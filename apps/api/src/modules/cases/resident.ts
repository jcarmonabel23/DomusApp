/**
 * @project DomusApp - API
 * @file src/modules/cases/resident.ts
 * @description Casos en la app del Propietario / Inquilino
 *
 *  GET  /resident/cases                 mis casos y los de mis filiales (?scope=active|finished)
 *  GET  /resident/cases/:id             detalle con el seguimiento público y los adjuntos
 *  POST /resident/cases                 reporta (daño, mejora, queja, sugerencia o denuncia; esta puede ser anónima)
 *  POST /resident/cases/:id/comments    responde o agrega información
 *  POST /resident/cases/:id/files       foto o PDF (cuerpo crudo)
 *  POST /resident/cases/:id/close       confirma la solución y califica (1-5)
 *  POST /resident/cases/:id/reopen      la solución no funcionó: vuelve a abierto con el motivo
 */

import { Router } from "express";
import { z } from "zod";
import { query, withTx } from "../../db.js";
import { conflict, handler, idParams } from "../../lib/http.js";
import { requireRole } from "../../security/authorize.js";
import { authOf, condominiumOf, txCtx } from "../../security/context.js";
import { assertResidentUnit, optText, residentUnitIds } from "../access/shared.js";
import { rawUpload } from "../files/images.js";
import {
  CASE_CATEGORIES,
  CASE_JOINS,
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

export const residentCaseRoutes = Router();
residentCaseRoutes.use(requireRole("owner", "tenant", "admin"));

/** Casos visibles para la cuenta: los suyos y los de sus filiales (sin denuncias anónimas ajenas) */
const VISIBLE = `(c.reported_by = $1 OR (c.unit_id = ANY ($2::uuid[]) AND NOT c.is_anonymous))`;

async function visibleCase(userId: string, id: string): Promise<CaseRow> {
  const units = await residentUnitIds(userId);
  const rows = await query<{ id: string }>(`SELECT c.id FROM cases c WHERE c.id = $3 AND ${VISIBLE}`, [userId, units, id]);
  const c = rows.length ? await caseById(id, false) : null;
  if (!c) throw caseNotFound();
  return c;
}

/** En la app, quien reportó una denuncia anónima no se expone a los demás de la filial (no la ven) */
const forResident = (c: CaseRow, userId: string) => ({ ...c, mine: c.reportedById === userId });

residentCaseRoutes.get(
  "/cases",
  handler({ query: z.object({ scope: z.enum(["active", "finished"]).default("active") }) }, async ({ req, query: q }) => {
    const { userId } = authOf(req);
    const units = await residentUnitIds(userId);
    const status = q.scope === "active" ? `c.status IN ('open', 'in_progress', 'resolved')` : `c.status IN ('closed', 'rejected')`;
    const rows = await query<CaseRow>(
      `SELECT ${caseSelect(false)} ${CASE_JOINS} WHERE ${VISIBLE} AND ${status}
        ORDER BY CASE WHEN c.status = 'resolved' THEN 0 ELSE 1 END, c.created_at DESC LIMIT 200`,
      [userId, units]
    );
    return rows.map((c) => forResident(c, userId));
  })
);

residentCaseRoutes.get(
  "/cases/:id",
  handler({ params: idParams }, async ({ req, params }) => {
    const { userId } = authOf(req);
    const c = await visibleCase(userId, params.id);
    return { ...forResident(c, userId), ...(await caseTimeline(c, false)) };
  })
);

residentCaseRoutes.post(
  "/cases",
  handler(
    {
      body: z
        .object({
          category: z.enum(CASE_CATEGORIES),
          title: z.string().trim().min(4, "Escriba un asunto").max(120),
          description: z.string().trim().min(10, "Cuéntenos un poco más (al menos 10 caracteres)").max(4000),
          location: optText(120),
          unitId: z.uuid().nullish().transform((v) => v ?? null),
          anonymous: z.boolean().default(false)
        })
        .refine((b) => !b.anonymous || b.category === "report", { message: "Solo las denuncias pueden ser anónimas", path: ["anonymous"] })
    },
    async ({ req, body }) => {
      const { userId } = authOf(req);
      const condominiumId = condominiumOf(req);
      let unitId = body.anonymous ? null : body.unitId;
      if (unitId) await assertResidentUnit(userId, unitId);
      else if (!body.anonymous) unitId = (await residentUnitIds(userId))[0] ?? null;
      const id = await withTx(txCtx(req), (client) => createCase(client, { ...body, unitId }, "app"));
      const c = (await caseById(id, false))!;
      await broadcastCase(condominiumId, id);
      await notifyCase(condominiumId, (await caseById(id, true))!, "created", userId);
      return { ...forResident(c, userId), updates: [], files: [] };
    }
  )
);

const finished = (c: CaseRow) => {
  if (c.status === "closed" || c.status === "rejected") throw conflict("CASE_FINISHED", "El caso ya está cerrado");
};

residentCaseRoutes.post(
  "/cases/:id/comments",
  handler({ params: idParams, body: z.object({ body: z.string().trim().min(2, "Escriba su mensaje").max(2000) }) }, async ({ req, params, body }) => {
    const { userId } = authOf(req);
    const condominiumId = condominiumOf(req);
    const c = await visibleCase(userId, params.id);
    finished(c);
    await withTx(txCtx(req), (client) => addCaseComment(client, c.id, "resident", body.body));
    await broadcastCase(condominiumId, c.id);
    await notifyCase(condominiumId, (await caseById(c.id, true))!, "resident_comment", userId);
    const fresh = (await caseById(c.id, false))!;
    return { ...forResident(fresh, userId), ...(await caseTimeline(fresh, false)) };
  })
);

residentCaseRoutes.post(
  "/cases/:id/files",
  rawUpload,
  handler({ params: idParams }, async ({ req, params }) => {
    const { userId } = authOf(req);
    const condominiumId = condominiumOf(req);
    const c = await visibleCase(userId, params.id);
    finished(c);
    await attachCaseFile(req, condominiumId, c, "resident", false);
    await broadcastCase(condominiumId, c.id);
    const fresh = (await caseById(c.id, false))!;
    return { ...forResident(fresh, userId), ...(await caseTimeline(fresh, false)) };
  })
);

residentCaseRoutes.post(
  "/cases/:id/close",
  handler(
    { params: idParams, body: z.object({ rating: z.coerce.number().int().min(1).max(5), comment: optText(300) }) },
    async ({ req, params, body }) => {
      const { userId } = authOf(req);
      const condominiumId = condominiumOf(req);
      const c = await visibleCase(userId, params.id);
      if (c.status !== "resolved") throw conflict("NOT_RESOLVED", "Solo se confirma un caso marcado como resuelto");
      await withTx(txCtx(req), async (client) => {
        await setCaseStatus(client, c, "closed", "resident", body.comment);
        await client.query(`UPDATE cases SET rating = $2, rating_comment = $3 WHERE id = $1`, [c.id, body.rating, body.comment]);
      });
      await broadcastCase(condominiumId, c.id);
      await notifyCase(condominiumId, (await caseById(c.id, true))!, "closed_by_resident", userId);
      const fresh = (await caseById(c.id, false))!;
      return { ...forResident(fresh, userId), ...(await caseTimeline(fresh, false)) };
    }
  )
);

residentCaseRoutes.post(
  "/cases/:id/reopen",
  handler({ params: idParams, body: z.object({ body: z.string().trim().min(5, "Cuéntenos qué sigue pasando").max(2000) }) }, async ({ req, params, body }) => {
    const { userId } = authOf(req);
    const condominiumId = condominiumOf(req);
    const c = await visibleCase(userId, params.id);
    if (c.status !== "resolved") throw conflict("NOT_RESOLVED", "Solo se reabre un caso marcado como resuelto");
    await withTx(txCtx(req), (client) => setCaseStatus(client, c, "open", "resident", body.body));
    await broadcastCase(condominiumId, c.id);
    await notifyCase(condominiumId, (await caseById(c.id, true))!, "reopened", userId);
    const fresh = (await caseById(c.id, false))!;
    return { ...forResident(fresh, userId), ...(await caseTimeline(fresh, false)) };
  })
);
