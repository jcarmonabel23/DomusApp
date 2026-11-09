/**
 * @project DomusApp - API
 * @file src/modules/notifications/routes.ts
 * @description Campana: avisos de la cuenta en el condominio activo y registro de dispositivos push
 *
 *  GET    /notifications?before&limit   avisos (más recientes primero) y no leídos
 *  GET    /notifications/unread         solo el contador (para la campana)
 *  POST   /notifications/:id/read       marca uno
 *  POST   /notifications/read-all       marca todos
 *  POST   /notifications/push-token     registra el token Expo del dispositivo
 *  DELETE /notifications/push-token     lo quita (cerrar sesión)
 */

import { Router } from "express";
import { z } from "zod";
import { query } from "../../db.js";
import { handler, idParams } from "../../lib/http.js";
import { authOf } from "../../security/context.js";
import { NOTIFICATION_SELECT, unreadCount } from "./service.js";

export const notificationsRoutes = Router();

notificationsRoutes.get(
  "/",
  handler(
    { query: z.object({ before: z.iso.datetime({ offset: true }).optional(), limit: z.coerce.number().int().min(1).max(100).default(30) }) },
    async ({ req, query: f }) => {
      const { userId } = authOf(req);
      const rows = await query(
        `SELECT ${NOTIFICATION_SELECT} FROM notifications n
          WHERE n.user_id = $1 AND ($2::timestamptz IS NULL OR n.created_at < $2)
          ORDER BY n.created_at DESC LIMIT $3`,
        [userId, f.before ?? null, f.limit]
      );
      return { rows, unread: await unreadCount(userId) };
    }
  )
);

notificationsRoutes.get(
  "/unread",
  handler({}, async ({ req }) => ({ unread: await unreadCount(authOf(req).userId) }))
);

notificationsRoutes.post(
  "/read-all",
  handler({}, async ({ req }) => {
    const { userId } = authOf(req);
    await query(`UPDATE notifications SET read_at = NOW() WHERE user_id = $1 AND read_at IS NULL`, [userId]);
    return { unread: 0 };
  })
);

const pushBody = z.object({
  token: z.string().trim().regex(/^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]{10,}\]$/, "Token de Expo no válido"),
  platform: z.enum(["ios", "android", "web"])
});

notificationsRoutes.post(
  "/push-token",
  handler({ body: pushBody }, async ({ req, body }) => {
    const { userId, sessionId } = authOf(req);
    // Un dispositivo pertenece a la última cuenta que inició sesión en él
    await query(
      `INSERT INTO push_tokens (token, user_id, platform, session_id) VALUES ($1, $2, $3, $4)
       ON CONFLICT (token) DO UPDATE SET user_id = EXCLUDED.user_id, platform = EXCLUDED.platform,
              session_id = EXCLUDED.session_id, last_seen_at = NOW(), failures = 0`,
      [body.token, userId, body.platform, sessionId]
    );
    return undefined;
  })
);

notificationsRoutes.delete(
  "/push-token",
  handler({ body: pushBody.pick({ token: true }) }, async ({ req, body }) => {
    await query(`DELETE FROM push_tokens WHERE token = $1 AND user_id = $2`, [body.token, authOf(req).userId]);
    return undefined;
  })
);

notificationsRoutes.post(
  "/:id/read",
  handler({ params: idParams }, async ({ req, params }) => {
    const { userId } = authOf(req);
    await query(`UPDATE notifications SET read_at = NOW() WHERE id = $1 AND user_id = $2 AND read_at IS NULL`, [params.id, userId]);
    return { unread: await unreadCount(userId) };
  })
);
