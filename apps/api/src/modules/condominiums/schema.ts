/**
 * @project DomusApp - API
 * @file src/modules/condominiums/schema.ts
 * @description Validación compartida de los datos de un condominio (alta de plataforma y configuración)
 */

import { z } from "zod";
import { one } from "../../db.js";
import { badRequest } from "../../lib/http.js";

const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => v || null);

export const condominiumFields = z.object({
  name: z.string().trim().min(2).max(120),
  kind: z.enum(["condominium", "residential", "commercial", "office"]),
  legalName: optText(160),
  taxId: optText(30),
  countryCode: z.string().length(2).toUpperCase(),
  currencyCode: z.string().length(3).toUpperCase(),
  timezone: z.string().min(3).max(60),
  address: optText(400),
  city: optText(80),
  state: optText(80),
  phone: optText(30),
  email: z
    .email()
    .max(200)
    .nullish()
    .or(z.literal(""))
    .transform((v) => v || null),
  brandColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Color en formato #RRGGBB")
    .nullish()
    .or(z.literal(""))
    .transform((v) => v || null)
});

export type CondominiumFields = z.infer<typeof condominiumFields>;

/** País, moneda y zona horaria deben existir (mensaje claro en vez de un error de FK) */
export async function assertCatalogs(f: Pick<CondominiumFields, "countryCode" | "currencyCode" | "timezone">): Promise<void> {
  const row = await one<{ country: boolean; currency: boolean; tz: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM catalogs_countries WHERE code = $1 AND is_active) AS country,
            EXISTS (SELECT 1 FROM catalogs_currencies WHERE code = $2 AND is_active) AS currency,
            EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = $3) AS tz`,
    [f.countryCode, f.currencyCode, f.timezone]
  );
  if (!row?.country) throw badRequest("COUNTRY_INVALID", "País no disponible");
  if (!row.currency) throw badRequest("CURRENCY_INVALID", "Moneda no disponible");
  if (!row.tz) throw badRequest("TIMEZONE_INVALID", "Zona horaria desconocida");
}

/** Columnas de condominio en formato de la API */
export const CONDOMINIUM_SELECT = `
  c.id, c.code, c.is_active AS "isActive", c.kind, c.name, c.legal_name AS "legalName", c.tax_id AS "taxId",
  c.country_code AS "countryCode", c.currency_code AS "currencyCode", c.timezone,
  c.address, c.city, c.state, c.phone, c.email, c.brand_color AS "brandColor",
  c.created_at AS "createdAt", c.updated_at AS "updatedAt"`;
