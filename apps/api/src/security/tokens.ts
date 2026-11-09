/**
 * @project DomusApp - API
 * @file src/security/tokens.ts
 * @description Access JWT (corto, HS256) y entrega del refresh token según el cliente
 *
 *  - web (panel):    refresh en cookie httpOnly, SameSite=Strict, solo para /api/v1/auth.
 *  - mobile (app):   refresh en el cuerpo de la respuesta; la app lo guarda en expo-secure-store
 *                    y lo devuelve en el cuerpo de /auth/refresh y /auth/logout.
 */

import jwt, { type SignOptions } from "jsonwebtoken";
import type { Request, Response } from "express";
import { config } from "../config.js";
import type { Client } from "./context.js";

const ISSUER = "domusapp-api";
const AUDIENCE = "domusapp";

export const REFRESH_COOKIE = "domus_refresh";
const REFRESH_COOKIE_PATH = "/api/v1/auth";

export interface AccessClaims {
  sub: string;
  sid: string;
}

export function signAccessToken(userId: string, sessionId: string): { token: string; expiresAt: number } {
  const token = jwt.sign({ sid: sessionId }, config.JWT_ACCESS_SECRET, {
    subject: userId,
    issuer: ISSUER,
    audience: AUDIENCE,
    algorithm: "HS256",
    expiresIn: config.JWT_ACCESS_TTL as SignOptions["expiresIn"]
  });
  const { exp } = jwt.decode(token) as { exp: number };
  return { token, expiresAt: exp };
}

export function verifyAccessToken(token: string): AccessClaims | null {
  try {
    const payload = jwt.verify(token, config.JWT_ACCESS_SECRET, {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: ["HS256"]
    }) as jwt.JwtPayload;
    if (typeof payload.sub !== "string" || typeof payload.sid !== "string") return null;
    return { sub: payload.sub, sid: payload.sid };
  } catch {
    return null;
  }
}

/** Duración absoluta de una sesión nueva según el cliente */
export function sessionExpiry(client: Client): Date {
  const ms = client === "mobile" ? config.MOBILE_REFRESH_TTL_DAYS * 86_400_000 : config.JWT_REFRESH_TTL_HOURS * 3_600_000;
  return new Date(Date.now() + ms);
}

/**
 * Entrega el refresh: cookie para el panel; para la app lo devuelve para ir en el cuerpo.
 * @returns el objeto a mezclar en la respuesta ({} en web)
 */
export function deliverRefresh(res: Response, client: Client, token: string, expiresAt: Date): { refreshToken?: string } {
  if (client === "mobile") return { refreshToken: token };
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: config.COOKIE_SECURE,
    sameSite: "strict",
    path: REFRESH_COOKIE_PATH,
    expires: expiresAt
  });
  return {};
}

/** Refresh presentado por el cliente: cookie (panel) o cuerpo (app) */
export function presentedRefresh(req: Request): string | undefined {
  const fromBody = (req.body as { refreshToken?: unknown } | undefined)?.refreshToken;
  if (typeof fromBody === "string" && fromBody.length >= 32 && fromBody.length <= 200) return fromBody;
  return req.cookies?.[REFRESH_COOKIE] as string | undefined;
}

export function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE, {
    httpOnly: true,
    secure: config.COOKIE_SECURE,
    sameSite: "strict",
    path: REFRESH_COOKIE_PATH
  });
}
