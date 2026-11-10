/**
 * @project DomusApp - API
 * @file src/modules/finance/admin.ts
 * @description Panel de finanzas (módulo FINANCE)
 *
 *  GET  /finance/summary                       indicadores del mes y de la cartera
 *  GET  /finance/balances[/export]             saldos y morosidad por filial
 *  GET  /finance/units/:unitId/statement[/export]  estado de cuenta de una filial
 *  GET|POST /finance/charges · POST :id/void   cargos sueltos (extraordinaria, multa, especial) y anulación
 *  POST /finance/generate                      genera ya las cuotas del mes e intereses (idempotente)
 *  GET|POST|PUT /finance/plans                 cuotas recurrentes
 *  GET|POST /finance/payments[/export] · POST :id/approve · POST :id/reject
 *  GET|POST|PUT /finance/bank-accounts
 *  GET|POST /finance/expenses[/export] · POST :id/void · PUT :id/receipt
 *  GET|PUT /finance/settings
 */

import { Router } from "express";
import { z } from "zod";
import { config } from "../../config.js";
import { one, query, withTx } from "../../db.js";
import { sendPdf, sendXlsx, type ExportColumn } from "../../lib/exports.js";
import { conflict, handler, idParams, notFound } from "../../lib/http.js";
import { requirePermission } from "../../security/authorize.js";
import { authOf, condominiumOf, txCtx } from "../../security/context.js";
import { fileKey, rawUpload, replaceImage, signedUrl } from "../files/images.js";
import { optText } from "../access/shared.js";
import { notifyCharges, runMonthly } from "./generate.js";
import { PAYMENT_JOINS, PAYMENT_SELECT, broadcastPayment, notifyPaymentResult, paymentById, withReceipt, type PaymentRow } from "./payments.js";
import {
  CHARGE_KINDS,
  CHARGE_LABEL,
  EXPENSE_CATEGORIES,
  EXPENSE_LABEL,
  MANUAL_CHARGE_KINDS,
  METHOD_LABEL,
  PAYMENT_STATUS_LABEL,
  balancesToday,
  condoMoney,
  financeSettings,
  ledger,
  money,
  type LedgerRow,
  type UnitBalance
} from "./shared.js";

export const financeRoutes = Router();
financeRoutes.use(requirePermission("FINANCE", "access"));

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida (AAAA-MM-DD)");
const period = z.string().regex(/^\d{4}-\d{2}-01$/, "Mes inválido (AAAA-MM-01)");
const amount = z.coerce.number().positive("El monto debe ser mayor que cero").max(1e11);
const formatQuery = z.object({ format: z.enum(["xlsx", "pdf"]).default("xlsx") });
const paging = { page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(200).default(50) };

async function exportSpec<T>(condominiumId: string, title: string, subtitle: string, columns: ExportColumn<T>[], rows: T[], fileBase: string) {
  const c = await condoMoney(condominiumId);
  return { title, subtitle, condominium: c.name, color: c.color, timezone: c.timezone, columns, rows, fileBase };
}

// ================================================================== Resumen y morosidad

financeRoutes.get(
  "/summary",
  handler({}, async () => {
    const settings = await financeSettings();
    const balances = await balancesToday(null, settings.graceDays);
    const month = await one<{ period: string; charged: number; collected: number; expenses: number; pending: number; pendingAmount: number }>(
      `SELECT to_char(date_trunc('month', CURRENT_DATE), 'YYYY-MM-DD') AS period,
              (SELECT COALESCE(SUM(amount), 0)::float8 FROM charges WHERE voided_at IS NULL
                 AND due_date >= date_trunc('month', CURRENT_DATE) AND due_date < date_trunc('month', CURRENT_DATE) + INTERVAL '1 month') AS charged,
              (SELECT COALESCE(SUM(amount), 0)::float8 FROM payments WHERE status = 'approved'
                 AND paid_on >= date_trunc('month', CURRENT_DATE)) AS collected,
              (SELECT COALESCE(SUM(amount), 0)::float8 FROM expenses WHERE voided_at IS NULL
                 AND spent_on >= date_trunc('month', CURRENT_DATE)) AS expenses,
              (SELECT COUNT(*)::int FROM payments WHERE status = 'pending' AND method <> 'online') AS pending,
              (SELECT COALESCE(SUM(amount), 0)::float8 FROM payments WHERE status = 'pending' AND method <> 'online') AS "pendingAmount"`
    );
    const receivable = balances.reduce((s, b) => s + b.open, 0);
    const overdue = balances.reduce((s, b) => s + b.overdue, 0);
    const delinquent = balances.filter((b) => b.overdue > 0).length;
    const credit = balances.reduce((s, b) => s + Math.max(0, -b.balance), 0);
    return {
      ...month,
      receivable,
      overdue,
      credit,
      delinquent,
      units: balances.length,
      delinquencyRate: balances.length ? delinquent / balances.length : 0,
      settings
    };
  })
);

const balanceQuery = z.object({ only: z.enum(["debt", "overdue"]).optional(), q: z.string().trim().max(40).optional() });

function filterBalances(rows: UnitBalance[], f: z.infer<typeof balanceQuery>) {
  const q = f.q?.toLowerCase();
  return rows.filter(
    (b) =>
      (!f.only || (f.only === "debt" ? b.open > 0 : b.overdue > 0)) &&
      (!q || b.unitCode.toLowerCase().includes(q) || (b.unitTower ?? "").toLowerCase().includes(q))
  );
}

const PAYER_SQL = `SELECT up.unit_id AS "unitId", p.names, p.phone, p.email
  FROM units_people up JOIN people p ON p.id = up.person_id AND p.is_active
 WHERE up.is_primary`;

financeRoutes.get(
  "/balances",
  handler({ query: balanceQuery }, async ({ query: f }) => {
    const settings = await financeSettings();
    const rows = filterBalances(await balancesToday(null, settings.graceDays), f);
    const payers = new Map((await query<{ unitId: string; names: string; phone: string | null; email: string | null }>(PAYER_SQL)).map((p) => [p.unitId, p]));
    return { rows: rows.map((b) => ({ ...b, payer: payers.get(b.unitId) ?? null })), graceDays: settings.graceDays };
  })
);

const daysLate = (oldestDue: string | null) => (oldestDue ? Math.max(0, Math.floor((Date.now() - new Date(`${oldestDue}T12:00:00Z`).getTime()) / 86_400_000)) : 0);

financeRoutes.get(
  "/balances/export",
  requirePermission("FINANCE", "download"),
  handler({ query: balanceQuery.extend(formatQuery.shape) }, async ({ query: f, req, res }) => {
    const condominiumId = condominiumOf(req);
    const settings = await financeSettings();
    const m = await condoMoney(condominiumId);
    const rows = filterBalances(await balancesToday(null, settings.graceDays), f);
    const payers = new Map((await query<{ unitId: string; names: string; phone: string | null }>(PAYER_SQL)).map((p) => [p.unitId, p]));
    const fmt = (n: number) => (f.format === "pdf" ? money(n, m) : n);
    const columns: ExportColumn<UnitBalance>[] = [
      { header: "Filial", width: 10, value: (b) => b.unitCode },
      { header: "Torre", width: 10, value: (b) => b.unitTower },
      { header: "Responsable", width: 24, value: (b) => payers.get(b.unitId)?.names ?? null },
      { header: "Teléfono", width: 14, value: (b) => payers.get(b.unitId)?.phone ?? null },
      { header: "Saldo", width: 14, value: (b) => fmt(b.balance) },
      { header: "Vencido", width: 14, value: (b) => fmt(b.overdue) },
      { header: "Desde", width: 12, value: (b) => (b.overdue > 0 ? b.oldestDue : null) },
      { header: "Días", width: 8, value: (b) => (b.overdue > 0 ? daysLate(b.oldestDue) : null) },
      { header: "En revisión", width: 13, value: (b) => (b.pending ? fmt(b.pending) : null) }
    ];
    const total = rows.reduce((s, b) => s + b.overdue, 0);
    const spec = await exportSpec(
      condominiumId,
      f.only === "overdue" ? "Reporte de morosidad" : "Saldos por filial",
      `${rows.length} filial(es) · vencido total ${money(total, m)} · gracia ${settings.graceDays} día(s) · moneda ${m.currency}`,
      columns,
      rows,
      f.only === "overdue" ? "Morosidad" : "Saldos"
    );
    if (f.format === "pdf") await sendPdf(res, spec);
    else await sendXlsx(res, spec);
    return undefined;
  })
);

// ================================================================== Estado de cuenta

const unitParams = z.object({ unitId: z.uuid() });

async function statement(unitId: string) {
  const unit = await one<{ id: string; code: string; tower: string | null }>(`SELECT id, code, tower FROM units WHERE id = $1`, [unitId]);
  if (!unit) throw notFound("Filial no encontrada");
  const settings = await financeSettings();
  const [balance] = await balancesToday([unitId], settings.graceDays);
  const rows = await ledger(unitId);
  const others = await query<PaymentRow>(
    `SELECT ${PAYMENT_SELECT} ${PAYMENT_JOINS} WHERE p.unit_id = $1 AND p.status <> 'approved' ORDER BY p.created_at DESC LIMIT 20`,
    [unitId]
  );
  return { unit, balance, rows, payments: others.map(withReceipt) };
}

financeRoutes.get("/units/:unitId/statement", handler({ params: unitParams }, ({ params }) => statement(params.unitId)));

financeRoutes.get(
  "/units/:unitId/statement/export",
  requirePermission("FINANCE", "download"),
  handler({ params: unitParams, query: formatQuery }, async ({ params, query: f, req, res }) => {
    const condominiumId = condominiumOf(req);
    const st = await statement(params.unitId);
    await sendStatement(res, condominiumId, st, f.format);
    return undefined;
  })
);

export async function sendStatement(
  res: Parameters<typeof sendPdf>[0],
  condominiumId: string,
  st: { unit: { code: string; tower: string | null }; balance: UnitBalance; rows: LedgerRow[] },
  format: "xlsx" | "pdf"
) {
  const m = await condoMoney(condominiumId);
  const fmt = (n: number) => (format === "pdf" ? (n ? money(n, m) : "") : n || null);
  const columns: ExportColumn<LedgerRow>[] = [
    { header: "Fecha", width: 11, value: (r) => r.date },
    { header: "Concepto", width: 40, value: (r) => r.concept },
    { header: "Vence", width: 11, value: (r) => r.dueDate },
    { header: "Cargo", width: 14, value: (r) => fmt(r.debit) },
    { header: "Abono", width: 14, value: (r) => fmt(r.credit) },
    { header: "Saldo", width: 14, value: (r) => (format === "pdf" ? money(r.balance, m) : r.balance) },
    { header: "Estado", width: 11, value: (r) => (r.type === "payment" ? "Aplicado" : r.open === 0 ? "Pagado" : r.open === r.debit ? "Pendiente" : "Parcial") }
  ];
  const b = st.balance;
  const spec = await exportSpec(
    condominiumId,
    `Estado de cuenta · filial ${st.unit.code}${st.unit.tower ? ` (${st.unit.tower})` : ""}`,
    `Saldo ${money(b.balance, m)} · vencido ${money(b.overdue, m)} · cargos ${money(b.charged, m)} · pagos ${money(b.paid, m)}`,
    columns,
    st.rows,
    `Estado_${st.unit.code}`
  );
  if (format === "pdf") await sendPdf(res, spec);
  else await sendXlsx(res, spec);
}

// ================================================================== Cargos

const chargeFilters = z.object({
  period: period.optional(),
  unitId: z.uuid().optional(),
  kind: z.enum(CHARGE_KINDS).optional(),
  status: z.enum(["open", "paid", "voided"]).optional(),
  ...paging
});

financeRoutes.get(
  "/charges",
  handler({ query: chargeFilters }, async ({ query: f }) => {
    const params = [f.period ?? null, f.unitId ?? null, f.kind ?? null, f.status ?? null];
    const base = `
      WITH paid AS (SELECT unit_id, SUM(amount) AS paid FROM payments WHERE status = 'approved' GROUP BY unit_id),
      c AS (
        SELECT ch.*, SUM(ch.amount) FILTER (WHERE ch.voided_at IS NULL)
                     OVER (PARTITION BY ch.unit_id ORDER BY ch.due_date, (ch.kind <> 'interest'), ch.created_at, ch.id) AS cum
          FROM charges ch
      ),
      x AS (
        SELECT c.*, CASE WHEN c.voided_at IS NOT NULL THEN NULL
                         ELSE GREATEST(0, LEAST(c.amount, c.cum - COALESCE(p.paid, 0))) END AS open
          FROM c LEFT JOIN paid p ON p.unit_id = c.unit_id
      )
      SELECT %COLS% FROM x JOIN units u ON u.id = x.unit_id
        LEFT JOIN users cb ON cb.id = x.created_by LEFT JOIN users vb ON vb.id = x.voided_by
       WHERE ($1::date IS NULL OR x.period = $1) AND ($2::uuid IS NULL OR x.unit_id = $2) AND ($3::text IS NULL OR x.kind = $3)
         AND ($4::text IS NULL OR ($4 = 'voided' AND x.voided_at IS NOT NULL)
              OR ($4 = 'open' AND x.voided_at IS NULL AND x.open > 0)
              OR ($4 = 'paid' AND x.voided_at IS NULL AND x.open = 0))`;
    const cols = `x.id, x.unit_id AS "unitId", u.code AS "unitCode", x.kind, x.concept, to_char(x.period, 'YYYY-MM-DD') AS period,
                  x.amount::float8 AS amount, to_char(x.due_date, 'YYYY-MM-DD') AS "dueDate", x.notes, x.plan_id AS "planId",
                  x.open::float8 AS open, x.voided_at AS "voidedAt", x.void_reason AS "voidReason", vb.names AS "voidedByName",
                  cb.names AS "createdByName", x.created_at AS "createdAt"`;
    const [rows, total] = await Promise.all([
      query(`${base.replace("%COLS%", cols)} ORDER BY x.due_date DESC, u.code, x.created_at DESC LIMIT ${f.pageSize} OFFSET ${(f.page - 1) * f.pageSize}`, params),
      one<{ n: number; sum: number }>(`${base.replace("%COLS%", `COUNT(*)::int AS n, COALESCE(SUM(x.amount), 0)::float8 AS sum`)}`, params)
    ]);
    return { rows, total: total?.n ?? 0, sum: total?.sum ?? 0 };
  })
);

financeRoutes.post(
  "/charges",
  requirePermission("FINANCE", "add_new"),
  handler(
    {
      body: z.object({
        unitIds: z.array(z.uuid()).max(5000).optional(),
        allUnits: z.boolean().default(false),
        kind: z.enum(MANUAL_CHARGE_KINDS),
        concept: z.string().trim().min(3, "Escriba el concepto").max(160),
        amount,
        dueDate: isoDate,
        notes: optText(500)
      })
    },
    async ({ req, body }) => {
      const condominiumId = condominiumOf(req);
      const auth = authOf(req);
      if (!body.allUnits && !body.unitIds?.length) throw conflict("NO_UNITS", "Elija al menos una filial");
      const created = await withTx(txCtx(req), async (client) => {
        const units = await query<{ id: string }>(
          body.allUnits ? `SELECT id FROM units WHERE is_active` : `SELECT id FROM units WHERE id = ANY ($1) AND is_active`,
          body.allUnits ? [] : [body.unitIds],
          client
        );
        if (!units.length) throw conflict("NO_UNITS", "Ninguna filial activa coincide");
        await client.query(
          `INSERT INTO charges (unit_id, kind, concept, amount, due_date, notes, created_by)
           SELECT u, $2, $3, $4, $5, $6, fn_current_app_user() FROM unnest($1::uuid[]) AS u`,
          [units.map((u) => u.id), body.kind, body.concept, body.amount, body.dueDate, body.notes]
        );
        return units.map((u) => u.id);
      });
      await notifyCharges(condominiumId, new Map(created.map((id) => [id, body.amount])), `${CHARGE_LABEL[body.kind]}: ${body.concept}`, auth.userId);
      return { created: created.length };
    }
  )
);

financeRoutes.post(
  "/charges/:id/void",
  requirePermission("FINANCE", "delete"),
  handler({ params: idParams, body: z.object({ reason: z.string().trim().min(3, "Escriba el motivo").max(300) }) }, async ({ req, params, body }) => {
    const row = await withTx(txCtx(req), (client) =>
      one<{ id: string }>(
        `UPDATE charges SET voided_at = NOW(), voided_by = fn_current_app_user(), void_reason = $2
          WHERE id = $1 AND voided_at IS NULL RETURNING id`,
        [params.id, body.reason],
        client
      )
    );
    if (!row) throw conflict("ALREADY_VOIDED", "El cargo no existe o ya estaba anulado");
    return { id: row.id };
  })
);

financeRoutes.post(
  "/generate",
  requirePermission("FINANCE", "add_new"),
  handler({}, ({ req }) => runMonthly(condominiumOf(req), { userId: authOf(req).userId, traceId: req.traceId }))
);

// ================================================================== Cuotas recurrentes

const planBody = z
  .object({
    name: z.string().trim().min(3, "Escriba el nombre").max(80),
    kind: z.enum(["ordinary", "extraordinary"]),
    mode: z.enum(["fixed", "aliquot", "area"]),
    amount,
    scope: z.enum(["all", "units"]),
    unitIds: z.array(z.uuid()).max(5000).default([]),
    startPeriod: period,
    endPeriod: period.nullish(),
    dueDay: z.coerce.number().int().min(1).max(28).nullish(),
    isActive: z.boolean().default(true)
  })
  .refine((b) => !b.endPeriod || b.endPeriod >= b.startPeriod, { message: "El último mes no puede ser anterior al primero", path: ["endPeriod"] })
  .refine((b) => b.scope === "all" || b.unitIds.length > 0, { message: "Elija las filiales", path: ["unitIds"] });

const PLAN_SELECT = `fp.id, fp.name, fp.kind, fp.mode, fp.amount::float8 AS amount, fp.scope,
  to_char(fp.start_period, 'YYYY-MM-DD') AS "startPeriod", to_char(fp.end_period, 'YYYY-MM-DD') AS "endPeriod",
  fp.due_day AS "dueDay", fp.is_active AS "isActive",
  COALESCE((SELECT array_agg(unit_id) FROM fee_plans_units WHERE plan_id = fp.id), '{}') AS "unitIds",
  (SELECT COUNT(*)::int FROM charges WHERE plan_id = fp.id AND voided_at IS NULL) AS "chargesCount"`;

financeRoutes.get(
  "/plans",
  handler({}, () => query(`SELECT ${PLAN_SELECT} FROM fee_plans fp ORDER BY fp.is_active DESC, fp.created_at`))
);

async function savePlanUnits(client: Parameters<Parameters<typeof withTx>[1]>[0], planId: string, scope: string, unitIds: string[]) {
  await client.query(`DELETE FROM fee_plans_units WHERE plan_id = $1`, [planId]);
  if (scope === "units") {
    await client.query(
      `INSERT INTO fee_plans_units (plan_id, unit_id) SELECT $1, id FROM units WHERE id = ANY ($2)`,
      [planId, unitIds]
    );
  }
}

financeRoutes.post(
  "/plans",
  requirePermission("FINANCE", "add_new"),
  handler({ body: planBody }, async ({ req, body }) =>
    withTx(txCtx(req), async (client) => {
      const r = await one<{ id: string }>(
        `INSERT INTO fee_plans (name, kind, mode, amount, scope, start_period, end_period, due_day, is_active, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, fn_current_app_user(), fn_current_app_user()) RETURNING id`,
        [body.name, body.kind, body.mode, body.amount, body.scope, body.startPeriod, body.endPeriod ?? null, body.dueDay ?? null, body.isActive],
        client
      );
      await savePlanUnits(client, r!.id, body.scope, body.unitIds);
      return { id: r!.id };
    })
  )
);

financeRoutes.put(
  "/plans/:id",
  requirePermission("FINANCE", "edit"),
  handler({ params: idParams, body: planBody }, async ({ req, params, body }) =>
    withTx(txCtx(req), async (client) => {
      const r = await one<{ id: string }>(
        `UPDATE fee_plans SET name = $2, kind = $3, mode = $4, amount = $5, scope = $6, start_period = $7, end_period = $8,
                due_day = $9, is_active = $10, updated_by = fn_current_app_user()
          WHERE id = $1 RETURNING id`,
        [params.id, body.name, body.kind, body.mode, body.amount, body.scope, body.startPeriod, body.endPeriod ?? null, body.dueDay ?? null, body.isActive],
        client
      );
      if (!r) throw notFound("Cuota no encontrada");
      await savePlanUnits(client, params.id, body.scope, body.unitIds);
      return { id: params.id };
    })
  )
);

// ================================================================== Pagos

const paymentFilters = z.object({
  status: z.enum(["pending", "approved", "rejected"]).optional(),
  method: z.enum(["online", "transfer", "deposit", "cash", "other"]).optional(),
  unitId: z.uuid().optional(),
  from: isoDate.optional(),
  to: isoDate.optional()
});

function paymentWhere(f: z.infer<typeof paymentFilters>) {
  return {
    sql: `WHERE ($1::text IS NULL OR p.status = $1) AND ($2::text IS NULL OR p.method = $2) AND ($3::uuid IS NULL OR p.unit_id = $3)
            AND ($4::date IS NULL OR p.paid_on >= $4) AND ($5::date IS NULL OR p.paid_on <= $5)
            AND NOT (p.method = 'online' AND p.status = 'pending')`,
    params: [f.status ?? null, f.method ?? null, f.unitId ?? null, f.from ?? null, f.to ?? null]
  };
}

financeRoutes.get(
  "/payments",
  handler({ query: paymentFilters.extend(paging) }, async ({ query: f }) => {
    const w = paymentWhere(f);
    const [rows, total] = await Promise.all([
      query<PaymentRow>(
        `SELECT ${PAYMENT_SELECT} ${PAYMENT_JOINS} ${w.sql}
          ORDER BY (p.status = 'pending') DESC, p.paid_on DESC, p.created_at DESC LIMIT ${f.pageSize} OFFSET ${(f.page - 1) * f.pageSize}`,
        w.params
      ),
      one<{ n: number; sum: number }>(`SELECT COUNT(*)::int AS n, COALESCE(SUM(p.amount), 0)::float8 AS sum FROM payments p ${w.sql}`, w.params)
    ]);
    return { rows: rows.map(withReceipt), total: total?.n ?? 0, sum: total?.sum ?? 0 };
  })
);

financeRoutes.get(
  "/payments/export",
  requirePermission("FINANCE", "download"),
  handler({ query: paymentFilters.extend(formatQuery.shape) }, async ({ query: f, req, res }) => {
    const condominiumId = condominiumOf(req);
    const m = await condoMoney(condominiumId);
    const w = paymentWhere(f);
    const rows = await query<PaymentRow>(`SELECT ${PAYMENT_SELECT} ${PAYMENT_JOINS} ${w.sql} ORDER BY p.paid_on DESC LIMIT 20000`, w.params);
    const columns: ExportColumn<PaymentRow>[] = [
      { header: "Fecha", width: 11, value: (p) => p.paidOn },
      { header: "Filial", width: 10, value: (p) => p.unitCode },
      { header: "Método", width: 13, value: (p) => METHOD_LABEL[p.method] ?? p.method },
      { header: "Referencia", width: 16, value: (p) => p.reference ?? (p.cardLast4 ? `${p.cardBrand} •••• ${p.cardLast4}` : null) },
      { header: "Cuenta", width: 16, value: (p) => p.bankName },
      { header: "Monto", width: 14, value: (p) => (f.format === "pdf" ? money(p.amount, m) : p.amount) },
      { header: "Estado", width: 11, value: (p) => PAYMENT_STATUS_LABEL[p.status] },
      { header: "Reportó", width: 20, value: (p) => p.submittedByName },
      { header: "Revisó", width: 20, value: (p) => p.reviewedByName },
      { header: "Notas", width: 24, value: (p) => p.reviewNotes ?? p.notes }
    ];
    const total = rows.filter((p) => p.status === "approved").reduce((s, p) => s + p.amount, 0);
    const spec = await exportSpec(
      condominiumId,
      "Pagos",
      `${f.from || f.to ? `Del ${f.from ?? "inicio"} al ${f.to ?? "hoy"}` : "Todo el historial"} · ${rows.length} pago(s) · aprobados ${money(total, m)}`,
      columns,
      rows,
      "Pagos"
    );
    if (f.format === "pdf") await sendPdf(res, spec);
    else await sendXlsx(res, spec);
    return undefined;
  })
);

/** Pago manual registrado por la administración (efectivo, transferencia verificada…): queda aprobado */
financeRoutes.post(
  "/payments",
  requirePermission("FINANCE", "add_new"),
  handler(
    {
      body: z.object({
        unitId: z.uuid(),
        method: z.enum(["transfer", "deposit", "cash", "other"]),
        amount,
        paidOn: isoDate,
        reference: optText(60),
        bankAccountId: z.uuid().nullish(),
        notes: optText(500)
      })
    },
    async ({ req, body }) => {
      const condominiumId = condominiumOf(req);
      const r = await withTx(txCtx(req), (client) =>
        one<{ id: string }>(
          `INSERT INTO payments (unit_id, method, amount, paid_on, reference, bank_account_id, notes, status, reviewed_at, reviewed_by, submitted_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'approved', NOW(), fn_current_app_user(), fn_current_app_user()) RETURNING id`,
          [body.unitId, body.method, body.amount, body.paidOn, body.reference, body.bankAccountId ?? null, body.notes],
          client
        )
      );
      const p = (await paymentById(r!.id))!;
      await broadcastPayment(condominiumId, p);
      await notifyPaymentResult(condominiumId, p, authOf(req).userId);
      return p;
    }
  )
);

async function review(req: Parameters<typeof authOf>[0], id: string, approve: boolean, notes: string | null) {
  const condominiumId = condominiumOf(req);
  const row = await withTx(txCtx(req), (client) =>
    one<{ id: string }>(
      `UPDATE payments SET status = $2, review_notes = $3, reviewed_at = NOW(), reviewed_by = fn_current_app_user()
        WHERE id = $1 AND status = 'pending' AND method <> 'online' RETURNING id`,
      [id, approve ? "approved" : "rejected", notes],
      client
    )
  );
  const p = await paymentById(id);
  if (!p) throw notFound("Pago no encontrado");
  if (!row) throw conflict(p.method === "online" ? "ONLINE_PAYMENT" : "ALREADY_REVIEWED", p.method === "online" ? "Los pagos en línea los resuelve la pasarela" : "El pago ya fue revisado");
  await broadcastPayment(condominiumId, p);
  await notifyPaymentResult(condominiumId, p, authOf(req).userId);
  return p;
}

financeRoutes.post(
  "/payments/:id/approve",
  requirePermission("FINANCE", "approve"),
  handler({ params: idParams, body: z.object({ notes: optText(500) }) }, ({ req, params, body }) => review(req, params.id, true, body.notes))
);

financeRoutes.post(
  "/payments/:id/reject",
  requirePermission("FINANCE", "approve"),
  handler({ params: idParams, body: z.object({ notes: z.string().trim().min(3, "Diga por qué se rechaza").max(500) }) }, ({ req, params, body }) =>
    review(req, params.id, false, body.notes)
  )
);

// ================================================================== Cuentas bancarias

const bankBody = z.object({
  bank: z.string().trim().min(2).max(80),
  holder: z.string().trim().min(2).max(120),
  number: z.string().trim().min(4).max(40),
  iban: optText(40),
  kind: z.enum(["checking", "savings"]),
  currencyCode: z.string().length(3).toUpperCase(),
  notes: optText(300),
  isActive: z.boolean().default(true)
});

export const BANK_SELECT = `id, bank, holder, number, iban, kind, currency_code AS "currencyCode", notes, is_active AS "isActive"`;

financeRoutes.get("/bank-accounts", handler({}, () => query(`SELECT ${BANK_SELECT} FROM bank_accounts ORDER BY is_active DESC, bank`)));

financeRoutes.post(
  "/bank-accounts",
  requirePermission("FINANCE", "configure"),
  handler({ body: bankBody }, async ({ req, body }) =>
    withTx(txCtx(req), (client) =>
      one(
        `INSERT INTO bank_accounts (bank, holder, number, iban, kind, currency_code, notes, is_active, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, fn_current_app_user(), fn_current_app_user()) RETURNING ${BANK_SELECT}`,
        [body.bank, body.holder, body.number, body.iban, body.kind, body.currencyCode, body.notes, body.isActive],
        client
      )
    )
  )
);

financeRoutes.put(
  "/bank-accounts/:id",
  requirePermission("FINANCE", "configure"),
  handler({ params: idParams, body: bankBody }, async ({ req, params, body }) => {
    const r = await withTx(txCtx(req), (client) =>
      one(
        `UPDATE bank_accounts SET bank = $2, holder = $3, number = $4, iban = $5, kind = $6, currency_code = $7, notes = $8,
                is_active = $9, updated_by = fn_current_app_user()
          WHERE id = $1 RETURNING ${BANK_SELECT}`,
        [params.id, body.bank, body.holder, body.number, body.iban, body.kind, body.currencyCode, body.notes, body.isActive],
        client
      )
    );
    if (!r) throw notFound("Cuenta no encontrada");
    return r;
  })
);

// ================================================================== Gastos

const expenseFilters = z.object({ from: isoDate.optional(), to: isoDate.optional(), category: z.enum(EXPENSE_CATEGORIES).optional() });

const EXPENSE_SELECT = `e.id, to_char(e.spent_on, 'YYYY-MM-DD') AS "spentOn", e.category, e.supplier, e.description,
  e.amount::float8 AS amount, e.bank_account_id AS "bankAccountId", ba.bank AS "bankName",
  e.voided_at AS "voidedAt", e.void_reason AS "voidReason", cb.names AS "createdByName",
  e.receipt_file_id AS "receiptFileId", e.condominium_id AS "condominiumId"`;
const EXPENSE_JOINS = `FROM expenses e LEFT JOIN bank_accounts ba ON ba.id = e.bank_account_id LEFT JOIN users cb ON cb.id = e.created_by`;

interface ExpenseRow {
  id: string;
  spentOn: string;
  category: string;
  supplier: string | null;
  description: string;
  amount: number;
  bankName: string | null;
  voidedAt: string | null;
  voidReason: string | null;
  createdByName: string | null;
  receiptFileId: string | null;
  condominiumId: string;
}

function expenseWhere(f: z.infer<typeof expenseFilters>, includeVoided = true) {
  return {
    sql: `WHERE ($1::date IS NULL OR e.spent_on >= $1) AND ($2::date IS NULL OR e.spent_on <= $2) AND ($3::text IS NULL OR e.category = $3)
          ${includeVoided ? "" : "AND e.voided_at IS NULL"}`,
    params: [f.from ?? null, f.to ?? null, f.category ?? null]
  };
}

const withExpenseReceipt = (e: ExpenseRow) => {
  const key = fileKey(e.condominiumId, e.receiptFileId);
  return { ...e, receipt: key ? { preview: signedUrl(key, "800.webp"), full: signedUrl(key, "orig.webp") } : null };
};

financeRoutes.get(
  "/expenses",
  handler({ query: expenseFilters.extend(paging) }, async ({ query: f }) => {
    const w = expenseWhere(f);
    const [rows, total, byCategory] = await Promise.all([
      query<ExpenseRow>(`SELECT ${EXPENSE_SELECT} ${EXPENSE_JOINS} ${w.sql} ORDER BY e.spent_on DESC, e.created_at DESC LIMIT ${f.pageSize} OFFSET ${(f.page - 1) * f.pageSize}`, w.params),
      one<{ n: number; sum: number }>(`SELECT COUNT(*)::int AS n, COALESCE(SUM(e.amount) FILTER (WHERE e.voided_at IS NULL), 0)::float8 AS sum FROM expenses e ${w.sql}`, w.params),
      query(`SELECT e.category, SUM(e.amount)::float8 AS amount FROM expenses e ${expenseWhere(f, false).sql} GROUP BY e.category ORDER BY amount DESC`, w.params)
    ]);
    return { rows: rows.map(withExpenseReceipt), total: total?.n ?? 0, sum: total?.sum ?? 0, byCategory };
  })
);

financeRoutes.post(
  "/expenses",
  requirePermission("FINANCE", "add_new"),
  handler(
    {
      body: z.object({
        spentOn: isoDate,
        category: z.enum(EXPENSE_CATEGORIES),
        supplier: optText(120),
        description: z.string().trim().min(3, "Describa el gasto").max(300),
        amount,
        bankAccountId: z.uuid().nullish()
      })
    },
    async ({ req, body }) =>
      withTx(txCtx(req), (client) =>
        one<{ id: string }>(
          `INSERT INTO expenses (spent_on, category, supplier, description, amount, bank_account_id, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, fn_current_app_user()) RETURNING id`,
          [body.spentOn, body.category, body.supplier, body.description, body.amount, body.bankAccountId ?? null],
          client
        )
      )
  )
);

financeRoutes.post(
  "/expenses/:id/void",
  requirePermission("FINANCE", "delete"),
  handler({ params: idParams, body: z.object({ reason: z.string().trim().min(3, "Escriba el motivo").max(300) }) }, async ({ req, params, body }) => {
    const r = await withTx(txCtx(req), (client) =>
      one<{ id: string }>(
        `UPDATE expenses SET voided_at = NOW(), voided_by = fn_current_app_user(), void_reason = $2 WHERE id = $1 AND voided_at IS NULL RETURNING id`,
        [params.id, body.reason],
        client
      )
    );
    if (!r) throw conflict("ALREADY_VOIDED", "El gasto no existe o ya estaba anulado");
    return r;
  })
);

financeRoutes.put(
  "/expenses/:id/receipt",
  requirePermission("FINANCE", "edit"),
  rawUpload,
  handler({ params: idParams }, async ({ req, params }) => {
    const condominiumId = condominiumOf(req);
    if (!(await one(`SELECT 1 FROM expenses WHERE id = $1`, [params.id]))) throw notFound("Gasto no encontrado");
    const stored = await replaceImage({
      req,
      condominiumId,
      profile: "receipt",
      purpose: "expense_receipt",
      withTx: (fn) => withTx(txCtx(req), fn),
      attach: async (client, fileId) => {
        const prev = await one<{ prev: string | null }>(
          `UPDATE expenses e SET receipt_file_id = $2 FROM (SELECT receipt_file_id AS prev FROM expenses WHERE id = $1) old
            WHERE e.id = $1 RETURNING old.prev`,
          [params.id, fileId],
          client
        );
        return prev?.prev ?? null;
      }
    });
    return { preview: signedUrl(stored.storageKey, "800.webp"), full: signedUrl(stored.storageKey, "orig.webp") };
  })
);

financeRoutes.get(
  "/expenses/export",
  requirePermission("FINANCE", "download"),
  handler({ query: expenseFilters.extend(formatQuery.shape) }, async ({ query: f, req, res }) => {
    const condominiumId = condominiumOf(req);
    const m = await condoMoney(condominiumId);
    const w = expenseWhere(f, false);
    const rows = await query<ExpenseRow>(`SELECT ${EXPENSE_SELECT} ${EXPENSE_JOINS} ${w.sql} ORDER BY e.spent_on DESC LIMIT 20000`, w.params);
    const columns: ExportColumn<ExpenseRow>[] = [
      { header: "Fecha", width: 11, value: (e) => e.spentOn },
      { header: "Categoría", width: 16, value: (e) => EXPENSE_LABEL[e.category] },
      { header: "Proveedor", width: 22, value: (e) => e.supplier },
      { header: "Descripción", width: 36, value: (e) => e.description },
      { header: "Cuenta", width: 16, value: (e) => e.bankName },
      { header: "Monto", width: 14, value: (e) => (f.format === "pdf" ? money(e.amount, m) : e.amount) }
    ];
    const total = rows.reduce((s, e) => s + e.amount, 0);
    const spec = await exportSpec(
      condominiumId,
      "Gastos del condominio",
      `${f.from || f.to ? `Del ${f.from ?? "inicio"} al ${f.to ?? "hoy"}` : "Todo el historial"} · ${rows.length} gasto(s) · total ${money(total, m)}`,
      columns,
      rows,
      "Gastos"
    );
    if (f.format === "pdf") await sendPdf(res, spec);
    else await sendXlsx(res, spec);
    return undefined;
  })
);

// ================================================================== Parámetros

// gateway: la pasarela del servidor ("none" = sin pagos con tarjeta aunque el interruptor esté encendido)
financeRoutes.get("/settings", handler({}, async () => ({ ...(await financeSettings()), gateway: config.PAYMENT_GATEWAY })));

financeRoutes.put(
  "/settings",
  requirePermission("FINANCE", "configure"),
  handler(
    {
      body: z.object({
        interestRate: z.coerce.number().min(0).max(10),
        graceDays: z.coerce.number().int().min(0).max(60),
        dueDay: z.coerce.number().int().min(1).max(28),
        onlinePayments: z.boolean()
      })
    },
    async ({ req, body }) => {
      await withTx(txCtx(req), (client) =>
        client.query(
          `INSERT INTO finance_settings (interest_rate, grace_days, due_day, online_payments, updated_by)
           VALUES ($1, $2, $3, $4, fn_current_app_user())
           ON CONFLICT (condominium_id) DO UPDATE
              SET interest_rate = $1, grace_days = $2, due_day = $3, online_payments = $4, updated_by = fn_current_app_user()`,
          [body.interestRate, body.graceDays, body.dueDay, body.onlinePayments]
        )
      );
      return financeSettings();
    }
  )
);
