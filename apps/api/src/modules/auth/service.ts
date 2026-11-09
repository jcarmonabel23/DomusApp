/**
 * @project DomusApp - API
 * @file src/modules/auth/service.ts
 * @description Lógica compartida de autenticación: sesiones, OTP y respuesta de sesión
 */

import type { Request, Response } from "express";
import type pg from "pg";
import { config } from "../../config.js";
import { one, query, runInCondominium, type Db } from "../../db.js";
import { hmac, otpCode, randomToken, safeEqualHex, sha256 } from "../../lib/crypto.js";
import { sessionModules, type SessionModule } from "../../security/authorize.js";
import { defaultCondominium, eligibleCondominiums, type EligibleCondominium } from "../../security/condominiums.js";
import { clientInfo, type Client, type Role } from "../../security/context.js";
import { deliverRefresh, sessionExpiry, signAccessToken } from "../../security/tokens.js";
import { fileKey, logoUrls } from "../files/images.js";

export interface UserRow {
  id: string;
  email: string;
  names: string;
  password_hash: string;
  is_active: boolean;
  is_platform_admin: boolean;
  must_change_password: boolean;
  failed_attempts: number;
  locked_until: Date | null;
}

export const USER_COLUMNS =
  "id, email, names, password_hash, is_active, is_platform_admin, must_change_password, failed_attempts, locked_until";

export interface SessionUser {
  id: string;
  email: string;
  names: string;
  mustChangePassword: boolean;
}

/** Condominio activo de la sesión, con lo que necesitan panel y app para pintarse */
export interface SessionCondominium {
  id: string;
  code: string;
  name: string;
  kind: string;
  brandColor: string | null;
  logo: { header: string; square: string; doc: string } | null;
  role: Role;
  roleName: string;
  country: { code: string; name: string; personIdLabel: string; taxIdLabel: string; phoneCode: string };
  currency: { code: string; symbol: string; decimals: number };
  timezone: string;
}

export interface SessionPayload {
  user: SessionUser & { isPlatformAdmin: boolean };
  client: Client;
  condominium: SessionCondominium | null;
  condominiums: EligibleCondominium[];
  modules: SessionModule[];
  environment: string;
  idleMinutes: number | null;
}

/** Correo enmascarado para la pantalla OTP: j*****a@dominio.com */
export function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (local.length <= 2) return `${local[0]}*@${domain}`;
  return `${local[0]}${"*".repeat(Math.min(local.length - 2, 6))}${local.at(-1)}@${domain}`;
}

async function loadCondominium(id: string, role: Role): Promise<SessionCondominium | null> {
  const row = await one<Omit<SessionCondominium, "role" | "logo"> & { logoFileId: string | null }>(
    `SELECT c.id, c.code, c.name, c.kind, c.brand_color AS "brandColor", c.logo_file_id AS "logoFileId",
            (SELECT name FROM catalogs_roles WHERE slug = $2) AS "roleName",
            json_build_object('code', k.code, 'name', k.name, 'personIdLabel', k.person_id_label,
                              'taxIdLabel', k.tax_id_label, 'phoneCode', k.phone_code) AS country,
            json_build_object('code', cur.code, 'symbol', cur.symbol, 'decimals', cur.decimals) AS currency,
            c.timezone
       FROM condominiums c
       JOIN catalogs_countries k ON k.code = c.country_code
       JOIN catalogs_currencies cur ON cur.code = c.currency_code
      WHERE c.id = $1`,
    [id, role]
  );
  if (!row) return null;
  const { logoFileId, ...rest } = row;
  return { ...rest, logo: logoUrls(fileKey(row.id, logoFileId)), role };
}

/**
 * @function sessionPayload
 * @description Usuario, condominio activo, condominios disponibles para el selector y módulos con permisos
 */
export async function sessionPayload(user: SessionUser, client: Client, condominiumId: string | null): Promise<SessionPayload> {
  const flags = await one<{ is_platform_admin: boolean }>(`SELECT is_platform_admin FROM users WHERE id = $1`, [user.id]);
  const isPlatformAdmin = flags?.is_platform_admin ?? false;
  const condominiums = await eligibleCondominiums(user.id, client);
  const current = condominiums.find((c) => c.id === condominiumId) ?? null;
  const condominium = current ? await loadCondominium(current.id, current.role) : null;
  const role = condominium?.role ?? (isPlatformAdmin && client === "web" ? "admin" : null);

  const modules =
    client === "web"
      ? condominium
        ? await runInCondominium(condominium.id, () => sessionModules({ role, isPlatformAdmin }))
        : await sessionModules({ role, isPlatformAdmin })
      : [];

  return {
    user: { ...user, isPlatformAdmin },
    client,
    condominium,
    condominiums,
    modules,
    environment: config.APP_ENVIRONMENT,
    idleMinutes: client === "web" ? config.SESSION_IDLE_MINUTES : null
  };
}

export interface TokenPayload extends SessionPayload {
  accessToken: string;
  accessExpiresAt: number;
  refreshToken?: string;
}

/**
 * @function openSession
 * @description Crea la sesión en el condominio por defecto del usuario, entrega el refresh
 * (cookie en el panel, cuerpo en la app) y devuelve el access token con la sesión.
 */
export async function openSession(db: Db, req: Request, res: Response, user: SessionUser, client: Client): Promise<TokenPayload> {
  const refreshToken = randomToken();
  const expiresAt = sessionExpiry(client);
  const { ip, userAgent } = clientInfo(req);
  const condo = await defaultCondominium(user.id, client);

  const [session] = await query<{ id: string }>(
    `INSERT INTO users_sessions (user_id, client, condominium_id, refresh_hash, ip_address, user_agent, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [user.id, client, condo?.id ?? null, sha256(refreshToken), ip, userAgent, expiresAt],
    db
  );

  const delivered = deliverRefresh(res, client, refreshToken, expiresAt);
  const access = signAccessToken(user.id, session.id);
  return {
    accessToken: access.token,
    accessExpiresAt: access.expiresAt,
    ...delivered,
    ...(await sessionPayload(user, client, condo?.id ?? null))
  };
}

export async function revokeAllSessions(db: Db, userId: string, reason: string, exceptSessionId?: string) {
  await query(
    `UPDATE users_sessions SET revoked_at = NOW(), revoke_reason = $2
      WHERE user_id = $1 AND revoked_at IS NULL AND ($3::uuid IS NULL OR id <> $3::uuid)`,
    [userId, reason, exceptSessionId ?? null],
    db
  );
}

/** ¿Puede este usuario entrar desde este cliente? (antes de enviarle el OTP) */
export async function canSignInFrom(userId: string, isPlatformAdmin: boolean, client: Client): Promise<boolean> {
  if (client === "web" && isPlatformAdmin) return true;
  return (await eligibleCondominiums(userId, client)).length > 0;
}

// ------------------------------------------------------------------ OTP

export type OtpPurpose = "login" | "password_reset";

export async function createOtp(
  db: Db,
  req: Request,
  userId: string,
  purpose: OtpPurpose,
  client: Client = "web"
): Promise<{ challengeId: string; code: string; expiresAt: Date }> {
  await query(`UPDATE users_otp SET consumed_at = NOW() WHERE user_id = $1 AND purpose = $2 AND consumed_at IS NULL`, [userId, purpose], db);
  const code = otpCode();
  const expiresAt = new Date(Date.now() + config.OTP_TTL_MINUTES * 60 * 1000);
  const [row] = await query<{ id: string }>(
    `INSERT INTO users_otp (user_id, purpose, client, code_hash, expires_at, ip_address)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [userId, purpose, client, hmac(code), expiresAt, clientInfo(req).ip],
    db
  );
  return { challengeId: row.id, code, expiresAt };
}

export interface OtpRow {
  id: string;
  user_id: string;
  client: Client;
  code_hash: string;
  attempts: number;
  sends: number;
  last_sent_at: Date;
  expires_at: Date;
}

export type OtpCheck = { ok: true } | { ok: false; reason: "invalid" | "locked"; remaining: number };

/** Compara el código; si falla suma un intento y al llegar al tope invalida el desafío (fila con FOR UPDATE) */
export async function checkOtp(client: pg.PoolClient, otp: OtpRow, code: string): Promise<OtpCheck> {
  if (safeEqualHex(otp.code_hash, hmac(code))) {
    await client.query(`UPDATE users_otp SET consumed_at = NOW() WHERE id = $1`, [otp.id]);
    return { ok: true };
  }
  const attempts = otp.attempts + 1;
  const locked = attempts >= config.OTP_MAX_ATTEMPTS;
  await client.query(
    `UPDATE users_otp SET attempts = $2, consumed_at = CASE WHEN $3 THEN NOW() ELSE consumed_at END WHERE id = $1`,
    [otp.id, attempts, locked]
  );
  return { ok: false, reason: locked ? "locked" : "invalid", remaining: Math.max(0, config.OTP_MAX_ATTEMPTS - attempts) };
}
