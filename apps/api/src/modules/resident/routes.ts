/**
 * @project DomusApp - API
 * @file src/modules/resident/routes.ts
 * @description App móvil del propietario / inquilino: sus filiales en el condominio activo
 */

import { Router } from "express";
import { one, query } from "../../db.js";
import { handler } from "../../lib/http.js";
import { requireRole } from "../../security/authorize.js";
import { authOf } from "../../security/context.js";

export const residentRoutes = Router();

residentRoutes.get(
  "/home",
  requireRole("owner", "tenant", "admin"),
  handler({}, async ({ req }) => {
    const auth = authOf(req);
    const person = await one<{ id: string; names: string; idNumber: string | null; phone: string | null }>(
      `SELECT id, names, id_number AS "idNumber", phone FROM people WHERE user_id = $1 AND is_active`,
      [auth.userId]
    );
    const units = person
      ? await query(
          `SELECT u.id, u.code, u.tower, u.floor, u.kind, u.occupancy, up.relation, up.is_primary AS "isPrimary",
                  (SELECT count(*)::int FROM units_people x WHERE x.unit_id = u.id) AS "peopleCount"
             FROM units_people up JOIN units u ON u.id = up.unit_id AND u.is_active
            WHERE up.person_id = $1
            ORDER BY u.tower NULLS FIRST, u.code`,
          [person.id]
        )
      : [];
    return { person, units };
  })
);
