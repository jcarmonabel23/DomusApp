/**
 * @project DomusApp - API
 * @file src/modules/auth/signIn.ts
 * @description POST /auth/sign-in — paso 1 del login: contraseña → envía OTP al correo
 *
 * @overview
 * - Correo inexistente y contraseña errada responden IGUAL (y tardan igual) para no enumerar cuentas.
 * - LOGIN_MAX_ATTEMPTS fallos seguidos bloquean la cuenta LOGIN_LOCK_MINUTES.
 * - `client`: web (panel) o mobile (app). Antes de enviar el código se comprueba que el usuario
 *   pueda entrar desde ese cliente: el panel es solo para administradores; la app, para cualquiera
 *   con un condominio.
 */

import { z } from "zod";
import { config } from "../../config.js";
import { one, query, withTx } from "../../db.js";
import { logAuth } from "../../lib/authLog.js";
import { HttpError, handler } from "../../lib/http.js";
import { brandForUser, sendOtp } from "../../lib/mailer.js";
import { verifyPassword } from "../../lib/passwords.js";
import { txCtx } from "../../security/context.js";
import { USER_COLUMNS, canSignInFrom, createOtp, maskEmail, type UserRow } from "./service.js";

const body = z.object({
  email: z.email().max(200).transform((v) => v.trim().toLowerCase()),
  password: z.string().min(1).max(128),
  client: z.enum(["web", "mobile"]).default("web")
});

const INVALID = new HttpError(401, "INVALID_CREDENTIALS", "Correo o contraseña incorrectos");

export const signIn = handler({ body }, async ({ body, req }) => {
  const user = await one<UserRow>(`SELECT ${USER_COLUMNS} FROM users WHERE email = $1`, [body.email]);

  if (user?.locked_until && user.locked_until > new Date()) {
    const minutes = Math.ceil((user.locked_until.getTime() - Date.now()) / 60000);
    await logAuth(req, "sign_in", false, { userId: user.id, email: body.email, detail: { reason: "locked" } });
    throw new HttpError(423, "ACCOUNT_LOCKED", `Cuenta bloqueada temporalmente. Intente de nuevo en ${minutes} min.`);
  }

  const valid = await verifyPassword(body.password, user?.password_hash);

  if (!user || !valid) {
    if (user) {
      const [{ failed_attempts }] = await query<{ failed_attempts: number }>(
        `UPDATE users SET failed_attempts = failed_attempts + 1 WHERE id = $1 RETURNING failed_attempts`,
        [user.id]
      );
      if (failed_attempts >= config.LOGIN_MAX_ATTEMPTS) {
        await query(`UPDATE users SET failed_attempts = 0, locked_until = NOW() + make_interval(mins => $2) WHERE id = $1`, [
          user.id,
          config.LOGIN_LOCK_MINUTES
        ]);
        await logAuth(req, "locked", true, { userId: user.id, email: body.email, detail: { attempts: failed_attempts } });
      }
    }
    await logAuth(req, "sign_in", false, {
      userId: user?.id,
      email: body.email,
      detail: { reason: user ? "bad_password" : "unknown_email" }
    });
    throw INVALID;
  }

  if (!user.is_active) {
    await logAuth(req, "sign_in", false, { userId: user.id, email: body.email, detail: { reason: "inactive" } });
    throw new HttpError(403, "ACCOUNT_INACTIVE", "Su cuenta está desactivada. Contacte a la administración.");
  }

  if (!(await canSignInFrom(user.id, user.is_platform_admin, body.client))) {
    await logAuth(req, "sign_in", false, { userId: user.id, email: body.email, detail: { reason: "no_access", client: body.client } });
    throw body.client === "web"
      ? new HttpError(403, "PANEL_FORBIDDEN", "El panel es para la administración. Ingrese desde la app DomusApp en su teléfono.")
      : new HttpError(403, "NO_CONDOMINIUM", "Su usuario no tiene acceso a ningún condominio activo.");
  }

  const otp = await withTx(txCtx(req), async (client) => {
    await client.query(`UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = $1`, [user.id]);
    return createOtp(client, req, user.id, "login", body.client);
  });

  await sendOtp(user.email, otp.code, "login", await brandForUser(user.id));
  await logAuth(req, "sign_in", true, { userId: user.id, email: body.email, detail: { step: "otp_sent", client: body.client } });

  return {
    challengeId: otp.challengeId,
    otpExpiresAt: otp.expiresAt.toISOString(),
    destination: maskEmail(user.email),
    resendAfterSeconds: config.OTP_RESEND_SECONDS
  };
});
