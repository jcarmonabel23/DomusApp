/**
 * @project DomusApp - API
 * @file src/modules/notifications/service.ts
 * @description Entrega de avisos: fila en la campana + evento por socket + push de Expo (si está activo)
 *
 * notify() nunca lanza: un aviso que falla se registra en el log y no tumba la acción que lo originó
 * (la alerta, el mensaje o la visita ya quedaron guardados).
 */

import { config } from "../../config.js";
import { query, runInCondominium } from "../../db.js";
import { logger } from "../../lib/logger.js";
import { emitToUser } from "../../lib/realtime.js";

export type NotificationKind = "alert" | "alert_update" | "visit" | "visit_update" | "message" | "announcement" | "payment" | "charge";

export interface NotificationInput {
  kind: NotificationKind;
  title: string;
  body?: string | null;
  data?: Record<string, unknown>;
}

export interface NotificationRow {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string | null;
  data: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
}

// ------------------------------------------------------------------ Destinatarios

/** Guardas y administradores activos del condominio */
export async function staffUserIds(condominiumId: string): Promise<string[]> {
  const rows = await query<{ user_id: string }>(
    `SELECT uc.user_id FROM users_condominiums uc JOIN users u ON u.id = uc.user_id AND u.is_active
      WHERE uc.condominium_id = $1 AND uc.is_active AND uc.role IN ('guard', 'admin')`,
    [condominiumId]
  );
  return rows.map((r) => r.user_id);
}

/** Administradores activos del condominio (cobros, aprobaciones) */
export async function adminUserIds(condominiumId: string): Promise<string[]> {
  const rows = await query<{ user_id: string }>(
    `SELECT uc.user_id FROM users_condominiums uc JOIN users u ON u.id = uc.user_id AND u.is_active
      WHERE uc.condominium_id = $1 AND uc.is_active AND uc.role = 'admin'`,
    [condominiumId]
  );
  return rows.map((r) => r.user_id);
}

/** Cuentas vinculadas a una filial (propietarios, inquilinos y residentes con usuario) */
export async function unitUserIds(condominiumId: string, unitId: string): Promise<string[]> {
  const rows = await query<{ user_id: string }>(
    `SELECT DISTINCT p.user_id
       FROM units_people up
       JOIN people p ON p.id = up.person_id AND p.is_active AND p.user_id IS NOT NULL
       JOIN users u ON u.id = p.user_id AND u.is_active
       JOIN users_condominiums uc ON uc.user_id = u.id AND uc.condominium_id = $2 AND uc.is_active
      WHERE up.unit_id = $1`,
    [unitId, condominiumId]
  );
  return rows.map((r) => r.user_id);
}

/** Miembros activos según la audiencia de un comunicado */
export async function audienceUserIds(condominiumId: string, audience: "all" | "residents" | "guards"): Promise<string[]> {
  const roles = audience === "residents" ? ["owner", "tenant", "admin"] : audience === "guards" ? ["guard", "admin"] : ["owner", "tenant", "guard", "admin"];
  const rows = await query<{ user_id: string }>(
    `SELECT uc.user_id FROM users_condominiums uc JOIN users u ON u.id = uc.user_id AND u.is_active
      WHERE uc.condominium_id = $1 AND uc.is_active AND uc.role = ANY ($2)`,
    [condominiumId, roles]
  );
  return rows.map((r) => r.user_id);
}

// ------------------------------------------------------------------ Entrega

export const NOTIFICATION_SELECT = `n.id, n.kind, n.title, n.body, n.data, n.read_at AS "readAt", n.created_at AS "createdAt"`;

export async function unreadCount(userId: string): Promise<number> {
  const row = await query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL`, [userId]);
  return row[0]?.n ?? 0;
}

/**
 * Avisa a `userIds` (sin repetir y sin el autor). Devuelve a cuántas cuentas llegó.
 * Corre en el condominio indicado aunque se llame fuera de una petición.
 */
export function notify(condominiumId: string, userIds: string[], input: NotificationInput, exceptUserId?: string | null): Promise<number> {
  const targets = [...new Set(userIds)].filter((id) => id !== exceptUserId);
  if (targets.length === 0) return Promise.resolve(0);

  return runInCondominium(condominiumId, async () => {
    try {
      const rows = await query<NotificationRow & { userId: string }>(
        `INSERT INTO notifications (condominium_id, user_id, kind, title, body, data)
         SELECT $1, t.user_id, $3, $4, $5, $6::jsonb FROM unnest($2::uuid[]) AS t(user_id)
         RETURNING user_id AS "userId", ${NOTIFICATION_SELECT.replaceAll("n.", "")}`,
        [condominiumId, targets, input.kind, input.title.slice(0, 140), input.body?.slice(0, 500) ?? null, JSON.stringify(input.data ?? {})]
      );
      const counts = await query<{ userId: string; n: number }>(
        `SELECT user_id AS "userId", COUNT(*)::int AS n FROM notifications
          WHERE user_id = ANY ($1::uuid[]) AND read_at IS NULL GROUP BY user_id`,
        [targets]
      );
      const unread = new Map(counts.map((c) => [c.userId, c.n]));
      for (const { userId, ...notification } of rows) {
        emitToUser(userId, "notification", { notification, unread: unread.get(userId) ?? 0 });
      }
      void sendPush(targets, input, unread);
      return rows.length;
    } catch (err) {
      logger.error({ err, kind: input.kind }, "[notify] no se pudo registrar el aviso");
      return 0;
    }
  });
}

// ------------------------------------------------------------------ Push (Expo)

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

interface ExpoTicket {
  status: "ok" | "error";
  message?: string;
  details?: { error?: string };
}

async function sendPush(userIds: string[], input: NotificationInput, unread: Map<string, number>): Promise<void> {
  if (!config.EXPO_PUSH_ENABLED) return;
  try {
    const tokens = await query<{ token: string; userId: string }>(
      `SELECT token, user_id AS "userId" FROM push_tokens WHERE user_id = ANY ($1::uuid[]) AND failures < 5`,
      [userIds]
    );
    const urgent = input.kind === "alert";
    const messages = tokens.map((t) => ({
      to: t.token,
      title: input.title,
      body: input.body ?? undefined,
      data: { kind: input.kind, ...input.data },
      // Builds de EAS: sirena empaquetada (app.json → expo-notifications.sounds) y canal "alerts-siren"
      sound: urgent ? "alarm.wav" : "default",
      priority: urgent ? "high" : "default",
      channelId: urgent ? "alerts-siren" : "default",
      ...(urgent ? { interruptionLevel: "time-sensitive" } : {}),
      badge: unread.get(t.userId) ?? undefined
    }));
    for (let i = 0; i < messages.length; i += 100) {
      const chunk = messages.slice(i, i + 100);
      const res = await fetch(EXPO_PUSH_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          ...(config.EXPO_ACCESS_TOKEN ? { authorization: `Bearer ${config.EXPO_ACCESS_TOKEN}` } : {})
        },
        body: JSON.stringify(chunk),
        signal: AbortSignal.timeout(10_000)
      });
      const json = (await res.json().catch(() => null)) as { data?: ExpoTicket[] } | null;
      const tickets = json?.data ?? [];
      const dead = chunk.filter((_m, idx) => tickets[idx]?.details?.error === "DeviceNotRegistered").map((m) => m.to);
      if (dead.length) await query(`DELETE FROM push_tokens WHERE token = ANY ($1)`, [dead]);
      const failed = chunk.filter((_m, idx) => tickets[idx]?.status === "error" && !dead.includes(chunk[idx].to)).map((m) => m.to);
      if (failed.length) await query(`UPDATE push_tokens SET failures = failures + 1 WHERE token = ANY ($1)`, [failed]);
    }
  } catch (err) {
    logger.warn({ err }, "[push] no se pudo enviar la notificación push");
  }
}
