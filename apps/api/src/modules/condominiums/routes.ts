/**
 * @project DomusApp - API
 * @file src/modules/condominiums/routes.ts
 * @description Condominios de la plataforma (solo administradores de plataforma)
 *
 * Alta, edición y suspensión. Al crear uno se puede designar su primer administrador: si el
 * correo no tiene cuenta, se crea y recibe una contraseña temporal.
 */

import { Router } from "express";
import { z } from "zod";
import { one, query, withTx } from "../../db.js";
import { conflict, handler, idParams, notFound } from "../../lib/http.js";
import { requirePermission } from "../../security/authorize.js";
import { txCtx } from "../../security/context.js";
import { grantAccess, notifyAccess } from "../members/service.js";
import { CONDOMINIUM_SELECT, assertCatalogs, condominiumFields } from "./schema.js";

export const condominiumsRoutes = Router();

condominiumsRoutes.get(
  "/",
  requirePermission("CONDOMINIUMS", "view"),
  handler({}, () =>
    query(
      `SELECT ${CONDOMINIUM_SELECT},
              (SELECT count(*)::int FROM users_condominiums uc WHERE uc.condominium_id = c.id AND uc.is_active) AS "membersCount",
              (SELECT string_agg(u.names, ', ' ORDER BY u.names)
                 FROM users_condominiums uc JOIN users u ON u.id = uc.user_id
                WHERE uc.condominium_id = c.id AND uc.is_active AND uc.role = 'admin') AS "adminNames",
              k.name AS "countryName"
         FROM condominiums c JOIN catalogs_countries k ON k.code = c.country_code
        ORDER BY c.is_active DESC, c.name`
    )
  )
);

const createBody = condominiumFields.extend({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9_-]{2,20}$/, "Solo letras, números, guion y guion bajo (2 a 20)"),
  admin: z
    .object({
      email: z.email().max(200).transform((v) => v.trim().toLowerCase()),
      names: z.string().trim().min(2).max(120)
    })
    .nullish()
});

condominiumsRoutes.post(
  "/",
  requirePermission("CONDOMINIUMS", "add_new"),
  handler({ body: createBody }, async ({ body, req }) => {
    await assertCatalogs(body);
    if (await one(`SELECT 1 FROM condominiums WHERE code = $1`, [body.code])) {
      throw conflict("DUPLICATED", `Ya existe un condominio con el código ${body.code}`);
    }
    const result = await withTx(txCtx(req), async (client) => {
      const condo = await one<{ id: string }>(
        `INSERT INTO condominiums (code, kind, name, legal_name, tax_id, country_code, currency_code, timezone,
                                   address, city, state, phone, email, brand_color, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, fn_current_app_user()) RETURNING id`,
        [
          body.code, body.kind, body.name, body.legalName, body.taxId, body.countryCode, body.currencyCode, body.timezone,
          body.address, body.city, body.state, body.phone, body.email, body.brandColor
        ],
        client
      );
      const grant = body.admin
        ? await grantAccess(client, { condominiumId: condo!.id, email: body.admin.email, names: body.admin.names, role: "admin" })
        : null;
      return { id: condo!.id, grant };
    });
    let emailed = false;
    if (body.admin && result.grant) {
      emailed = await notifyAccess(
        { condominiumId: result.id, email: body.admin.email, names: body.admin.names, role: "admin" },
        result.grant
      );
    }
    return { id: result.id, adminCreated: result.grant?.created ?? false, adminEmailed: emailed };
  })
);

condominiumsRoutes.put(
  "/:id",
  requirePermission("CONDOMINIUMS", "edit"),
  handler({ params: idParams, body: condominiumFields }, async ({ params, body, req }) => {
    await assertCatalogs(body);
    const row = await withTx(txCtx(req), (client) =>
      one(
        `UPDATE condominiums SET kind = $2, name = $3, legal_name = $4, tax_id = $5, country_code = $6, currency_code = $7,
                timezone = $8, address = $9, city = $10, state = $11, phone = $12, email = $13, brand_color = $14,
                updated_by = fn_current_app_user()
          WHERE id = $1 RETURNING id`,
        [
          params.id, body.kind, body.name, body.legalName, body.taxId, body.countryCode, body.currencyCode, body.timezone,
          body.address, body.city, body.state, body.phone, body.email, body.brandColor
        ],
        client
      )
    );
    if (!row) throw notFound("Condominio no encontrado");
    return undefined;
  })
);

condominiumsRoutes.patch(
  "/:id/status",
  requirePermission("CONDOMINIUMS", "edit"),
  handler({ params: idParams, body: z.object({ isActive: z.boolean() }) }, async ({ params, body, req }) => {
    const row = await withTx(txCtx(req), (client) =>
      one(`UPDATE condominiums SET is_active = $2, updated_by = fn_current_app_user() WHERE id = $1 RETURNING id`, [params.id, body.isActive], client)
    );
    if (!row) throw notFound("Condominio no encontrado");
    return undefined;
  })
);
