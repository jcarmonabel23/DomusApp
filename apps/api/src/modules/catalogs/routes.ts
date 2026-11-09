/**
 * @project DomusApp - API
 * @file src/modules/catalogs/routes.ts
 * @description Catálogos de lectura para formularios: países, monedas y zonas horarias
 */

import { Router } from "express";
import { z } from "zod";
import { query } from "../../db.js";
import { handler } from "../../lib/http.js";

export const catalogsRoutes = Router();

catalogsRoutes.get(
  "/countries",
  handler({}, () =>
    query(
      `SELECT code, name, currency_code AS "currencyCode", timezone, phone_code AS "phoneCode",
              person_id_label AS "personIdLabel", tax_id_label AS "taxIdLabel"
         FROM catalogs_countries WHERE is_active ORDER BY order_list, name`
    )
  )
);

catalogsRoutes.get(
  "/currencies",
  handler({}, () => query(`SELECT code, name, symbol, decimals FROM catalogs_currencies WHERE is_active ORDER BY name`))
);

/** Zonas horarias de América (y la de España): las que tiene sentido elegir para un condominio */
catalogsRoutes.get(
  "/timezones",
  handler({ query: z.object({ q: z.string().max(60).optional() }) }, ({ query: q }) =>
    query(
      `SELECT name, to_char(utc_offset, 'SGHH24:MI') AS "utcOffset"
         FROM pg_timezone_names
        WHERE (name LIKE 'America/%' OR name IN ('Europe/Madrid', 'Atlantic/Canary', 'UTC'))
          AND name NOT LIKE '%/%/%/%'
          AND ($1::text IS NULL OR name ILIKE '%' || $1 || '%')
        ORDER BY name`,
      [q.q ?? null]
    )
  )
);
