/**
 * @project DomusApp - Mobile
 * @file src/lib/config.ts
 * @description URL de la API
 *
 * Orden de prioridad:
 *  1. EXPO_PUBLIC_API_URL (archivo .env de apps/mobile), p. ej. https://api.domusapp.com
 *  2. En desarrollo con Expo Go: la IP de la PC que corre `expo start` (hostUri) + el puerto
 *     del panel (WEB_PORT=8090), que hace de proxy /api hacia la API del docker compose.
 */

import Constants from "expo-constants";

const DEV_WEB_PORT = process.env.EXPO_PUBLIC_WEB_PORT ?? "8090";

function devHost(): string | null {
  const hostUri = Constants.expoConfig?.hostUri; // "192.168.1.20:8081"
  return hostUri ? hostUri.split(":")[0] : null;
}

/** false en un build sin EXPO_PUBLIC_API_URL (no hay PC de desarrollo de la cual tomar la IP) */
export const API_CONFIGURED = Boolean(process.env.EXPO_PUBLIC_API_URL || devHost());

export const API_URL: string = (() => {
  const fromEnv = process.env.EXPO_PUBLIC_API_URL;
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  const host = devHost() ?? "localhost";
  return `http://${host}:${DEV_WEB_PORT}`;
})();

export const APP_VERSION = Constants.expoConfig?.version ?? "0.0.0";
