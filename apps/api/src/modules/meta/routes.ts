/**
 * @project DomusApp - API
 * @file src/modules/meta/routes.ts
 * @description Estado del sistema (público): versión, entorno, BD y migraciones aplicadas
 *
 * Lo usan el panel y la app móvil para mostrar si hay conexión con el servidor.
 * No expone datos sensibles: nada de usuarios, condominios ni configuración.
 */

import { Router } from "express";
import { config } from "../../config.js";
import { one } from "../../db.js";
import { handler } from "../../lib/http.js";

export const metaRoutes = Router();

metaRoutes.get(
  "/status",
  handler({}, async () => {
    const db = await one<{ now: string; migrations: number }>(
      `SELECT now()::text AS now,
              (SELECT count(*)::int FROM schema_migrations) AS migrations`
    );
    return {
      app: "DomusApp",
      version: config.APP_VERSION,
      environment: config.APP_ENVIRONMENT,
      database: { ok: true, serverTime: db?.now ?? null, migrations: db?.migrations ?? 0 }
    };
  })
);
