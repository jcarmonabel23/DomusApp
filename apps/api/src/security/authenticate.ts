/**
 * @project DomusApp - API
 * @file src/security/authenticate.ts
 * @description Middleware de autenticación: JWT válido + sesión viva + usuario activo + condominio
 *
 * @overview
 * El JWT por sí solo NO basta: en cada petición se comprueba contra la BD que la sesión
 * (claim sid) no esté revocada ni vencida, y que el usuario siga activo. En el panel también
 * se cierra por inactividad; en la app móvil no (la sesión dura días).
 *
 * La sesión trae su condominio activo: debe seguir siendo elegible para el usuario desde ese
 * cliente (ver condominiums.ts). Si ya no lo es, pasa sola a otro; sin ninguno, 403 NO_CONDOMINIUM
 * (salvo el administrador de plataforma en el panel, que puede trabajar sin condominio para
 * crear el primero). El resto de la petición corre dentro de runInCondominium (RLS).
 *
 * Los clientes envían el condominio con el que pintaron la pantalla (x-condominium-id). Si la
 * sesión cambió de condominio en otra pestaña: 409 CONDOMINIUM_CHANGED, para no guardar nada
 * en el condominio equivocado.
 */

import type { NextFunction, Request, RequestHandler, Response } from "express";
import { config } from "../config.js";
import { one, query, runInCondominium } from "../db.js";
import { conflict, forbidden, unauthorized } from "../lib/http.js";
import { defaultCondominium, eligibleCondominium, type EligibleCondominium } from "./condominiums.js";
import type { AuthContext, Client } from "./context.js";
import { verifyAccessToken } from "./tokens.js";

interface SessionRow {
  user_id: string;
  email: string;
  names: string;
  must_change_password: boolean;
  is_platform_admin: boolean;
  client: Client;
  idle: boolean;
  condominium_id: string | null;
}

/**
 * Valida un access token contra la BD y arma el contexto de seguridad (lo usan el middleware HTTP y el
 * socket de tiempo real). `expected` = condominio con el que el cliente pintó la pantalla.
 */
export async function resolveAuth(token: string, expected?: string | null, touch = true): Promise<AuthContext> {
  const claims = verifyAccessToken(token);
  if (!claims) throw unauthorized("TOKEN_INVALID", "Su sesión expiró");

  const row = await one<SessionRow>(
    `SELECT u.id AS user_id, u.email, u.names, u.must_change_password, u.is_platform_admin, s.client,
            (s.client = 'web' AND s.last_used_at < NOW() - make_interval(mins => $3)) AS idle,
            s.condominium_id
       FROM users_sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.id = $1 AND s.user_id = $2
        AND s.revoked_at IS NULL AND s.expires_at > NOW()
        AND u.is_active`,
    [claims.sid, claims.sub, config.SESSION_IDLE_MINUTES]
  );
  if (!row) throw unauthorized("SESSION_REVOKED", "Su sesión ya no es válida");
  if (row.idle) throw unauthorized("SESSION_IDLE", "Su sesión se cerró por inactividad");

  let condo: EligibleCondominium | null = row.condominium_id
    ? await eligibleCondominium(row.user_id, row.client, row.condominium_id)
    : null;
  if (!condo) {
    condo = await defaultCondominium(row.user_id, row.client);
    if (condo?.id !== row.condominium_id) {
      await query(`UPDATE users_sessions SET condominium_id = $2 WHERE id = $1`, [claims.sid, condo?.id ?? null]);
    }
  }
  if (!condo && !(row.client === "web" && row.is_platform_admin)) {
    throw forbidden("NO_CONDOMINIUM", "Su usuario no tiene acceso a un condominio activo");
  }

  if (expected && expected !== (condo?.id ?? "")) {
    throw conflict("CONDOMINIUM_CHANGED", "La sesión cambió de condominio en otra pestaña; recargue la página");
  }

  // Marca actividad como mucho una vez por minuto (evita un UPDATE por petición)
  if (touch) await query(
    `UPDATE users_sessions SET last_used_at = NOW()
      WHERE id = $1 AND last_used_at < NOW() - INTERVAL '1 minute'`,
    [claims.sid]
  );

  return {
    userId: row.user_id,
    sessionId: claims.sid,
    email: row.email,
    names: row.names,
    mustChangePassword: row.must_change_password,
    client: row.client,
    condominiumId: condo?.id ?? null,
    role: condo?.role ?? (row.is_platform_admin ? "admin" : null),
    isPlatformAdmin: row.is_platform_admin
  };
}

export function authenticate(
  options: { allowPendingPasswordChange?: boolean; ignoreCondominiumHeader?: boolean } = {}
): RequestHandler {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const header = req.get("authorization") ?? "";
      const [scheme, token] = header.split(" ");
      if (scheme !== "Bearer" || !token) throw unauthorized("TOKEN_MISSING", "Debe iniciar sesión");

      const auth = await resolveAuth(token, options.ignoreCondominiumHeader ? null : req.get("x-condominium-id"));
      req.auth = auth;

      if (auth.mustChangePassword && !options.allowPendingPasswordChange) {
        throw forbidden("PASSWORD_CHANGE_REQUIRED", "Debe cambiar su contraseña antes de continuar");
      }

      if (auth.condominiumId) runInCondominium(auth.condominiumId, () => next());
      else next();
    } catch (err) {
      next(err);
    }
  };
}
