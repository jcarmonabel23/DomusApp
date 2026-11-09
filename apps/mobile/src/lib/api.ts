/**
 * @project DomusApp - Mobile
 * @file src/lib/api.ts
 * @description Cliente HTTP hacia /api/v1 con sesión
 *
 * - Adjunta `Authorization: Bearer` y `x-condominium-id`.
 * - Si el access token está por vencer, o la API responde TOKEN_INVALID, renueva UNA vez con el
 *   refresh guardado en SecureStore (single-flight) y reintenta.
 * - Cualquier otro 401 (revocada, reuso, expirada) borra la sesión local → pantalla de login.
 * - 409 CONDOMINIUM_CHANGED: la sesión cambió de condominio en otro lado; se toma la sesión fresca.
 */

import { API_URL } from "./config";
import { sessionStore, type TokenPayload } from "./session";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
  }
}

interface Options {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  /** Sin token ni refresh (login, OTP, recuperación) */
  skipAuth?: boolean;
  timeoutMs?: number;
  /** Cuerpo crudo (imagen): se envía tal cual con su content-type */
  file?: { blob: Blob; type: string; name: string };
}

async function rawFetch(path: string, opts: Options, token: string | null) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? (opts.file ? 60_000 : 10_000));
  const headers: Record<string, string> = { "content-type": opts.file?.type ?? "application/json" };
  if (opts.file) headers["x-file-name"] = encodeURIComponent(opts.file.name);
  if (token) headers.authorization = `Bearer ${token}`;
  const condominiumId = sessionStore.get().session?.condominium?.id;
  if (token && condominiumId) headers["x-condominium-id"] = condominiumId;
  try {
    const res = await fetch(`${API_URL}/api/v1${path}`, {
      method: opts.method ?? "GET",
      headers,
      body: opts.file ? opts.file.blob : opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: controller.signal
    });
    const json = await res.json().catch(() => null);
    return { res, json };
  } catch {
    throw new ApiError(0, "NETWORK", `No hay conexión con el servidor (${API_URL})`);
  } finally {
    clearTimeout(timer);
  }
}

function toError(status: number, json: unknown): ApiError {
  const err = (json as { error?: { code?: string; message?: string; details?: unknown } } | null)?.error;
  return new ApiError(status, err?.code ?? "UNKNOWN", err?.message ?? (status >= 500 ? "Error del servidor" : "Solicitud rechazada"), err?.details);
}

let refreshing: Promise<TokenPayload> | null = null;

/** Renueva la sesión con el refresh de SecureStore (rota: el nuevo reemplaza al anterior) */
export function refreshSession(): Promise<TokenPayload> {
  if (!refreshing) {
    refreshing = (async () => {
      const refreshToken = await sessionStore.readRefresh();
      if (!refreshToken) throw new ApiError(401, "REFRESH_INVALID", "Sin sesión");
      const { res, json } = await rawFetch("/auth/refresh", { method: "POST", body: { refreshToken } }, null);
      if (!res.ok) throw toError(res.status, json);
      const payload = json as TokenPayload;
      await sessionStore.setTokens(payload);
      return payload;
    })().finally(() => {
      refreshing = null;
    });
  }
  return refreshing;
}

/** Access token vigente (lo renueva si está por vencer). También lo usa el socket */
export async function validToken(): Promise<string> {
  const { accessToken, accessExpiresAt } = sessionStore.get();
  if (accessToken && accessExpiresAt && accessExpiresAt * 1000 - Date.now() > 30_000) return accessToken;
  try {
    return (await refreshSession()).accessToken;
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) await sessionStore.clear();
    throw err;
  }
}

export async function api<T>(path: string, opts: Options = {}): Promise<T> {
  let token = opts.skipAuth ? null : await validToken();
  let { res, json } = await rawFetch(path, opts, token);

  if (!opts.skipAuth && res.status === 401 && toError(401, json).code === "TOKEN_INVALID") {
    token = (await refreshSession()).accessToken;
    ({ res, json } = await rawFetch(path, opts, token));
  }
  if (res.ok) return json as T;

  const error = toError(res.status, json);
  if (!opts.skipAuth && res.status === 401) await sessionStore.clear();
  if (error.code === "CONDOMINIUM_CHANGED") await refreshSession().catch(() => undefined);
  throw error;
}

export interface SystemStatus {
  app: string;
  version: string;
  environment: string;
  database: { ok: boolean; serverTime: string | null; migrations: number };
}

/** Las URLs de archivos que da la API son relativas y firmadas: se completan con API_URL */
export const fileUrl = (path: string | null | undefined): string | undefined => (path ? `${API_URL}${path}` : undefined);

/** Sube una imagen local (uri del selector o la cámara) como cuerpo crudo */
export async function uploadImage<T>(path: string, image: { uri: string; mimeType?: string | null; fileName?: string | null }): Promise<T> {
  const blob = await (await fetch(image.uri)).blob();
  const type = image.mimeType ?? (blob.type || "image/jpeg");
  return api<T>(path, { method: "PUT", file: { blob, type, name: image.fileName ?? "foto.jpg" } });
}
