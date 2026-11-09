/**
 * @project DomusApp - Admin
 * @file src/global/modules/access-control/useCan.ts
 * @description Hooks de permisos: ocultan acciones que la API rechazaría de todos modos
 */

import { useCallback } from "react";
import { coreAuth } from "@auth/store/coreAuth";
import { can as canSlug, canAccessModule } from "./moduleTree";

export function useCanAccess(): (code: string) => boolean {
  const modules = coreAuth((s) => s.modules);
  return useCallback((code: string) => canAccessModule(modules.find((m) => m.code === code)), [modules]);
}

export function useCan(code: string): (slug: string) => boolean {
  const modules = coreAuth((s) => s.modules);
  return useCallback((slug: string) => canSlug(modules.find((m) => m.code === code), slug), [modules, code]);
}
