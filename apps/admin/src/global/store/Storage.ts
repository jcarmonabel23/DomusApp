/**
 * @project DomusApp - Admin
 * @file src/global/store/Storage.ts
 * @description Limpieza de los stores persistidos al cerrar sesión
 */

import { AUTH_STORE_KEY } from "@auth/store/coreAuth";

export function purgePersistedStores(): void {
  try {
    localStorage.removeItem(AUTH_STORE_KEY);
  } catch {
    /* almacenamiento no disponible (modo privado) */
  }
}
