/**
 * @project DomusApp - API
 * @file src/modules/cases/admin.ts
 * @description Casos en el panel: bandeja, detalle con seguimiento, asignación, estados, notas internas y adjuntos
 *
 *  GET  /cases/summary             abiertos, en proceso, por confirmar, urgentes, vencidos, tiempo medio y calificación
 *  GET  /cases                     bandeja con filtros y paginación
 *  GET  /cases/export              Excel / PDF
 *  GET  /cases/supplier-options    proveedores para asignar
 *  GET  /cases/:id                 detalle con seguimiento y adjuntos (incluye internos)
 *  POST /cases                     registra un caso desde el panel
 *  PUT  /cases/:id                 clasificación, prioridad, responsable, proveedor y fecha compromiso
 *  POST /cases/:id/updates         respuesta, nota interna y/o cambio de estado
 *  POST /cases/:id/files           adjunto (foto o PDF, cuerpo crudo; ?internal=true)
 */

import { Router } from "express";
import { z } from "zod";
import { one, query, withTx } from "../../db.js";
import { sendPdf, sendXlsx, type ExportColumn } from "../../lib/exports.js";
import { badRequest, handler, idParams, pageQuery } from "../../lib/http.js";
import { requirePermission } from "../../security/authorize.js";
import { authOf, condominiumOf, txCtx } from "../../security/context.js";
import { optText } from "../access/shared.js";
import { rawUpload } from "../files/images.js";
import { condoMoney } from "../finance/shared.js";
import { supplierOptions } from "../suppliers/routes.js";
import {
  CASE_CATEGORIES,
  CASE_JOINS,
  CASE_PRIORITIES,
  CASE_STATUSES,
  CATEGORY_LABEL,
  PRIORITY_LABEL,
  STATUS_LABEL,
  addCaseComment,
  attachCaseFile,
  broadcastCase,
  caseById,
  caseNotFound,
  caseSelect,
  caseTimeline,
  createCase,
  notifyCase,
  setCaseStatus,
  type CaseRow
} from "./shared.js";

export const caseRoutes = Router();
caseRoutes.use(requirePermission("CASES", "access"));

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida (AAAA-MM-DD)");

caseRoutes.get(
  "/summary",
  handler({}, async () =>
    one(
      `SELECT COUNT(*) FILTER (WHERE status = 'open')::int AS open,
              COUNT(*) FILTER (WHERE status = 'in_progress')::int AS "inProgress",
              COUNT(*) FILTER (WHERE status = 'resolved')::int AS resolved,
              COUNT(*) FILTER (WHERE status IN ('open', 'in_progress') AND priority = 'urgent')::int AS urgent,
              COUNT(*) FILTER (WHERE status IN ('open', 'in_progress') AND due_on < CURRENT_DATE)::int AS overdue,
              ROUND(AVG(EXTRACT(EPOCH FROM resolved_at - created_at) / 3600)
                    FILTER (WHERE resolved_at > now() - interval '90 days'))::int AS "avgHours",
              ROUND(AVG(rating) FILTER (WHERE rating IS NOT NULL), 1)::float8 AS rating
         FROM cases`
    )
  )
);

const listQuery = pageQuery.extend({
  scope: z.enum(["active", "finished", "all"]).default("active"),
  status: z.enum(CASE_STATUSES).optional(),
  category: z.enum(CASE_CATEGORIES).optional(),
  priority: z.enum(CASE_PRIORITIES).optional(),
  unitId: z.uuid().optional(),
  search: z.string().trim().max(80).optional()
});

function listWhere(q: z.infer<typeof listQuery>) {
  const where: string[] = [];
  const params: unknown[] = [];
  const add = (sql: string, v: unknown) => {
    params.push(v);
    where.push(sql.replace("?", `$${params.length}`));
  };
  if (q.status) add(`c.status = ?`, q.status);
  else if (q.scope === "active") where.push(`c.status IN ('open', 'in_progress', 'resolved')`);
  else if (q.scope === "finished") where.push(`c.status IN ('closed', 'rejected')`);
  if (q.category) add(`c.category = ?`, q.category);
  if (q.priority) add(`c.priority = ?`, q.priority);
  if (q.unitId) add(`c.unit_id = ?`, q.unitId);
  if (q.search) {
    const n = q.search.replace(/^#/, "");
    if (/^\d{1,7}$/.test(n)) add(`c.number = ?`, Number(n));
    else add(`(c.title ILIKE ? OR c.description ILIKE $${params.length + 1} OR c.location ILIKE $${params.length + 1})`, `%${q.search}%`);
  }
  return { sql: where.length ? `WHERE ${where.join(" AND ")}` : "", params };
}

// Urgentes y vencidos primero; luego lo más reciente
const ORDER = `CASE WHEN c.status IN ('open', 'in_progress') THEN 0 ELSE 1 END,
  CASE c.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, c.created_at DESC`;

caseRoutes.get(
  "/",
  handler({ query: listQuery }, async ({ query: q }) => {
    const w = listWhere(q);
    const [rows, total] = await Promise.all([
      query<CaseRow>(
        `SELECT ${caseSelect(true)} ${CASE_JOINS} ${w.sql} ORDER BY ${ORDER} LIMIT ${q.pageSize} OFFSET ${(q.page - 1) * q.pageSize}`,
        w.params
      ),
      one<{ n: number }>(`SELECT COUNT(*)::int AS n FROM cases c ${w.sql}`, w.params)
    ]);
    return { rows, total: total?.n ?? 0 };
  })
);

caseRoutes.get(
  "/export",
  requirePermission("CASES", "download"),
  handler({ query: listQuery.extend({ format: z.enum(["xlsx", "pdf"]).default("xlsx") }) }, async ({ req, res, query: q }) => {
    const w = listWhere(q);
    const rows = await query<CaseRow>(`SELECT ${caseSelect(true)} ${CASE_JOINS} ${w.sql} ORDER BY c.number DESC LIMIT 5000`, w.params);
    const c = await condoMoney(condominiumOf(req));
    const columns: ExportColumn<CaseRow>[] = [
      { header: "Caso", width: 7, value: (r) => r.code },
      { header: "Fecha", width: 14, value: (r) => new Date(r.createdAt) },
      { header: "Tipo", width: 10, value: (r) => CATEGORY_LABEL[r.category] },
      { header: "Asunto", width: 28, value: (r) => r.title },
      { header: "Filial", width: 9, value: (r) => (r.isAnonymous ? "Anónimo" : r.unitCode ? `${r.unitTower ? `${r.unitTower} ` : ""}${r.unitCode}` : "") },
      { header: "Prioridad", width: 9, value: (r) => PRIORITY_LABEL[r.priority] },
      { header: "Estado", width: 10, value: (r) => STATUS_LABEL[r.status] },
      { header: "Responsable", width: 18, value: (r) => [r.assignee, r.supplierName].filter(Boolean).join(" · ") },
      { header: "Compromiso", width: 11, value: (r) => r.dueOn ?? "" },
      { header: "Resuelto", width: 14, value: (r) => (r.resolvedAt ? new Date(r.resolvedAt) : null) },
      { header: "Calificación", width: 8, value: (r) => r.rating ?? "" }
    ];
    const subtitle =
      [q.status ? STATUS_LABEL[q.status] : { active: "Activos", finished: "Cerrados y rechazados", all: "Todos" }[q.scope], q.category && CATEGORY_LABEL[q.category]]
        .filter(Boolean)
        .join(" · ");
    const spec = { title: "Casos", subtitle, condominium: c.name, color: c.color, timezone: c.timezone, columns, rows, fileBase: "casos" };
    await (q.format === "pdf" ? sendPdf(res, spec) : sendXlsx(res, spec));
  })
);

caseRoutes.get("/supplier-options", handler({}, () => supplierOptions()));

caseRoutes.get(
  "/:id",
  handler({ params: idParams }, async ({ params }) => {
    const c = await caseById(params.id, true);
    if (!c) throw caseNotFound();
    return { ...c, ...(await caseTimeline(c, true)) };
  })
);

const assignFields = {
  priority: z.enum(CASE_PRIORITIES),
  supplierId: z.uuid().nullish().transform((v) => v ?? null),
  assignee: optText(120),
  dueOn: isoDate.nullish().transform((v) => v || null)
};

caseRoutes.post(
  "/",
  requirePermission("CASES", "add_new"),
  handler(
    {
      body: z.object({
        category: z.enum(CASE_CATEGORIES),
        title: z.string().trim().min(4, "Escriba un asunto").max(120),
        description: z.string().trim().min(5, "Describa el caso").max(4000),
        location: optText(120),
        unitId: z.uuid().nullish().transform((v) => v ?? null),
        ...assignFields
      })
    },
    async ({ req, body }) => {
      const condominiumId = condominiumOf(req);
      const id = await withTx(txCtx(req), (client) => createCase(client, body, "panel"));
      await broadcastCase(condominiumId, id);
      return { ...(await caseById(id, true))!, updates: [], files: [] };
    }
  )
);

caseRoutes.put(
  "/:id",
  requirePermission("CASES", "edit"),
  handler(
    {
      params: idParams,
      body: z.object({
        category: z.enum(CASE_CATEGORIES),
        title: z.string().trim().min(4).max(120),
        location: optText(120),
        ...assignFields
      })
    },
    async ({ req, params, body }) => {
      const condominiumId = condominiumOf(req);
      const cur = await caseById(params.id, true);
      if (!cur) throw caseNotFound();
      if (cur.isAnonymous && body.category !== "report") throw badRequest("ANONYMOUS_ONLY_REPORT", "Una denuncia anónima no puede cambiar de tipo");
      await withTx(txCtx(req), (client) =>
        client.query(
          `UPDATE cases SET category = $2, title = $3, location = $4, priority = $5, supplier_id = $6, assignee = $7, due_on = $8 WHERE id = $1`,
          [params.id, body.category, body.title, body.location, body.priority, body.supplierId, body.assignee, body.dueOn]
        )
      );
      await broadcastCase(condominiumId, params.id);
      const c = (await caseById(params.id, true))!;
      return { ...c, ...(await caseTimeline(c, true)) };
    }
  )
);

caseRoutes.post(
  "/:id/updates",
  requirePermission("CASES", "edit"),
  handler(
    {
      params: idParams,
      body: z
        .object({
          body: optText(2000),
          status: z.enum(CASE_STATUSES).nullish(),
          internal: z.boolean().default(false)
        })
        .refine((b) => b.body || b.status, { message: "Escriba una respuesta o elija un estado", path: ["body"] })
        .refine((b) => b.status !== "rejected" || b.body, { message: "Explique por qué se rechaza", path: ["body"] })
        .refine((b) => !(b.internal && b.status), { message: "Una nota interna no cambia el estado", path: ["internal"] })
    },
    async ({ req, params, body }) => {
      const condominiumId = condominiumOf(req);
      const cur = await caseById(params.id, true);
      if (!cur) throw caseNotFound();
      await withTx(txCtx(req), async (client) => {
        if (body.status) await setCaseStatus(client, cur, body.status, "staff", body.body);
        else await addCaseComment(client, cur.id, "staff", body.body!, body.internal);
      });
      const c = (await caseById(params.id, true))!;
      await broadcastCase(condominiumId, c.id);
      if (!body.internal) await notifyCase(condominiumId, c, body.status ? "status" : "staff_comment", authOf(req).userId, body.body);
      return { ...c, ...(await caseTimeline(c, true)) };
    }
  )
);

caseRoutes.post(
  "/:id/files",
  requirePermission("CASES", "edit"),
  rawUpload,
  handler({ params: idParams, query: z.object({ internal: z.enum(["true", "false"]).default("false") }) }, async ({ req, params, query: q }) => {
    const condominiumId = condominiumOf(req);
    const cur = await caseById(params.id, true);
    if (!cur) throw caseNotFound();
    await attachCaseFile(req, condominiumId, cur, "staff", q.internal === "true");
    await broadcastCase(condominiumId, cur.id);
    const c = (await caseById(params.id, true))!;
    return { ...c, ...(await caseTimeline(c, true)) };
  })
);
