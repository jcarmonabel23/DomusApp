/**
 * @project DomusApp - Admin
 * @file src/global/config/environment.ts
 * @description Entorno de ejecución embebido en el build
 */

export const APP_ENVIRONMENT = (import.meta.env.VITE_ENVIRONMENT ?? "dev") as "dev" | "qa" | "prod";
export const APP_VERSION = import.meta.env.VITE_APP_VERSION ?? "0.0.0";

export const ENVIRONMENT_LABEL: Record<string, string> = {
  dev: "Desarrollo",
  qa: "Pruebas",
  prod: "Producción"
};
