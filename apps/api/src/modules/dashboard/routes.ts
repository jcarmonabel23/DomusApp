/**
 * @project DomusApp - API
 * @file src/modules/dashboard/routes.ts
 * @description Tablero del panel: cifras del condominio activo
 */

import { Router } from "express";
import { one } from "../../db.js";
import { handler } from "../../lib/http.js";
import { requirePermission } from "../../security/authorize.js";
import { condominiumOf } from "../../security/context.js";

export const dashboardRoutes = Router();

dashboardRoutes.get(
  "/summary",
  requirePermission("DASHBOARD"),
  handler({}, ({ req }) =>
    one(
      `SELECT (SELECT count(*)::int FROM units WHERE is_active) AS units,
              (SELECT count(*)::int FROM units WHERE is_active AND occupancy = 'rented') AS rented,
              (SELECT count(*)::int FROM units WHERE is_active AND occupancy = 'vacant') AS vacant,
              (SELECT count(*)::int FROM people WHERE is_active) AS people,
              (SELECT count(*)::int FROM users_condominiums WHERE condominium_id = $1 AND is_active AND role IN ('owner', 'tenant')) AS residents,
              (SELECT count(*)::int FROM users_condominiums WHERE condominium_id = $1 AND is_active AND role = 'guard') AS guards,
              (SELECT count(*)::int FROM users_condominiums WHERE condominium_id = $1 AND is_active AND role = 'admin') AS admins`,
      [condominiumOf(req)]
    )
  )
);
