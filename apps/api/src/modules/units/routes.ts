/**
 * @project DomusApp - API
 * @file src/modules/units/routes.ts
 * @description Filiales del condominio activo (RLS): listado, alta individual o por lote, edición y baja
 */

import { Router } from "express";
import { z } from "zod";
import { one, query, withTx } from "../../db.js";
import { conflict, handler, idParams, notFound } from "../../lib/http.js";
import { requirePermission } from "../../security/authorize.js";
import { txCtx } from "../../security/context.js";

export const unitsRoutes = Router();

const KINDS = ["house", "apartment", "commercial", "office", "lot", "parking", "storage", "other"] as const;

const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => v || null);

const unitBody = z.object({
  code: z.string().trim().min(1).max(20),
  tower: optText(40),
  floor: optText(10),
  kind: z.enum(KINDS),
  areaM2: z.coerce.number().positive().max(1_000_000).nullish(),
  aliquot: z.coerce.number().min(0).max(100).nullish(),
  occupancy: z.enum(["owner", "rented", "vacant"]),
  notes: optText(500),
  isActive: z.boolean().default(true)
});

const listQuery = z.object({
  q: z.string().trim().max(60).optional(),
  tower: z.string().trim().max(40).optional()
});

unitsRoutes.get(
  "/",
  requirePermission("UNITS", "view"),
  handler({ query: listQuery }, ({ query: f }) =>
    query(
      `SELECT u.id, u.code, u.tower, u.floor, u.kind, u.area_m2::float AS "areaM2", u.aliquot::float AS aliquot,
              u.occupancy, u.notes, u.is_active AS "isActive",
              COALESCE(json_agg(json_build_object('personId', p.id, 'names', p.names, 'relation', up.relation, 'isPrimary', up.is_primary)
                                ORDER BY up.is_primary DESC, up.relation, p.names) FILTER (WHERE p.id IS NOT NULL), '[]') AS people
         FROM units u
         LEFT JOIN units_people up ON up.unit_id = u.id
         LEFT JOIN people p ON p.id = up.person_id
        WHERE ($1::text IS NULL OR u.code ILIKE '%' || $1 || '%' OR p.names ILIKE '%' || $1 || '%')
          AND ($2::text IS NULL OR u.tower = $2)
        GROUP BY u.id
        ORDER BY u.tower NULLS FIRST, length(u.code), u.code`,
      [f.q || null, f.tower || null]
    )
  )
);

unitsRoutes.get(
  "/summary",
  requirePermission("UNITS", "view"),
  handler({}, async () =>
    one(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE occupancy = 'rented')::int AS rented,
              count(*) FILTER (WHERE occupancy = 'vacant')::int AS vacant,
              COALESCE(sum(aliquot), 0)::float AS "aliquotTotal",
              COALESCE(array_agg(DISTINCT tower) FILTER (WHERE tower IS NOT NULL), '{}') AS towers
         FROM units WHERE is_active`
    )
  )
);

unitsRoutes.post(
  "/",
  requirePermission("UNITS", "add_new"),
  handler({ body: unitBody }, async ({ body, req }) => {
    const row = await withTx(txCtx(req), (client) =>
      one<{ id: string }>(
        `INSERT INTO units (code, tower, floor, kind, area_m2, aliquot, occupancy, notes, is_active, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, fn_current_app_user()) RETURNING id`,
        [body.code, body.tower, body.floor, body.kind, body.areaM2 ?? null, body.aliquot ?? null, body.occupancy, body.notes, body.isActive],
        client
      )
    );
    return { id: row!.id };
  })
);

/** Alta por lote: el panel genera los códigos (p. ej. Torre A, pisos 1-10, 4 por piso) */
const bulkBody = z.object({
  tower: optText(40),
  kind: z.enum(KINDS),
  codes: z.array(z.string().trim().min(1).max(20)).min(1).max(500)
});

unitsRoutes.post(
  "/bulk",
  requirePermission("UNITS", "add_new"),
  handler({ body: bulkBody }, async ({ body, req }) => {
    const codes = [...new Set(body.codes)];
    const existing = await query<{ code: string }>(`SELECT code FROM units WHERE code = ANY($1)`, [codes]);
    if (existing.length > 0) {
      throw conflict("DUPLICATED", `Ya existen: ${existing.slice(0, 10).map((e) => e.code).join(", ")}${existing.length > 10 ? "…" : ""}`);
    }
    await withTx(txCtx(req), (client) =>
      client.query(
        `INSERT INTO units (code, tower, kind, created_by)
         SELECT c, $2, $3, fn_current_app_user() FROM unnest($1::text[]) AS c`,
        [codes, body.tower, body.kind]
      )
    );
    return { created: codes.length };
  })
);

unitsRoutes.put(
  "/:id",
  requirePermission("UNITS", "edit"),
  handler({ params: idParams, body: unitBody }, async ({ params, body, req }) => {
    const row = await withTx(txCtx(req), (client) =>
      one(
        `UPDATE units SET code = $2, tower = $3, floor = $4, kind = $5, area_m2 = $6, aliquot = $7, occupancy = $8,
                notes = $9, is_active = $10, updated_by = fn_current_app_user()
          WHERE id = $1 RETURNING id`,
        [params.id, body.code, body.tower, body.floor, body.kind, body.areaM2 ?? null, body.aliquot ?? null, body.occupancy, body.notes, body.isActive],
        client
      )
    );
    if (!row) throw notFound("Filial no encontrada");
    return undefined;
  })
);

unitsRoutes.delete(
  "/:id",
  requirePermission("UNITS", "delete"),
  handler({ params: idParams }, async ({ params, req }) => {
    const linked = await one(`SELECT 1 FROM units_people WHERE unit_id = $1 LIMIT 1`, [params.id]);
    if (linked) throw conflict("IN_USE", "La filial tiene personas vinculadas; desvincúlelas o desactívela en lugar de eliminarla");
    const row = await withTx(txCtx(req), (client) => one(`DELETE FROM units WHERE id = $1 RETURNING id`, [params.id], client));
    if (!row) throw notFound("Filial no encontrada");
    return undefined;
  })
);
