/**
 * @project DomusApp - API
 * @file src/security/context.ts
 * @description Tipos de contexto de seguridad que viajan en cada Request
 */

import type { Request } from "express";
import type { TxContext } from "../db.js";
import { forbidden } from "../lib/http.js";

export type Client = "web" | "mobile";
export type Role = "admin" | "owner" | "tenant" | "guard";

export interface AuthContext {
  userId: string;
  sessionId: string;
  email: string;
  names: string;
  mustChangePassword: boolean;
  client: Client;
  /** Condominio activo de la sesión (app.condominium_id). NULL solo para un administrador de plataforma sin condominios */
  condominiumId: string | null;
  /** Rol en el condominio activo. Un administrador de plataforma sin pertenencia actúa como admin */
  role: Role | null;
  isPlatformAdmin: boolean;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext;
      /** Permisos efectivos sobre el módulo de la ruta (lo fija requirePermission) */
      modulePermissions?: string[];
    }
  }
}

/** Datos del cliente para bitácoras */
export const clientInfo = (req: Request) => ({
  ip: req.ip ?? null,
  userAgent: req.get("user-agent")?.slice(0, 500) ?? null
});

/** Contexto de auditoría para withTx() */
export const txCtx = (req: Request): TxContext => ({
  userId: req.auth?.userId ?? null,
  traceId: req.traceId,
  condominiumId: req.auth?.condominiumId ?? null
});

/** Usuario autenticado (lanza si la ruta olvidó `authenticate`) */
export function authOf(req: Request): AuthContext {
  if (!req.auth) throw new Error("authOf() llamado en una ruta sin authenticate");
  return req.auth;
}

/** Condominio activo; lanza 403 si la sesión no tiene uno */
export function condominiumOf(req: Request): string {
  const id = authOf(req).condominiumId;
  if (!id) throw forbidden("NO_CONDOMINIUM", "Seleccione un condominio");
  return id;
}
