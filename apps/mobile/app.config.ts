/**
 * @project DomusApp - Mobile
 * @file app.config.ts
 * @description Configuración dinámica de Expo sobre app.json: variante del build y proyecto de EAS
 *
 * APP_VARIANT (lo pone cada perfil de eas.json):
 *  - development / preview → "DomusApp (prueba)", paquete com.domusapp.mobile.preview (se instala junto a la
 *    de producción) y tráfico HTTP permitido, para hablar con la API de la LAN (http://<IP>:8090).
 *  - production → "DomusApp", com.domusapp.mobile, solo HTTPS.
 *
 * EXPO_PUBLIC_API_URL (variable del ambiente de EAS: preview → qa, production → prod): la URL del servidor,
 * p. ej. https://app.domusapp.com. En un build de EAS es obligatoria y en producción debe ser HTTPS; sin ella
 * el build falla aquí en vez de producir una app que no sabe a dónde conectarse.
 *
 * EAS_PROJECT_ID: el id que da `eas init`. Habilita el token push remoto (sin él, la app funciona igual
 * pero solo con el socket y avisos locales). También puede quedar en app.json → extra.eas.projectId.
 */

import type { ConfigContext, ExpoConfig } from "expo/config";

type Plugin = NonNullable<ExpoConfig["plugins"]>[number];

export default ({ config }: ConfigContext): ExpoConfig => {
  const variant = process.env.APP_VARIANT ?? "development";
  const production = variant === "production";
  const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? "";
  if (process.env.EAS_BUILD === "true" && variant !== "development") {
    if (!apiUrl) throw new Error(`[app.config] Falta EXPO_PUBLIC_API_URL en el ambiente "${variant}" de EAS (eas env:create)`);
    if (production && !apiUrl.startsWith("https://")) throw new Error("[app.config] En producción EXPO_PUBLIC_API_URL debe ser https://");
  }
  const projectId = process.env.EAS_PROJECT_ID || (config.extra?.eas as { projectId?: string } | undefined)?.projectId;

  const plugins = (config.plugins ?? []).map((p): Plugin => {
    const name = Array.isArray(p) ? p[0] : p;
    if (name === "expo-build-properties") {
      return ["expo-build-properties", { android: { usesCleartextTraffic: !production } }];
    }
    return p;
  });

  return {
    ...config,
    name: production ? "DomusApp" : "DomusApp (prueba)",
    slug: config.slug ?? "domusapp",
    ios: {
      ...config.ios,
      bundleIdentifier: production ? "com.domusapp.mobile" : "com.domusapp.mobile.preview",
      // Solo HTTPS estándar: sin cifrado propio (evita el trámite de exportación en cada envío)
      config: { ...config.ios?.config, usesNonExemptEncryption: false }
    },
    android: { ...config.android, package: production ? "com.domusapp.mobile" : "com.domusapp.mobile.preview" },
    plugins,
    extra: { ...config.extra, variant, ...(projectId ? { eas: { projectId } } : {}) }
  };
};
