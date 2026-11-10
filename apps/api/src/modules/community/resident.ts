/**
 * @project DomusApp - API
 * @file src/modules/community/resident.ts
 * @description "Mi Condominio" en la app: documentos, asambleas, seguimiento de acuerdos y directorio de proveedores
 *
 *  GET /resident/documents          documentos publicados para residentes (con archivo)
 *  GET /resident/assemblies         asambleas (próximas primero) con su acta
 *  GET /resident/assemblies/:id     detalle con agenda, resultado y acuerdos
 *  GET /resident/agreements         acuerdos (?scope=open|all)
 *  GET /resident/suppliers          proveedores que la administración comparte con los residentes
 */

import { Router } from "express";
import { z } from "zod";
import { one, query } from "../../db.js";
import { handler, idParams, notFound } from "../../lib/http.js";
import { requireRole } from "../../security/authorize.js";
import { AGREEMENT_JOINS, AGREEMENT_SELECT, ASSEMBLY_JOINS, ASSEMBLY_SELECT, withMinutes } from "../assemblies/routes.js";
import { DOCUMENT_CATEGORIES, DOCUMENT_JOINS, DOCUMENT_SELECT, withDocumentFile } from "../documents/routes.js";

export const residentCommunityRoutes = Router();
residentCommunityRoutes.use(requireRole("owner", "tenant", "admin"));

residentCommunityRoutes.get(
  "/documents",
  handler({ query: z.object({ category: z.enum(DOCUMENT_CATEGORIES).optional() }) }, async ({ query: q }) => {
    const rows = await query<Parameters<typeof withDocumentFile>[0]>(
      `SELECT ${DOCUMENT_SELECT} ${DOCUMENT_JOINS}
        WHERE d.is_active AND d.audience = 'residents' AND d.file_id IS NOT NULL AND d.published_on <= CURRENT_DATE
          AND ($1::text IS NULL OR d.category = $1)
        ORDER BY CASE d.category WHEN 'regulation' THEN 0 ELSE 1 END, d.published_on DESC, d.title`,
      [q.category ?? null]
    );
    return rows.map(withDocumentFile);
  })
);

residentCommunityRoutes.get(
  "/assemblies",
  handler({}, async () => {
    const rows = await query<Parameters<typeof withMinutes>[0]>(
      `SELECT ${ASSEMBLY_SELECT} ${ASSEMBLY_JOINS}
        ORDER BY CASE WHEN a.status = 'scheduled' AND a.scheduled_at > now() - interval '6 hours' THEN 0 ELSE 1 END,
                 CASE WHEN a.status = 'scheduled' AND a.scheduled_at > now() - interval '6 hours' THEN a.scheduled_at END,
                 a.scheduled_at DESC
        LIMIT 100`
    );
    return rows.map(withMinutes);
  })
);

residentCommunityRoutes.get(
  "/assemblies/:id",
  handler({ params: idParams }, async ({ params }) => {
    const a = await one<Parameters<typeof withMinutes>[0]>(`SELECT ${ASSEMBLY_SELECT} ${ASSEMBLY_JOINS} WHERE a.id = $1`, [params.id]);
    if (!a) throw notFound("Asamblea no encontrada");
    const agreements = await query(`SELECT ${AGREEMENT_SELECT} ${AGREEMENT_JOINS} WHERE g.assembly_id = $1 AND g.status <> 'cancelled' ORDER BY g.number`, [
      params.id
    ]);
    return { ...withMinutes(a), agreements };
  })
);

residentCommunityRoutes.get(
  "/agreements",
  handler({ query: z.object({ scope: z.enum(["open", "all"]).default("open") }) }, async ({ query: q }) =>
    query(
      `SELECT ${AGREEMENT_SELECT} ${AGREEMENT_JOINS}
        WHERE ${q.scope === "open" ? `g.status IN ('pending', 'in_progress')` : `g.status <> 'cancelled'`}
        ORDER BY CASE WHEN g.status IN ('pending', 'in_progress') THEN 0 ELSE 1 END, g.due_on NULLS LAST, a.scheduled_at DESC, g.number
        LIMIT 300`
    )
  )
);

residentCommunityRoutes.get(
  "/suppliers",
  handler({}, async () =>
    query(
      `SELECT s.id, s.name, s.category, s.phone, s.email, s.website,
              (SELECT json_build_object('names', x.names, 'role', x.role, 'phone', x.phone)
                 FROM supplier_contacts x WHERE x.supplier_id = s.id ORDER BY x.is_primary DESC, x.created_at LIMIT 1) AS contact,
              s.created_at > now() - interval '30 days' AS "isNew"
         FROM suppliers s WHERE s.is_active AND s.show_to_residents
        ORDER BY s.created_at > now() - interval '30 days' DESC, s.category, s.name`
    )
  )
);
