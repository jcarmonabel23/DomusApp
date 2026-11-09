/**
 * @project DomusApp - API
 * @file src/modules/access/admin.ts
 * @description Control de acceso en el panel (módulo ACCESS): bitácora, exportación, autorizados y vehículos
 */

import { Router } from "express";
import { z } from "zod";
import { one, query, withTx } from "../../db.js";
import { sendPdf, sendXlsx, type ExportColumn } from "../../lib/exports.js";
import { conflict, handler, idParams, notFound } from "../../lib/http.js";
import { requirePermission } from "../../security/authorize.js";
import { condominiumOf, txCtx } from "../../security/context.js";
import { LOG_SELECT, VEHICLE_SELECT } from "./resident.js";
import { AUTHORIZATION_SELECT, KINDS, KIND_LABEL, optText, plateSchema, withPhoto } from "./shared.js";

export const accessRoutes = Router();

accessRoutes.get(
  "/summary",
  requirePermission("ACCESS", "view"),
  handler({}, () =>
    one(
      `SELECT (SELECT count(*)::int FROM access_logs WHERE status = 'inside') AS inside,
              (SELECT count(*)::int FROM access_logs WHERE status = 'pending' AND created_at > NOW() - INTERVAL '12 hours') AS pending,
              (SELECT count(*)::int FROM access_logs WHERE entry_at::date = CURRENT_DATE) AS "entriesToday",
              (SELECT count(*)::int FROM authorizations a WHERE a.status = 'active'
                  AND (a.valid_to IS NULL OR a.valid_to >= CURRENT_DATE)) AS "activeAuthorizations",
              (SELECT count(*)::int FROM vehicles WHERE is_active) AS vehicles`
    )
  )
);

// ------------------------------------------------------------------ Bitácora

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const logFilters = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  unitId: z.uuid().optional(),
  status: z.enum(["pending", "inside", "exited", "denied"]).optional(),
  kind: z.string().max(12).optional(),
  q: z.string().trim().max(60).optional()
});

/** WHERE de la bitácora; fechas por el día del condominio (la sesión de BD ya está en su zona) */
function logWhere(f: z.infer<typeof logFilters>) {
  return {
    sql: `WHERE ($1::date IS NULL OR COALESCE(l.entry_at, l.created_at)::date >= $1)
            AND ($2::date IS NULL OR COALESCE(l.entry_at, l.created_at)::date <= $2)
            AND ($3::uuid IS NULL OR l.unit_id = $3)
            AND ($4::text IS NULL OR l.status = $4)
            AND ($5::text IS NULL OR l.kind = $5)
            AND ($6::text IS NULL OR l.names ILIKE '%' || $6 || '%' OR l.id_number ILIKE '%' || $6 || '%'
                 OR l.plate LIKE '%' || upper(regexp_replace($6, '[^A-Za-z0-9]', '', 'g')) || '%')`,
    params: [f.from ?? null, f.to ?? null, f.unitId ?? null, f.status ?? null, f.kind || null, f.q || null]
  };
}

const LOG_ADMIN_SELECT = `${LOG_SELECT},
  ge.names AS "entryByName", gx.names AS "exitByName", rb.names AS "respondedByName"`;
const LOG_JOINS = `FROM access_logs l JOIN units u ON u.id = l.unit_id
  LEFT JOIN users ge ON ge.id = l.entry_by LEFT JOIN users gx ON gx.id = l.exit_by LEFT JOIN users rb ON rb.id = l.responded_by`;

accessRoutes.get(
  "/logs",
  requirePermission("ACCESS", "view"),
  handler(
    { query: logFilters.extend({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(200).default(50) }) },
    async ({ query: f }) => {
      const w = logWhere(f);
      const [rows, total] = await Promise.all([
        query(
          `SELECT ${LOG_ADMIN_SELECT} ${LOG_JOINS} ${w.sql}
            ORDER BY COALESCE(l.entry_at, l.created_at) DESC
            LIMIT $7 OFFSET $8`,
          [...w.params, f.pageSize, (f.page - 1) * f.pageSize]
        ),
        one<{ n: number }>(`SELECT count(*)::int AS n FROM access_logs l ${w.sql}`, w.params)
      ]);
      return { rows, total: total?.n ?? 0 };
    }
  )
);

interface LogRow {
  unitCode: string;
  kind: string;
  names: string;
  idNumber: string | null;
  plate: string | null;
  status: string;
  response: string | null;
  entryAt: Date | null;
  exitAt: Date | null;
  createdAt: Date;
  entryByName: string | null;
  exitByName: string | null;
  notes: string | null;
}

const STATUS_LABEL: Record<string, string> = { pending: "Pendiente", inside: "Adentro", exited: "Salió", denied: "Rechazado" };

const LOG_COLUMNS: ExportColumn<LogRow>[] = [
  { header: "Ingreso", width: 16, value: (r) => r.entryAt ?? r.createdAt },
  { header: "Salida", width: 16, value: (r) => r.exitAt },
  { header: "Filial", width: 10, value: (r) => r.unitCode },
  { header: "Tipo", width: 16, value: (r) => KIND_LABEL[r.kind] ?? r.kind },
  { header: "Nombre", width: 26, value: (r) => r.names },
  { header: "Documento", width: 14, value: (r) => r.idNumber },
  { header: "Placa", width: 10, value: (r) => r.plate },
  { header: "Estado", width: 11, value: (r) => STATUS_LABEL[r.status] ?? r.status },
  { header: "Registró ingreso", width: 18, value: (r) => r.entryByName },
  { header: "Registró salida", width: 18, value: (r) => r.exitByName },
  { header: "Notas", width: 26, value: (r) => r.notes }
];

accessRoutes.get(
  "/logs/export",
  requirePermission("ACCESS", "download"),
  handler({ query: logFilters.extend({ format: z.enum(["xlsx", "pdf"]).default("xlsx") }) }, async ({ query: f, req, res }) => {
    const w = logWhere(f);
    const rows = await query<LogRow>(
      `SELECT ${LOG_ADMIN_SELECT} ${LOG_JOINS} ${w.sql} ORDER BY COALESCE(l.entry_at, l.created_at) DESC LIMIT 20000`,
      w.params
    );
    const condo = await one<{ name: string; brand_color: string | null; timezone: string }>(
      `SELECT name, brand_color, timezone FROM condominiums WHERE id = $1`,
      [condominiumOf(req)]
    );
    const period = f.from || f.to ? `del ${f.from ?? "inicio"} al ${f.to ?? "hoy"}` : "todo el historial";
    const spec = {
      title: "Bitácora de acceso",
      subtitle: `Período: ${period} · ${rows.length} registro(s)`,
      condominium: condo?.name ?? "DomusApp",
      color: condo?.brand_color ?? null,
      timezone: condo?.timezone ?? "UTC",
      columns: LOG_COLUMNS,
      rows,
      fileBase: "Bitacora_acceso"
    };
    if (f.format === "pdf") await sendPdf(res, spec);
    else await sendXlsx(res, spec);
    return undefined;
  })
);

// ------------------------------------------------------------------ Autorizados

accessRoutes.get(
  "/authorizations",
  requirePermission("ACCESS", "view"),
  handler(
    {
      query: z.object({
        kind: z.enum(KINDS).optional(),
        status: z.enum(["active", "used", "revoked", "expired"]).optional(),
        unitId: z.uuid().optional(),
        q: z.string().trim().max(60).optional()
      })
    },
    async ({ query: f }) => {
      const rows = await query<{ photoFileId: string | null; condominiumId: string }>(
        `SELECT ${AUTHORIZATION_SELECT}, cu.names AS "createdByName"
           FROM authorizations a JOIN units u ON u.id = a.unit_id
           LEFT JOIN users cu ON cu.id = a.created_by
          WHERE ($1::text IS NULL OR a.kind = $1)
            AND ($2::text IS NULL
                 OR ($2 = 'expired' AND a.status = 'active' AND a.valid_to < CURRENT_DATE)
                 OR ($2 = 'active' AND a.status = 'active' AND (a.valid_to IS NULL OR a.valid_to >= CURRENT_DATE))
                 OR ($2 IN ('used', 'revoked') AND a.status = $2))
            AND ($3::uuid IS NULL OR a.unit_id = $3)
            AND ($4::text IS NULL OR a.names ILIKE '%' || $4 || '%' OR a.id_number ILIKE '%' || $4 || '%'
                 OR a.plate LIKE '%' || upper(regexp_replace($4, '[^A-Za-z0-9]', '', 'g')) || '%' OR u.code ILIKE '%' || $4 || '%')
          ORDER BY a.created_at DESC LIMIT 500`,
        [f.kind ?? null, f.status ?? null, f.unitId ?? null, f.q || null]
      );
      return rows.map(withPhoto);
    }
  )
);

/** La administración revoca un permiso (p. ej. un empleado que ya no trabaja en la filial) */
accessRoutes.post(
  "/authorizations/:id/revoke",
  requirePermission("ACCESS", "edit"),
  handler({ params: idParams }, async ({ params, req }) => {
    const row = await withTx(txCtx(req), (client) =>
      one(
        `UPDATE authorizations SET status = 'revoked', updated_by = fn_current_app_user()
          WHERE id = $1 AND status = 'active' RETURNING id`,
        [params.id],
        client
      )
    );
    if (!row) throw conflict("NOT_ACTIVE", "El permiso ya no está activo");
    return undefined;
  })
);

// ------------------------------------------------------------------ Vehículos

const vehicleBody = z.object({
  unitId: z.uuid(),
  plate: plateSchema.refine((v) => v !== null, "Indique la placa"),
  kind: z.enum(["car", "motorcycle", "truck", "bicycle", "other"]).default("car"),
  brand: optText(40),
  model: optText(40),
  color: optText(30),
  notes: optText(300),
  isActive: z.boolean().default(true)
});

accessRoutes.get(
  "/vehicles",
  requirePermission("ACCESS", "view"),
  handler({ query: z.object({ q: z.string().trim().max(60).optional(), unitId: z.uuid().optional() }) }, ({ query: f }) =>
    query(
      `SELECT ${VEHICLE_SELECT} FROM vehicles v JOIN units u ON u.id = v.unit_id
        WHERE ($1::text IS NULL OR v.plate LIKE '%' || upper(regexp_replace($1, '[^A-Za-z0-9]', '', 'g')) || '%'
               OR u.code ILIKE '%' || $1 || '%' OR v.brand ILIKE '%' || $1 || '%')
          AND ($2::uuid IS NULL OR v.unit_id = $2)
        ORDER BY v.is_active DESC, u.code, v.plate`,
      [f.q || null, f.unitId ?? null]
    )
  )
);

async function assertPlateFree(plate: string, exceptId: string | null) {
  if (await one(`SELECT 1 FROM vehicles WHERE plate = $1 AND is_active AND ($2::uuid IS NULL OR id <> $2)`, [plate, exceptId])) {
    throw conflict("DUPLICATED", `La placa ${plate} ya está registrada en el condominio`);
  }
}

accessRoutes.post(
  "/vehicles",
  requirePermission("ACCESS", "add_new"),
  handler({ body: vehicleBody }, async ({ body, req }) => {
    if (body.isActive) await assertPlateFree(body.plate!, null);
    const row = await withTx(txCtx(req), (client) =>
      one<{ id: string }>(
        `INSERT INTO vehicles (unit_id, plate, kind, brand, model, color, notes, is_active, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, fn_current_app_user()) RETURNING id`,
        [body.unitId, body.plate, body.kind, body.brand, body.model, body.color, body.notes, body.isActive],
        client
      )
    );
    return { id: row!.id };
  })
);

accessRoutes.put(
  "/vehicles/:id",
  requirePermission("ACCESS", "edit"),
  handler({ params: idParams, body: vehicleBody }, async ({ params, body, req }) => {
    if (body.isActive) await assertPlateFree(body.plate!, params.id);
    const row = await withTx(txCtx(req), (client) =>
      one(
        `UPDATE vehicles SET unit_id = $2, plate = $3, kind = $4, brand = $5, model = $6, color = $7, notes = $8,
                is_active = $9, updated_by = fn_current_app_user()
          WHERE id = $1 RETURNING id`,
        [params.id, body.unitId, body.plate, body.kind, body.brand, body.model, body.color, body.notes, body.isActive],
        client
      )
    );
    if (!row) throw notFound("Vehículo no encontrado");
    return undefined;
  })
);

accessRoutes.delete(
  "/vehicles/:id",
  requirePermission("ACCESS", "delete"),
  handler({ params: idParams }, async ({ params, req }) => {
    const row = await withTx(txCtx(req), (client) => one(`DELETE FROM vehicles WHERE id = $1 RETURNING id`, [params.id], client));
    if (!row) throw notFound("Vehículo no encontrado");
    return undefined;
  })
);
