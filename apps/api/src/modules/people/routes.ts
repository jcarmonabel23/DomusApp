/**
 * @project DomusApp - API
 * @file src/modules/people/routes.ts
 * @description Personas del condominio activo (RLS), su vínculo con las filiales y su acceso a la app
 */

import { Router } from "express";
import { z } from "zod";
import { one, query, withTx } from "../../db.js";
import { badRequest, conflict, handler, idParams, notFound } from "../../lib/http.js";
import { logAuth } from "../../lib/authLog.js";
import { requirePermission } from "../../security/authorize.js";
import { authOf, condominiumOf, txCtx } from "../../security/context.js";
import { grantAccess, notifyAccess } from "../members/service.js";

export const peopleRoutes = Router();

const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => v || null);

const personBody = z.object({
  names: z.string().trim().min(2).max(120),
  idNumber: optText(30),
  email: z
    .email()
    .max(200)
    .nullish()
    .or(z.literal(""))
    .transform((v) => (v ? v.trim().toLowerCase() : null)),
  phone: optText(30),
  notes: optText(500),
  isActive: z.boolean().default(true)
});

const PERSON_SELECT = `
  p.id, p.names, p.id_number AS "idNumber", p.email, p.phone, p.notes, p.is_active AS "isActive",
  p.user_id AS "userId",
  uc.role AS "accessRole", COALESCE(uc.is_active, FALSE) AS "hasAccess",
  COALESCE((SELECT json_agg(json_build_object('unitId', u.id, 'code', u.code, 'tower', u.tower,
                                              'relation', up.relation, 'isPrimary', up.is_primary)
                            ORDER BY u.tower NULLS FIRST, u.code)
              FROM units_people up JOIN units u ON u.id = up.unit_id
             WHERE up.person_id = p.id), '[]') AS units`;

/** Pertenencia de la cuenta vinculada en ESTE condominio (users_condominiums no tiene RLS) */
const ACCESS_JOIN = `LEFT JOIN users_condominiums uc ON uc.user_id = p.user_id AND uc.condominium_id = fn_current_condominium()`;

peopleRoutes.get(
  "/",
  requirePermission("PEOPLE", "view"),
  handler(
    { query: z.object({ q: z.string().trim().max(60).optional(), relation: z.enum(["owner", "tenant", "resident"]).optional() }) },
    ({ query: f }) =>
      query(
        `SELECT ${PERSON_SELECT}
           FROM people p ${ACCESS_JOIN}
          WHERE ($1::text IS NULL OR p.names ILIKE '%' || $1 || '%' OR p.id_number ILIKE '%' || $1 || '%'
                 OR p.email ILIKE '%' || $1 || '%')
            AND ($2::text IS NULL OR EXISTS (SELECT 1 FROM units_people x WHERE x.person_id = p.id AND x.relation = $2))
          ORDER BY p.is_active DESC, p.names`,
        [f.q || null, f.relation ?? null]
      )
  )
);

peopleRoutes.get(
  "/:id",
  requirePermission("PEOPLE", "view"),
  handler({ params: idParams }, async ({ params }) => {
    const row = await one(`SELECT ${PERSON_SELECT} FROM people p ${ACCESS_JOIN} WHERE p.id = $1`, [params.id]);
    if (!row) throw notFound("Persona no encontrada");
    return row;
  })
);

peopleRoutes.post(
  "/",
  requirePermission("PEOPLE", "add_new"),
  handler({ body: personBody }, async ({ body, req }) => {
    const row = await withTx(txCtx(req), (client) =>
      one<{ id: string }>(
        `INSERT INTO people (names, id_number, email, phone, notes, is_active, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, fn_current_app_user()) RETURNING id`,
        [body.names, body.idNumber, body.email, body.phone, body.notes, body.isActive],
        client
      )
    );
    return { id: row!.id };
  })
);

peopleRoutes.put(
  "/:id",
  requirePermission("PEOPLE", "edit"),
  handler({ params: idParams, body: personBody }, async ({ params, body, req }) => {
    const row = await withTx(txCtx(req), (client) =>
      one(
        `UPDATE people SET names = $2, id_number = $3, email = $4, phone = $5, notes = $6, is_active = $7,
                updated_by = fn_current_app_user()
          WHERE id = $1 RETURNING id`,
        [params.id, body.names, body.idNumber, body.email, body.phone, body.notes, body.isActive],
        client
      )
    );
    if (!row) throw notFound("Persona no encontrada");
    return undefined;
  })
);

peopleRoutes.delete(
  "/:id",
  requirePermission("PEOPLE", "delete"),
  handler({ params: idParams }, async ({ params, req }) => {
    const person = await one<{ user_id: string | null }>(`SELECT user_id FROM people WHERE id = $1`, [params.id]);
    if (!person) throw notFound("Persona no encontrada");
    if (person.user_id) throw conflict("IN_USE", "La persona tiene acceso a la app; retírelo o desactívela en lugar de eliminarla");
    await withTx(txCtx(req), (client) => client.query(`DELETE FROM people WHERE id = $1`, [params.id]));
    return undefined;
  })
);

// ------------------------------------------------------------------ Filiales de la persona

const linkBody = z.object({
  unitId: z.uuid(),
  relation: z.enum(["owner", "tenant", "resident"]),
  isPrimary: z.boolean().default(false)
});

peopleRoutes.put(
  "/:id/units",
  requirePermission("PEOPLE", "edit"),
  handler({ params: idParams, body: linkBody }, async ({ params, body, req }) => {
    await withTx(txCtx(req), async (client) => {
      // El contacto principal es uno por filial: el nuevo reemplaza al anterior
      if (body.isPrimary) {
        await client.query(`UPDATE units_people SET is_primary = FALSE WHERE unit_id = $1 AND person_id <> $2`, [body.unitId, params.id]);
      }
      await client.query(
        `INSERT INTO units_people (unit_id, person_id, relation, is_primary, created_by)
         VALUES ($1, $2, $3, $4, fn_current_app_user())
         ON CONFLICT (unit_id, person_id) DO UPDATE SET relation = EXCLUDED.relation, is_primary = EXCLUDED.is_primary`,
        [body.unitId, params.id, body.relation, body.isPrimary]
      );
      // Una filial con inquilino queda marcada como alquilada
      if (body.relation === "tenant") {
        await client.query(`UPDATE units SET occupancy = 'rented' WHERE id = $1 AND occupancy <> 'rented'`, [body.unitId]);
      }
    });
    return undefined;
  })
);

peopleRoutes.delete(
  "/:id/units/:unitId",
  requirePermission("PEOPLE", "edit"),
  handler({ params: z.object({ id: z.uuid(), unitId: z.uuid() }) }, async ({ params, req }) => {
    await withTx(txCtx(req), (client) =>
      client.query(`DELETE FROM units_people WHERE person_id = $1 AND unit_id = $2`, [params.id, params.unitId])
    );
    return undefined;
  })
);

// ------------------------------------------------------------------ Acceso a la app

/**
 * POST /people/:id/access — da acceso a la app como propietario o inquilino.
 * Por defecto: propietario si es dueño de alguna filial; si no, inquilino.
 */
peopleRoutes.post(
  "/:id/access",
  requirePermission("PEOPLE", "configure"),
  handler({ params: idParams, body: z.object({ role: z.enum(["owner", "tenant"]).optional() }) }, async ({ params, body, req }) => {
    const condominiumId = condominiumOf(req);
    const person = await one<{ names: string; email: string | null; phone: string | null; is_owner: boolean; units: number }>(
      `SELECT p.names, p.email, p.phone,
              EXISTS (SELECT 1 FROM units_people x WHERE x.person_id = p.id AND x.relation = 'owner') AS is_owner,
              (SELECT count(*)::int FROM units_people x WHERE x.person_id = p.id) AS units
         FROM people p WHERE p.id = $1 AND p.is_active`,
      [params.id]
    );
    if (!person) throw notFound("Persona no encontrada o inactiva");
    if (!person.email) throw badRequest("EMAIL_REQUIRED", "Registre el correo de la persona para darle acceso");
    if (person.units === 0) throw badRequest("NO_UNITS", "Vincule la persona a una filial antes de darle acceso");

    const existing = await one<{ role: string }>(
      `SELECT uc.role FROM users u JOIN users_condominiums uc ON uc.user_id = u.id AND uc.condominium_id = $2
        WHERE u.email = $1 AND uc.is_active`,
      [person.email, condominiumId]
    );
    if (existing && (existing.role === "admin" || existing.role === "guard")) {
      throw conflict("ROLE_CONFLICT", "Ese correo ya tiene acceso como personal del condominio; gestiónelo en Usuarios");
    }

    const input = {
      condominiumId,
      email: person.email,
      names: person.names,
      phone: person.phone,
      role: body.role ?? (person.is_owner ? ("owner" as const) : ("tenant" as const))
    };
    const grant = await withTx(txCtx(req), async (client) => {
      const g = await grantAccess(client, input);
      await client.query(`UPDATE people SET user_id = $2, updated_by = fn_current_app_user() WHERE id = $1`, [params.id, g.userId]);
      return g;
    });
    const emailed = await notifyAccess(input, grant);
    await logAuth(req, "invite", true, { userId: grant.userId, email: person.email, detail: { role: input.role, by: authOf(req).userId } });
    return { created: grant.created, emailed, role: input.role };
  })
);

/** DELETE /people/:id/access — retira el acceso a ESTE condominio (la cuenta sigue existiendo) */
peopleRoutes.delete(
  "/:id/access",
  requirePermission("PEOPLE", "configure"),
  handler({ params: idParams }, async ({ params, req }) => {
    const person = await one<{ user_id: string | null }>(`SELECT user_id FROM people WHERE id = $1`, [params.id]);
    if (!person?.user_id) throw notFound("La persona no tiene acceso");
    await withTx(txCtx(req), (client) =>
      client.query(
        `UPDATE users_condominiums SET is_active = FALSE, updated_by = fn_current_app_user()
          WHERE user_id = $1 AND condominium_id = $2 AND role IN ('owner', 'tenant')`,
        [person.user_id, condominiumOf(req)]
      )
    );
    return undefined;
  })
);
