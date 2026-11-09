/**
 * @project DomusApp - Mobile
 * @file src/lib/auth.ts
 * @description Acciones de autenticación: login (contraseña → OTP), restauración, cambio de
 * contraseña, cambio de condominio y cierre de sesión
 */

import { api, ApiError, refreshSession } from "./api";
import { sessionStore, type OtpChallenge, type SessionPayload, type TokenPayload } from "./session";

export async function signIn(email: string, password: string): Promise<void> {
  const clean = email.trim().toLowerCase();
  const challenge = await api<OtpChallenge>("/auth/sign-in", {
    method: "POST",
    body: { email: clean, password, client: "mobile" },
    skipAuth: true
  });
  sessionStore.setChallenge({ ...challenge, email: clean });
}

export async function verifyOtp(code: string): Promise<void> {
  const challenge = sessionStore.get().challenge;
  if (!challenge) throw new ApiError(400, "NO_CHALLENGE", "Vuelva a iniciar sesión");
  const payload = await api<TokenPayload>("/auth/otp/verify", {
    method: "POST",
    body: { challengeId: challenge.challengeId, code },
    skipAuth: true
  });
  await sessionStore.setTokens(payload);
}

export async function resendOtp(): Promise<number> {
  const challenge = sessionStore.get().challenge;
  if (!challenge) throw new ApiError(400, "NO_CHALLENGE", "Vuelva a iniciar sesión");
  const r = await api<{ otpExpiresAt: string; resendAfterSeconds: number }>("/auth/otp/resend", {
    method: "POST",
    body: { challengeId: challenge.challengeId },
    skipAuth: true
  });
  sessionStore.setChallenge({ ...challenge, otpExpiresAt: r.otpExpiresAt, resendAfterSeconds: r.resendAfterSeconds });
  return r.resendAfterSeconds;
}

/** Al abrir la app: si hay refresh guardado, recupera la sesión sin pedir contraseña */
export async function restoreSession(): Promise<void> {
  if (!(await sessionStore.readRefresh())) {
    sessionStore.markAnonymous();
    return;
  }
  try {
    await refreshSession();
  } catch (err) {
    // Sin red se conserva el refresh para reintentar; si la API lo rechaza, se borra
    if (err instanceof ApiError && err.status === 401) await sessionStore.clear();
    else sessionStore.markAnonymous();
  }
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  const session = await api<SessionPayload>("/auth/change-password", { method: "POST", body: { currentPassword, newPassword } });
  sessionStore.setSession(session);
}

export async function switchCondominium(condominiumId: string): Promise<void> {
  const session = await api<SessionPayload>("/auth/switch-condominium", { method: "POST", body: { condominiumId } });
  sessionStore.setSession(session);
  // El access token vigente lleva el condominio anterior: se renueva para que coincida
  await refreshSession();
}

export async function signOut(): Promise<void> {
  const refreshToken = await sessionStore.readRefresh();
  if (refreshToken) {
    await api("/auth/logout", { method: "POST", body: { refreshToken }, skipAuth: true }).catch(() => undefined);
  }
  await sessionStore.clear();
}
