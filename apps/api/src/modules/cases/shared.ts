/**
 * @project DomusApp - API
 * @file src/modules/cases/shared.ts
 * @description Casos (daños, mejoras, quejas, sugerencias y denuncias): consultas, alta, seguimiento,
 *              adjuntos y avisos, compartidos por el panel y la app.
 *
 * Visibilidad:
 *  - La administración ve todos; en una denuncia anónima nunca ve quién la hizo.
 *  - En la app, cada cuenta ve los casos que reportó y los de sus filiales (salvo anónimos de otros).
 *  - Las notas y los adjuntos internos solo los ve la administración.
 */

import type { Request } from "express";
import type pg from "pg";
import { one, query, withTx } from "../../db.js";
import { badRequest, conflict, notFound } from "../../lib/http.js";
import { emitToStaff, emitToUser } from "../../lib/realtime.js";
import { txCtx } from "../../security/context.js";
import { fileUrls, replaceImage } from "../files/images.js";
import { adminUserIds, notify, unitUserIds } from "../notifications/service.js";

export const CASE_CATEGORIES = ["damage", "improvement", "complaint", "suggestion", "report"] as const;
export const CASE_STATUSES = ["open", "in_progress", "resolved", "closed", "rejected"] as const;
export const CASE_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type CaseCategory = (typeof CASE_CATEGORIES)[number];
export type CaseStatus = (typeof CASE_STATUSES)[number];
export type CasePriority = (typeof CASE_PRIORITIES)[number];

export const CATEGORY_LABEL: Record<CaseCategory, string> = {
  damage: "Daño",
  improvement: "Mejora",
  complaint: "Queja",
  suggestion: "Sugerencia",
  report: "Denuncia"
};
export const STATUS_LABEL: Record<CaseStatus, string> = {
  open: "Abierto",
  in_progress: "En proceso",
  resolved: "Resuelto",
  closed: "Cerrado",
  rejected: "Rechazado"
};
export const PRIORITY_LABEL: Record<CasePriority, string> = { low: "Baja", normal: "Normal", high: "Alta", urgent: "Urgente" };

/** Adjuntos por caso (fotos o PDF) */
export const MAX_CASE_FILES = 12;

export const caseCode = (n: number) => `#${String(n).padStart(4, "0")}`;

export interface CaseRow {
  id: string;
  number: number;
  code: string;
  category: CaseCategory;
  title: string;
  description: string;
  location: string | null;
  unitId: string | null;
  unitCode: string | null;
  unitTower: string | null;
  priority: CasePriority;
  status: CaseStatus;
  isAnonymous: boolean;
  source: "app" | "panel";
  reportedById: string | null;
  reportedByName: string | null;
  supplierId: string | null;
  supplierName: string | null;
  assignee: string | null;
  dueOn: string | null;
  overdue: boolean;
  resolvedAt: string | null;
  closedAt: string | null;
  rating: number | null;
  ratingComment: string | null;
  updates: number;
  files: number;
  lastActivityAt: string;
  createdAt: string;
}

/** Columnas de un caso (alias c). `staff` oculta a quien reportó una denuncia anónima */
export function caseSelect(staff: boolean): string {
  const reporter = staff ? `CASE WHEN c.is_anonymous THEN NULL ELSE c.reported_by END` : `c.reported_by`;
  const reporterName = staff ? `CASE WHEN c.is_anonymous THEN NULL ELSE ru.names END` : `ru.names`;
  const internal = staff ? "" : "AND NOT x.is_internal";
  return `c.id, c.number, '#' || lpad(c.number::text, 4, '0') AS code, c.category, c.title, c.description, c.location,
    c.unit_id AS "unitId", u.code AS "unitCode", u.tower AS "unitTower", c.priority, c.status, c.is_anonymous AS "isAnonymous",
    c.source, ${reporter} AS "reportedById", ${reporterName} AS "reportedByName",
    c.supplier_id AS "supplierId", s.name AS "supplierName", c.assignee, to_char(c.due_on, 'YYYY-MM-DD') AS "dueOn",
    (c.due_on < CURRENT_DATE AND c.status IN ('open', 'in_progress')) AS overdue,
    c.resolved_at AS "resolvedAt", c.closed_at AS "closedAt", c.rating, c.rating_comment AS "ratingComment",
    (SELECT COUNT(*)::int FROM case_updates x WHERE x.case_id = c.id AND x.body IS NOT NULL ${internal}) AS updates,
    (SELECT COUNT(*)::int FROM case_files x WHERE x.case_id = c.id ${internal}) AS files,
    GREATEST(c.updated_at, (SELECT MAX(x.created_at) FROM case_updates x WHERE x.case_id = c.id ${internal})) AS "lastActivityAt",
    c.created_at AS "createdAt"`;
}

export const CASE_JOINS = `FROM cases c
  LEFT JOIN units u ON u.id = c.unit_id
  LEFT JOIN users ru ON ru.id = c.reported_by
  LEFT JOIN suppliers s ON s.id = c.supplier_id`;

export const caseNotFound = () => notFound("Caso no encontrado");

export async function caseById(id: string, staff: boolean, client?: pg.PoolClient): Promise<CaseRow | null> {
  return one<CaseRow>(`SELECT ${caseSelect(staff)} ${CASE_JOINS} WHERE c.id = $1`, [id], client);
}

export interface CaseUpdate {
  id: string;
  side: "resident" | "staff";
  body: string | null;
  statusFrom: CaseStatus | null;
  statusTo: CaseStatus | null;
  isInternal: boolean;
  authorName: string | null;
  createdAt: string;
}

/** Línea de tiempo y adjuntos de un caso */
export async function caseTimeline(c: CaseRow, staff: boolean) {
  const internal = staff ? "" : "AND NOT x.is_internal";
  // En una denuncia anónima la administración ve "Residente" en lugar del nombre
  const author = staff && c.isAnonymous ? `CASE WHEN x.side = 'resident' THEN NULL ELSE au.names END` : `au.names`;
  const [updates, files] = await Promise.all([
    query<CaseUpdate>(
      `SELECT x.id, x.side, x.body, x.status_from AS "statusFrom", x.status_to AS "statusTo", x.is_internal AS "isInternal",
              ${author} AS "authorName", x.created_at AS "createdAt"
         FROM case_updates x LEFT JOIN users au ON au.id = x.author_id
        WHERE x.case_id = $1 ${internal} ORDER BY x.created_at, x.id`,
      [c.id]
    ),
    query<{ id: string; updateId: string | null; side: string; isInternal: boolean; key: string; mime: string; name: string | null; createdAt: string }>(
      `SELECT x.id, x.update_id AS "updateId", x.side, x.is_internal AS "isInternal", f.storage_key AS key, f.mime_type AS mime,
              f.original_name AS name, x.created_at AS "createdAt"
         FROM case_files x JOIN files f ON f.id = x.file_id
        WHERE x.case_id = $1 ${internal} ORDER BY x.created_at`,
      [c.id]
    )
  ]);
  return {
    updates,
    files: files.map(({ key, mime, ...f }) => ({ ...f, ...fileUrls(key, mime, f.name ?? `${c.code} adjunto`)! }))
  };
}

// ------------------------------------------------------------------ Alta y seguimiento

export interface NewCase {
  category: CaseCategory;
  title: string;
  description: string;
  location: string | null;
  unitId: string | null;
  priority?: CasePriority;
  anonymous?: boolean;
  supplierId?: string | null;
  assignee?: string | null;
  dueOn?: string | null;
}

/** Crea el caso con el siguiente correlativo del condominio (bloqueo por condominio) */
export async function createCase(client: pg.PoolClient, input: NewCase, source: "app" | "panel"): Promise<string> {
  const anonymous = Boolean(input.anonymous);
  if (anonymous && input.category !== "report") throw badRequest("ANONYMOUS_ONLY_REPORT", "Solo las denuncias pueden ser anónimas");
  await client.query(`SELECT pg_advisory_xact_lock(hashtext('cases:' || fn_current_condominium()::text))`);
  const row = await one<{ id: string }>(
    `INSERT INTO cases (number, category, title, description, location, unit_id, priority, is_anonymous, source, reported_by,
                        supplier_id, assignee, due_on)
     VALUES ((SELECT COALESCE(MAX(number), 0) + 1 FROM cases), $1, $2, $3, $4, $5, $6, $7, $8, fn_current_app_user(), $9, $10, $11)
     RETURNING id`,
    [
      input.category,
      input.title,
      input.description,
      input.location,
      anonymous ? null : input.unitId,
      input.priority ?? "normal",
      anonymous,
      source,
      input.supplierId ?? null,
      input.assignee ?? null,
      input.dueOn ?? null
    ],
    client
  );
  return row!.id;
}

/** Cambia el estado (y deja constancia en el seguimiento). Devuelve el estado anterior */
export async function setCaseStatus(
  client: pg.PoolClient,
  c: CaseRow,
  to: CaseStatus,
  side: "resident" | "staff",
  body: string | null,
  internal = false
): Promise<void> {
  if (c.status === to) throw conflict("SAME_STATUS", `El caso ya está ${STATUS_LABEL[to].toLowerCase()}`);
  if (c.status === "closed") throw conflict("CASE_CLOSED", "El caso está cerrado");
  await client.query(
    `UPDATE cases SET status = $2::varchar,
            resolved_at = CASE WHEN $2::varchar = 'resolved' THEN now() WHEN $2::varchar IN ('open', 'in_progress') THEN NULL ELSE resolved_at END,
            closed_at = CASE WHEN $2::varchar IN ('closed', 'rejected') THEN now() ELSE NULL END
      WHERE id = $1`,
    [c.id, to]
  );
  await client.query(
    `INSERT INTO case_updates (case_id, author_id, side, body, status_from, status_to, is_internal)
     VALUES ($1, fn_current_app_user(), $2, $3, $4, $5, $6)`,
    [c.id, side, body, c.status, to, internal]
  );
}

export async function addCaseComment(client: pg.PoolClient, caseId: string, side: "resident" | "staff", body: string, internal = false) {
  const row = await one<{ id: string }>(
    `INSERT INTO case_updates (case_id, author_id, side, body, is_internal) VALUES ($1, fn_current_app_user(), $2, $3, $4) RETURNING id`,
    [caseId, side, body, internal],
    client
  );
  await client.query(`UPDATE cases SET updated_at = now() WHERE id = $1`, [caseId]);
  return row!.id;
}

/** Adjunta una foto o PDF (cuerpo crudo) al caso */
export async function attachCaseFile(req: Request, condominiumId: string, c: CaseRow, side: "resident" | "staff", internal: boolean) {
  const n = await one<{ n: number }>(`SELECT COUNT(*)::int AS n FROM case_files WHERE case_id = $1`, [c.id]);
  if ((n?.n ?? 0) >= MAX_CASE_FILES) throw conflict("TOO_MANY_FILES", `Un caso admite hasta ${MAX_CASE_FILES} adjuntos`);
  await replaceImage({
    req,
    condominiumId,
    profile: "receipt",
    purpose: "case_attachment",
    allowPdf: true,
    withTx: (fn) => withTx(txCtx(req), fn),
    attach: async (client, fileId) => {
      await client.query(`INSERT INTO case_files (case_id, file_id, side, is_internal) VALUES ($1, $2, $3, $4)`, [c.id, fileId, side, internal]);
      await client.query(`UPDATE cases SET updated_at = now() WHERE id = $1`, [c.id]);
      return null;
    }
  });
}

// ------------------------------------------------------------------ Avisos y tiempo real

/** Cuentas que siguen el caso en la app: quien lo reportó y, si no es anónimo, su filial */
async function followers(condominiumId: string, caseId: string): Promise<string[]> {
  const row = await one<{ reported_by: string | null; unit_id: string | null; is_anonymous: boolean }>(
    `SELECT reported_by, unit_id, is_anonymous FROM cases WHERE id = $1`,
    [caseId]
  );
  if (!row) return [];
  const ids = new Set<string>();
  if (row.reported_by) ids.add(row.reported_by);
  if (row.unit_id && !row.is_anonymous) for (const id of await unitUserIds(condominiumId, row.unit_id)) ids.add(id);
  return [...ids];
}

export async function broadcastCase(condominiumId: string, caseId: string): Promise<void> {
  emitToStaff(condominiumId, "cases:update", { id: caseId });
  for (const id of await followers(condominiumId, caseId)) emitToUser(id, "cases:update", { id: caseId });
}

export type CaseEvent = "created" | "resident_comment" | "staff_comment" | "status" | "reopened" | "closed_by_resident";

export async function notifyCase(condominiumId: string, c: CaseRow, event: CaseEvent, actorId: string, text?: string | null): Promise<void> {
  const data = { caseId: c.id };
  const label = `${CATEGORY_LABEL[c.category]} ${c.code}`;
  if (event === "created" || event === "resident_comment" || event === "reopened" || event === "closed_by_resident") {
    const title = {
      created: `Nuevo caso: ${label}`,
      resident_comment: `Respuesta en ${label}`,
      reopened: `Reabierto: ${label}`,
      closed_by_resident: `Cerrado por el residente: ${label}`
    }[event];
    const who = c.isAnonymous ? "Anónimo" : c.unitCode ? `Filial ${c.unitTower ? `${c.unitTower} ` : ""}${c.unitCode}` : null;
    await notify(condominiumId, await adminUserIds(condominiumId), { kind: "case", title, body: [who, c.title].filter(Boolean).join(" · "), data }, actorId);
    return;
  }
  const title = event === "status" ? `${label}: ${STATUS_LABEL[c.status].toLowerCase()}` : `La administración respondió ${label}`;
  await notify(condominiumId, await followers(condominiumId, c.id), { kind: "case", title, body: text ? text.slice(0, 160) : c.title, data }, actorId);
}
