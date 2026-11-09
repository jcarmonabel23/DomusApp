/**
 * @project DomusApp - API
 * @file src/modules/alerts/routes.ts
 * @description Botón de pánico y alertas
 *
 *  Residente (/resident/alerts)       POST  activa una alerta · GET  sus alertas abiertas y recientes
 *  Caseta    (/guard/alerts)          GET   abiertas y atendidas hoy · POST :id/ack (voy en camino) · POST :id/attend
 *  Panel     (/alerts, módulo ALERTS) GET   summary · GET lista · GET export · POST :id/attend
 *
 * Ciclo: active (suena en la caseta) → acknowledged (un guarda va en camino) → attended (cerrada con resolución).
 * La alerta no se puede borrar ni "cancelar" desde la app: queda como evidencia y solo la cierra un guarda o la
 * administración, con la resolución escrita.
 */

import { Router } from "express";
import { z } from "zod";
import { one, query, withTx } from "../../db.js";
import { sendPdf, sendXlsx, type ExportColumn } from "../../lib/exports.js";
import { conflict, handler, idParams, notFound } from "../../lib/http.js";
import { emitToStaff, emitToUnit, emitToUser } from "../../lib/realtime.js";
import { requirePermission, requireRole } from "../../security/authorize.js";
import { authOf, condominiumOf, txCtx } from "../../security/context.js";
import type { Request } from "express";
import { UNIT_PHONES, optText, residentUnitIds } from "../access/shared.js";
import { notify, staffUserIds, unitUserIds } from "../notifications/service.js";

export const ALERT_KINDS = [
  "robbery",
  "fire",
  "flood",
  "intruder",
  "vandalism",
  "short_circuit",
  "domestic_violence",
  "medical",
  "accident",
  "other"
] as const;

export const ALERT_LABEL: Record<string, string> = {
  robbery: "Robo",
  fire: "Incendio",
  flood: "Inundación",
  intruder: "Intrusos",
  vandalism: "Vandalismo",
  short_circuit: "Cortocircuito",
  domestic_violence: "Violencia doméstica",
  medical: "Emergencia médica",
  accident: "Accidente",
  other: "Otra emergencia"
};

const STATUS_LABEL: Record<string, string> = { active: "Activa", acknowledged: "En atención", attended: "Atendida" };

export const ALERT_SELECT = `al.id, al.unit_id AS "unitId", u.code AS "unitCode", u.tower AS "unitTower",
  al.kind, al.notes, al.status, al.resolution,
  al.raised_at AS "raisedAt", al.acknowledged_at AS "acknowledgedAt", al.attended_at AS "attendedAt",
  rb.names AS "raisedByName", ab.names AS "acknowledgedByName", tb.names AS "attendedByName",
  al.raised_by AS "raisedBy",
  EXTRACT(EPOCH FROM (al.acknowledged_at - al.raised_at))::int AS "ackSeconds",
  EXTRACT(EPOCH FROM (al.attended_at - al.raised_at))::int AS "attendSeconds",
  ${UNIT_PHONES} AS phones`;

export const ALERT_JOINS = `FROM alerts al
  LEFT JOIN units u ON u.id = al.unit_id
  LEFT JOIN users rb ON rb.id = al.raised_by
  LEFT JOIN users ab ON ab.id = al.acknowledged_by
  LEFT JOIN users tb ON tb.id = al.attended_by`;

interface AlertRow {
  id: string;
  unitId: string | null;
  unitCode: string | null;
  kind: string;
  notes: string | null;
  status: string;
  resolution: string | null;
  raisedAt: Date;
  acknowledgedAt: Date | null;
  attendedAt: Date | null;
  raisedByName: string | null;
  acknowledgedByName: string | null;
  attendedByName: string | null;
  raisedBy: string | null;
  ackSeconds: number | null;
  attendSeconds: number | null;
}

const alertById = (id: string) => one<AlertRow>(`SELECT ${ALERT_SELECT} ${ALERT_JOINS} WHERE al.id = $1`, [id]);

const where = (a: Pick<AlertRow, "unitCode">) => (a.unitCode ? ` · ${a.unitCode}` : "");

/** Avisa un cambio de estado a la caseta, a la filial y a quien la activó */
async function broadcastUpdate(condominiumId: string, alert: AlertRow, title: string, body: string, actorId: string) {
  emitToStaff(condominiumId, "alert:update", alert);
  if (alert.unitId) emitToUnit(condominiumId, alert.unitId, "alert:update", alert);
  if (alert.raisedBy) emitToUser(alert.raisedBy, "alert:update", alert);
  // Filial, quien la activó y los demás guardas (para que sepan que alguien ya la tomó); notify() quita repetidos
  const targets = [
    ...(alert.unitId ? await unitUserIds(condominiumId, alert.unitId) : []),
    ...(alert.raisedBy ? [alert.raisedBy] : []),
    ...(await staffUserIds(condominiumId))
  ];
  await notify(condominiumId, targets, { kind: "alert_update", title, body, data: { alertId: alert.id } }, actorId);
}

// ================================================================== Residente

export const residentAlertsRoutes = Router();
residentAlertsRoutes.use(requireRole("owner", "tenant", "admin"));

residentAlertsRoutes.post(
  "/alerts",
  handler(
    { body: z.object({ kind: z.enum(ALERT_KINDS), unitId: z.uuid().nullish(), notes: optText(500) }) },
    async ({ req, body }) => {
      const auth = authOf(req);
      const condominiumId = condominiumOf(req);
      const units = await residentUnitIds(auth.userId);
      if (body.unitId && !units.includes(body.unitId)) throw conflict("UNIT_FORBIDDEN", "Esa filial no está vinculada a su cuenta");
      const unitId = body.unitId ?? units[0] ?? null;

      // Doble toque o nervios: si ya tiene una alerta abierta reciente, se devuelve esa
      const open = await one<{ id: string }>(
        `SELECT id FROM alerts WHERE raised_by = $1 AND status <> 'attended' AND raised_at > NOW() - INTERVAL '30 minutes'
          ORDER BY raised_at DESC LIMIT 1`,
        [auth.userId]
      );
      if (open) return { id: open.id, duplicate: true };

      const row = await withTx(txCtx(req), (client) =>
        one<{ id: string }>(
          `INSERT INTO alerts (unit_id, kind, notes, raised_by) VALUES ($1, $2, $3, fn_current_app_user()) RETURNING id`,
          [unitId, body.kind, body.notes],
          client
        )
      );
      const alert = (await alertById(row!.id))!;

      emitToStaff(condominiumId, "alert:new", alert);
      if (unitId) emitToUnit(condominiumId, unitId, "alert:update", alert);
      const label = ALERT_LABEL[body.kind];
      await notify(condominiumId, await staffUserIds(condominiumId), {
        kind: "alert",
        title: `ALERTA: ${label}${where(alert)}`,
        body: [auth.names, body.notes].filter(Boolean).join(": "),
        data: { alertId: alert.id }
      });
      if (unitId) {
        await notify(
          condominiumId,
          await unitUserIds(condominiumId, unitId),
          { kind: "alert_update", title: `${auth.names} activó una alerta de ${label.toLowerCase()}`, body: "La caseta ya fue avisada", data: { alertId: alert.id } },
          auth.userId
        );
      }
      return { id: alert.id, duplicate: false };
    }
  )
);

residentAlertsRoutes.get(
  "/alerts",
  handler({}, async ({ req }) => {
    const { userId } = authOf(req);
    const units = await residentUnitIds(userId);
    const scope = `(al.raised_by = $1 OR al.unit_id = ANY ($2))`;
    const [open, recent] = await Promise.all([
      query(`SELECT ${ALERT_SELECT} ${ALERT_JOINS} WHERE ${scope} AND al.status <> 'attended' ORDER BY al.raised_at DESC`, [userId, units]),
      query(
        `SELECT ${ALERT_SELECT} ${ALERT_JOINS} WHERE ${scope} AND al.status = 'attended' ORDER BY al.raised_at DESC LIMIT 10`,
        [userId, units]
      )
    ]);
    return { open, recent };
  })
);

// ================================================================== Caseta

export const guardAlertsRoutes = Router();
guardAlertsRoutes.use(requireRole("guard", "admin"));

guardAlertsRoutes.get(
  "/alerts",
  handler({}, async () => {
    const [open, recent] = await Promise.all([
      query(`SELECT ${ALERT_SELECT} ${ALERT_JOINS} WHERE al.status <> 'attended' ORDER BY al.raised_at`),
      query(
        `SELECT ${ALERT_SELECT} ${ALERT_JOINS} WHERE al.status = 'attended' AND al.attended_at > NOW() - INTERVAL '24 hours'
          ORDER BY al.attended_at DESC LIMIT 30`
      )
    ]);
    return { open, recent };
  })
);

guardAlertsRoutes.post(
  "/alerts/:id/ack",
  handler({ params: idParams }, async ({ req, params }) => {
    const auth = authOf(req);
    const row = await withTx(txCtx(req), (client) =>
      one<{ id: string }>(
        `UPDATE alerts SET status = 'acknowledged', acknowledged_at = NOW(), acknowledged_by = fn_current_app_user()
          WHERE id = $1 AND status = 'active' RETURNING id`,
        [params.id],
        client
      )
    );
    const alert = await alertById(params.id);
    if (!alert) throw notFound("Alerta no encontrada");
    if (!row) {
      throw conflict(
        alert.status === "attended" ? "ALREADY_ATTENDED" : "ALREADY_ACKNOWLEDGED",
        alert.status === "attended" ? "La alerta ya fue atendida" : `${alert.acknowledgedByName ?? "Otro guarda"} ya la está atendiendo`
      );
    }
    await broadcastUpdate(condominiumOf(req), alert, `Un guarda va en camino${where(alert)}`, `${auth.names} atiende la alerta de ${ALERT_LABEL[alert.kind].toLowerCase()}`, auth.userId);
    return alert;
  })
);

/** Cierre de la alerta (caseta o panel): exige escribir qué pasó */
async function attend(req: Request, id: string, resolution: string) {
  const auth = authOf(req);
  const row = await withTx(txCtx(req), (client) =>
    one<{ id: string }>(
      `UPDATE alerts SET status = 'attended', attended_at = NOW(), attended_by = fn_current_app_user(), resolution = $2,
              acknowledged_at = COALESCE(acknowledged_at, NOW()), acknowledged_by = COALESCE(acknowledged_by, fn_current_app_user())
        WHERE id = $1 AND status <> 'attended' RETURNING id`,
      [id, resolution],
      client
    )
  );
  const alert = await alertById(id);
  if (!alert) throw notFound("Alerta no encontrada");
  if (!row) throw conflict("ALREADY_ATTENDED", "La alerta ya fue atendida");
  await broadcastUpdate(condominiumOf(req), alert, `Alerta atendida${where(alert)}`, resolution, auth.userId);
  return alert;
}

const attendBody = z.object({ resolution: z.string().trim().min(3, "Escriba qué se hizo").max(1000) });

guardAlertsRoutes.post(
  "/alerts/:id/attend",
  handler({ params: idParams, body: attendBody }, ({ req, params, body }) => attend(req, params.id, body.resolution))
);

// ================================================================== Panel

export const alertsRoutes = Router();
alertsRoutes.use(requirePermission("ALERTS", "access"));

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const filters = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  status: z.enum(["open", "active", "acknowledged", "attended"]).optional(),
  kind: z.enum(ALERT_KINDS).optional(),
  unitId: z.uuid().optional()
});

function alertWhere(f: z.infer<typeof filters>) {
  return {
    sql: `WHERE ($1::date IS NULL OR al.raised_at::date >= $1) AND ($2::date IS NULL OR al.raised_at::date <= $2)
            AND ($3::text IS NULL OR ($3 = 'open' AND al.status <> 'attended') OR al.status = $3)
            AND ($4::text IS NULL OR al.kind = $4) AND ($5::uuid IS NULL OR al.unit_id = $5)`,
    params: [f.from ?? null, f.to ?? null, f.status ?? null, f.kind ?? null, f.unitId ?? null]
  };
}

alertsRoutes.get(
  "/summary",
  handler({}, async () => {
    const row = await one(
      `SELECT COUNT(*) FILTER (WHERE status <> 'attended')::int AS open,
              COUNT(*) FILTER (WHERE status = 'active')::int AS unattended,
              COUNT(*) FILTER (WHERE raised_at::date = CURRENT_DATE)::int AS today,
              COUNT(*) FILTER (WHERE raised_at > NOW() - INTERVAL '30 days')::int AS last30,
              ROUND(AVG(EXTRACT(EPOCH FROM (acknowledged_at - raised_at))) FILTER (WHERE raised_at > NOW() - INTERVAL '30 days'))::int AS "avgAckSeconds",
              ROUND(AVG(EXTRACT(EPOCH FROM (attended_at - raised_at))) FILTER (WHERE raised_at > NOW() - INTERVAL '30 days'))::int AS "avgAttendSeconds"
         FROM alerts`
    );
    const byKind = await query(
      `SELECT kind, COUNT(*)::int AS n FROM alerts WHERE raised_at > NOW() - INTERVAL '30 days' GROUP BY kind ORDER BY n DESC`
    );
    return { ...row, byKind };
  })
);

alertsRoutes.get(
  "/",
  handler(
    { query: filters.extend({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(200).default(50) }) },
    async ({ query: f }) => {
      const w = alertWhere(f);
      const [rows, total] = await Promise.all([
        query(
          `SELECT ${ALERT_SELECT} ${ALERT_JOINS} ${w.sql}
            ORDER BY (al.status <> 'attended') DESC, al.raised_at DESC LIMIT ${f.pageSize} OFFSET ${(f.page - 1) * f.pageSize}`,
          w.params
        ),
        one<{ n: number }>(`SELECT COUNT(*)::int AS n FROM alerts al ${w.sql}`, w.params)
      ]);
      return { rows, total: total?.n ?? 0 };
    }
  )
);

const mmss = (s: number | null) => (s === null ? null : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`);

const ALERT_COLUMNS: ExportColumn<AlertRow>[] = [
  { header: "Activada", width: 16, value: (r) => r.raisedAt },
  { header: "Tipo", width: 18, value: (r) => ALERT_LABEL[r.kind] ?? r.kind },
  { header: "Filial", width: 10, value: (r) => r.unitCode },
  { header: "Activó", width: 22, value: (r) => r.raisedByName },
  { header: "Estado", width: 11, value: (r) => STATUS_LABEL[r.status] ?? r.status },
  { header: "Respuesta (min)", width: 12, value: (r) => mmss(r.ackSeconds) },
  { header: "Cierre (min)", width: 12, value: (r) => mmss(r.attendSeconds) },
  { header: "Atendió", width: 20, value: (r) => r.attendedByName ?? r.acknowledgedByName },
  { header: "Detalle", width: 24, value: (r) => r.notes },
  { header: "Resolución", width: 30, value: (r) => r.resolution }
];

alertsRoutes.get(
  "/export",
  requirePermission("ALERTS", "download"),
  handler({ query: filters.extend({ format: z.enum(["xlsx", "pdf"]).default("xlsx") }) }, async ({ query: f, req, res }) => {
    const w = alertWhere(f);
    const rows = await query<AlertRow>(`SELECT ${ALERT_SELECT} ${ALERT_JOINS} ${w.sql} ORDER BY al.raised_at DESC LIMIT 20000`, w.params);
    const condo = await one<{ name: string; brand_color: string | null; timezone: string }>(
      `SELECT name, brand_color, timezone FROM condominiums WHERE id = $1`,
      [condominiumOf(req)]
    );
    const period = f.from || f.to ? `del ${f.from ?? "inicio"} al ${f.to ?? "hoy"}` : "todo el historial";
    const spec = {
      title: "Alertas de pánico",
      subtitle: `Período: ${period} · ${rows.length} alerta(s)`,
      condominium: condo?.name ?? "DomusApp",
      color: condo?.brand_color ?? null,
      timezone: condo?.timezone ?? "UTC",
      columns: ALERT_COLUMNS,
      rows,
      fileBase: "Alertas"
    };
    if (f.format === "pdf") await sendPdf(res, spec);
    else await sendXlsx(res, spec);
    return undefined;
  })
);

alertsRoutes.post(
  "/:id/attend",
  requirePermission("ALERTS", "edit"),
  handler({ params: idParams, body: attendBody }, ({ req, params, body }) => attend(req, params.id, body.resolution))
);
