/**
 * @project DomusApp - API
 * @file src/modules/documents/routes.ts
 * @description Reglamentos, circulares, manuales, formularios y otros documentos (PDF o imagen)
 *
 *  GET    /documents              listado (?category&search&active)
 *  POST   /documents              crea la ficha (el archivo se sube aparte)
 *  PUT    /documents/:id          edita la ficha (incluye ocultar / mostrar)
 *  PUT    /documents/:id/file     archivo (cuerpo crudo; ?notify=true avisa a los residentes)
 *  DELETE /documents/:id          borra la ficha y su archivo
 */

import { Router } from "express";
import { z } from "zod";
import { one, query, withTx } from "../../db.js";
import { handler, idParams, notFound } from "../../lib/http.js";
import { emitToStaff } from "../../lib/realtime.js";
import { requirePermission } from "../../security/authorize.js";
import { authOf, condominiumOf, txCtx } from "../../security/context.js";
import { optText } from "../access/shared.js";
import { fileKey, fileUrls, rawUpload, removeStored, replaceImage } from "../files/images.js";
import { audienceUserIds, notify } from "../notifications/service.js";

export const DOCUMENT_CATEGORIES = ["regulation", "circular", "minutes", "manual", "form", "financial", "other"] as const;
export const DOCUMENT_CATEGORY_LABEL: Record<(typeof DOCUMENT_CATEGORIES)[number], string> = {
  regulation: "Reglamento",
  circular: "Circular",
  minutes: "Acta",
  manual: "Manual",
  form: "Formulario",
  financial: "Informe financiero",
  other: "Otro"
};

/** Columnas de un documento (alias d, archivo f) */
export const DOCUMENT_SELECT = `d.id, d.title, d.category, d.description, d.audience, to_char(d.published_on, 'YYYY-MM-DD') AS "publishedOn",
  d.is_active AS "isActive", d.updated_at AS "updatedAt", f.storage_key AS "fileKey", f.mime_type AS "fileMime",
  f.size_bytes AS "fileBytes", f.original_name AS "fileName"`;
export const DOCUMENT_JOINS = `FROM documents d LEFT JOIN files f ON f.id = d.file_id`;

type DocumentRow = { title: string; fileKey: string | null; fileMime: string | null } & Record<string, unknown>;

export const withDocumentFile = ({ fileKey: key, fileMime, ...d }: DocumentRow) => ({ ...d, file: fileUrls(key, fileMime, d.title) });

export const documentRoutes = Router();
documentRoutes.use(requirePermission("DOCUMENTS", "access"));

const body = z.object({
  title: z.string().trim().min(3, "Escriba el título").max(160),
  category: z.enum(DOCUMENT_CATEGORIES),
  description: optText(500),
  audience: z.enum(["residents", "staff"]),
  publishedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida"),
  isActive: z.boolean().default(true)
});

async function documentById(id: string) {
  const d = await one<DocumentRow>(`SELECT ${DOCUMENT_SELECT} ${DOCUMENT_JOINS} WHERE d.id = $1`, [id]);
  return d ? withDocumentFile(d) : null;
}

const changed = (condominiumId: string) => emitToStaff(condominiumId, "documents:update", {});

documentRoutes.get(
  "/",
  handler(
    {
      query: z.object({
        category: z.enum(DOCUMENT_CATEGORIES).optional(),
        search: z.string().trim().max(80).optional(),
        active: z.enum(["true", "false", "all"]).default("all")
      })
    },
    async ({ query: q }) => {
      const where: string[] = [];
      const params: unknown[] = [];
      if (q.active !== "all") where.push(`d.is_active = ${q.active === "true"}`);
      if (q.category) {
        params.push(q.category);
        where.push(`d.category = $${params.length}`);
      }
      if (q.search) {
        params.push(`%${q.search}%`);
        where.push(`(d.title ILIKE $${params.length} OR d.description ILIKE $${params.length})`);
      }
      const rows = await query<DocumentRow>(
        `SELECT ${DOCUMENT_SELECT} ${DOCUMENT_JOINS} ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
          ORDER BY d.is_active DESC, d.published_on DESC, d.title LIMIT 500`,
        params
      );
      return rows.map(withDocumentFile);
    }
  )
);

documentRoutes.post(
  "/",
  requirePermission("DOCUMENTS", "add_new"),
  handler({ body }, async ({ req, body: b }) => {
    const row = await withTx(txCtx(req), (client) =>
      one<{ id: string }>(
        `INSERT INTO documents (title, category, description, audience, published_on, is_active, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, fn_current_app_user()) RETURNING id`,
        [b.title, b.category, b.description, b.audience, b.publishedOn, b.isActive],
        client
      )
    );
    changed(condominiumOf(req));
    return documentById(row!.id);
  })
);

documentRoutes.put(
  "/:id",
  requirePermission("DOCUMENTS", "edit"),
  handler({ params: idParams, body }, async ({ req, params, body: b }) => {
    const row = await withTx(txCtx(req), (client) =>
      one<{ id: string }>(
        `UPDATE documents SET title = $2, category = $3, description = $4, audience = $5, published_on = $6, is_active = $7,
                updated_by = fn_current_app_user()
          WHERE id = $1 RETURNING id`,
        [params.id, b.title, b.category, b.description, b.audience, b.publishedOn, b.isActive],
        client
      )
    );
    if (!row) throw notFound("Documento no encontrado");
    changed(condominiumOf(req));
    return documentById(params.id);
  })
);

documentRoutes.put(
  "/:id/file",
  requirePermission("DOCUMENTS", "edit"),
  rawUpload,
  handler({ params: idParams, query: z.object({ notify: z.enum(["true", "false"]).default("false") }) }, async ({ req, params, query: q }) => {
    const condominiumId = condominiumOf(req);
    const d = await one<{ title: string; category: (typeof DOCUMENT_CATEGORIES)[number]; audience: string; is_active: boolean }>(
      `SELECT title, category, audience, is_active FROM documents WHERE id = $1`,
      [params.id]
    );
    if (!d) throw notFound("Documento no encontrado");
    await replaceImage({
      req,
      condominiumId,
      profile: "receipt",
      purpose: "document",
      allowPdf: true,
      withTx: (fn) => withTx(txCtx(req), fn),
      attach: async (client, fileId) => {
        const prev = await one<{ prev: string | null }>(
          `UPDATE documents x SET file_id = $2, updated_by = fn_current_app_user()
             FROM (SELECT file_id AS prev FROM documents WHERE id = $1) old WHERE x.id = $1 RETURNING old.prev`,
          [params.id, fileId],
          client
        );
        return prev?.prev ?? null;
      }
    });
    changed(condominiumId);
    if (q.notify === "true" && d.audience === "residents" && d.is_active) {
      await notify(
        condominiumId,
        await audienceUserIds(condominiumId, "residents"),
        { kind: "document", title: `Nuevo documento: ${DOCUMENT_CATEGORY_LABEL[d.category].toLowerCase()}`, body: d.title, data: { documentId: params.id } },
        authOf(req).userId
      );
    }
    return documentById(params.id);
  })
);

documentRoutes.delete(
  "/:id",
  requirePermission("DOCUMENTS", "delete"),
  handler({ params: idParams }, async ({ req, params }) => {
    const condominiumId = condominiumOf(req);
    const row = await withTx(txCtx(req), async (client) => {
      const r = await one<{ file_id: string | null }>(`DELETE FROM documents WHERE id = $1 RETURNING file_id`, [params.id], client);
      if (!r) throw notFound("Documento no encontrado");
      if (r.file_id) await client.query(`DELETE FROM files WHERE id = $1`, [r.file_id]);
      return r;
    });
    await removeStored(fileKey(condominiumId, row.file_id));
    changed(condominiumId);
    return { ok: true };
  })
);
