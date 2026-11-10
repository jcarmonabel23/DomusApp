/**
 * @project DomusApp - API
 * @file src/index.ts
 * @description Punto de entrada de la API de DomusApp
 *
 * @overview
 * Orden de middlewares (importa):
 *   trace → helmet → json(limitado) → cookies → rutas públicas →
 *   [authenticate → rate limit] → rutas de negocio → 404 → manejador de errores
 */

import cookieParser from "cookie-parser";
import express, { type NextFunction, type Request, type Response } from "express";
import helmet from "helmet";
import { ZodError } from "zod";
import { bootstrap } from "./bootstrap.js";
import { config, isProduction } from "./config.js";
import { pool, waitForDb } from "./db.js";
import { HttpError } from "./lib/http.js";
import { logger } from "./lib/logger.js";
import { authRoutes } from "./modules/auth/routes.js";
import { catalogsRoutes } from "./modules/catalogs/routes.js";
import { condominiumsRoutes } from "./modules/condominiums/routes.js";
import { dashboardRoutes } from "./modules/dashboard/routes.js";
import { membersRoutes } from "./modules/members/routes.js";
import { metaRoutes } from "./modules/meta/routes.js";
import { peopleRoutes } from "./modules/people/routes.js";
import { residentRoutes } from "./modules/resident/routes.js";
import { accessRoutes } from "./modules/access/admin.js";
import { guardRoutes } from "./modules/access/guard.js";
import { residentAccessRoutes } from "./modules/access/resident.js";
import { serveFile } from "./modules/files/images.js";
import { settingsRoutes } from "./modules/settings/routes.js";
import { unitsRoutes } from "./modules/units/routes.js";
import { authenticate } from "./security/authenticate.js";
import { apiLimiter } from "./security/rateLimits.js";
import { trace } from "./security/trace.js";
import { closeRealtime, initRealtime } from "./lib/realtime.js";
import { alertsRoutes, guardAlertsRoutes, residentAlertsRoutes } from "./modules/alerts/routes.js";
import { announcementsRoutes, messagesRoutes } from "./modules/messages/routes.js";
import { notificationsRoutes } from "./modules/notifications/routes.js";
import { financeRoutes } from "./modules/finance/admin.js";
import { reportsRoutes } from "./modules/reports/routes.js";
import { startFinanceScheduler, stopFinanceScheduler } from "./modules/finance/generate.js";
import { paymentWebhook } from "./modules/finance/payments.js";
import { residentFinanceRoutes } from "./modules/finance/resident.js";
import { bookingRoutes } from "./modules/bookings/admin.js";
import { residentBookingRoutes } from "./modules/bookings/resident.js";
import { assemblyRoutes } from "./modules/assemblies/routes.js";
import { caseRoutes } from "./modules/cases/admin.js";
import { residentCaseRoutes } from "./modules/cases/resident.js";
import { residentCommunityRoutes } from "./modules/community/resident.js";
import { documentRoutes } from "./modules/documents/routes.js";
import { inventoryRoutes } from "./modules/inventory/routes.js";
import { supplierRoutes } from "./modules/suppliers/routes.js";

const app = express();

/** Códigos SQLSTATE de PostgreSQL que son errores del usuario, no del sistema */
const PG_ERRORS: Record<string, [number, string, string]> = {
  "23505": [409, "DUPLICATED", "Ya existe un registro con ese código"],
  "23503": [409, "IN_USE", "El registro está en uso por otros datos; desactívelo en lugar de eliminarlo"],
  "23514": [400, "CHECK_VIOLATION", "Algún valor no cumple las reglas del registro"],
  P0001: [400, "BUSINESS_RULE", "La operación viola una regla de negocio"]
};

app.disable("x-powered-by");
// Una capa de proxy delante (el Express del panel). req.ip = IP real del cliente.
app.set("trust proxy", Number(process.env.TRUST_PROXY ?? 1));

app.use(trace);
app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } } }));
// Webhooks de la pasarela: antes de express.json, porque la firma se valida sobre el cuerpo exacto
app.post("/api/v1/finance/webhooks/:gateway", express.raw({ type: "application/json", limit: "64kb" }), (req, res, next) => {
  paymentWebhook(req, res).catch(next);
});
app.use(express.json({ limit: "200kb" }));
app.use(cookieParser());
app.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

app.get("/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ok" });
  } catch {
    res.status(503).json({ status: "db_unavailable" });
  }
});

const v1 = express.Router();
v1.use("/meta", metaRoutes);
v1.use("/auth", authRoutes);
// Archivos: sin sesión, los autoriza la firma de la URL (ver modules/files/images.ts)
v1.get("/files/:condominium/:file/:name", serveFile);
v1.use(authenticate(), apiLimiter);
v1.use("/catalogs", catalogsRoutes);
v1.use("/dashboard", dashboardRoutes);
v1.use("/condominiums", condominiumsRoutes);
v1.use("/settings", settingsRoutes);
v1.use("/units", unitsRoutes);
v1.use("/people", peopleRoutes);
v1.use("/members", membersRoutes);
v1.use("/resident", residentRoutes);
v1.use("/resident", residentAccessRoutes);
v1.use("/guard", guardRoutes);
v1.use("/access", accessRoutes);
v1.use("/resident", residentAlertsRoutes);
v1.use("/guard", guardAlertsRoutes);
v1.use("/alerts", alertsRoutes);
v1.use("/messages", messagesRoutes);
v1.use("/announcements", announcementsRoutes);
v1.use("/notifications", notificationsRoutes);
v1.use("/finance", financeRoutes);
v1.use("/reports", reportsRoutes);
v1.use("/resident", residentFinanceRoutes);
v1.use("/bookings", bookingRoutes);
v1.use("/resident", residentBookingRoutes);
v1.use("/cases", caseRoutes);
v1.use("/resident", residentCaseRoutes);
v1.use("/assemblies", assemblyRoutes);
v1.use("/documents", documentRoutes);
v1.use("/suppliers", supplierRoutes);
v1.use("/inventory", inventoryRoutes);
v1.use("/resident", residentCommunityRoutes);
app.use("/api/v1", v1);

app.use((_req, res) => {
  res.status(404).json({ error: { code: "NOT_FOUND", message: "Recurso no encontrado" } });
});

// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof ZodError) {
    res.locals.errorCode = "VALIDATION";
    res.status(400).json({
      error: {
        code: "VALIDATION",
        message: "Datos inválidos",
        details: err.issues.map((i) => ({ path: i.path.join("."), message: i.message }))
      }
    });
    return;
  }
  if (err instanceof HttpError) {
    res.locals.errorCode = err.code;
    res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
    return;
  }
  // Restricciones de la BD → mensajes de negocio (la BD es la última línea de defensa)
  const pgCode = (err as { code?: unknown })?.code;
  if (typeof pgCode === "string" && PG_ERRORS[pgCode]) {
    const [status, code, generic] = PG_ERRORS[pgCode];
    const message = pgCode === "P0001" ? (err as Error).message : generic;
    res.locals.errorCode = code;
    res.status(status).json({ error: { code, message, details: (err as { constraint?: string }).constraint } });
    return;
  }
  if ((err as { type?: string })?.type === "entity.too.large") {
    res.locals.errorCode = "PAYLOAD_TOO_LARGE";
    res.status(413).json({ error: { code: "PAYLOAD_TOO_LARGE", message: "La petición es demasiado grande" } });
    return;
  }
  if (err instanceof SyntaxError && "body" in err) {
    res.locals.errorCode = "BAD_JSON";
    res.status(400).json({ error: { code: "BAD_JSON", message: "JSON mal formado" } });
    return;
  }
  res.locals.errorCode = "INTERNAL";
  logger.error({ err, traceId: req.traceId, path: req.path }, "[api] error no controlado");
  res.status(500).json({
    error: {
      code: "INTERNAL",
      message: `Error interno. Referencia: ${req.traceId}`,
      ...(isProduction ? {} : { debug: String(err) })
    }
  });
});

waitForDb()
  .then(bootstrap)
  .then(() => {
    const server = app.listen(config.PORT, () =>
      logger.info({ port: config.PORT, env: config.APP_ENVIRONMENT, version: config.APP_VERSION }, "[api] lista")
    );
    initRealtime(server);
    startFinanceScheduler();
    const shutdown = (signal: string) => {
      logger.info({ signal }, "[api] cerrando…");
      stopFinanceScheduler();
      void closeRealtime().finally(() => server.close(() => pool.end().finally(() => process.exit(0))));
      setTimeout(() => process.exit(1), 10_000).unref();
    };
    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));
  })
  .catch((err) => {
    logger.fatal({ err }, "[api] no se pudo arrancar");
    process.exit(1);
  });
