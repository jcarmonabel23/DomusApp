/**
 * @project DomusApp - Admin
 * @file src/global/modules/access-control/moduleTree.ts
 * @description Reglas de acceso a módulos (espejo de requirePermission en la API)
 */

import type { SessionModule } from "@auth/types";

export const canAccessModule = (m: SessionModule | undefined): boolean =>
  Boolean(m && (m.isPublic || m.permissions.includes("access")));

export const can = (m: SessionModule | undefined, slug: string): boolean =>
  Boolean(m && canAccessModule(m) && m.permissions.includes(slug));

/** Módulos que aparecen en barra y tablero: los accesibles y los de fases futuras (deshabilitados) */
export function visibleModules(modules: SessionModule[]): { module: SessionModule; enabled: boolean }[] {
  return modules
    .filter((m) => m.code !== "DASHBOARD")
    .filter((m) => canAccessModule(m) || (m.isOffline && m.scope === "condominium"))
    .map((m) => ({ module: m, enabled: canAccessModule(m) && !m.isOffline }));
}

/** Módulo cuyo `path` coincide con la URL (o es su prefijo más largo) */
export function moduleForPath(modules: SessionModule[], pathname: string): SessionModule | undefined {
  const clean = pathname.replace(/\/$/, "") || "/";
  return modules
    .filter((m) => clean === m.path || clean.startsWith(`${m.path}/`))
    .sort((a, b) => b.path.length - a.path.length)[0];
}
