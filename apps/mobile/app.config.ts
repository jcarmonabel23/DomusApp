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
 * EAS_PROJECT_ID: el id que da `eas init`. Habilita el token push remoto (sin él, la app funciona igual
 * pero solo con el socket y avisos locales). También puede quedar en app.json → extra.eas.projectId.
 */

import type { ConfigContext, ExpoConfig } from "expo/config";

type Plugin = NonNullable<ExpoConfig["plugins"]>[number];

export default ({ config }: ConfigContext): ExpoConfig => {
  const variant = process.env.APP_VARIANT ?? "development";
  const production = variant === "production";
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
    ios: { ...config.ios, bundleIdentifier: production ? "com.domusapp.mobile" : "com.domusapp.mobile.preview" },
    android: { ...config.android, package: production ? "com.domusapp.mobile" : "com.domusapp.mobile.preview" },
    plugins,
    extra: { ...config.extra, variant, ...(projectId ? { eas: { projectId } } : {}) }
  };
};
