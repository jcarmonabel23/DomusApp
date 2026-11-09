/**
 * @project DomusApp - API
 * @file src/modules/settings/routes.ts
 * @description Configuración del condominio activo: identidad, país, moneda, zona horaria, contacto y logo
 */

import { Router } from "express";
import { one, withTx } from "../../db.js";
import { handler, notFound } from "../../lib/http.js";
import { requirePermission } from "../../security/authorize.js";
import { condominiumOf, txCtx } from "../../security/context.js";
import { CONDOMINIUM_SELECT, assertCatalogs, condominiumFields } from "../condominiums/schema.js";
import { fileKey, logoUrls, rawUpload, removeStored, replaceImage } from "../files/images.js";

export const settingsRoutes = Router();

settingsRoutes.get(
  "/condominium",
  requirePermission("SETTINGS", "view"),
  handler({}, async ({ req }) => {
    const row = await one<{ id: string; logoFileId: string | null }>(
      `SELECT ${CONDOMINIUM_SELECT}, c.logo_file_id AS "logoFileId" FROM condominiums c WHERE c.id = $1`,
      [condominiumOf(req)]
    );
    if (!row) throw notFound("Condominio no encontrado");
    const { logoFileId, ...rest } = row;
    return { ...rest, logo: logoUrls(fileKey(row.id, logoFileId)) };
  })
);

settingsRoutes.put(
  "/condominium",
  requirePermission("SETTINGS", "edit"),
  handler({ body: condominiumFields }, async ({ body, req }) => {
    await assertCatalogs(body);
    await withTx(txCtx(req), (client) =>
      client.query(
        `UPDATE condominiums SET kind = $2, name = $3, legal_name = $4, tax_id = $5, country_code = $6, currency_code = $7,
                timezone = $8, address = $9, city = $10, state = $11, phone = $12, email = $13, brand_color = $14,
                updated_by = fn_current_app_user()
          WHERE id = $1`,
        [
          condominiumOf(req), body.kind, body.name, body.legalName, body.taxId, body.countryCode, body.currencyCode, body.timezone,
          body.address, body.city, body.state, body.phone, body.email, body.brandColor
        ]
      )
    );
    return undefined;
  })
);

/** PUT /settings/logo — cuerpo crudo (PNG/JPG/WebP); se re-codifica y reemplaza al anterior */
settingsRoutes.put(
  "/logo",
  requirePermission("SETTINGS", "edit"),
  rawUpload,
  handler({}, async ({ req }) => {
    const condominiumId = condominiumOf(req);
    const stored = await replaceImage({
      req,
      condominiumId,
      profile: "logo",
      purpose: "condominium_logo",
      withTx: (fn) => withTx(txCtx(req), fn),
      attach: async (client, fileId) => {
        const prev = await one<{ logo_file_id: string | null }>(`SELECT logo_file_id FROM condominiums WHERE id = $1`, [condominiumId], client);
        await client.query(`UPDATE condominiums SET logo_file_id = $2, updated_by = fn_current_app_user() WHERE id = $1`, [condominiumId, fileId]);
        return prev?.logo_file_id ?? null;
      }
    });
    return { logo: logoUrls(stored.storageKey) };
  })
);

settingsRoutes.delete(
  "/logo",
  requirePermission("SETTINGS", "edit"),
  handler({}, async ({ req }) => {
    const condominiumId = condominiumOf(req);
    const prev = await withTx(txCtx(req), async (client) => {
      const row = await one<{ logo_file_id: string | null }>(`SELECT logo_file_id FROM condominiums WHERE id = $1`, [condominiumId], client);
      if (row?.logo_file_id) {
        await client.query(`UPDATE condominiums SET logo_file_id = NULL, updated_by = fn_current_app_user() WHERE id = $1`, [condominiumId]);
        await client.query(`DELETE FROM files WHERE id = $1`, [row.logo_file_id]);
      }
      return row?.logo_file_id ?? null;
    });
    await removeStored(fileKey(condominiumId, prev));
    return undefined;
  })
);
