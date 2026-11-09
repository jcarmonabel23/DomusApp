/**
 * @project DomusApp - Admin
 * @file vite.config.ts
 * @description Configuración de Vite (alias al estilo FabriHub y proxy /api en desarrollo)
 *
 * En `npm run dev` las llamadas a /api van al contenedor `admin` (http://localhost:8090),
 * que a su vez hace de proxy a la API. Así el desarrollo usa la API real sin publicarla.
 */

import { defineConfig } from "vite";
import path from "node:path";
import react from "@vitejs/plugin-react-swc";

const r = (p: string) => path.resolve(__dirname, p);

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: process.env.VITE_DEV_API_TARGET ?? "http://localhost:8090", changeOrigin: true, ws: true }
    }
  },
  resolve: {
    alias: {
      "@": r("./src"),
      "@global": r("./src/global"),
      "@assets": r("./src/global/assets"),
      "@atoms": r("./src/global/atoms"),
      "@clients": r("./src/global/clients"),
      "@config": r("./src/global/config"),
      "@navigation": r("./src/navigation"),
      "@layouts": r("./src/layouts"),
      "@dashboard": r("./src/app/dashboard"),
      "@auth": r("./src/app/auth"),
      "@modules": r("./src/global/modules"),
      "@store": r("./src/global/store"),
      "@utils": r("./src/global/utils")
    }
  },
  test: {
    environment: "node",
    include: ["src/**/__tests__/**/*.test.ts"]
  }
} as Parameters<typeof defineConfig>[0]);
