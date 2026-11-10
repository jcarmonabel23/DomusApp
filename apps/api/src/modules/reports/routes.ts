/**
 * @project DomusApp - API
 * @file src/modules/reports/routes.ts
 * @description Reportes (REPORTS): indicadores del período por subsistema y su exportación a Excel o PDF
 *
 *  GET /reports/indicators?from&to                 finanzas, morosidad, accesos, alertas, casos y reservas
 *  GET /reports/export?from&to&format&sections     el mismo reporte en Excel (una hoja por sección) o PDF
 *
 * Cada sección sale solo si el rol tiene acceso a su módulo de origen (FINANCE, ACCESS, ALERTS, CASES,
 * BOOKINGS): quien ve los reportes no ve por aquí nada que su rol no le deje ver en el módulo.
 * Las fechas se agrupan en la zona horaria del condominio (la sesión de BD ya la tiene). El período
 * se agrupa por día hasta 45 días y por mes si es más largo. La morosidad es la foto de hoy.
 */

import { Router } from "express";
import { z } from "zod";
import { one, query } from "../../db.js";
import { badRequest, handler } from "../../lib/http.js";
import { sendReportPdf, sendReportXlsx, type ReportDoc, type ReportSection } from "../../lib/reportExport.js";
import { requirePermission, sessionModules } from "../../security/authorize.js";
import { condominiumOf } from "../../security/context.js";
import { KIND_LABEL as ACCESS_KIND_LABEL } from "../access/shared.js";
import { ALERT_LABEL } from "../alerts/routes.js";
import { CATEGORY_LABEL as CASE_CATEGORY_LABEL, STATUS_LABEL as CASE_STATUS_LABEL } from "../cases/shared.js";
import { balancesToday, condoMoney, EXPENSE_LABEL, financeSettings, METHOD_LABEL, money, type CondoMoney } from "../finance/shared.js";

export const reportsRoutes = Router();

export const REPORT_SECTIONS = ["finance", "delinquency", "access", "alerts", "cases", "bookings"] as const;
type SectionKey = (typeof REPORT_SECTIONS)[number];
const SOURCE: Record<SectionKey, string> = {
  finance: "FINANCE",
  delinquency: "FINANCE",
  access: "ACCESS",
  alerts: "ALERTS",
  cases: "CASES",
  bookings: "BOOKINGS"
};
const MAX_DAYS = 731;
const DAILY_UP_TO = 45;

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha AAAA-MM-DD");
const rangeQuery = z.object({ from: ymd.optional(), to: ymd.optional() });

const UNIT_LABEL = `CASE WHEN u.tower IS NULL THEN u.code ELSE u.code || ' · ' || u.tower END`;
const WEEKDAYS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];

interface Range {
  from: string;
  to: string;
  days: number;
  bucket: "day" | "month";
}

/** Por defecto: desde el primer día de hace 5 meses hasta hoy (seis meses calendario) */
async function resolveRange(q: z.infer<typeof rangeQuery>): Promise<Range> {
  const r = await one<{ from: string; to: string; days: number; valid: boolean }>(
    `WITH x AS (
       SELECT COALESCE($1::date, (date_trunc('month', CURRENT_DATE) - INTERVAL '5 months')::date) AS f,
              COALESCE($2::date, CURRENT_DATE) AS t
     )
     SELECT to_char(f, 'YYYY-MM-DD') AS "from", to_char(t, 'YYYY-MM-DD') AS "to", (t - f + 1) AS days, f <= t AS valid FROM x`,
    [q.from ?? null, q.to ?? null]
  ).catch(() => null);
  if (!r) throw badRequest("INVALID_RANGE", "Las fechas del período no son válidas");
  if (!r.valid) throw badRequest("INVALID_RANGE", "La fecha inicial debe ser anterior o igual a la final");
  if (r.days > MAX_DAYS) throw badRequest("RANGE_TOO_LONG", "El período no puede pasar de dos años");
  return { from: r.from, to: r.to, days: r.days, bucket: r.days <= DAILY_UP_TO ? "day" : "month" };
}

/** Secciones que el rol puede ver (por permiso de acceso al módulo de origen, y que el módulo esté en línea) */
async function allowedSections(req: Parameters<typeof condominiumOf>[0]): Promise<Set<SectionKey>> {
  const mods = await sessionModules(req.auth!);
  const ok = new Set(mods.filter((m) => !m.isOffline && (m.isPublic || m.permissions.includes("access"))).map((m) => m.code));
  return new Set(REPORT_SECTIONS.filter((s) => ok.has(SOURCE[s])));
}

/** Períodos de la serie: cada día o cada mes del rango, aunque no tengan movimientos */
async function periods(r: Range): Promise<string[]> {
  const rows = await query<{ p: string }>(
    `SELECT to_char(g, 'YYYY-MM-DD') AS p
       FROM generate_series(date_trunc($3, $1::date), $2::date, ('1 ' || $3)::interval) g`,
    [r.from, r.to, r.bucket]
  );
  return rows.map((x) => x.p);
}

/** Une varias series por período en una sola, con ceros donde falte */
function merge<K extends string>(keys: string[], series: Record<K, { period: string; value: number }[]>) {
  const maps = Object.fromEntries(Object.entries(series).map(([k, v]) => [k, new Map((v as { period: string; value: number }[]).map((x) => [x.period, x.value]))])) as Record<
    K,
    Map<string, number>
  >;
  return keys.map((period) => ({ period, ...(Object.fromEntries(Object.keys(series).map((k) => [k, maps[k as K].get(period) ?? 0])) as Record<K, number>) }));
}

const bucketOf = (col: string, r: Range) => `to_char(date_trunc('${r.bucket}', ${col}), 'YYYY-MM-DD')`;

// ================================================================== Secciones

async function financeSection(r: Range, keys: string[]) {
  const params = [r.from, r.to];
  const [totals, billed, collected, spent, byMethod, byCategory] = await Promise.all([
    one<{ billed: number; collected: number; expenses: number; payments: number }>(
      `SELECT (SELECT COALESCE(SUM(amount), 0)::float8 FROM charges WHERE voided_at IS NULL AND due_date BETWEEN $1 AND $2) AS billed,
              (SELECT COALESCE(SUM(amount), 0)::float8 FROM payments WHERE status = 'approved' AND paid_on BETWEEN $1 AND $2) AS collected,
              (SELECT COUNT(*)::int FROM payments WHERE status = 'approved' AND paid_on BETWEEN $1 AND $2) AS payments,
              (SELECT COALESCE(SUM(amount), 0)::float8 FROM expenses WHERE voided_at IS NULL AND spent_on BETWEEN $1 AND $2) AS expenses`,
      params
    ),
    query<{ period: string; value: number }>(
      `SELECT ${bucketOf("due_date", r)} AS period, SUM(amount)::float8 AS value FROM charges
        WHERE voided_at IS NULL AND due_date BETWEEN $1 AND $2 GROUP BY 1`,
      params
    ),
    query<{ period: string; value: number }>(
      `SELECT ${bucketOf("paid_on", r)} AS period, SUM(amount)::float8 AS value FROM payments
        WHERE status = 'approved' AND paid_on BETWEEN $1 AND $2 GROUP BY 1`,
      params
    ),
    query<{ period: string; value: number }>(
      `SELECT ${bucketOf("spent_on", r)} AS period, SUM(amount)::float8 AS value FROM expenses
        WHERE voided_at IS NULL AND spent_on BETWEEN $1 AND $2 GROUP BY 1`,
      params
    ),
    query<{ method: string; amount: number; count: number }>(
      `SELECT method, SUM(amount)::float8 AS amount, COUNT(*)::int AS count FROM payments
        WHERE status = 'approved' AND paid_on BETWEEN $1 AND $2 GROUP BY method ORDER BY 2 DESC`,
      params
    ),
    query<{ category: string; amount: number }>(
      `SELECT category, SUM(amount)::float8 AS amount FROM expenses
        WHERE voided_at IS NULL AND spent_on BETWEEN $1 AND $2 GROUP BY category ORDER BY 2 DESC`,
      params
    )
  ]);
  const t = totals!;
  return {
    billed: t.billed,
    collected: t.collected,
    payments: t.payments,
    expenses: t.expenses,
    net: t.collected - t.expenses,
    collectionRate: t.billed > 0 ? t.collected / t.billed : null,
    byPeriod: merge(keys, { billed, collected, expenses: spent }),
    byMethod: byMethod.map((m) => ({ ...m, label: METHOD_LABEL[m.method] ?? m.method })),
    expensesByCategory: byCategory.map((c) => ({ ...c, label: EXPENSE_LABEL[c.category] ?? c.category }))
  };
}

const AGING = [
  { key: "1-30", label: "1 a 30 días", min: 0, max: 30 },
  { key: "31-60", label: "31 a 60 días", min: 31, max: 60 },
  { key: "61-90", label: "61 a 90 días", min: 61, max: 90 },
  { key: "90+", label: "Más de 90 días", min: 91, max: Infinity }
];

async function delinquencySection() {
  const settings = await financeSettings();
  const today = (await one<{ d: string }>(`SELECT to_char(CURRENT_DATE, 'YYYY-MM-DD') AS d`))!.d;
  const balances = await balancesToday(null, settings.graceDays);
  const dayMs = 86_400_000;
  const debtors = balances
    .filter((b) => b.overdue > 0)
    .map((b) => ({
      unitId: b.unitId,
      unit: b.unitTower ? `${b.unitCode} · ${b.unitTower}` : b.unitCode,
      overdue: b.overdue,
      open: b.open,
      oldestDue: b.oldestDue,
      // Días desde el vencimiento más antiguo con saldo (sin contar la gracia)
      days: b.oldestDue ? Math.max(0, Math.round((Date.parse(today) - Date.parse(b.oldestDue)) / dayMs) - settings.graceDays) : 0
    }))
    .sort((a, b) => b.overdue - a.overdue);
  const overdue = debtors.reduce((s, d) => s + d.overdue, 0);
  return {
    asOf: today,
    units: balances.length,
    delinquent: debtors.length,
    delinquencyRate: balances.length ? debtors.length / balances.length : 0,
    receivable: balances.reduce((s, b) => s + b.open, 0),
    overdue,
    credit: balances.reduce((s, b) => s + Math.max(0, -b.balance), 0),
    aging: AGING.map((a) => {
      const inBucket = debtors.filter((d) => d.days >= a.min && d.days <= a.max);
      return { key: a.key, label: a.label, units: inBucket.length, amount: inBucket.reduce((s, d) => s + d.overdue, 0) };
    }),
    topDebtors: debtors.slice(0, 10)
  };
}

async function accessSection(r: Range, keys: string[]) {
  const params = [r.from, r.to];
  const inRange = `entry_at >= $1::date AND entry_at < $2::date + 1`;
  const [totals, series, byKind, byHour, byWeekday, topUnits] = await Promise.all([
    one<{ entries: number; visitors: number; vehicles: number; unannounced: number; denied: number; insideNow: number; avgStayMinutes: number | null }>(
      `SELECT (SELECT COUNT(*)::int FROM access_logs WHERE ${inRange}) AS entries,
              (SELECT COUNT(*)::int FROM access_logs WHERE ${inRange} AND kind <> 'resident') AS visitors,
              (SELECT COUNT(*)::int FROM access_logs WHERE ${inRange} AND plate IS NOT NULL) AS vehicles,
              (SELECT COUNT(*)::int FROM access_logs WHERE ${inRange} AND kind = 'unannounced') AS unannounced,
              (SELECT COUNT(*)::int FROM access_logs WHERE status = 'denied' AND created_at >= $1::date AND created_at < $2::date + 1) AS denied,
              (SELECT COUNT(*)::int FROM access_logs WHERE status = 'inside') AS "insideNow",
              (SELECT ROUND(AVG(EXTRACT(EPOCH FROM (exit_at - entry_at)) / 60))::int FROM access_logs
                WHERE ${inRange} AND exit_at IS NOT NULL AND kind <> 'resident') AS "avgStayMinutes"`,
      params
    ),
    query<{ period: string; value: number }>(`SELECT ${bucketOf("entry_at", r)} AS period, COUNT(*)::int AS value FROM access_logs WHERE ${inRange} GROUP BY 1`, params),
    query<{ kind: string; count: number }>(`SELECT kind, COUNT(*)::int AS count FROM access_logs WHERE ${inRange} GROUP BY kind ORDER BY 2 DESC`, params),
    query<{ hour: number; count: number }>(`SELECT EXTRACT(HOUR FROM entry_at)::int AS hour, COUNT(*)::int AS count FROM access_logs WHERE ${inRange} GROUP BY 1`, params),
    query<{ dow: number; count: number }>(`SELECT EXTRACT(ISODOW FROM entry_at)::int AS dow, COUNT(*)::int AS count FROM access_logs WHERE ${inRange} GROUP BY 1`, params),
    query<{ unit: string; count: number }>(
      `SELECT ${UNIT_LABEL} AS unit, COUNT(*)::int AS count FROM access_logs l JOIN units u ON u.id = l.unit_id
        WHERE l.entry_at >= $1::date AND l.entry_at < $2::date + 1 AND l.kind <> 'resident'
        GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 10`,
      params
    )
  ]);
  const hours = new Map(byHour.map((h) => [h.hour, h.count]));
  const dows = new Map(byWeekday.map((d) => [d.dow, d.count]));
  const peak = byHour.reduce<{ hour: number; count: number } | null>((p, h) => (!p || h.count > p.count ? h : p), null);
  return {
    ...totals!,
    peakHour: peak?.hour ?? null,
    byPeriod: merge(keys, { entries: series }),
    byKind: byKind.map((k) => ({ ...k, label: ACCESS_KIND_LABEL[k.kind] ?? k.kind })),
    byHour: Array.from({ length: 24 }, (_, hour) => ({ hour, count: hours.get(hour) ?? 0 })),
    byWeekday: WEEKDAYS.map((label, i) => ({ day: i + 1, label, count: dows.get(i + 1) ?? 0 })),
    topUnits
  };
}

async function alertsSection(r: Range, keys: string[]) {
  const params = [r.from, r.to];
  const inRange = `raised_at >= $1::date AND raised_at < $2::date + 1`;
  const ack = `EXTRACT(EPOCH FROM (acknowledged_at - raised_at))`;
  const att = `EXTRACT(EPOCH FROM (attended_at - raised_at))`;
  const [totals, count, ackAvg, byKind] = await Promise.all([
    one<{
      total: number;
      attended: number;
      open: number;
      avgAckSeconds: number | null;
      medianAckSeconds: number | null;
      maxAckSeconds: number | null;
      avgAttendSeconds: number | null;
      ackWithin5: number | null;
    }>(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE status = 'attended')::int AS attended,
              COUNT(*) FILTER (WHERE status <> 'attended')::int AS open,
              ROUND(AVG(${ack}))::int AS "avgAckSeconds",
              ROUND(percentile_cont(0.5) WITHIN GROUP (ORDER BY ${ack}))::int AS "medianAckSeconds",
              ROUND(MAX(${ack}))::int AS "maxAckSeconds",
              ROUND(AVG(${att}))::int AS "avgAttendSeconds",
              (COUNT(*) FILTER (WHERE ${ack} <= 300))::float8 / NULLIF(COUNT(acknowledged_at), 0) AS "ackWithin5"
         FROM alerts WHERE ${inRange}`,
      params
    ),
    query<{ period: string; value: number }>(`SELECT ${bucketOf("raised_at", r)} AS period, COUNT(*)::int AS value FROM alerts WHERE ${inRange} GROUP BY 1`, params),
    query<{ period: string; value: number }>(
      `SELECT ${bucketOf("raised_at", r)} AS period, ROUND(AVG(${ack}))::int AS value FROM alerts WHERE ${inRange} AND acknowledged_at IS NOT NULL GROUP BY 1`,
      params
    ),
    query<{ kind: string; count: number; avgAckSeconds: number | null }>(
      `SELECT kind, COUNT(*)::int AS count, ROUND(AVG(${ack}))::int AS "avgAckSeconds" FROM alerts WHERE ${inRange} GROUP BY kind ORDER BY 2 DESC`,
      params
    )
  ]);
  return {
    ...totals!,
    byPeriod: merge(keys, { count, avgAckSeconds: ackAvg }),
    byKind: byKind.map((k) => ({ ...k, label: ALERT_LABEL[k.kind] ?? k.kind }))
  };
}

async function casesSection(r: Range, keys: string[]) {
  const params = [r.from, r.to];
  const created = `created_at >= $1::date AND created_at < $2::date + 1`;
  const resolved = `resolved_at >= $1::date AND resolved_at < $2::date + 1`;
  const [totals, opened, closed, byCategory, byStatus] = await Promise.all([
    one<{ opened: number; resolved: number; openNow: number; overdueNow: number; avgResolutionHours: number | null; avgRating: number | null; ratings: number }>(
      `SELECT (SELECT COUNT(*)::int FROM cases WHERE ${created}) AS opened,
              (SELECT COUNT(*)::int FROM cases WHERE ${resolved}) AS resolved,
              (SELECT COUNT(*)::int FROM cases WHERE status IN ('open', 'in_progress')) AS "openNow",
              (SELECT COUNT(*)::int FROM cases WHERE status IN ('open', 'in_progress') AND due_on < CURRENT_DATE) AS "overdueNow",
              (SELECT ROUND((AVG(EXTRACT(EPOCH FROM (resolved_at - created_at))) / 3600)::numeric, 1)::float8 FROM cases WHERE ${resolved}) AS "avgResolutionHours",
              (SELECT ROUND(AVG(rating)::numeric, 2)::float8 FROM cases WHERE rating IS NOT NULL AND ${created}) AS "avgRating",
              (SELECT COUNT(*)::int FROM cases WHERE rating IS NOT NULL AND ${created}) AS ratings`,
      params
    ),
    query<{ period: string; value: number }>(`SELECT ${bucketOf("created_at", r)} AS period, COUNT(*)::int AS value FROM cases WHERE ${created} GROUP BY 1`, params),
    query<{ period: string; value: number }>(`SELECT ${bucketOf("resolved_at", r)} AS period, COUNT(*)::int AS value FROM cases WHERE ${resolved} GROUP BY 1`, params),
    query<{ category: string; count: number; open: number }>(
      `SELECT category, COUNT(*)::int AS count, COUNT(*) FILTER (WHERE status IN ('open', 'in_progress'))::int AS open
         FROM cases WHERE ${created} GROUP BY category ORDER BY 2 DESC`,
      params
    ),
    query<{ status: string; count: number }>(`SELECT status, COUNT(*)::int AS count FROM cases WHERE ${created} GROUP BY status ORDER BY 2 DESC`, params)
  ]);
  return {
    ...totals!,
    byPeriod: merge(keys, { opened, resolved: closed }),
    byCategory: byCategory.map((c) => ({ ...c, label: CASE_CATEGORY_LABEL[c.category as keyof typeof CASE_CATEGORY_LABEL] ?? c.category })),
    byStatus: byStatus.map((s) => ({ ...s, label: CASE_STATUS_LABEL[s.status as keyof typeof CASE_STATUS_LABEL] ?? s.status }))
  };
}

async function bookingsSection(r: Range) {
  const params = [r.from, r.to];
  const inRange = `b.starts_at >= $1::date AND b.starts_at < $2::date + 1`;
  const hours = `EXTRACT(EPOCH FROM (b.ends_at - b.starts_at)) / 3600`;
  const [totals, byAmenity] = await Promise.all([
    one<{ approved: number; pending: number; cancelled: number; rejected: number; hours: number; revenue: number }>(
      `SELECT COUNT(*) FILTER (WHERE status = 'approved')::int AS approved,
              COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
              COUNT(*) FILTER (WHERE status = 'cancelled')::int AS cancelled,
              COUNT(*) FILTER (WHERE status = 'rejected')::int AS rejected,
              COALESCE(SUM(${hours}) FILTER (WHERE status = 'approved'), 0)::float8 AS hours,
              COALESCE(SUM(cost) FILTER (WHERE status = 'approved'), 0)::float8 AS revenue
         FROM bookings b WHERE ${inRange}`,
      params
    ),
    query<{ name: string; approved: number; hours: number; revenue: number; cancelled: number }>(
      `SELECT a.name, COUNT(*) FILTER (WHERE b.status = 'approved')::int AS approved,
              COALESCE(SUM(${hours}) FILTER (WHERE b.status = 'approved'), 0)::float8 AS hours,
              COALESCE(SUM(b.cost) FILTER (WHERE b.status = 'approved'), 0)::float8 AS revenue,
              COUNT(*) FILTER (WHERE b.status IN ('cancelled', 'rejected'))::int AS cancelled
         FROM bookings b JOIN amenities a ON a.id = b.amenity_id
        WHERE ${inRange} GROUP BY a.name ORDER BY 2 DESC, 1`,
      params
    )
  ]);
  return { ...totals!, byAmenity };
}

type Indicators = Awaited<ReturnType<typeof buildIndicators>>;

async function buildIndicators(req: Parameters<typeof condominiumOf>[0], range: Range, only?: Set<SectionKey>) {
  const allowed = await allowedSections(req);
  const want = (s: SectionKey) => allowed.has(s) && (!only || only.has(s));
  const keys = await periods(range);
  const m = await condoMoney(condominiumOf(req));
  // Una sección a la vez (cada una ya lanza sus consultas en paralelo): no acapara el pool de conexiones
  const finance = want("finance") ? await financeSection(range, keys) : null;
  const delinquency = want("delinquency") ? await delinquencySection() : null;
  const access = want("access") ? await accessSection(range, keys) : null;
  const alerts = want("alerts") ? await alertsSection(range, keys) : null;
  const cases = want("cases") ? await casesSection(range, keys) : null;
  const bookings = want("bookings") ? await bookingsSection(range) : null;
  return {
    from: range.from,
    to: range.to,
    days: range.days,
    bucket: range.bucket,
    generatedAt: new Date().toISOString(),
    currency: { code: m.currency, symbol: m.symbol, decimals: m.decimals },
    sections: REPORT_SECTIONS.filter((s) => allowed.has(s)),
    finance,
    delinquency,
    access,
    alerts,
    cases,
    bookings
  };
}

reportsRoutes.use(requirePermission("REPORTS", "access"));

reportsRoutes.get(
  "/indicators",
  requirePermission("REPORTS", "view"),
  handler({ query: rangeQuery }, async ({ query: q, req }) => buildIndicators(req, await resolveRange(q)))
);

// ================================================================== Exportación

/** 754 → "12 min 34 s" · 7300 → "2 h 2 min" · 200000 → "2 d 7 h" (igual que el panel) */
export function duration(seconds: number | null): string {
  if (seconds === null || seconds === undefined) return "—";
  const s = Math.round(seconds);
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min${s % 60 ? ` ${s % 60} s` : ""}`;
  if (s < 172_800) {
    const h = Math.floor(s / 3600);
    const min = Math.round((s % 3600) / 60);
    return `${h} h${min ? ` ${min} min` : ""}`;
  }
  const d = Math.floor(s / 86_400);
  const h = Math.round((s % 86_400) / 3600);
  return `${d} d${h ? ` ${h} h` : ""}`;
}

const pct = (v: number | null) => (v === null ? "—" : `${new Intl.NumberFormat("es-419", { maximumFractionDigits: 1 }).format(v * 100)} %`);
const int = (v: number) => new Intl.NumberFormat("es-419").format(v);
const fmtDay = (d: string) => new Intl.DateTimeFormat("es", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${d}T12:00:00Z`));
const fmtPeriod = (d: string, bucket: Range["bucket"]) =>
  bucket === "month" ? new Intl.DateTimeFormat("es", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${d}T12:00:00Z`)) : fmtDay(d);

function toReport(d: Indicators, m: CondoMoney): ReportSection[] {
  const $ = (v: number) => money(v, m);
  const cur = `(${m.currency})`;
  const out: ReportSection[] = [];
  const period = (p: string) => fmtPeriod(p, d.bucket);

  if (d.finance) {
    const f = d.finance;
    out.push({
      title: "Ingresos y gastos",
      kpis: [
        { label: "Facturado (cuotas y cargos que vencen)", value: $(f.billed) },
        { label: "Cobrado (pagos aprobados)", value: $(f.collected) },
        { label: "Cobranza", value: pct(f.collectionRate) },
        { label: "Gastos", value: $(f.expenses) },
        { label: "Resultado (cobrado − gastos)", value: $(f.net) },
        { label: "Pagos recibidos", value: int(f.payments) }
      ],
      tables: [
        {
          title: d.bucket === "month" ? "Por mes" : "Por día",
          columns: [
            { header: "Período", width: 22 },
            { header: `Facturado ${cur}`, width: 18, align: "right" },
            { header: `Cobrado ${cur}`, width: 18, align: "right" },
            { header: `Gastos ${cur}`, width: 18, align: "right" },
            { header: `Resultado ${cur}`, width: 18, align: "right" }
          ],
          rows: f.byPeriod.map((p) => [period(p.period), p.billed, p.collected, p.expenses, p.collected - p.expenses])
        },
        {
          title: "Cobros por medio de pago",
          columns: [
            { header: "Medio", width: 24 },
            { header: "Pagos", width: 10, align: "right" },
            { header: `Monto ${cur}`, width: 18, align: "right" }
          ],
          rows: f.byMethod.map((x) => [x.label, x.count, x.amount])
        },
        {
          title: "Gastos por categoría",
          columns: [
            { header: "Categoría", width: 24 },
            { header: `Monto ${cur}`, width: 18, align: "right" },
            { header: "Participación", width: 14, align: "right" }
          ],
          rows: f.expensesByCategory.map((x) => [x.label, x.amount, pct(f.expenses ? x.amount / f.expenses : null)])
        }
      ]
    });
  }

  if (d.delinquency) {
    const q = d.delinquency;
    out.push({
      title: "Morosidad",
      note: `Situación al ${fmtDay(q.asOf)}, sin importar el período`,
      kpis: [
        { label: "Filiales en mora", value: `${int(q.delinquent)} de ${int(q.units)}` },
        { label: "Índice de morosidad", value: pct(q.delinquencyRate) },
        { label: "Monto vencido", value: $(q.overdue) },
        { label: "Por cobrar (vencido y por vencer)", value: $(q.receivable) },
        { label: "Saldos a favor", value: $(q.credit) }
      ],
      tables: [
        {
          title: "Antigüedad de la deuda vencida",
          columns: [
            { header: "Antigüedad", width: 24 },
            { header: "Filiales", width: 10, align: "right" },
            { header: `Monto ${cur}`, width: 18, align: "right" }
          ],
          rows: q.aging.map((a) => [a.label, a.units, a.amount])
        },
        {
          title: "Filiales con mayor deuda vencida",
          columns: [
            { header: "Filial", width: 22 },
            { header: `Vencido ${cur}`, width: 18, align: "right" },
            { header: `Saldo total ${cur}`, width: 18, align: "right" },
            { header: "Vence desde", width: 16 },
            { header: "Días de atraso", width: 12, align: "right" }
          ],
          rows: q.topDebtors.map((t) => [t.unit, t.overdue, t.open, t.oldestDue ? fmtDay(t.oldestDue) : "", t.days])
        }
      ]
    });
  }

  if (d.access) {
    const a = d.access;
    out.push({
      title: "Accesos",
      kpis: [
        { label: "Ingresos registrados", value: int(a.entries) },
        { label: "Visitantes (no residentes)", value: int(a.visitors) },
        { label: "Con vehículo", value: int(a.vehicles) },
        { label: "Visitas no anunciadas", value: int(a.unannounced) },
        { label: "Ingresos rechazados", value: int(a.denied) },
        { label: "Estadía promedio de visitas", value: duration(a.avgStayMinutes === null ? null : a.avgStayMinutes * 60) },
        { label: "Hora de más ingresos", value: a.peakHour === null ? "—" : `${String(a.peakHour).padStart(2, "0")}:00` },
        { label: "Adentro ahora", value: int(a.insideNow) }
      ],
      tables: [
        { title: d.bucket === "month" ? "Ingresos por mes" : "Ingresos por día", columns: [{ header: "Período", width: 22 }, { header: "Ingresos", width: 12, align: "right" }], rows: a.byPeriod.map((p) => [period(p.period), p.entries]) },
        { title: "Por tipo de ingreso", columns: [{ header: "Tipo", width: 24 }, { header: "Ingresos", width: 12, align: "right" }], rows: a.byKind.map((k) => [k.label, k.count]) },
        { title: "Por día de la semana", columns: [{ header: "Día", width: 24 }, { header: "Ingresos", width: 12, align: "right" }], rows: a.byWeekday.map((w) => [w.label, w.count]) },
        {
          title: "Por hora del día",
          columns: [{ header: "Hora", width: 24 }, { header: "Ingresos", width: 12, align: "right" }],
          rows: a.byHour.filter((h) => h.count > 0).map((h) => [`${String(h.hour).padStart(2, "0")}:00 – ${String(h.hour).padStart(2, "0")}:59`, h.count])
        },
        { title: "Filiales con más visitas", columns: [{ header: "Filial", width: 24 }, { header: "Visitas", width: 12, align: "right" }], rows: a.topUnits.map((u) => [u.unit, u.count]) }
      ]
    });
  }

  if (d.alerts) {
    const a = d.alerts;
    out.push({
      title: "Alertas de pánico",
      kpis: [
        { label: "Alertas", value: int(a.total) },
        { label: "Atendidas", value: int(a.attended) },
        { label: "Sin cerrar", value: int(a.open) },
        { label: "Respuesta promedio (en camino)", value: duration(a.avgAckSeconds) },
        { label: "Respuesta mediana", value: duration(a.medianAckSeconds) },
        { label: "Respuesta más lenta", value: duration(a.maxAckSeconds) },
        { label: "Respondidas en 5 min o menos", value: pct(a.ackWithin5) },
        { label: "Cierre promedio (atendida)", value: duration(a.avgAttendSeconds) }
      ],
      tables: [
        {
          title: d.bucket === "month" ? "Por mes" : "Por día",
          columns: [{ header: "Período", width: 22 }, { header: "Alertas", width: 12, align: "right" }, { header: "Respuesta promedio", width: 18, align: "right" }],
          rows: a.byPeriod.map((p) => [period(p.period), p.count, p.count ? duration(p.avgAckSeconds || null) : "—"])
        },
        {
          title: "Por tipo de emergencia",
          columns: [{ header: "Tipo", width: 24 }, { header: "Alertas", width: 12, align: "right" }, { header: "Respuesta promedio", width: 18, align: "right" }],
          rows: a.byKind.map((k) => [k.label, k.count, duration(k.avgAckSeconds)])
        }
      ]
    });
  }

  if (d.cases) {
    const c = d.cases;
    out.push({
      title: "Casos e incidentes",
      kpis: [
        { label: "Casos abiertos en el período", value: int(c.opened) },
        { label: "Resueltos en el período", value: int(c.resolved) },
        { label: "Tiempo promedio de solución", value: c.avgResolutionHours === null ? "—" : duration(c.avgResolutionHours * 3600) },
        { label: "Calificación promedio", value: c.avgRating === null ? "—" : `${c.avgRating.toFixed(1)} de 5 (${c.ratings})` },
        { label: "Pendientes hoy", value: int(c.openNow) },
        { label: "Con fecha compromiso vencida", value: int(c.overdueNow) }
      ],
      tables: [
        {
          title: d.bucket === "month" ? "Por mes" : "Por día",
          columns: [{ header: "Período", width: 22 }, { header: "Abiertos", width: 12, align: "right" }, { header: "Resueltos", width: 12, align: "right" }],
          rows: c.byPeriod.map((p) => [period(p.period), p.opened, p.resolved])
        },
        {
          title: "Por categoría",
          columns: [{ header: "Categoría", width: 24 }, { header: "Casos", width: 12, align: "right" }, { header: "Aún pendientes", width: 14, align: "right" }],
          rows: c.byCategory.map((x) => [x.label, x.count, x.open])
        },
        { title: "Estado actual de los casos del período", columns: [{ header: "Estado", width: 24 }, { header: "Casos", width: 12, align: "right" }], rows: c.byStatus.map((x) => [x.label, x.count]) }
      ]
    });
  }

  if (d.bookings) {
    const b = d.bookings;
    out.push({
      title: "Reservaciones",
      kpis: [
        { label: "Reservas confirmadas", value: int(b.approved) },
        { label: "Horas reservadas", value: int(Math.round(b.hours * 10) / 10) },
        { label: "Ingresos por reservas", value: $(b.revenue) },
        { label: "Por aprobar", value: int(b.pending) },
        { label: "Canceladas", value: int(b.cancelled) },
        { label: "Rechazadas", value: int(b.rejected) }
      ],
      tables: [
        {
          title: "Por área común",
          columns: [
            { header: "Área", width: 24 },
            { header: "Confirmadas", width: 12, align: "right" },
            { header: "Horas", width: 10, align: "right" },
            { header: `Ingresos ${cur}`, width: 16, align: "right" },
            { header: "Canceladas o rechazadas", width: 16, align: "right" }
          ],
          rows: b.byAmenity.map((x) => [x.name, x.approved, Math.round(x.hours * 10) / 10, x.revenue, x.cancelled])
        }
      ]
    });
  }
  return out;
}

reportsRoutes.get(
  "/export",
  requirePermission("REPORTS", "download"),
  handler(
    {
      query: rangeQuery.extend({
        format: z.enum(["xlsx", "pdf"]).default("xlsx"),
        sections: z
          .string()
          .optional()
          .transform((v, ctx) => {
            if (!v) return undefined;
            const list = v.split(",").map((s) => s.trim()).filter(Boolean);
            const bad = list.filter((s) => !REPORT_SECTIONS.includes(s as SectionKey));
            if (bad.length) {
              ctx.addIssue({ code: "custom", message: `Sección desconocida: ${bad.join(", ")}` });
              return z.NEVER;
            }
            return new Set(list as SectionKey[]);
          })
      })
    },
    async ({ query: q, req, res }) => {
      const range = await resolveRange(q);
      const data = await buildIndicators(req, range, q.sections);
      const m = await condoMoney(condominiumOf(req));
      const doc: ReportDoc = {
        title: "Reporte de indicadores",
        subtitle: `Del ${fmtDay(range.from)} al ${fmtDay(range.to)} · montos en ${m.currency}`,
        condominium: m.name,
        color: m.color,
        timezone: m.timezone,
        fileBase: "reporte_indicadores",
        sections: toReport(data, m)
      };
      if (q.format === "pdf") await sendReportPdf(res, doc);
      else await sendReportXlsx(res, doc);
    }
  )
);
