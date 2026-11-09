/**
 * @project DomusApp - API
 * @file src/security/authorize.ts
 * @description Autorización por módulo y permiso (RBAC por rol en el condominio), del lado del servidor
 *
 * @overview
 * El panel oculta botones con `useCan`, pero quien AUTORIZA es la API: cada handler del panel
 * se monta detrás de `requirePermission(MODULE_CODE, ...slugs)`. Reglas, en orden:
 *  1. El módulo debe existir y estar activo; si está fuera de servicio → 503 MODULE_OFFLINE.
 *  2. scope 'platform': solo administradores de plataforma (todos los permisos).
 *  3. scope 'condominium': la sesión debe tener condominio; permisos = los del rol en ese
 *     condominio (catalogs_roles.permissions[MODULO]). El administrador de plataforma los tiene todos.
 *  4. Hace falta `access` (o módulo público) y TODOS los slugs pedidos.
 *
 * Las funciones de la app móvil (propietario, inquilino, guarda) se protegen con `requireRole`.
 */

import type { NextFunction, Request, RequestHandler, Response } from "express";
import { one, query } from "../db.js";
import { forbidden, HttpError } from "../lib/http.js";
import type { AuthContext, Role } from "./context.js";

const ALL = `(SELECT jsonb_agg(slug ORDER BY order_list) FROM catalogs_permissions)`;

/** Permisos efectivos (requiere m = módulo; $1 = rol; $2 = es admin de plataforma) */
const EFFECTIVE = `CASE
    WHEN $2::boolean THEN ${ALL}
    WHEN m.scope = 'platform' THEN '[]'::jsonb
    ELSE COALESCE((SELECT r.permissions -> m.code FROM catalogs_roles r WHERE r.slug = $1), '[]'::jsonb)
  END`;

interface ModuleRow {
  scope: "platform" | "condominium";
  is_public: boolean;
  is_offline: boolean;
  permissions: string[];
}

export function requirePermission(moduleCode: string, ...slugs: string[]): RequestHandler {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const auth = req.auth;
      if (!auth) throw new Error(`requirePermission(${moduleCode}) sin authenticate previo`);

      const row = await one<ModuleRow>(
        `SELECT m.scope, m.is_public, m.is_offline, ${EFFECTIVE} AS permissions
           FROM catalogs_modules m WHERE m.code = $3 AND m.is_active`,
        [auth.role, auth.isPlatformAdmin, moduleCode]
      );
      if (!row) throw forbidden();
      if (row.is_offline) throw new HttpError(503, "MODULE_OFFLINE", "El módulo está fuera de servicio");
      if (row.scope === "condominium" && !auth.condominiumId) {
        throw forbidden("NO_CONDOMINIUM", "Seleccione o cree un condominio primero");
      }

      const granted = row.permissions ?? [];
      const hasAccess = row.is_public || granted.includes("access");
      if (!hasAccess || slugs.some((s) => !granted.includes(s))) throw forbidden();

      req.modulePermissions = granted;
      next();
    } catch (err) {
      next(err);
    }
  };
}

/** Funciones de la app: exige uno de los roles en el condominio activo */
export function requireRole(...roles: Role[]): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const auth = req.auth;
    if (!auth?.condominiumId || !auth.role || !roles.includes(auth.role)) {
      next(forbidden("ROLE_FORBIDDEN", "Su rol en este condominio no permite esta acción"));
      return;
    }
    next();
  };
}

/** Módulo tal como lo recibe el panel en la sesión */
export interface SessionModule {
  code: string;
  name: string;
  description: string | null;
  icon: string | null;
  path: string;
  scope: "platform" | "condominium";
  phase: number;
  isPublic: boolean;
  isOffline: boolean;
  permissions: string[];
}

/** Catálogo de módulos con los permisos efectivos de la sesión (los de plataforma solo para su administrador) */
export function sessionModules(auth: Pick<AuthContext, "role" | "isPlatformAdmin">): Promise<SessionModule[]> {
  return query<SessionModule>(
    `SELECT m.code, m.name, m.description, m.icon, m.path, m.scope, m.phase,
            m.is_public AS "isPublic", m.is_offline AS "isOffline", ${EFFECTIVE} AS permissions
       FROM catalogs_modules m
      WHERE m.is_active AND (m.scope <> 'platform' OR $2::boolean)
      ORDER BY m.order_list`,
    [auth.role, auth.isPlatformAdmin]
  );
}
