/**
 * @project DomusApp - Admin
 * @file server.ts
 * @description Servidor Express (mismo papel que en FabriHub): estáticos + proxy /api + health
 *
 * @overview
 *  - /api/*   → proxy a la API (red interna de Docker). El navegador solo conoce este origen,
 *               así la cookie del refresh es same-site y la API nunca se publica.
 *  - /health  → health check.
 *  - /privacidad → política de privacidad pública (la piden Google Play y App Store), con el correo SUPPORT_EMAIL.
 *  - resto    → SPA de Vite (dist) con fallback a index.html para el history mode.
 * Añade cabeceras de seguridad (CSP estricta, anti-clickjacking, no-sniff, referrer).
 */

import express from "express";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createProxyMiddleware } from "http-proxy-middleware";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

const PORT = Number(process.env.PORT ?? 3005);
const API_TARGET = process.env.API_TARGET ?? "http://127.0.0.1:4000";

app.disable("x-powered-by");

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob:",          // blob: vista previa de imágenes antes de subirlas
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'"
].join("; ");

app.use((_req, res, next) => {
  res.setHeader("Content-Security-Policy", CSP);
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  next();
});

/** Proxy a la API. Va ANTES de los estáticos y del fallback SPA. */
// /api (REST) y /api/socket.io (tiempo real, con upgrade a WebSocket)
const apiProxy = createProxyMiddleware({
  target: API_TARGET,
  pathFilter: "/api",
  changeOrigin: false,
  xfwd: true,
  ws: true,
  proxyTimeout: 30_000
});
app.use(apiProxy);

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// Política de privacidad: HTML estático con el correo de contacto del ambiente (escapado)
const escapeHtml = (v: string) => v.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const privacy = (() => {
  try {
    const support = escapeHtml(process.env.SUPPORT_EMAIL || "soporte@domusapp.com");
    return readFileSync(path.join(__dirname, "legal", "privacidad.html"), "utf8")
      .replaceAll("{{SUPPORT_EMAIL}}", support)
      .replaceAll("{{UPDATED}}", "noviembre de 2026");
  } catch {
    return null;
  }
})();
app.get(["/privacidad", "/privacy"], (_req, res) => {
  if (!privacy) {
    res.status(404).end();
    return;
  }
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.type("html").send(privacy);
});

const dist = path.join(__dirname, "dist");
app.use(
  express.static(dist, {
    index: false,
    setHeaders(res, filePath) {
      // Los assets llevan hash en el nombre: caché larga. index.html nunca se cachea.
      if (filePath.includes(`${path.sep}assets${path.sep}`)) {
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      }
    }
  })
);

app.get("/{*splat}", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.sendFile(path.join(dist, "index.html"));
});

const server = app.listen(PORT, () => {
  console.log(`[admin] escuchando en :${PORT} · API → ${API_TARGET}`);
});
server.on("upgrade", apiProxy.upgrade);
