/**
 * @project DomusApp - API
 * @file src/security/trace.ts
 * @description Trace id por petición (x-trace-id) + registro en trace_api_logs (escrituras y errores)
 */

import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { pool } from "../db.js";
import { logger } from "../lib/logger.js";
import { clientInfo } from "./context.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

declare module "express-serve-static-core" {
  interface Request {
    traceId: string;
  }
}

export function trace(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.get("x-trace-id");
  req.traceId = incoming && UUID_RE.test(incoming) ? incoming : randomUUID();
  res.setHeader("x-trace-id", req.traceId);

  const started = process.hrtime.bigint();
  res.on("finish", () => {
    const isWrite = req.method !== "GET" && req.method !== "HEAD" && req.method !== "OPTIONS";
    if ((!isWrite && res.statusCode < 400) || req.path === "/health") return;

    const durationMs = Number((process.hrtime.bigint() - started) / 1_000_000n);
    const { ip, userAgent } = clientInfo(req);
    pool
      .query(
        `INSERT INTO trace_api_logs (trace_id, user_id, condominium_id, method, path, status, duration_ms, error_code, ip_address, user_agent)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          req.traceId,
          req.auth?.userId ?? null,
          req.auth?.condominiumId ?? null,
          req.method,
          req.originalUrl.split("?")[0].slice(0, 300),
          res.statusCode,
          durationMs,
          (res.locals.errorCode as string | undefined) ?? null,
          ip,
          userAgent
        ]
      )
      .catch((err) => logger.error({ err }, "[trace] no se pudo registrar la traza"));
  });
  next();
}
