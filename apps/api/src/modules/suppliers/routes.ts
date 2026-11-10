/**
 * @project DomusApp - API
 * @file src/modules/suppliers/routes.ts
 * @description Proveedores: datos, contactos, personal designado y contratos (con su archivo)
 *
 *  GET    /suppliers                         listado (?search&category&active) con contratos y vencimientos
 *  GET    /suppliers/summary                 activos, contratos vigentes, por vencer y vencidos
 *  GET    /suppliers/export                  Excel / PDF
 *  GET    /suppliers/:id                     detalle con contactos, personal y contratos
 *  POST   /suppliers                         crea
 *  PUT    /suppliers/:id                     edita (incluye activar / desactivar)
 *  POST   /suppliers/:id/contacts            agrega contacto       PUT|DELETE /suppliers/contacts/:id
 *  POST   /suppliers/:id/staff               agrega personal       PUT|DELETE /suppliers/staff/:id
 *  POST   /suppliers/:id/contracts           agrega contrato       PUT|DELETE /suppliers/contracts/:id
 *  PUT    /suppliers/contracts/:id/file      archivo del contrato (PDF o imagen, cuerpo crudo)
 */

import { Router } from "express";
import { z } from "zod";
import { one, query, withTx } from "../../db.js";
import { sendPdf, sendXlsx, type ExportColumn } from "../../lib/exports.js";
import { conflict, handler, idParams, notFound } from "../../lib/http.js";
import { requirePermission } from "../../security/authorize.js";
import { condominiumOf, txCtx } from "../../security/context.js";
import { optText } from "../access/shared.js";
import { fileUrls, rawUpload, removeStored, replaceImage, fileKey } from "../files/images.js";
import { condoMoney } from "../finance/shared.js";

export const SUPPLIER_CATEGORIES = [
  "security",
  "cleaning",
  "maintenance",
  "gardening",
  "elevators",
  "pools",
  "plumbing",
  "electrical",
  "pest_control",
  "administration",
  "other"
] as const;

export const SUPPLIER_CATEGORY_LABEL: Record<(typeof SUPPLIER_CATEGORIES)[number], string> = {
  security: "Seguridad",
  cleaning: "Limpieza",
  maintenance: "Mantenimiento",
  gardening: "Jardinería",
  elevators: "Ascensores",
  pools: "Piscinas",
  plumbing: "Fontanería",
  electrical: "Electricidad",
  pest_control: "Fumigación",
  administration: "Administración",
  other: "Otro"
};

const CONTRACT_STATUS_LABEL = { active: "Vigente", upcoming: "Por iniciar", expiring: "Por vencer", expired: "Vencido", cancelled: "Cancelado" };

/** Estado de un contrato (alias c) */
const CONTRACT_STATUS = `CASE WHEN c.is_cancelled THEN 'cancelled'
                              WHEN c.ends_on < CURRENT_DATE THEN 'expired'
                              WHEN c.starts_on > CURRENT_DATE THEN 'upcoming'
                              WHEN c.ends_on <= CURRENT_DATE + 30 THEN 'expiring'
                              ELSE 'active' END`;

export const optEmail = z
  .union([z.email("Correo inválido").max(120), z.literal("")])
  .nullish()
  .transform((v) => v || null);

/** Opciones para los selectores de otros módulos (casos, acuerdos, inventario) */
export function supplierOptions() {
  return query<{ id: string; name: string; category: string; isActive: boolean }>(
    `SELECT id, name, category, is_active AS "isActive" FROM suppliers ORDER BY is_active DESC, name`
  );
}

export const supplierRoutes = Router();
supplierRoutes.use(requirePermission("SUPPLIERS", "access"));

const supplierBody = z.object({
  name: z.string().trim().min(2, "Escriba el nombre").max(120),
  legalId: optText(30),
  category: z.enum(SUPPLIER_CATEGORIES),
  phone: optText(30),
  email: optEmail,
  address: optText(200),
  website: optText(200),
  notes: optText(1000),
  showToResidents: z.boolean().default(false),
  isActive: z.boolean().default(true)
});

const contactBody = z.object({
  names: z.string().trim().min(2, "Escriba el nombre").max(120),
  role: optText(80),
  phone: optText(30),
  email: optEmail,
  isPrimary: z.boolean().default(false)
});

const staffBody = z.object({
  names: z.string().trim().min(2, "Escriba el nombre").max(120),
  idNumber: optText(30),
  role: optText(80),
  phone: optText(30),
  schedule: optText(120),
  isActive: z.boolean().default(true)
});

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida (AAAA-MM-DD)");

const contractBody = z
  .object({
    title: z.string().trim().min(3, "Escriba el objeto del contrato").max(160),
    startsOn: isoDate,
    endsOn: isoDate.nullish().transform((v) => v || null),
    amount: z.coerce.number().min(0).max(1e10).nullish(),
    frequency: z.enum(["monthly", "quarterly", "yearly", "one_time"]),
    notes: optText(1000),
    isCancelled: z.boolean().default(false)
  })
  .refine((b) => !b.endsOn || b.endsOn >= b.startsOn, { message: "El fin debe ser posterior al inicio", path: ["endsOn"] });

interface SupplierRow {
  id: string;
  name: string;
  legalId: string | null;
  category: (typeof SUPPLIER_CATEGORIES)[number];
  phone: string | null;
  email: string | null;
  address: string | null;
  website: string | null;
  notes: string | null;
  showToResidents: boolean;
  isActive: boolean;
  contacts: number;
  staff: number;
  activeContracts: number;
  nextEnd: string | null;
  expiring: number;
  expired: number;
  primaryContact: string | null;
}

const SUPPLIER_SELECT = `s.id, s.name, s.legal_id AS "legalId", s.category, s.phone, s.email, s.address, s.website, s.notes,
  s.show_to_residents AS "showToResidents", s.is_active AS "isActive",
  (SELECT COUNT(*)::int FROM supplier_contacts x WHERE x.supplier_id = s.id) AS contacts,
  (SELECT COUNT(*)::int FROM supplier_staff x WHERE x.supplier_id = s.id AND x.is_active) AS staff,
  (SELECT COUNT(*)::int FROM supplier_contracts c WHERE c.supplier_id = s.id AND ${CONTRACT_STATUS} IN ('active', 'expiring')) AS "activeContracts",
  (SELECT to_char(MIN(c.ends_on), 'YYYY-MM-DD') FROM supplier_contracts c WHERE c.supplier_id = s.id AND NOT c.is_cancelled AND c.ends_on >= CURRENT_DATE) AS "nextEnd",
  (SELECT COUNT(*)::int FROM supplier_contracts c WHERE c.supplier_id = s.id AND ${CONTRACT_STATUS} = 'expiring') AS expiring,
  (SELECT COUNT(*)::int FROM supplier_contracts c WHERE c.supplier_id = s.id AND ${CONTRACT_STATUS} = 'expired'
      AND NOT EXISTS (SELECT 1 FROM supplier_contracts c2 WHERE c2.supplier_id = s.id AND NOT c2.is_cancelled
                         AND c2.starts_on <= CURRENT_DATE AND (c2.ends_on IS NULL OR c2.ends_on >= CURRENT_DATE))) AS expired,
  (SELECT x.names FROM supplier_contacts x WHERE x.supplier_id = s.id ORDER BY x.is_primary DESC, x.created_at LIMIT 1) AS "primaryContact"`;

const listQuery = z.object({
  search: z.string().trim().max(80).optional(),
  category: z.enum(SUPPLIER_CATEGORIES).optional(),
  active: z.enum(["true", "false", "all"]).default("true")
});

function listWhere(q: z.infer<typeof listQuery>) {
  const where: string[] = [];
  const params: unknown[] = [];
  if (q.active !== "all") where.push(`s.is_active = ${q.active === "true"}`);
  if (q.category) {
    params.push(q.category);
    where.push(`s.category = $${params.length}`);
  }
  if (q.search) {
    params.push(`%${q.search}%`);
    where.push(`(s.name ILIKE $${params.length} OR s.legal_id ILIKE $${params.length} OR EXISTS
      (SELECT 1 FROM supplier_contacts x WHERE x.supplier_id = s.id AND x.names ILIKE $${params.length}))`);
  }
  return { sql: where.length ? `WHERE ${where.join(" AND ")}` : "", params };
}

const duplicate = (err: unknown) => {
  if ((err as { code?: string }).code === "23505") throw conflict("DUPLICATE_NAME", "Ya existe un proveedor con ese nombre");
  throw err;
};

async function supplierDetail(id: string) {
  const s = await one<SupplierRow>(`SELECT ${SUPPLIER_SELECT} FROM suppliers s WHERE s.id = $1`, [id]);
  if (!s) return null;
  const [contacts, staff, contracts] = await Promise.all([
    query(
      `SELECT id, names, role, phone, email, is_primary AS "isPrimary" FROM supplier_contacts
        WHERE supplier_id = $1 ORDER BY is_primary DESC, names`,
      [id]
    ),
    query(
      `SELECT id, names, id_number AS "idNumber", role, phone, schedule, is_active AS "isActive" FROM supplier_staff
        WHERE supplier_id = $1 ORDER BY is_active DESC, names`,
      [id]
    ),
    query<{ fileKey: string | null; fileMime: string | null; title: string }>(
      `SELECT c.id, c.title, to_char(c.starts_on, 'YYYY-MM-DD') AS "startsOn", to_char(c.ends_on, 'YYYY-MM-DD') AS "endsOn",
              c.amount::float8 AS amount, c.frequency, c.notes, c.is_cancelled AS "isCancelled", ${CONTRACT_STATUS} AS status,
              f.storage_key AS "fileKey", f.mime_type AS "fileMime", f.original_name AS "fileName"
         FROM supplier_contracts c LEFT JOIN files f ON f.id = c.file_id
        WHERE c.supplier_id = $1 ORDER BY c.is_cancelled, c.starts_on DESC`,
      [id]
    )
  ]);
  return {
    ...s,
    contacts,
    staff,
    contracts: contracts.map(({ fileKey: key, fileMime, ...c }) => ({ ...c, file: fileUrls(key, fileMime, c.title) }))
  };
}

supplierRoutes.get(
  "/",
  handler({ query: listQuery }, async ({ query: q }) => {
    const w = listWhere(q);
    return query<SupplierRow>(`SELECT ${SUPPLIER_SELECT} FROM suppliers s ${w.sql} ORDER BY s.is_active DESC, s.name LIMIT 500`, w.params);
  })
);

supplierRoutes.get(
  "/summary",
  handler({}, async () =>
    one(
      `SELECT (SELECT COUNT(*)::int FROM suppliers WHERE is_active) AS active,
              (SELECT COUNT(*)::int FROM supplier_contracts c WHERE ${CONTRACT_STATUS} IN ('active', 'expiring')) AS contracts,
              (SELECT COUNT(*)::int FROM supplier_contracts c WHERE ${CONTRACT_STATUS} = 'expiring') AS expiring,
              (SELECT COUNT(*)::int FROM supplier_staff WHERE is_active) AS staff`
    )
  )
);

supplierRoutes.get(
  "/export",
  requirePermission("SUPPLIERS", "download"),
  handler({ query: listQuery.extend({ format: z.enum(["xlsx", "pdf"]).default("xlsx") }) }, async ({ req, res, query: q }) => {
    const w = listWhere(q);
    const rows = await query<SupplierRow>(`SELECT ${SUPPLIER_SELECT} FROM suppliers s ${w.sql} ORDER BY s.name`, w.params);
    const c = await condoMoney(condominiumOf(req));
    const columns: ExportColumn<SupplierRow>[] = [
      { header: "Proveedor", width: 24, value: (s) => s.name },
      { header: "Cédula jurídica", width: 14, value: (s) => s.legalId ?? "" },
      { header: "Categoría", width: 14, value: (s) => SUPPLIER_CATEGORY_LABEL[s.category] },
      { header: "Teléfono", width: 12, value: (s) => s.phone ?? "" },
      { header: "Correo", width: 22, value: (s) => s.email ?? "" },
      { header: "Contacto", width: 18, value: (s) => s.primaryContact ?? "" },
      { header: "Personal", width: 8, value: (s) => s.staff },
      { header: "Contratos vigentes", width: 10, value: (s) => s.activeContracts },
      { header: "Próximo vencimiento", width: 12, value: (s) => s.nextEnd ?? "" },
      { header: "Estado", width: 9, value: (s) => (s.isActive ? "Activo" : "Inactivo") }
    ];
    const spec = { title: "Proveedores", subtitle: q.category ? SUPPLIER_CATEGORY_LABEL[q.category] : "Todos", condominium: c.name, color: c.color, timezone: c.timezone, columns, rows, fileBase: "proveedores" };
    await (q.format === "pdf" ? sendPdf(res, spec) : sendXlsx(res, spec));
  })
);

supplierRoutes.get(
  "/:id",
  handler({ params: idParams }, async ({ params }) => {
    const s = await supplierDetail(params.id);
    if (!s) throw notFound("Proveedor no encontrado");
    return s;
  })
);

const SUPPLIER_COLUMNS = `name, legal_id, category, phone, email, address, website, notes, show_to_residents, is_active`;
const supplierValues = (b: z.infer<typeof supplierBody>) => [
  b.name,
  b.legalId,
  b.category,
  b.phone,
  b.email,
  b.address,
  b.website,
  b.notes,
  b.showToResidents,
  b.isActive
];

supplierRoutes.post(
  "/",
  requirePermission("SUPPLIERS", "add_new"),
  handler({ body: supplierBody }, async ({ req, body }) => {
    const row = await withTx(txCtx(req), (client) =>
      one<{ id: string }>(
        `INSERT INTO suppliers (${SUPPLIER_COLUMNS}, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, fn_current_app_user()) RETURNING id`,
        supplierValues(body),
        client
      )
    ).catch(duplicate);
    return supplierDetail(row!.id);
  })
);

supplierRoutes.put(
  "/:id",
  requirePermission("SUPPLIERS", "edit"),
  handler({ params: idParams, body: supplierBody }, async ({ req, params, body }) => {
    const row = await withTx(txCtx(req), (client) =>
      one<{ id: string }>(
        `UPDATE suppliers SET (${SUPPLIER_COLUMNS}, updated_by) = ($2, $3, $4, $5, $6, $7, $8, $9, $10, $11, fn_current_app_user())
          WHERE id = $1 RETURNING id`,
        [params.id, ...supplierValues(body)],
        client
      )
    ).catch(duplicate);
    if (!row) throw notFound("Proveedor no encontrado");
    return supplierDetail(row.id);
  })
);

// ------------------------------------------------------------------ Contactos, personal y contratos

/** Registra POST /:id/<path>, PUT /<path>/:id y DELETE /<path>/:id de un hijo del proveedor */
function child<S extends z.ZodType>(opts: {
  path: string;
  table: string;
  body: S;
  columns: string;
  values: (b: z.infer<S>) => unknown[];
  /** Antes de guardar (p. ej. un solo contacto principal) */
  before?: (client: import("pg").PoolClient, supplierId: string, b: z.infer<S>) => Promise<void>;
}) {
  const n = opts.columns.split(",").length;
  const ph = (from: number) => Array.from({ length: n }, (_, i) => `$${i + from}`).join(", ");

  supplierRoutes.post(
    `/:id/${opts.path}`,
    requirePermission("SUPPLIERS", "edit"),
    handler({ params: idParams, body: opts.body }, async ({ req, params, body }) => {
      await withTx(txCtx(req), async (client) => {
        const s = await one(`SELECT 1 FROM suppliers WHERE id = $1`, [params.id], client);
        if (!s) throw notFound("Proveedor no encontrado");
        await opts.before?.(client, params.id, body);
        await client.query(`INSERT INTO ${opts.table} (supplier_id, ${opts.columns}) VALUES ($1, ${ph(2)})`, [params.id, ...opts.values(body)]);
      });
      return supplierDetail(params.id);
    })
  );

  supplierRoutes.put(
    `/${opts.path}/:id`,
    requirePermission("SUPPLIERS", "edit"),
    handler({ params: idParams, body: opts.body }, async ({ req, params, body }) => {
      const row = await withTx(txCtx(req), async (client) => {
        const cur = await one<{ supplier_id: string }>(`SELECT supplier_id FROM ${opts.table} WHERE id = $1`, [params.id], client);
        if (!cur) throw notFound();
        await opts.before?.(client, cur.supplier_id, body);
        await client.query(`UPDATE ${opts.table} SET (${opts.columns}) = ROW(${ph(2)}) WHERE id = $1`, [params.id, ...opts.values(body)]);
        return cur;
      });
      return supplierDetail(row.supplier_id);
    })
  );

  supplierRoutes.delete(
    `/${opts.path}/:id`,
    requirePermission("SUPPLIERS", "delete"),
    handler({ params: idParams }, async ({ req, params }) => {
      const row = await withTx(txCtx(req), (client) =>
        one<{ supplier_id: string; file_id?: string | null }>(`DELETE FROM ${opts.table} WHERE id = $1 RETURNING *`, [params.id], client)
      );
      if (!row) throw notFound();
      if (row.file_id) {
        // El archivo del contrato queda huérfano: se borra su fila y su contenido
        const key = fileKey(condominiumOf(req), row.file_id);
        await withTx(txCtx(req), (client) => client.query(`DELETE FROM files WHERE id = $1`, [row.file_id]));
        await removeStored(key);
      }
      return supplierDetail(row.supplier_id);
    })
  );
}

child({
  path: "contacts",
  table: "supplier_contacts",
  body: contactBody,
  columns: "names, role, phone, email, is_primary",
  values: (b) => [b.names, b.role, b.phone, b.email, b.isPrimary],
  before: async (client, supplierId, b) => {
    if (b.isPrimary) await client.query(`UPDATE supplier_contacts SET is_primary = FALSE WHERE supplier_id = $1`, [supplierId]);
  }
});

child({
  path: "staff",
  table: "supplier_staff",
  body: staffBody,
  columns: "names, id_number, role, phone, schedule, is_active",
  values: (b) => [b.names, b.idNumber, b.role, b.phone, b.schedule, b.isActive]
});

child({
  path: "contracts",
  table: "supplier_contracts",
  body: contractBody,
  columns: "title, starts_on, ends_on, amount, frequency, notes, is_cancelled",
  values: (b) => [b.title, b.startsOn, b.endsOn, b.amount ?? null, b.frequency, b.notes, b.isCancelled]
});

supplierRoutes.put(
  "/contracts/:id/file",
  requirePermission("SUPPLIERS", "edit"),
  rawUpload,
  handler({ params: idParams }, async ({ req, params }) => {
    const cur = await one<{ supplier_id: string }>(`SELECT supplier_id FROM supplier_contracts WHERE id = $1`, [params.id]);
    if (!cur) throw notFound("Contrato no encontrado");
    await replaceImage({
      req,
      condominiumId: condominiumOf(req),
      profile: "receipt",
      purpose: "contract",
      allowPdf: true,
      withTx: (fn) => withTx(txCtx(req), fn),
      attach: async (client, fileId) => {
        const prev = await one<{ prev: string | null }>(
          `UPDATE supplier_contracts x SET file_id = $2 FROM (SELECT file_id AS prev FROM supplier_contracts WHERE id = $1) old
            WHERE x.id = $1 RETURNING old.prev`,
          [params.id, fileId],
          client
        );
        return prev?.prev ?? null;
      }
    });
    return supplierDetail(cur.supplier_id);
  })
);

export { CONTRACT_STATUS_LABEL };
