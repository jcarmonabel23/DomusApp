/**
 * @project DomusApp - API
 * @file src/modules/assemblies/routes.ts
 * @description Asambleas (convocatoria, celebración, acta) y seguimiento de acuerdos
 *
 *  GET    /assemblies/summary                 próxima asamblea y avance de acuerdos
 *  GET    /assemblies                         asambleas con conteo de acuerdos
 *  GET    /assemblies/agreements              todos los acuerdos (?status&overdue=true&search)
 *  GET    /assemblies/agreements/export       Excel / PDF de acuerdos
 *  GET    /assemblies/supplier-options        proveedores para asignar acuerdos
 *  GET    /assemblies/:id                     detalle con acuerdos y acta
 *  POST   /assemblies                         convoca (?notify avisa a los residentes)
 *  PUT    /assemblies/:id                     edita la convocatoria o el resultado
 *  POST   /assemblies/:id/held                registra la celebración (asistencia, quórum y resumen)
 *  POST   /assemblies/:id/cancel              cancela con motivo (avisa a los residentes)
 *  PUT    /assemblies/:id/minutes             acta (PDF o imagen, cuerpo crudo)
 *  DELETE /assemblies/:id                     borra una convocatoria sin acuerdos
 *  POST   /assemblies/:id/agreements          agrega un acuerdo (número correlativo)
 *  PUT    /assemblies/agreements/:id          edita / actualiza el avance
 *  DELETE /assemblies/agreements/:id          lo quita
 */

import { Router } from "express";
import { z } from "zod";
import { one, query, withTx } from "../../db.js";
import { sendPdf, sendXlsx, type ExportColumn } from "../../lib/exports.js";
import { conflict, handler, idParams, notFound } from "../../lib/http.js";
import { emitToStaff } from "../../lib/realtime.js";
import { requirePermission } from "../../security/authorize.js";
import { authOf, condominiumOf, txCtx } from "../../security/context.js";
import { optText } from "../access/shared.js";
import { fileKey, fileUrls, rawUpload, removeStored, replaceImage } from "../files/images.js";
import { condoMoney } from "../finance/shared.js";
import { audienceUserIds, notify } from "../notifications/service.js";
import { supplierOptions } from "../suppliers/routes.js";

export const assemblyRoutes = Router();
assemblyRoutes.use(requirePermission("ASSEMBLIES", "access"));

export const AGREEMENT_STATUS_LABEL = { pending: "Pendiente", in_progress: "En proceso", done: "Cumplido", cancelled: "Anulado" } as const;
export const ASSEMBLY_KIND_LABEL = { ordinary: "Ordinaria", extraordinary: "Extraordinaria" } as const;
const AGREEMENT_STATUSES = ["pending", "in_progress", "done", "cancelled"] as const;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida (AAAA-MM-DD)");

/** Columnas de una asamblea (alias a, acta f) */
export const ASSEMBLY_SELECT = `a.id, a.title, a.kind, a.scheduled_at AS "scheduledAt", to_char(a.scheduled_at, 'YYYY-MM-DD') AS date,
  to_char(a.scheduled_at, 'HH24:MI') AS time, a.location, a.meeting_url AS "meetingUrl", a.agenda, a.status,
  a.attendance_units AS "attendanceUnits", a.quorum_reached AS "quorumReached", a.summary, a.cancel_reason AS "cancelReason",
  (SELECT COUNT(*)::int FROM units WHERE is_active) AS "totalUnits",
  (SELECT COUNT(*)::int FROM assembly_agreements g WHERE g.assembly_id = a.id AND g.status <> 'cancelled') AS agreements,
  (SELECT COUNT(*)::int FROM assembly_agreements g WHERE g.assembly_id = a.id AND g.status = 'done') AS "agreementsDone",
  f.storage_key AS "minutesKey", f.mime_type AS "minutesMime"`;
export const ASSEMBLY_JOINS = `FROM assemblies a LEFT JOIN files f ON f.id = a.minutes_file_id`;

/** Columnas de un acuerdo (alias g, asamblea a, proveedor s) */
export const AGREEMENT_SELECT = `g.id, g.assembly_id AS "assemblyId", a.title AS "assemblyTitle", to_char(a.scheduled_at, 'YYYY-MM-DD') AS "assemblyDate",
  g.number, g.title, g.description, g.responsible, g.supplier_id AS "supplierId", s.name AS "supplierName",
  to_char(g.due_on, 'YYYY-MM-DD') AS "dueOn", g.status, g.progress_notes AS "progressNotes", g.completed_at AS "completedAt",
  (g.due_on < CURRENT_DATE AND g.status IN ('pending', 'in_progress')) AS overdue, g.updated_at AS "updatedAt"`;
export const AGREEMENT_JOINS = `FROM assembly_agreements g JOIN assemblies a ON a.id = g.assembly_id LEFT JOIN suppliers s ON s.id = g.supplier_id`;

type AssemblyRow = Record<string, unknown> & { minutesKey: string | null; minutesMime: string | null; title: string };

export const withMinutes = ({ minutesKey, minutesMime, ...a }: AssemblyRow) => ({ ...a, minutes: fileUrls(minutesKey, minutesMime, `Acta ${a.title}`) });

async function assemblyDetail(id: string) {
  const a = await one<AssemblyRow>(`SELECT ${ASSEMBLY_SELECT} ${ASSEMBLY_JOINS} WHERE a.id = $1`, [id]);
  if (!a) return null;
  const agreements = await query(`SELECT ${AGREEMENT_SELECT} ${AGREEMENT_JOINS} WHERE g.assembly_id = $1 ORDER BY g.number`, [id]);
  return { ...withMinutes(a), agreements };
}

const notFoundA = () => notFound("Asamblea no encontrada");

const changed = (condominiumId: string) => emitToStaff(condominiumId, "assemblies:update", {});

const fmtWhen = (date: string, time: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)} ${time}`;

async function notifyResidents(condominiumId: string, actorId: string, title: string, body: string, assemblyId: string) {
  await notify(condominiumId, await audienceUserIds(condominiumId, "residents"), { kind: "assembly", title, body, data: { assemblyId } }, actorId);
}

// ------------------------------------------------------------------ Resumen y listados

assemblyRoutes.get(
  "/summary",
  handler({}, async () => {
    const [next, ag] = await Promise.all([
      one(`SELECT ${ASSEMBLY_SELECT} ${ASSEMBLY_JOINS} WHERE a.status = 'scheduled' AND a.scheduled_at > now() - interval '6 hours'
            ORDER BY a.scheduled_at LIMIT 1`).then((r) => (r ? withMinutes(r as AssemblyRow) : null)),
      one(
        `SELECT COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
                COUNT(*) FILTER (WHERE status = 'in_progress')::int AS "inProgress",
                COUNT(*) FILTER (WHERE status = 'done')::int AS done,
                COUNT(*) FILTER (WHERE status IN ('pending', 'in_progress') AND due_on < CURRENT_DATE)::int AS overdue
           FROM assembly_agreements`
      )
    ]);
    return { next, agreements: ag };
  })
);

assemblyRoutes.get(
  "/",
  handler({}, async () => {
    const rows = await query<AssemblyRow>(`SELECT ${ASSEMBLY_SELECT} ${ASSEMBLY_JOINS} ORDER BY a.scheduled_at DESC LIMIT 300`);
    return rows.map(withMinutes);
  })
);

const agreementsQuery = z.object({
  status: z.enum(AGREEMENT_STATUSES).optional(),
  scope: z.enum(["open", "all"]).default("open"),
  overdue: z.enum(["true", "false"]).optional(),
  search: z.string().trim().max(80).optional()
});

function agreementsWhere(q: z.infer<typeof agreementsQuery>) {
  const where: string[] = [];
  const params: unknown[] = [];
  if (q.status) {
    params.push(q.status);
    where.push(`g.status = $${params.length}`);
  } else if (q.scope === "open") where.push(`g.status IN ('pending', 'in_progress')`);
  if (q.overdue === "true") where.push(`g.due_on < CURRENT_DATE AND g.status IN ('pending', 'in_progress')`);
  if (q.search) {
    params.push(`%${q.search}%`);
    where.push(`(g.title ILIKE $${params.length} OR g.responsible ILIKE $${params.length} OR a.title ILIKE $${params.length})`);
  }
  return { sql: where.length ? `WHERE ${where.join(" AND ")}` : "", params };
}

const AGREEMENT_ORDER = `CASE WHEN g.status IN ('pending', 'in_progress') THEN 0 ELSE 1 END, g.due_on NULLS LAST, a.scheduled_at DESC, g.number`;

assemblyRoutes.get(
  "/agreements",
  handler({ query: agreementsQuery }, async ({ query: q }) => {
    const w = agreementsWhere(q);
    return query(`SELECT ${AGREEMENT_SELECT} ${AGREEMENT_JOINS} ${w.sql} ORDER BY ${AGREEMENT_ORDER} LIMIT 500`, w.params);
  })
);

assemblyRoutes.get(
  "/agreements/export",
  requirePermission("ASSEMBLIES", "download"),
  handler({ query: agreementsQuery.extend({ format: z.enum(["xlsx", "pdf"]).default("xlsx") }) }, async ({ req, res, query: q }) => {
    const w = agreementsWhere(q);
    type Row = { assemblyDate: string; assemblyTitle: string; number: number; title: string; responsible: string | null; supplierName: string | null; dueOn: string | null; status: keyof typeof AGREEMENT_STATUS_LABEL; progressNotes: string | null };
    const rows = await query<Row>(`SELECT ${AGREEMENT_SELECT} ${AGREEMENT_JOINS} ${w.sql} ORDER BY ${AGREEMENT_ORDER}`, w.params);
    const c = await condoMoney(condominiumOf(req));
    const columns: ExportColumn<Row>[] = [
      { header: "Asamblea", width: 22, value: (r) => `${r.assemblyDate} · ${r.assemblyTitle}` },
      { header: "N.º", width: 5, value: (r) => r.number },
      { header: "Acuerdo", width: 30, value: (r) => r.title },
      { header: "Responsable", width: 18, value: (r) => [r.responsible, r.supplierName].filter(Boolean).join(" · ") },
      { header: "Fecha límite", width: 11, value: (r) => r.dueOn ?? "" },
      { header: "Estado", width: 10, value: (r) => AGREEMENT_STATUS_LABEL[r.status] },
      { header: "Avance", width: 30, value: (r) => r.progressNotes ?? "" }
    ];
    const spec = { title: "Seguimiento de acuerdos", subtitle: q.status ? AGREEMENT_STATUS_LABEL[q.status] : q.scope === "open" ? "Pendientes y en proceso" : "Todos", condominium: c.name, color: c.color, timezone: c.timezone, columns, rows, fileBase: "acuerdos" };
    await (q.format === "pdf" ? sendPdf(res, spec) : sendXlsx(res, spec));
  })
);

assemblyRoutes.get("/supplier-options", handler({}, () => supplierOptions()));

assemblyRoutes.get(
  "/:id",
  handler({ params: idParams }, async ({ params }) => {
    const a = await assemblyDetail(params.id);
    if (!a) throw notFoundA();
    return a;
  })
);

// ------------------------------------------------------------------ Convocatoria y celebración

const assemblyBody = z.object({
  title: z.string().trim().min(4, "Escriba el título").max(160),
  kind: z.enum(["ordinary", "extraordinary"]),
  date: isoDate,
  time: z.string().regex(/^\d{2}:\d{2}$/, "Hora inválida"),
  location: optText(200),
  meetingUrl: z
    .union([z.url("Enlace inválido").max(300), z.literal("")])
    .nullish()
    .transform((v) => v || null),
  agenda: optText(4000)
});

assemblyRoutes.post(
  "/",
  requirePermission("ASSEMBLIES", "add_new"),
  handler({ body: assemblyBody, query: z.object({ notify: z.enum(["true", "false"]).default("true") }) }, async ({ req, body, query: q }) => {
    const condominiumId = condominiumOf(req);
    const row = await withTx(txCtx(req), (client) =>
      one<{ id: string }>(
        `INSERT INTO assemblies (title, kind, scheduled_at, location, meeting_url, agenda, created_by)
         VALUES ($1, $2, ($3::text || ' ' || $4::text)::timestamp, $5, $6, $7, fn_current_app_user()) RETURNING id`,
        [body.title, body.kind, body.date, body.time, body.location, body.meetingUrl, body.agenda],
        client
      )
    );
    changed(condominiumId);
    if (q.notify === "true") {
      await notifyResidents(
        condominiumId,
        authOf(req).userId,
        `Convocatoria: asamblea ${ASSEMBLY_KIND_LABEL[body.kind].toLowerCase()}`,
        `${body.title} · ${fmtWhen(body.date, body.time)}${body.location ? ` · ${body.location}` : ""}`,
        row!.id
      );
    }
    return assemblyDetail(row!.id);
  })
);

assemblyRoutes.put(
  "/:id",
  requirePermission("ASSEMBLIES", "edit"),
  handler(
    {
      params: idParams,
      body: assemblyBody.extend({
        attendanceUnits: z.coerce.number().int().min(0).max(10000).nullish(),
        quorumReached: z.boolean().nullish(),
        summary: optText(4000)
      })
    },
    async ({ req, params, body }) => {
      const row = await withTx(txCtx(req), (client) =>
        one<{ id: string }>(
          `UPDATE assemblies SET title = $2, kind = $3, scheduled_at = ($4::text || ' ' || $5::text)::timestamp, location = $6, meeting_url = $7,
                  agenda = $8, attendance_units = $9, quorum_reached = $10, summary = $11, updated_by = fn_current_app_user()
            WHERE id = $1 RETURNING id`,
          [params.id, body.title, body.kind, body.date, body.time, body.location, body.meetingUrl, body.agenda, body.attendanceUnits ?? null, body.quorumReached ?? null, body.summary],
          client
        )
      );
      if (!row) throw notFoundA();
      changed(condominiumOf(req));
      return assemblyDetail(params.id);
    }
  )
);

assemblyRoutes.post(
  "/:id/held",
  requirePermission("ASSEMBLIES", "edit"),
  handler(
    {
      params: idParams,
      body: z.object({
        attendanceUnits: z.coerce.number().int().min(0).max(10000),
        quorumReached: z.boolean(),
        summary: optText(4000)
      })
    },
    async ({ req, params, body }) => {
      const row = await withTx(txCtx(req), (client) =>
        one<{ id: string }>(
          `UPDATE assemblies SET status = 'held', attendance_units = $2, quorum_reached = $3, summary = COALESCE($4, summary),
                  updated_by = fn_current_app_user()
            WHERE id = $1 AND status = 'scheduled' AND scheduled_at <= now() + interval '1 day' RETURNING id`,
          [params.id, body.attendanceUnits, body.quorumReached, body.summary],
          client
        )
      );
      if (!row) throw conflict("NOT_SCHEDULED", "Solo se registra una asamblea convocada que ya llegó a su fecha");
      changed(condominiumOf(req));
      return assemblyDetail(params.id);
    }
  )
);

assemblyRoutes.post(
  "/:id/cancel",
  requirePermission("ASSEMBLIES", "edit"),
  handler({ params: idParams, body: z.object({ reason: z.string().trim().min(3, "Escriba el motivo").max(300) }) }, async ({ req, params, body }) => {
    const condominiumId = condominiumOf(req);
    const row = await withTx(txCtx(req), (client) =>
      one<{ id: string; title: string }>(
        `UPDATE assemblies SET status = 'cancelled', cancel_reason = $2, updated_by = fn_current_app_user()
          WHERE id = $1 AND status = 'scheduled' RETURNING id, title`,
        [params.id, body.reason],
        client
      )
    );
    if (!row) throw conflict("NOT_SCHEDULED", "La asamblea ya se celebró o ya estaba cancelada");
    changed(condominiumId);
    if ((await one<{ future: boolean }>(`SELECT scheduled_at > now() AS future FROM assemblies WHERE id = $1`, [params.id]))?.future) {
      await notifyResidents(condominiumId, authOf(req).userId, "Asamblea cancelada", `${row.title} · ${body.reason}`, params.id);
    }
    return assemblyDetail(params.id);
  })
);

assemblyRoutes.put(
  "/:id/minutes",
  requirePermission("ASSEMBLIES", "edit"),
  rawUpload,
  handler({ params: idParams, query: z.object({ notify: z.enum(["true", "false"]).default("false") }) }, async ({ req, params, query: q }) => {
    const condominiumId = condominiumOf(req);
    const a = await one<{ title: string }>(`SELECT title FROM assemblies WHERE id = $1`, [params.id]);
    if (!a) throw notFoundA();
    await replaceImage({
      req,
      condominiumId,
      profile: "receipt",
      purpose: "assembly_minutes",
      allowPdf: true,
      withTx: (fn) => withTx(txCtx(req), fn),
      attach: async (client, fileId) => {
        const prev = await one<{ prev: string | null }>(
          `UPDATE assemblies x SET minutes_file_id = $2 FROM (SELECT minutes_file_id AS prev FROM assemblies WHERE id = $1) old
            WHERE x.id = $1 RETURNING old.prev`,
          [params.id, fileId],
          client
        );
        return prev?.prev ?? null;
      }
    });
    changed(condominiumId);
    if (q.notify === "true") await notifyResidents(condominiumId, authOf(req).userId, "Acta disponible", a.title, params.id);
    return assemblyDetail(params.id);
  })
);

assemblyRoutes.delete(
  "/:id",
  requirePermission("ASSEMBLIES", "delete"),
  handler({ params: idParams }, async ({ req, params }) => {
    const condominiumId = condominiumOf(req);
    const row = await withTx(txCtx(req), async (client) => {
      const has = await one(`SELECT 1 FROM assembly_agreements WHERE assembly_id = $1 LIMIT 1`, [params.id], client);
      if (has) throw conflict("HAS_AGREEMENTS", "La asamblea tiene acuerdos registrados; cancélela en lugar de borrarla");
      const r = await one<{ minutes_file_id: string | null }>(`DELETE FROM assemblies WHERE id = $1 RETURNING minutes_file_id`, [params.id], client);
      if (!r) throw notFoundA();
      if (r.minutes_file_id) await client.query(`DELETE FROM files WHERE id = $1`, [r.minutes_file_id]);
      return r;
    });
    await removeStored(fileKey(condominiumId, row.minutes_file_id));
    changed(condominiumId);
    return { ok: true };
  })
);

// ------------------------------------------------------------------ Acuerdos

const agreementBody = z.object({
  title: z.string().trim().min(4, "Escriba el acuerdo").max(200),
  description: optText(2000),
  responsible: optText(120),
  supplierId: z.uuid().nullish().transform((v) => v ?? null),
  dueOn: isoDate.nullish().transform((v) => v || null),
  status: z.enum(AGREEMENT_STATUSES).default("pending"),
  progressNotes: optText(1000)
});

const agreementValues = (b: z.infer<typeof agreementBody>) => [b.title, b.description, b.responsible, b.supplierId, b.dueOn, b.status, b.progressNotes];

assemblyRoutes.post(
  "/:id/agreements",
  requirePermission("ASSEMBLIES", "edit"),
  handler({ params: idParams, body: agreementBody }, async ({ req, params, body }) => {
    await withTx(txCtx(req), async (client) => {
      const a = await one<{ status: string }>(`SELECT status FROM assemblies WHERE id = $1 FOR UPDATE`, [params.id], client);
      if (!a) throw notFoundA();
      if (a.status === "cancelled") throw conflict("CANCELLED", "La asamblea está cancelada");
      await client.query(
        `INSERT INTO assembly_agreements (assembly_id, number, title, description, responsible, supplier_id, due_on, status, progress_notes, completed_at)
         VALUES ($1, (SELECT COALESCE(MAX(number), 0) + 1 FROM assembly_agreements WHERE assembly_id = $1), $2, $3, $4, $5, $6, $7::varchar, $8,
                 CASE WHEN $7::varchar = 'done' THEN now() END)`,
        [params.id, ...agreementValues(body)]
      );
    });
    changed(condominiumOf(req));
    return assemblyDetail(params.id);
  })
);

assemblyRoutes.put(
  "/agreements/:id",
  requirePermission("ASSEMBLIES", "edit"),
  handler({ params: idParams, body: agreementBody }, async ({ req, params, body }) => {
    const row = await withTx(txCtx(req), (client) =>
      one<{ assembly_id: string }>(
        `UPDATE assembly_agreements SET title = $2, description = $3, responsible = $4, supplier_id = $5, due_on = $6, status = $7::varchar,
                progress_notes = $8, completed_at = CASE WHEN $7::varchar = 'done' THEN COALESCE(completed_at, now()) END
          WHERE id = $1 RETURNING assembly_id`,
        [params.id, ...agreementValues(body)],
        client
      )
    );
    if (!row) throw notFound("Acuerdo no encontrado");
    changed(condominiumOf(req));
    return assemblyDetail(row.assembly_id);
  })
);

assemblyRoutes.delete(
  "/agreements/:id",
  requirePermission("ASSEMBLIES", "delete"),
  handler({ params: idParams }, async ({ req, params }) => {
    const row = await withTx(txCtx(req), (client) =>
      one<{ assembly_id: string }>(`DELETE FROM assembly_agreements WHERE id = $1 RETURNING assembly_id`, [params.id], client)
    );
    if (!row) throw notFound("Acuerdo no encontrado");
    changed(condominiumOf(req));
    return assemblyDetail(row.assembly_id);
  })
);
