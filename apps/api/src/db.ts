/**
 * @project DomusApp - API
 * @file src/db.ts
 * @description Pool de PostgreSQL y helper transaccional con contexto de auditoría y condominio
 *
 * @overview
 * Toda escritura de negocio pasa por `withTx(ctx, fn)`: abre la transacción y fija
 * `app.user_id`, `app.trace_id` y `app.condominium_id` con set_config(..., true).
 *
 * Multicondominio: las tablas de negocio se aíslan por RLS según `app.condominium_id`.
 * El condominio activo viaja en un AsyncLocalStorage (`runInCondominium`, lo abrirá
 * authenticate en la fase 1); `query()` y `withTx()` lo fijan en la conexión antes de consultar.
 * Sin condominio, RLS no devuelve ni acepta filas de negocio.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import pg from "pg";
import { config } from "./config.js";
import { logger } from "./lib/logger.js";

/** Las columnas DATE viajan como texto 'YYYY-MM-DD' (una fecha de calendario no tiene zona) */
pg.types.setTypeParser(pg.types.builtins.DATE, (value: string) => value);

export const pool = new pg.Pool({
  host: config.DB_HOST,
  port: config.DB_PORT,
  database: config.DB_NAME,
  user: config.DB_USER,
  password: config.DB_PASSWORD,
  max: 10,
  idleTimeoutMillis: 30_000,
  application_name: "domusapp-api"
});

pool.on("error", (err) => logger.error({ err }, "[db] error en cliente inactivo del pool"));

export type Db = pg.Pool | pg.PoolClient;

export interface TxContext {
  userId?: string | null;
  traceId?: string | null;
  /** Condominio activo; si falta, el del runInCondominium en curso */
  condominiumId?: string | null;
}

const condominiumScope = new AsyncLocalStorage<{ condominiumId: string }>();

/** Ejecuta `fn` (y todo lo asíncrono que dispare) con `condominiumId` como condominio activo */
export function runInCondominium<T>(condominiumId: string, fn: () => T): T {
  return condominiumScope.run({ condominiumId }, fn);
}

export const currentCondominiumId = (): string | null => condominiumScope.getStore()?.condominiumId ?? null;

/** Consulta parametrizada fuera de transacción (lecturas) */
export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = [],
  db: Db = pool
): Promise<T[]> {
  const condominiumId = currentCondominiumId();
  if (db !== pool || !condominiumId) {
    const result = await db.query<T>(text, params);
    return result.rows;
  }

  // Conexión con el condominio fijado solo durante esta consulta
  const client = await pool.connect();
  let broken = false;
  try {
    // Condominio y su zona horaria: now() y CURRENT_DATE siguen la hora local del condominio
    await client.query(
      "SELECT set_config('app.condominium_id', $1, false), set_config('TimeZone', COALESCE(fn_condominium_timezone($1::uuid), current_setting('TimeZone')), false)",
      [condominiumId]
    );
    const result = await client.query<T>(text, params);
    return result.rows;
  } finally {
    try {
      await client.query("SELECT set_config('app.condominium_id', '', false); RESET TimeZone");
    } catch {
      broken = true; // sin limpiar, la conexión se descarta: nunca vuelve al pool con otro condominio
    }
    client.release(broken);
  }
}

export async function one<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = [],
  db: Db = pool
): Promise<T | null> {
  const rows = await query<T>(text, params, db);
  return rows[0] ?? null;
}

/** Ejecuta `fn` en una transacción con el contexto de auditoría y condominio fijado */
export async function withTx<T>(ctx: TxContext, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `SELECT set_config('app.user_id', $1, true), set_config('app.trace_id', $2, true), set_config('app.condominium_id', $3, true),
              set_config('TimeZone', COALESCE(fn_condominium_timezone(NULLIF($3, '')::uuid), current_setting('TimeZone')), true)`,
      [ctx.userId ?? "", ctx.traceId ?? "", ctx.condominiumId ?? currentCondominiumId() ?? ""]
    );
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** Espera a que la BD responda (arranque) */
export async function waitForDb(retries = 30): Promise<void> {
  for (let i = 1; i <= retries; i++) {
    try {
      await pool.query("SELECT 1");
      return;
    } catch (err) {
      if (i === retries) throw err;
      logger.warn({ attempt: i }, "[db] esperando a la base de datos…");
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}
