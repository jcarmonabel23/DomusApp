/**
 * @project DomusApp - API
 * @file src/modules/auth/session.ts
 * @description Sesión en curso: /me, cambio de contraseña, cambio de condominio y cierres de sesión
 */

import { z } from "zod";
import { one, query, withTx } from "../../db.js";
import { logAuth } from "../../lib/authLog.js";
import { sha256 } from "../../lib/crypto.js";
import { HttpError, forbidden, handler } from "../../lib/http.js";
import { assertNotReused, assertPasswordPolicy, setPassword, verifyPassword } from "../../lib/passwords.js";
import { eligibleCondominium } from "../../security/condominiums.js";
import { authOf, txCtx, type AuthContext } from "../../security/context.js";
import { clearRefreshCookie, presentedRefresh } from "../../security/tokens.js";
import { revokeAllSessions, sessionPayload } from "./service.js";

const userOf = (auth: AuthContext, mustChangePassword = auth.mustChangePassword) => ({
  id: auth.userId,
  email: auth.email,
  names: auth.names,
  mustChangePassword
});

/** GET /auth/me — perfil, condominio activo, condominios disponibles y módulos */
export const me = handler({}, async ({ req }) => {
  const auth = authOf(req);
  return sessionPayload(userOf(auth), auth.client, auth.condominiumId);
});

/** POST /auth/switch-condominium — cambia el condominio activo de la sesión */
export const switchCondominium = handler(
  { body: z.object({ condominiumId: z.uuid(), makeDefault: z.boolean().default(false) }) },
  async ({ body, req }) => {
    const auth = authOf(req);
    const target = await eligibleCondominium(auth.userId, auth.client, body.condominiumId);
    if (!target) throw forbidden("CONDOMINIUM_FORBIDDEN", "No tiene acceso a ese condominio");

    await query(`UPDATE users_sessions SET condominium_id = $2 WHERE id = $1`, [auth.sessionId, target.id]);
    if (body.makeDefault) {
      await query(
        `UPDATE users_condominiums SET is_default = (condominium_id = $2)
          WHERE user_id = $1 AND is_default <> (condominium_id = $2)`,
        [auth.userId, target.id]
      );
    }
    await logAuth(req, "switch_condominium", true, {
      userId: auth.userId,
      email: auth.email,
      detail: { from: auth.condominiumId, to: target.id }
    });
    return sessionPayload(userOf(auth), auth.client, target.id);
  }
);

/** POST /auth/change-password — también la usa el cambio obligatorio del primer ingreso */
export const changePassword = handler(
  { body: z.object({ currentPassword: z.string().min(1).max(128), newPassword: z.string().min(1).max(128) }) },
  async ({ body, req }) => {
    const auth = authOf(req);
    const user = await one<{ password_hash: string }>(`SELECT password_hash FROM users WHERE id = $1`, [auth.userId]);
    if (!user || !(await verifyPassword(body.currentPassword, user.password_hash))) {
      await logAuth(req, "password_change", false, { userId: auth.userId, email: auth.email, detail: { reason: "bad_current" } });
      throw new HttpError(400, "INVALID_CURRENT_PASSWORD", "La contraseña actual no es correcta");
    }
    if (body.currentPassword === body.newPassword) {
      throw new HttpError(400, "PASSWORD_REUSED", "La nueva contraseña debe ser distinta de la actual");
    }
    assertPasswordPolicy(body.newPassword, auth.email);

    await withTx(txCtx(req), async (client) => {
      await assertNotReused(client, auth.userId, user.password_hash, body.newPassword);
      await setPassword(client, auth.userId, user.password_hash, body.newPassword, false);
      await revokeAllSessions(client, auth.userId, "password_change", auth.sessionId);
    });
    await logAuth(req, "password_change", true, { userId: auth.userId, email: auth.email });
    return sessionPayload(userOf(auth, false), auth.client, auth.condominiumId);
  }
);

/** POST /auth/logout — basta el refresh (cookie o cuerpo): funciona aunque el access haya vencido */
export const logout = handler({}, async ({ req, res }) => {
  const token = presentedRefresh(req);
  if (token) {
    const rows = await query<{ id: string; user_id: string }>(
      `UPDATE users_sessions SET revoked_at = NOW(), revoke_reason = 'logout'
        WHERE refresh_hash = $1 AND revoked_at IS NULL RETURNING id, user_id`,
      [sha256(token)]
    );
    if (rows[0]) {
      // El teléfono deja de recibir push de esta cuenta
      await query(`DELETE FROM push_tokens WHERE session_id = $1`, [rows[0].id]);
      await logAuth(req, "logout", true, { userId: rows[0].user_id });
    }
  }
  clearRefreshCookie(res);
  return undefined;
});

/** POST /auth/logout-all — cierra todas las sesiones del usuario (panel y teléfonos) */
export const logoutAll = handler({}, async ({ req, res }) => {
  const auth = authOf(req);
  await withTx(txCtx(req), (client) => revokeAllSessions(client, auth.userId, "logout_all"));
  await query(`DELETE FROM push_tokens WHERE user_id = $1`, [auth.userId]);
  await logAuth(req, "logout_all", true, { userId: auth.userId, email: auth.email });
  clearRefreshCookie(res);
  return undefined;
});
