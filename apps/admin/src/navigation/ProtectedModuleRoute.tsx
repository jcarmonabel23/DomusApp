/**
 * @project DomusApp - Admin
 * @file src/navigation/ProtectedModuleRoute.tsx
 * @description Guard de módulo: ACCESO (permiso `access`) + ESTADO (fase futura)
 *
 *  - Sin acceso, o módulo que la sesión no trae → al tablero, sin explicar.
 *  - Módulo de una fase futura → pantalla "próximamente".
 */

import { Navigate, Outlet } from "react-router-dom";
import { coreAuth } from "@auth/store/coreAuth";
import { canAccessModule } from "@modules/access-control/moduleTree";
import ModuleOffline from "@atoms/states/ModuleOffline";
import { DEFAULT_REDIRECT_AUTHENTICATED } from "./routes.config";

export function ProtectedModuleRoute({ moduleCode }: Readonly<{ moduleCode: string }>) {
  const modules = coreAuth((s) => s.modules);
  const mod = modules.find((m) => m.code === moduleCode);

  if (mod?.isOffline) return <ModuleOffline moduleName={mod.name} phase={mod.phase} />;
  if (!mod || !canAccessModule(mod)) return <Navigate to={DEFAULT_REDIRECT_AUTHENTICATED} replace />;
  return <Outlet />;
}
