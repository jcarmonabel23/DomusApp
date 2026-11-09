/**
 * @project DomusApp - API
 * @file src/modules/finance/shared.ts
 * @description Finanzas: etiquetas, parámetros, saldos por filial (FIFO) y estado de cuenta
 *
 * Regla de saldos: los pagos aprobados se aplican a los cargos más antiguos primero (por vencimiento) y, con el
 * mismo vencimiento, primero a los intereses y luego al capital.
 * Con eso, para cada cargo se sabe cuánto queda abierto sin guardar "aplicaciones":
 *   abierto(cargo) = max(0, min(monto, acumulado_hasta_el_cargo − total_pagado))
 * Mora = lo abierto de cargos vencidos hace más de `grace_days` días.
 */

import type pg from "pg";
import { one, query, type Db } from "../../db.js";

export const CHARGE_KINDS = ["ordinary", "extraordinary", "interest", "fine", "special"] as const;
export const MANUAL_CHARGE_KINDS = ["extraordinary", "fine", "special"] as const;
export const PAYMENT_METHODS = ["online", "transfer", "deposit", "cash", "other"] as const;
export const EXPENSE_CATEGORIES = [
  "maintenance",
  "security",
  "cleaning",
  "utilities",
  "administration",
  "insurance",
  "repairs",
  "gardening",
  "other"
] as const;

export const CHARGE_LABEL: Record<string, string> = {
  ordinary: "Cuota ordinaria",
  extraordinary: "Cuota extraordinaria",
  interest: "Interés moratorio",
  fine: "Multa",
  special: "Cargo especial"
};

export const METHOD_LABEL: Record<string, string> = {
  online: "En línea",
  transfer: "Transferencia",
  deposit: "Depósito",
  cash: "Efectivo",
  other: "Otro"
};

export const PAYMENT_STATUS_LABEL: Record<string, string> = { pending: "En revisión", approved: "Aprobado", rejected: "Rechazado" };

export const EXPENSE_LABEL: Record<string, string> = {
  maintenance: "Mantenimiento",
  security: "Seguridad",
  cleaning: "Limpieza",
  utilities: "Servicios públicos",
  administration: "Administración",
  insurance: "Seguros",
  repairs: "Reparaciones",
  gardening: "Jardinería",
  other: "Otros"
};

export interface FinanceSettings {
  interestRate: number;
  graceDays: number;
  dueDay: number;
  onlinePayments: boolean;
}

const DEFAULT_SETTINGS: FinanceSettings = { interestRate: 0, graceDays: 0, dueDay: 10, onlinePayments: true };

export async function financeSettings(db?: Db): Promise<FinanceSettings> {
  const row = await one<FinanceSettings>(
    `SELECT interest_rate::float8 AS "interestRate", grace_days AS "graceDays", due_day AS "dueDay", online_payments AS "onlinePayments"
       FROM finance_settings WHERE condominium_id = fn_current_condominium()`,
    [],
    db
  );
  return row ?? DEFAULT_SETTINGS;
}

export interface CondoMoney {
  name: string;
  color: string | null;
  timezone: string;
  currency: string;
  symbol: string;
  decimals: number;
}

export async function condoMoney(condominiumId: string, db?: Db): Promise<CondoMoney> {
  const row = await one<CondoMoney>(
    `SELECT c.name, c.brand_color AS color, c.timezone, c.currency_code AS currency, cu.symbol, cu.decimals
       FROM condominiums c JOIN catalogs_currencies cu ON cu.code = c.currency_code WHERE c.id = $1`,
    [condominiumId],
    db
  );
  return row ?? { name: "DomusApp", color: null, timezone: "UTC", currency: "USD", symbol: "$", decimals: 2 };
}

/** 125000.5 → "₡125 000,50" (formato del país de habla hispana más común; el símbolo de la moneda) */
export function money(amount: number, m: Pick<CondoMoney, "symbol" | "decimals">): string {
  const n = new Intl.NumberFormat("es-419", { minimumFractionDigits: m.decimals, maximumFractionDigits: m.decimals }).format(amount);
  return `${m.symbol}${n}`;
}

export const roundTo = (amount: number, decimals: number) => {
  const f = 10 ** decimals;
  return Math.round(amount * f) / f;
};

/** "2026-11-01" → "noviembre 2026" */
export function periodLabel(period: string | Date): string {
  const d = typeof period === "string" ? new Date(`${period.slice(0, 10)}T12:00:00Z`) : period;
  return new Intl.DateTimeFormat("es", { month: "long", year: "numeric", timeZone: "UTC" }).format(d);
}

/**
 * Saldos por filial (FIFO). $1 = filiales (NULL = todas), $2 = días de gracia, $3 = fecha de corte de la mora.
 * Columnas: unitId, charged, paid, balance (puede ser negativo = saldo a favor), open, overdue, overdueCapital,
 * oldestDue (vencimiento más antiguo con saldo abierto), pending (pagos en revisión).
 */
export const BALANCES_SQL = `
  WITH paid AS (
    SELECT unit_id, SUM(amount) AS paid FROM payments WHERE status = 'approved' GROUP BY unit_id
  ), pend AS (
    SELECT unit_id, SUM(amount) AS pending FROM payments WHERE status = 'pending' AND method <> 'online' GROUP BY unit_id
  ), c AS (
    SELECT ch.unit_id, ch.kind, ch.amount, ch.due_date,
           SUM(ch.amount) OVER (PARTITION BY ch.unit_id ORDER BY ch.due_date, (ch.kind <> 'interest'), ch.created_at, ch.id) AS cum
      FROM charges ch
     WHERE ch.voided_at IS NULL AND ($1::uuid[] IS NULL OR ch.unit_id = ANY ($1))
  ), o AS (
    SELECT c.unit_id, c.kind, c.amount, c.due_date,
           GREATEST(0, LEAST(c.amount, c.cum - COALESCE(p.paid, 0))) AS open
      FROM c LEFT JOIN paid p ON p.unit_id = c.unit_id
  ), agg AS (
    SELECT unit_id,
           SUM(amount) AS charged,
           SUM(open) AS open,
           COALESCE(SUM(open) FILTER (WHERE due_date + $2::int < $3::date), 0) AS overdue,
           COALESCE(SUM(open) FILTER (WHERE due_date + $2::int < $3::date AND kind <> 'interest'), 0) AS overdue_capital,
           MIN(due_date) FILTER (WHERE open > 0) AS oldest_due
      FROM o GROUP BY unit_id
  )
  SELECT u.id AS "unitId", u.code AS "unitCode", u.tower AS "unitTower",
         COALESCE(a.charged, 0)::float8 AS charged,
         COALESCE(p.paid, 0)::float8 AS paid,
         (COALESCE(a.charged, 0) - COALESCE(p.paid, 0))::float8 AS balance,
         COALESCE(a.open, 0)::float8 AS open,
         COALESCE(a.overdue, 0)::float8 AS overdue,
         COALESCE(a.overdue_capital, 0)::float8 AS "overdueCapital",
         to_char(a.oldest_due, 'YYYY-MM-DD') AS "oldestDue",
         COALESCE(pe.pending, 0)::float8 AS pending
    FROM units u
    LEFT JOIN agg a ON a.unit_id = u.id
    LEFT JOIN paid p ON p.unit_id = u.id
    LEFT JOIN pend pe ON pe.unit_id = u.id
   WHERE ($1::uuid[] IS NULL OR u.id = ANY ($1))`;

export interface UnitBalance {
  unitId: string;
  unitCode: string;
  unitTower: string | null;
  charged: number;
  paid: number;
  balance: number;
  open: number;
  overdue: number;
  overdueCapital: number;
  oldestDue: string | null;
  pending: number;
}

export async function unitBalances(unitIds: string[] | null, graceDays: number, cutoff?: string, db?: Db): Promise<UnitBalance[]> {
  return query<UnitBalance>(
    `${BALANCES_SQL} AND ($1::uuid[] IS NOT NULL OR u.is_active) ORDER BY u.tower NULLS FIRST, u.code`,
    [unitIds, graceDays, cutoff ?? null],
    db
  ).then((rows) => rows);
}

/** El corte por defecto es "hoy" en la zona del condominio (la sesión de BD ya la tiene) */
export async function balancesToday(unitIds: string[] | null, graceDays: number, db?: Db): Promise<UnitBalance[]> {
  const today = await one<{ d: string }>(`SELECT to_char(CURRENT_DATE, 'YYYY-MM-DD') AS d`, [], db);
  return unitBalances(unitIds, graceDays, today!.d, db);
}

export interface LedgerRow {
  id: string;
  type: "charge" | "payment";
  date: string;
  dueDate: string | null;
  kind: string;
  concept: string;
  debit: number;
  credit: number;
  balance: number;
  status: string | null;
  open: number | null;
}

/**
 * Estado de cuenta de una filial: cargos vigentes y pagos aprobados en orden, con saldo corrido.
 * Cada cargo trae lo que le queda abierto (FIFO) para marcarlo pagado / parcial / pendiente.
 */
export async function ledger(unitId: string, db?: Db): Promise<LedgerRow[]> {
  return query<LedgerRow>(
    `WITH paid AS (SELECT COALESCE(SUM(amount), 0) AS paid FROM payments WHERE unit_id = $1 AND status = 'approved'),
     ch AS (
       SELECT c.id, c.kind, c.concept, c.amount, c.due_date, c.created_at,
              SUM(c.amount) OVER (ORDER BY c.due_date, (c.kind <> 'interest'), c.created_at, c.id) AS cum
         FROM charges c WHERE c.unit_id = $1 AND c.voided_at IS NULL
     ),
     mov AS (
       SELECT ch.id, 'charge' AS type, LEAST(ch.created_at::date, ch.due_date) AS date, ch.due_date, ch.kind, ch.concept,
              ch.amount AS debit, 0::numeric AS credit, NULL::text AS status,
              GREATEST(0, LEAST(ch.amount, ch.cum - (SELECT paid FROM paid))) AS open, ch.created_at AS ts
         FROM ch
       UNION ALL
       SELECT p.id, 'payment', p.paid_on, NULL, p.method,
              CONCAT('Pago · ', CASE p.method WHEN 'online' THEN 'en línea' WHEN 'transfer' THEN 'transferencia'
                                              WHEN 'deposit' THEN 'depósito' WHEN 'cash' THEN 'efectivo' ELSE 'otro' END,
                     CASE WHEN p.reference IS NOT NULL THEN ' ' || p.reference ELSE '' END),
              0, p.amount, p.status, NULL, p.created_at
         FROM payments p WHERE p.unit_id = $1 AND p.status = 'approved'
     )
     SELECT id, type, to_char(date, 'YYYY-MM-DD') AS date, to_char(due_date, 'YYYY-MM-DD') AS "dueDate", kind, concept,
            debit::float8 AS debit, credit::float8 AS credit,
            SUM(debit - credit) OVER (ORDER BY date, ts, id)::float8 AS balance,
            status, open::float8 AS open
       FROM mov ORDER BY date, ts, id`,
    [unitId],
    db
  );
}

/** Fecha de vencimiento del día `day` del mes `period` ("2026-11-01") */
export const dueDateOf = (period: string, day: number) => `${period.slice(0, 8)}${String(day).padStart(2, "0")}`;

export type Tx = pg.PoolClient;
