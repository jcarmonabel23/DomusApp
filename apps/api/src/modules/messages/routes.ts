/**
 * @project DomusApp - API
 * @file src/modules/messages/routes.ts
 * @description Mensajería con la caseta y comunicados
 *
 *  Para cualquier rol de la app (/messages):
 *   GET  /messages/threads              guarda/admin: filiales con conversación · residente: sus filiales
 *   GET  /messages/threads/:unitId      mensajes (paginados con ?before) y marca el hilo como leído
 *   POST /messages/threads/:unitId      envía (la caseta habla como "guard"; la filial como "resident")
 *   GET  /messages/unread               total de mensajes sin leer
 *   GET  /messages/announcements        comunicados visibles para el rol
 *
 *  Panel (/announcements, módulo MESSAGES): GET lista · POST publica (avisa) · PUT edita · DELETE retira
 */

import { Router, type Request } from "express";
import { z } from "zod";
import { one, query, withTx } from "../../db.js";
import { forbidden, handler, idParams, notFound } from "../../lib/http.js";
import { emitToStaff, emitToUnit, isStaff } from "../../lib/realtime.js";
import { requirePermission } from "../../security/authorize.js";
import { authOf, condominiumOf, txCtx } from "../../security/context.js";
import { UNIT_PHONES, residentUnitIds } from "../access/shared.js";
import { audienceUserIds, notify, staffUserIds, unitUserIds } from "../notifications/service.js";

export const messagesRoutes = Router();

/** La caseta ve todas las filiales; un residente solo las suyas */
async function assertThreadAccess(req: Request, unitId: string): Promise<"guard" | "resident"> {
  const auth = authOf(req);
  if (isStaff(auth.role)) return "guard";
  if (!(await residentUnitIds(auth.userId)).includes(unitId)) throw forbidden("UNIT_FORBIDDEN", "Esa filial no está vinculada a su cuenta");
  return "resident";
}

/** Mensajes que cuentan como "no leídos" para quien consulta: los del otro lado, posteriores a su última lectura */
const UNREAD = (side: "guard" | "resident") => `(SELECT COUNT(*)::int FROM messages m
    WHERE m.unit_id = u.id AND m.side <> '${side}'
      AND m.created_at > COALESCE((SELECT r.last_read_at FROM messages_reads r WHERE r.user_id = $1 AND r.unit_id = u.id), '-infinity'))`;

const LAST = `(SELECT json_build_object('body', m.body, 'side', m.side, 'createdAt', m.created_at)
    FROM messages m WHERE m.unit_id = u.id ORDER BY m.created_at DESC LIMIT 1)`;

messagesRoutes.get(
  "/threads",
  handler({ query: z.object({ q: z.string().trim().max(40).optional() }) }, async ({ req, query: f }) => {
    const auth = authOf(req);
    if (isStaff(auth.role)) {
      return query(
        `SELECT u.id AS "unitId", u.code, u.tower, ${LAST} AS last, ${UNREAD("guard")} AS unread
           FROM units u
          WHERE u.is_active AND EXISTS (SELECT 1 FROM messages m WHERE m.unit_id = u.id)
            AND ($2::text IS NULL OR u.code ILIKE '%' || $2 || '%' OR u.tower ILIKE '%' || $2 || '%')
          ORDER BY (SELECT MAX(m.created_at) FROM messages m WHERE m.unit_id = u.id) DESC
          LIMIT 200`,
        [auth.userId, f.q || null]
      );
    }
    const units = await residentUnitIds(auth.userId);
    return query(
      `SELECT u.id AS "unitId", u.code, u.tower, ${LAST} AS last, ${UNREAD("resident")} AS unread
         FROM units u WHERE u.id = ANY ($2) ORDER BY u.code`,
      [auth.userId, units]
    );
  })
);

messagesRoutes.get(
  "/unread",
  handler({}, async ({ req }) => {
    const auth = authOf(req);
    const staff = isStaff(auth.role);
    const units = staff ? null : await residentUnitIds(auth.userId);
    const row = await one<{ n: number }>(
      `SELECT COALESCE(SUM(${UNREAD(staff ? "guard" : "resident")}), 0)::int AS n
         FROM units u WHERE u.is_active AND ($2::uuid[] IS NULL OR u.id = ANY ($2))`,
      [auth.userId, units]
    );
    return { unread: row?.n ?? 0 };
  })
);

const MESSAGE_SELECT = `m.id, m.side, m.body, m.created_at AS "createdAt", m.sender_id AS "senderId", s.names AS "senderName"`;

async function markRead(req: Request, unitId: string) {
  await query(
    `INSERT INTO messages_reads (user_id, unit_id) VALUES ($1, $2)
     ON CONFLICT (condominium_id, user_id, unit_id) DO UPDATE SET last_read_at = NOW()`,
    [authOf(req).userId, unitId]
  );
}

messagesRoutes.get(
  "/threads/:unitId",
  handler(
    {
      params: z.object({ unitId: z.uuid() }),
      query: z.object({ before: z.iso.datetime({ offset: true }).optional(), limit: z.coerce.number().int().min(1).max(100).default(50) })
    },
    async ({ req, params, query: f }) => {
      const side = await assertThreadAccess(req, params.unitId);
      const unit = await one(
        `SELECT u.id, u.code, u.tower${side === "guard" ? `, ${UNIT_PHONES} AS phones` : ""} FROM units u WHERE u.id = $1`,
        [params.unitId]
      );
      if (!unit) throw notFound("Filial no encontrada");
      const rows = await query(
        `SELECT ${MESSAGE_SELECT} FROM messages m LEFT JOIN users s ON s.id = m.sender_id
          WHERE m.unit_id = $1 AND ($2::timestamptz IS NULL OR m.created_at < $2)
          ORDER BY m.created_at DESC LIMIT $3`,
        [params.unitId, f.before ?? null, f.limit]
      );
      if (!f.before) await markRead(req, params.unitId);
      return { unit, side, messages: rows.reverse() };
    }
  )
);

messagesRoutes.post(
  "/threads/:unitId",
  handler(
    { params: z.object({ unitId: z.uuid() }), body: z.object({ body: z.string().trim().min(1).max(2000) }) },
    async ({ req, params, body }) => {
      const auth = authOf(req);
      const condominiumId = condominiumOf(req);
      const side = await assertThreadAccess(req, params.unitId);
      const row = await withTx(txCtx(req), (client) =>
        one<{ id: string }>(
          `INSERT INTO messages (unit_id, side, body, sender_id) VALUES ($1, $2, $3, fn_current_app_user()) RETURNING id`,
          [params.unitId, side, body.body],
          client
        )
      );
      await markRead(req, params.unitId);
      const message = await one<{ id: string }>(
        `SELECT ${MESSAGE_SELECT}, m.unit_id AS "unitId", u.code AS "unitCode" FROM messages m
           JOIN units u ON u.id = m.unit_id LEFT JOIN users s ON s.id = m.sender_id WHERE m.id = $1`,
        [row!.id]
      );

      emitToStaff(condominiumId, "message:new", message);
      emitToUnit(condominiumId, params.unitId, "message:new", message);
      const unit = await one<{ code: string }>(`SELECT code FROM units WHERE id = $1`, [params.unitId]);
      const preview = body.body.length > 120 ? `${body.body.slice(0, 117)}…` : body.body;
      if (side === "resident") {
        await notify(
          condominiumId,
          await staffUserIds(condominiumId),
          { kind: "message", title: `Mensaje de ${unit?.code ?? "una filial"} · ${auth.names}`, body: preview, data: { unitId: params.unitId } },
          auth.userId
        );
      } else {
        await notify(
          condominiumId,
          await unitUserIds(condominiumId, params.unitId),
          { kind: "message", title: "Mensaje de la caseta", body: preview, data: { unitId: params.unitId } },
          auth.userId
        );
      }
      return message;
    }
  )
);

messagesRoutes.post(
  "/threads/:unitId/read",
  handler({ params: z.object({ unitId: z.uuid() }) }, async ({ req, params }) => {
    await assertThreadAccess(req, params.unitId);
    await markRead(req, params.unitId);
    return undefined;
  })
);

const ANNOUNCEMENT_SELECT = `a.id, a.title, a.body, a.audience, a.is_pinned AS "isPinned", a.published_at AS "publishedAt",
  a.is_active AS "isActive", cb.names AS "createdByName"`;

messagesRoutes.get(
  "/announcements",
  handler({}, async ({ req }) => {
    const role = authOf(req).role;
    const audiences = role === "admin" ? ["all", "residents", "guards"] : role === "guard" ? ["all", "guards"] : ["all", "residents"];
    return query(
      `SELECT ${ANNOUNCEMENT_SELECT} FROM announcements a LEFT JOIN users cb ON cb.id = a.created_by
        WHERE a.is_active AND a.published_at <= NOW() AND a.audience = ANY ($1)
        ORDER BY a.is_pinned DESC, a.published_at DESC LIMIT 100`,
      [audiences]
    );
  })
);

// ================================================================== Panel: comunicados

export const announcementsRoutes = Router();
announcementsRoutes.use(requirePermission("MESSAGES", "access"));

const announcementBody = z.object({
  title: z.string().trim().min(3).max(140),
  body: z.string().trim().min(3).max(5000),
  audience: z.enum(["all", "residents", "guards"]).default("all"),
  isPinned: z.boolean().default(false)
});

const AUDIENCE_TEXT: Record<string, string> = { all: "todos", residents: "residentes", guards: "guardas" };

announcementsRoutes.get(
  "/",
  handler({}, () =>
    query(
      `SELECT ${ANNOUNCEMENT_SELECT}, (SELECT COUNT(*)::int FROM notifications n
              WHERE n.kind = 'announcement' AND n.data->>'announcementId' = a.id::text) AS recipients,
              (SELECT COUNT(*)::int FROM notifications n
              WHERE n.kind = 'announcement' AND n.data->>'announcementId' = a.id::text AND n.read_at IS NOT NULL) AS "readCount"
         FROM announcements a LEFT JOIN users cb ON cb.id = a.created_by
        WHERE a.is_active ORDER BY a.is_pinned DESC, a.published_at DESC LIMIT 300`
    )
  )
);

announcementsRoutes.post(
  "/",
  requirePermission("MESSAGES", "add_new"),
  handler({ body: announcementBody }, async ({ req, body }) => {
    const condominiumId = condominiumOf(req);
    const row = await withTx(txCtx(req), (client) =>
      one<{ id: string }>(
        `INSERT INTO announcements (title, body, audience, is_pinned, created_by, updated_by)
         VALUES ($1, $2, $3, $4, fn_current_app_user(), fn_current_app_user()) RETURNING id`,
        [body.title, body.body, body.audience, body.isPinned],
        client
      )
    );
    const notified = await notify(
      condominiumId,
      await audienceUserIds(condominiumId, body.audience),
      { kind: "announcement", title: `Comunicado: ${body.title}`, body: body.body.slice(0, 200), data: { announcementId: row!.id } },
      authOf(req).userId
    );
    return { id: row!.id, notified, audience: AUDIENCE_TEXT[body.audience] };
  })
);

announcementsRoutes.put(
  "/:id",
  requirePermission("MESSAGES", "edit"),
  handler({ params: idParams, body: announcementBody }, async ({ req, params, body }) => {
    const row = await withTx(txCtx(req), (client) =>
      one(
        `UPDATE announcements SET title = $2, body = $3, audience = $4, is_pinned = $5, updated_by = fn_current_app_user()
          WHERE id = $1 AND is_active RETURNING id`,
        [params.id, body.title, body.body, body.audience, body.isPinned],
        client
      )
    );
    if (!row) throw notFound("Comunicado no encontrado");
    return undefined;
  })
);

announcementsRoutes.delete(
  "/:id",
  requirePermission("MESSAGES", "delete"),
  handler({ params: idParams }, async ({ req, params }) => {
    const row = await withTx(txCtx(req), (client) =>
      one(`UPDATE announcements SET is_active = FALSE, updated_by = fn_current_app_user() WHERE id = $1 AND is_active RETURNING id`, [params.id], client)
    );
    if (!row) throw notFound("Comunicado no encontrado");
    return undefined;
  })
);
