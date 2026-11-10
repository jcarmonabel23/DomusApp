/**
 * @project DomusApp - API
 * @file src/modules/inventory/routes.ts
 * @description Inventario: mobiliario, equipos y bienes del condominio, con foto y bitácora
 *
 *  GET    /inventory/summary          bienes, valor, en mal estado y mantenimientos por vencer
 *  GET    /inventory                  listado (?search&category&condition&amenityId&active&maintenance=due)
 *  GET    /inventory/export           Excel / PDF
 *  GET    /inventory/options          áreas comunes y proveedores para los selectores
 *  GET    /inventory/:id              detalle con bitácora
 *  POST   /inventory                  crea
 *  PUT    /inventory/:id              edita
 *  PUT    /inventory/:id/photo        foto (cuerpo crudo)
 *  POST   /inventory/:id/logs         mantenimiento, reparación, traslado, cambio de estado, baja o nota
 *  DELETE /inventory/:id              borra un registro hecho por error (con su bitácora y foto)
 *
 * Mantenimiento: si el bien indica cada cuántos meses lo lleva, al registrar uno se recalcula el próximo.
 */

import { Router } from "express";
import { z } from "zod";
import { one, query, withTx } from "../../db.js";
import { sendPdf, sendXlsx, type ExportColumn } from "../../lib/exports.js";
import { conflict, handler, idParams, notFound } from "../../lib/http.js";
import { emitToStaff } from "../../lib/realtime.js";
import { requirePermission } from "../../security/authorize.js";
import { condominiumOf, txCtx } from "../../security/context.js";
import { optText } from "../access/shared.js";
import { fileKey, photoUrls, rawUpload, removeStored, replaceImage } from "../files/images.js";
import { condoMoney, money } from "../finance/shared.js";
import { supplierOptions } from "../suppliers/routes.js";

export const INVENTORY_CATEGORIES = ["furniture", "equipment", "appliance", "electronics", "tools", "security", "sports", "garden", "other"] as const;
const CONDITIONS = ["good", "fair", "poor", "broken"] as const;
const LOG_KINDS = ["maintenance", "repair", "move", "condition", "retire", "note"] as const;

export const INVENTORY_CATEGORY_LABEL: Record<(typeof INVENTORY_CATEGORIES)[number], string> = {
  furniture: "Mobiliario",
  equipment: "Equipo",
  appliance: "Electrodoméstico",
  electronics: "Electrónica",
  tools: "Herramienta",
  security: "Seguridad",
  sports: "Deportivo",
  garden: "Jardín",
  other: "Otro"
};
const CONDITION_LABEL: Record<(typeof CONDITIONS)[number], string> = { good: "Bueno", fair: "Regular", poor: "Malo", broken: "Dañado" };

/** Días antes del mantenimiento en que se avisa como "por vencer" */
const DUE_DAYS = 15;

const ITEM_SELECT = `i.id, i.code, i.name, i.category, i.location, i.amenity_id AS "amenityId", am.name AS "amenityName",
  i.quantity, i.unit_value::float8 AS "unitValue", (i.quantity * COALESCE(i.unit_value, 0))::float8 AS "totalValue",
  to_char(i.acquired_on, 'YYYY-MM-DD') AS "acquiredOn", i.supplier_id AS "supplierId", s.name AS "supplierName",
  i.brand, i.model, i.serial, i.condition, i.maintenance_months AS "maintenanceMonths",
  to_char(i.next_maintenance_on, 'YYYY-MM-DD') AS "nextMaintenanceOn",
  (i.is_active AND i.next_maintenance_on <= CURRENT_DATE + ${DUE_DAYS}) AS "maintenanceDue",
  (i.is_active AND i.next_maintenance_on < CURRENT_DATE) AS "maintenanceOverdue",
  i.notes, i.is_active AS "isActive", i.retired_at AS "retiredAt", i.retire_reason AS "retireReason",
  f.storage_key AS "photoKey", i.updated_at AS "updatedAt"`;
const ITEM_JOINS = `FROM inventory_items i
  LEFT JOIN amenities am ON am.id = i.amenity_id
  LEFT JOIN suppliers s ON s.id = i.supplier_id
  LEFT JOIN files f ON f.id = i.photo_file_id`;

interface ItemRow {
  id: string;
  code: string;
  name: string;
  category: (typeof INVENTORY_CATEGORIES)[number];
  location: string | null;
  amenityName: string | null;
  quantity: number;
  unitValue: number | null;
  totalValue: number;
  condition: (typeof CONDITIONS)[number];
  nextMaintenanceOn: string | null;
  supplierName: string | null;
  isActive: boolean;
  photoKey: string | null;
  [k: string]: unknown;
}

const withPhoto = ({ photoKey, ...i }: ItemRow) => ({ ...i, photo: photoUrls(photoKey) });

export const inventoryRoutes = Router();
inventoryRoutes.use(requirePermission("INVENTORY", "access"));

const changed = (condominiumId: string) => emitToStaff(condominiumId, "inventory:update", {});

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida (AAAA-MM-DD)");
const optDate = isoDate.nullish().transform((v) => v || null);
const optUuid = z.uuid().nullish().transform((v) => v ?? null);

inventoryRoutes.get(
  "/summary",
  handler({}, async () =>
    one(
      `SELECT COUNT(*) FILTER (WHERE is_active)::int AS items,
              COALESCE(SUM(quantity) FILTER (WHERE is_active), 0)::int AS units,
              COALESCE(SUM(quantity * COALESCE(unit_value, 0)) FILTER (WHERE is_active), 0)::float8 AS value,
              COUNT(*) FILTER (WHERE is_active AND condition IN ('poor', 'broken'))::int AS damaged,
              COUNT(*) FILTER (WHERE is_active AND next_maintenance_on <= CURRENT_DATE + ${DUE_DAYS})::int AS "maintenanceDue",
              COUNT(*) FILTER (WHERE NOT is_active)::int AS retired
         FROM inventory_items`
    )
  )
);

const listQuery = z.object({
  search: z.string().trim().max(80).optional(),
  category: z.enum(INVENTORY_CATEGORIES).optional(),
  condition: z.enum(CONDITIONS).optional(),
  amenityId: z.uuid().optional(),
  active: z.enum(["true", "false", "all"]).default("true"),
  maintenance: z.enum(["due"]).optional()
});

function listWhere(q: z.infer<typeof listQuery>) {
  const where: string[] = [];
  const params: unknown[] = [];
  const add = (sql: string, v: unknown) => {
    params.push(v);
    where.push(sql.replaceAll("?", `$${params.length}`));
  };
  if (q.active !== "all") where.push(`i.is_active = ${q.active === "true"}`);
  if (q.category) add(`i.category = ?`, q.category);
  if (q.condition) add(`i.condition = ?`, q.condition);
  if (q.amenityId) add(`i.amenity_id = ?`, q.amenityId);
  if (q.maintenance === "due") where.push(`i.next_maintenance_on <= CURRENT_DATE + ${DUE_DAYS}`);
  if (q.search) add(`(i.name ILIKE ? OR i.code ILIKE ? OR i.serial ILIKE ? OR i.location ILIKE ? OR i.brand ILIKE ?)`, `%${q.search}%`);
  return { sql: where.length ? `WHERE ${where.join(" AND ")}` : "", params };
}

inventoryRoutes.get(
  "/",
  handler({ query: listQuery }, async ({ query: q }) => {
    const w = listWhere(q);
    const rows = await query<ItemRow>(`SELECT ${ITEM_SELECT} ${ITEM_JOINS} ${w.sql} ORDER BY i.is_active DESC, i.code LIMIT 1000`, w.params);
    return rows.map(withPhoto);
  })
);

inventoryRoutes.get(
  "/export",
  requirePermission("INVENTORY", "download"),
  handler({ query: listQuery.extend({ format: z.enum(["xlsx", "pdf"]).default("xlsx") }) }, async ({ req, res, query: q }) => {
    const w = listWhere(q);
    const rows = await query<ItemRow>(`SELECT ${ITEM_SELECT} ${ITEM_JOINS} ${w.sql} ORDER BY i.code`, w.params);
    const c = await condoMoney(condominiumOf(req));
    const columns: ExportColumn<ItemRow>[] = [
      { header: "Código", width: 9, value: (i) => i.code },
      { header: "Bien", width: 24, value: (i) => i.name },
      { header: "Categoría", width: 12, value: (i) => INVENTORY_CATEGORY_LABEL[i.category] },
      { header: "Ubicación", width: 18, value: (i) => [i.amenityName, i.location].filter(Boolean).join(" · ") },
      { header: "Cant.", width: 6, value: (i) => i.quantity },
      { header: "Valor unitario", width: 12, value: (i) => (i.unitValue != null ? money(i.unitValue, c) : "") },
      { header: "Valor total", width: 12, value: (i) => money(i.totalValue, c) },
      { header: "Estado", width: 9, value: (i) => (i.isActive ? CONDITION_LABEL[i.condition] : "De baja") },
      { header: "Próx. mantenimiento", width: 12, value: (i) => i.nextMaintenanceOn ?? "" },
      { header: "Proveedor", width: 16, value: (i) => i.supplierName ?? "" }
    ];
    const spec = { title: "Inventario", subtitle: q.category ? INVENTORY_CATEGORY_LABEL[q.category] : "Todos los bienes", condominium: c.name, color: c.color, timezone: c.timezone, columns, rows, fileBase: "inventario" };
    await (q.format === "pdf" ? sendPdf(res, spec) : sendXlsx(res, spec));
  })
);

inventoryRoutes.get(
  "/options",
  handler({}, async () => {
    const [amenities, suppliers] = await Promise.all([query(`SELECT id, name FROM amenities ORDER BY name`), supplierOptions()]);
    return { amenities, suppliers };
  })
);

async function itemDetail(id: string) {
  const i = await one<ItemRow>(`SELECT ${ITEM_SELECT} ${ITEM_JOINS} WHERE i.id = $1`, [id]);
  if (!i) return null;
  const logs = await query(
    `SELECT l.id, l.kind, to_char(l.happened_on, 'YYYY-MM-DD') AS "happenedOn", l.description, l.cost::float8 AS cost,
            s.name AS "supplierName", u.names AS "createdByName", l.created_at AS "createdAt"
       FROM inventory_logs l LEFT JOIN suppliers s ON s.id = l.supplier_id LEFT JOIN users u ON u.id = l.created_by
      WHERE l.item_id = $1 ORDER BY l.happened_on DESC, l.created_at DESC`,
    [id]
  );
  return { ...withPhoto(i), logs };
}

const itemBody = z.object({
  code: z
    .string()
    .trim()
    .min(1, "Escriba el código")
    .max(30)
    .transform((v) => v.toUpperCase()),
  name: z.string().trim().min(2, "Escriba el nombre").max(120),
  category: z.enum(INVENTORY_CATEGORIES),
  location: optText(120),
  amenityId: optUuid,
  quantity: z.coerce.number().int().min(0).max(1_000_000),
  unitValue: z.coerce.number().min(0).max(1e10).nullish(),
  acquiredOn: optDate,
  supplierId: optUuid,
  brand: optText(80),
  model: optText(80),
  serial: optText(80),
  condition: z.enum(CONDITIONS),
  maintenanceMonths: z.coerce.number().int().min(1).max(120).nullish(),
  nextMaintenanceOn: optDate,
  notes: optText(1000)
});

const ITEM_COLUMNS = `code, name, category, location, amenity_id, quantity, unit_value, acquired_on, supplier_id, brand, model, serial,
  condition, maintenance_months, next_maintenance_on, notes`;
const itemValues = (b: z.infer<typeof itemBody>) => [
  b.code,
  b.name,
  b.category,
  b.location,
  b.amenityId,
  b.quantity,
  b.unitValue ?? null,
  b.acquiredOn,
  b.supplierId,
  b.brand,
  b.model,
  b.serial,
  b.condition,
  b.maintenanceMonths ?? null,
  b.nextMaintenanceOn,
  b.notes
];
const PH = Array.from({ length: 16 }, (_, i) => `$${i + 1}`).join(", ");
const PH2 = Array.from({ length: 16 }, (_, i) => `$${i + 2}`).join(", ");

const duplicate = (err: unknown) => {
  if ((err as { code?: string }).code === "23505") throw conflict("DUPLICATE_CODE", "Ya existe un bien con ese código");
  throw err;
};

inventoryRoutes.get(
  "/:id",
  handler({ params: idParams }, async ({ params }) => {
    const i = await itemDetail(params.id);
    if (!i) throw notFound("Bien no encontrado");
    return i;
  })
);

inventoryRoutes.post(
  "/",
  requirePermission("INVENTORY", "add_new"),
  handler({ body: itemBody }, async ({ req, body }) => {
    const row = await withTx(txCtx(req), (client) =>
      one<{ id: string }>(`INSERT INTO inventory_items (${ITEM_COLUMNS}, created_by) VALUES (${PH}, fn_current_app_user()) RETURNING id`, itemValues(body), client)
    ).catch(duplicate);
    changed(condominiumOf(req));
    return itemDetail(row!.id);
  })
);

inventoryRoutes.put(
  "/:id",
  requirePermission("INVENTORY", "edit"),
  handler({ params: idParams, body: itemBody }, async ({ req, params, body }) => {
    const row = await withTx(txCtx(req), (client) =>
      one<{ id: string }>(
        `UPDATE inventory_items SET (${ITEM_COLUMNS}, updated_by) = ROW(${PH2}, fn_current_app_user()) WHERE id = $1 RETURNING id`,
        [params.id, ...itemValues(body)],
        client
      )
    ).catch(duplicate);
    if (!row) throw notFound("Bien no encontrado");
    changed(condominiumOf(req));
    return itemDetail(params.id);
  })
);

inventoryRoutes.put(
  "/:id/photo",
  requirePermission("INVENTORY", "edit"),
  rawUpload,
  handler({ params: idParams }, async ({ req, params }) => {
    if (!(await one(`SELECT 1 FROM inventory_items WHERE id = $1`, [params.id]))) throw notFound("Bien no encontrado");
    await replaceImage({
      req,
      condominiumId: condominiumOf(req),
      profile: "photo",
      purpose: "inventory_photo",
      withTx: (fn) => withTx(txCtx(req), fn),
      attach: async (client, fileId) => {
        const prev = await one<{ prev: string | null }>(
          `UPDATE inventory_items x SET photo_file_id = $2 FROM (SELECT photo_file_id AS prev FROM inventory_items WHERE id = $1) old
            WHERE x.id = $1 RETURNING old.prev`,
          [params.id, fileId],
          client
        );
        return prev?.prev ?? null;
      }
    });
    changed(condominiumOf(req));
    return itemDetail(params.id);
  })
);

inventoryRoutes.post(
  "/:id/logs",
  requirePermission("INVENTORY", "edit"),
  handler(
    {
      params: idParams,
      body: z
        .object({
          kind: z.enum(LOG_KINDS),
          happenedOn: isoDate,
          description: z.string().trim().min(3, "Describa lo que se hizo").max(500),
          cost: z.coerce.number().min(0).max(1e10).nullish(),
          supplierId: optUuid,
          condition: z.enum(CONDITIONS).nullish(),
          location: optText(120),
          amenityId: optUuid
        })
        .refine((b) => b.kind !== "condition" || b.condition, { message: "Elija el nuevo estado", path: ["condition"] })
        .refine((b) => b.kind !== "move" || b.location || b.amenityId, { message: "Indique la nueva ubicación", path: ["location"] })
    },
    async ({ req, params, body }) => {
      await withTx(txCtx(req), async (client) => {
        const item = await one<{ is_active: boolean }>(`SELECT is_active FROM inventory_items WHERE id = $1 FOR UPDATE`, [params.id], client);
        if (!item) throw notFound("Bien no encontrado");
        if (!item.is_active) throw conflict("RETIRED", "El bien está dado de baja");
        await client.query(
          `INSERT INTO inventory_logs (item_id, kind, happened_on, description, cost, supplier_id, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, fn_current_app_user())`,
          [params.id, body.kind, body.happenedOn, body.description, body.cost ?? null, body.supplierId]
        );
        if (body.kind === "maintenance") {
          await client.query(
            `UPDATE inventory_items SET next_maintenance_on = CASE WHEN maintenance_months IS NULL THEN NULL
                                                                 ELSE ($2::date + make_interval(months => maintenance_months))::date END
              WHERE id = $1`,
            [params.id, body.happenedOn]
          );
        }
        if (body.kind === "repair" || body.kind === "condition") {
          await client.query(`UPDATE inventory_items SET condition = COALESCE($2::varchar, CASE WHEN $3 THEN 'good' ELSE condition END) WHERE id = $1`, [
            params.id,
            body.condition ?? null,
            body.kind === "repair"
          ]);
        }
        if (body.kind === "move") {
          await client.query(`UPDATE inventory_items SET location = $2, amenity_id = $3 WHERE id = $1`, [params.id, body.location, body.amenityId]);
        }
        if (body.kind === "retire") {
          await client.query(`UPDATE inventory_items SET is_active = FALSE, retired_at = now(), retire_reason = $2 WHERE id = $1`, [
            params.id,
            body.description.slice(0, 300)
          ]);
        }
      });
      changed(condominiumOf(req));
      return itemDetail(params.id);
    }
  )
);

inventoryRoutes.delete(
  "/:id",
  requirePermission("INVENTORY", "delete"),
  handler({ params: idParams }, async ({ req, params }) => {
    const condominiumId = condominiumOf(req);
    const row = await withTx(txCtx(req), async (client) => {
      const r = await one<{ photo_file_id: string | null }>(`DELETE FROM inventory_items WHERE id = $1 RETURNING photo_file_id`, [params.id], client);
      if (!r) throw notFound("Bien no encontrado");
      if (r.photo_file_id) await client.query(`DELETE FROM files WHERE id = $1`, [r.photo_file_id]);
      return r;
    });
    await removeStored(fileKey(condominiumId, row.photo_file_id));
    changed(condominiumId);
    return { ok: true };
  })
);
