/**
 * @project DomusApp - API
 * @file src/modules/dashboard/routes.ts
 * @description Tablero del panel: cifras del condominio activo y lo que pide atención hoy
 *
 *  GET /dashboard/summary   filiales, personas y usuarios + bloque `today`
 *
 * `today` trae solo lo de los módulos a los que el rol puede entrar (null en los demás):
 * alertas sin cerrar, visitas por confirmar y gente adentro, pagos por revisar y morosidad,
 * casos pendientes y vencidos, reservas por aprobar, contratos por vencer, mantenimientos
 * próximos y la próxima asamblea.
 */

import { Router } from "express";
import { one, query } from "../../db.js";
import { handler } from "../../lib/http.js";
import { requirePermission, sessionModules } from "../../security/authorize.js";
import { condominiumOf } from "../../security/context.js";
import { balancesToday, financeSettings } from "../finance/shared.js";

export const dashboardRoutes = Router();

const count = async (sql: string) => (await one<{ n: number }>(`SELECT (${sql})::int AS n`))!.n;

async function today(granted: Set<string>) {
  const has = (code: string) => granted.has(code);
  const [alerts, access, finance, cases, bookings, suppliers, inventory, assemblies] = await Promise.all([
    has("ALERTS") ? count(`SELECT COUNT(*) FROM alerts WHERE status <> 'attended'`).then((open) => ({ open })) : null,
    has("ACCESS")
      ? one<{ entries: number; inside: number; pending: number }>(
          `SELECT (SELECT COUNT(*)::int FROM access_logs WHERE entry_at >= CURRENT_DATE) AS entries,
                  (SELECT COUNT(*)::int FROM access_logs WHERE status = 'inside') AS inside,
                  (SELECT COUNT(*)::int FROM access_logs WHERE status = 'pending') AS pending`
        )
      : null,
    has("FINANCE")
      ? (async () => {
          const settings = await financeSettings();
          const balances = await balancesToday(null, settings.graceDays);
          const pending = await one<{ count: number; amount: number }>(
            `SELECT COUNT(*)::int AS count, COALESCE(SUM(amount), 0)::float8 AS amount FROM payments WHERE status = 'pending' AND method <> 'online'`
          );
          const late = balances.filter((b) => b.overdue > 0);
          return {
            pendingPayments: pending!.count,
            pendingAmount: pending!.amount,
            delinquent: late.length,
            units: balances.length,
            overdue: late.reduce((s, b) => s + b.overdue, 0)
          };
        })()
      : null,
    has("CASES")
      ? one<{ open: number; overdue: number; urgent: number }>(
          `SELECT COUNT(*) FILTER (WHERE status IN ('open', 'in_progress'))::int AS open,
                  COUNT(*) FILTER (WHERE status IN ('open', 'in_progress') AND due_on < CURRENT_DATE)::int AS overdue,
                  COUNT(*) FILTER (WHERE status IN ('open', 'in_progress') AND priority = 'urgent')::int AS urgent
             FROM cases`
        )
      : null,
    has("BOOKINGS")
      ? one<{ pending: number; today: number }>(
          `SELECT COUNT(*) FILTER (WHERE status = 'pending' AND ends_at > NOW())::int AS pending,
                  COUNT(*) FILTER (WHERE status = 'approved' AND starts_at >= CURRENT_DATE AND starts_at < CURRENT_DATE + 1)::int AS today
             FROM bookings`
        )
      : null,
    has("SUPPLIERS")
      ? one<{ expiring: number; expired: number }>(
          `SELECT COUNT(*) FILTER (WHERE ends_on BETWEEN CURRENT_DATE AND CURRENT_DATE + 30)::int AS expiring,
                  COUNT(*) FILTER (WHERE ends_on < CURRENT_DATE AND ends_on >= CURRENT_DATE - 30)::int AS expired
             FROM supplier_contracts WHERE NOT is_cancelled`
        )
      : null,
    has("INVENTORY")
      ? one<{ due: number; overdue: number }>(
          `SELECT COUNT(*) FILTER (WHERE next_maintenance_on <= CURRENT_DATE + 15)::int AS due,
                  COUNT(*) FILTER (WHERE next_maintenance_on < CURRENT_DATE)::int AS overdue
             FROM inventory_items WHERE is_active`
        )
      : null,
    has("ASSEMBLIES")
      ? query<{ id: string; title: string; scheduledAt: string }>(
          `SELECT id, title, scheduled_at AS "scheduledAt" FROM assemblies
            WHERE status = 'scheduled' AND scheduled_at >= NOW() ORDER BY scheduled_at LIMIT 1`
        ).then((rows) => ({ next: rows[0] ?? null }))
      : null
  ]);
  return { alerts, access, finance, cases, bookings, suppliers, inventory, assemblies };
}

dashboardRoutes.get(
  "/summary",
  requirePermission("DASHBOARD"),
  handler({}, async ({ req }) => {
    const mods = await sessionModules(req.auth!);
    const granted = new Set(mods.filter((m) => !m.isOffline && (m.isPublic || m.permissions.includes("access"))).map((m) => m.code));
    const base = await one(
      `SELECT (SELECT count(*)::int FROM units WHERE is_active) AS units,
              (SELECT count(*)::int FROM units WHERE is_active AND occupancy = 'rented') AS rented,
              (SELECT count(*)::int FROM units WHERE is_active AND occupancy = 'vacant') AS vacant,
              (SELECT count(*)::int FROM people WHERE is_active) AS people,
              (SELECT count(*)::int FROM users_condominiums WHERE condominium_id = $1 AND is_active AND role IN ('owner', 'tenant')) AS residents,
              (SELECT count(*)::int FROM users_condominiums WHERE condominium_id = $1 AND is_active AND role = 'guard') AS guards,
              (SELECT count(*)::int FROM users_condominiums WHERE condominium_id = $1 AND is_active AND role = 'admin') AS admins`,
      [condominiumOf(req)]
    );
    return { ...base, today: await today(granted) };
  })
);
