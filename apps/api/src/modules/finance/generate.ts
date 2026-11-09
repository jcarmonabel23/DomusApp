/**
 * @project DomusApp - API
 * @file src/modules/finance/generate.ts
 * @description Cuotas recurrentes e intereses moratorios
 *
 *  generateMonth(condo, period)  un cargo por plan activo y filial del mes. Idempotente (índice único
 *                                plan + filial + mes): correrlo dos veces no duplica nada.
 *  applyInterest(condo, period)  un cargo de interés por filial y mes sobre el capital vencido al inicio
 *                                del mes (no se cobran intereses sobre intereses). También idempotente.
 *  startFinanceScheduler()       al arrancar y cada hora, para cada condominio activo, genera el mes en
 *                                curso (en su zona horaria) y aplica intereses. Así "se generan solas".
 */

import { one, query, runInCondominium, withTx } from "../../db.js";
import { logger } from "../../lib/logger.js";
import { notify, unitUserIds } from "../notifications/service.js";
import { condoMoney, dueDateOf, financeSettings, money, periodLabel, roundTo, unitBalances, type Tx } from "./shared.js";

interface PlanRow {
  id: string;
  name: string;
  kind: "ordinary" | "extraordinary";
  mode: "fixed" | "aliquot" | "area";
  amount: number;
  scope: "all" | "units";
  dueDay: number | null;
}

interface Target {
  id: string;
  aliquot: number | null;
  area: number | null;
}

export interface GenerateResult {
  period: string;
  created: number;
  plans: number;
  /** Planes que no se pudieron repartir (p. ej. por alícuota sin alícuotas cargadas) */
  skipped: { plan: string; reason: string }[];
}

/** Primer día del mes en curso según la zona del condominio (la sesión de BD ya la tiene) */
export async function currentPeriod(client: Tx): Promise<string> {
  const r = await one<{ p: string }>(`SELECT to_char(date_trunc('month', CURRENT_DATE), 'YYYY-MM-DD') AS p`, [], client);
  return r!.p;
}

async function planShares(client: Tx, plan: PlanRow, decimals: number): Promise<{ shares: Map<string, number>; reason?: string }> {
  const targets = await query<Target>(
    plan.scope === "all"
      ? `SELECT id, aliquot::float8 AS aliquot, area_m2::float8 AS area FROM units WHERE is_active`
      : `SELECT u.id, u.aliquot::float8 AS aliquot, u.area_m2::float8 AS area
           FROM fee_plans_units pu JOIN units u ON u.id = pu.unit_id AND u.is_active WHERE pu.plan_id = $1`,
    plan.scope === "all" ? [] : [plan.id],
    client
  );
  const shares = new Map<string, number>();
  if (plan.mode === "fixed") {
    for (const t of targets) shares.set(t.id, plan.amount);
    return { shares };
  }
  const weight = (t: Target) => (plan.mode === "aliquot" ? t.aliquot : t.area) ?? 0;
  const total = targets.reduce((s, t) => s + weight(t), 0);
  if (total <= 0) return { shares, reason: plan.mode === "aliquot" ? "Las filiales no tienen alícuota" : "Las filiales no tienen área (m²)" };
  for (const t of targets) {
    const v = roundTo((plan.amount * weight(t)) / total, decimals);
    if (v > 0) shares.set(t.id, v);
  }
  return { shares };
}

/** Genera las cuotas del mes `period` ("AAAA-MM-01"). Debe correr dentro de una transacción del condominio. */
export async function generateMonth(client: Tx, condominiumId: string, period: string): Promise<GenerateResult & { byUnit: Map<string, number> }> {
  const settings = await financeSettings(client);
  const m = await condoMoney(condominiumId, client);
  const plans = await query<PlanRow>(
    `SELECT id, name, kind, mode, amount::float8 AS amount, scope, due_day AS "dueDay"
       FROM fee_plans
      WHERE is_active AND start_period <= $1::date AND (end_period IS NULL OR end_period >= $1::date)
      ORDER BY created_at`,
    [period],
    client
  );
  const label = periodLabel(period);
  const byUnit = new Map<string, number>();
  const skipped: GenerateResult["skipped"] = [];
  let created = 0;
  for (const plan of plans) {
    const { shares, reason } = await planShares(client, plan, m.decimals);
    if (reason) {
      skipped.push({ plan: plan.name, reason });
      continue;
    }
    const due = dueDateOf(period, plan.dueDay ?? settings.dueDay);
    for (const [unitId, amount] of shares) {
      const r = await one<{ id: string }>(
        `INSERT INTO charges (unit_id, kind, concept, period, amount, due_date, plan_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (plan_id, unit_id, period) WHERE plan_id IS NOT NULL AND voided_at IS NULL DO NOTHING
         RETURNING id`,
        [unitId, plan.kind, `${plan.name} · ${label}`, period, amount, due, plan.id],
        client
      );
      if (r) {
        created++;
        byUnit.set(unitId, (byUnit.get(unitId) ?? 0) + amount);
      }
    }
  }
  return { period, created, plans: plans.length, skipped, byUnit };
}

/** Interés del mes `period` sobre el capital vencido antes del inicio de ese mes */
export async function applyInterest(client: Tx, condominiumId: string, period: string): Promise<{ created: number; byUnit: Map<string, number> }> {
  const settings = await financeSettings(client);
  const byUnit = new Map<string, number>();
  if (settings.interestRate <= 0) return { created: 0, byUnit };
  const m = await condoMoney(condominiumId, client);
  const balances = await unitBalances(null, settings.graceDays, period, client);
  const rate = settings.interestRate;
  let created = 0;
  for (const b of balances) {
    const amount = roundTo((b.overdueCapital * rate) / 100, m.decimals);
    if (amount <= 0) continue;
    const r = await one<{ id: string }>(
      `INSERT INTO charges (unit_id, kind, concept, period, amount, due_date, notes)
       VALUES ($1, 'interest', $2, $3, $4, $5, $6)
       ON CONFLICT (unit_id, period) WHERE kind = 'interest' AND voided_at IS NULL DO NOTHING
       RETURNING id`,
      [
        b.unitId,
        `Interés moratorio ${rate} % · ${periodLabel(period)}`,
        period,
        amount,
        dueDateOf(period, settings.dueDay),
        `Sobre ${money(b.overdueCapital, m)} vencidos al ${period}`
      ],
      client
    );
    if (r) {
      created++;
      byUnit.set(b.unitId, amount);
    }
  }
  return { created, byUnit };
}

/** Avisa a cada filial cuánto se le cargó (después del commit) */
export async function notifyCharges(condominiumId: string, byUnit: Map<string, number>, title: string, actorId?: string): Promise<void> {
  if (!byUnit.size) return;
  const m = await condoMoney(condominiumId);
  for (const [unitId, amount] of byUnit) {
    await notify(
      condominiumId,
      await unitUserIds(condominiumId, unitId),
      { kind: "charge", title, body: `Se cargó ${money(amount, m)} a su estado de cuenta`, data: { unitId } },
      actorId
    );
  }
}

/** Genera el mes en curso e intereses de un condominio (lo usan el programador y el botón del panel) */
export async function runMonthly(condominiumId: string, ctx: { userId?: string; traceId?: string } = {}) {
  const result = await withTx({ condominiumId, userId: ctx.userId, traceId: ctx.traceId }, async (client) => {
    const period = await currentPeriod(client);
    const fees = await generateMonth(client, condominiumId, period);
    const interest = await applyInterest(client, condominiumId, period);
    return { period, fees, interest };
  });
  const label = periodLabel(result.period);
  await notifyCharges(condominiumId, result.fees.byUnit, `Cuotas de ${label}`, ctx.userId);
  await notifyCharges(condominiumId, result.interest.byUnit, `Interés moratorio de ${label}`, ctx.userId);
  return {
    period: result.period,
    created: result.fees.created,
    plans: result.fees.plans,
    skipped: result.fees.skipped,
    interest: result.interest.created
  };
}

/** Nota con que se cierran los pagos en línea abandonados (la pasarela nunca confirmó) */
export const EXPIRED_NOTE = "Pago en línea no completado";

/** Cierra intentos de pago en línea de más de 1 hora sin respuesta de la pasarela */
async function expireOnlineIntents(condominiumId: string): Promise<number> {
  return withTx({ condominiumId }, async (client) => {
    const r = await client.query(
      `UPDATE payments SET status = 'rejected', reviewed_at = NOW(), review_notes = $1
        WHERE method = 'online' AND status = 'pending' AND created_at < NOW() - INTERVAL '1 hour'`,
      [EXPIRED_NOTE]
    );
    return r.rowCount ?? 0;
  });
}

let timer: NodeJS.Timeout | null = null;

async function tick() {
  const condos = await query<{ id: string }>(`SELECT id FROM condominiums WHERE is_active`);
  for (const c of condos) {
    try {
      // Fuera de una petición no hay condominio en contexto: RLS lo exige para leer filiales y personas
      const r = await runInCondominium(c.id, () => runMonthly(c.id));
      await expireOnlineIntents(c.id);
      if (r.created || r.interest) logger.info({ condominiumId: c.id, ...r }, "[finanzas] cargos del mes generados");
    } catch (err) {
      logger.error({ err, condominiumId: c.id }, "[finanzas] no se pudieron generar los cargos del mes");
    }
  }
}

export function startFinanceScheduler(): void {
  if (timer) return;
  setTimeout(() => void tick(), 5_000).unref();
  timer = setInterval(() => void tick(), 60 * 60 * 1000);
  timer.unref();
}

export function stopFinanceScheduler(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
