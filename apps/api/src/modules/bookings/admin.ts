/**
 * @project DomusApp - API
 * @file src/modules/bookings/admin.ts
 * @description Áreas comunes y reservaciones (panel de administración)
 *
 *  GET  /bookings/summary                          próximas, por aprobar, hoy y bloqueos activos
 *  GET  /bookings/amenities                        áreas (incluye inactivas) con sus próximas reservas
 *  POST /bookings/amenities                        crea un área
 *  PUT  /bookings/amenities/:id                    edita un área
 *  PUT  /bookings/amenities/:id/photo              foto del área (cuerpo crudo)
 *  GET  /bookings/amenities/:id/availability       horarios de un día con sus reservas (?date=)
 *  GET  /bookings/calendar                         reservas activas y bloqueos de un rango (?amenityId&from&to)
 *  GET  /bookings/list                             reservas con filtros y paginación
 *  GET  /bookings/list/:id                         una reserva
 *  GET  /bookings/list/export                      Excel / PDF
 *  POST /bookings/list                             reserva a nombre de una filial (queda aprobada)
 *  POST /bookings/list/:id/approve|reject|cancel   revisión y cancelación (con motivo)
 *  GET  /bookings/blocks                           feriados, cierres y restricciones (?scope=active|all)
 *  POST /bookings/blocks                           crea uno (opcional: cancela las reservas que choquen)
 *  DELETE /bookings/blocks/:id                     lo quita
 */

import { Router } from "express";
import { z } from "zod";
import { one, query, withTx } from "../../db.js";
import { sendPdf, sendXlsx, type ExportColumn } from "../../lib/exports.js";
import { badRequest, conflict, handler, idParams, notFound } from "../../lib/http.js";
import { requirePermission } from "../../security/authorize.js";
import { authOf, condominiumOf, txCtx } from "../../security/context.js";
import { optText } from "../access/shared.js";
import { rawUpload, replaceImage, signedUrl } from "../files/images.js";
import { condoMoney, money } from "../finance/shared.js";
import {
  AMENITY_ICONS,
  AMENITY_SELECT,
  BLOCK_KIND_LABEL,
  BOOKING_JOINS,
  BOOKING_SELECT,
  BOOKING_STATUS_LABEL,
  amenityById,
  availability,
  bookingById,
  bookingNotFound,
  broadcastBooking,
  chargeBooking,
  createBooking,
  notifyBooking,
  voidBookingCharge,
  withAmenityPhoto,
  type AmenityRow,
  type BookingRow
} from "./shared.js";

export const bookingRoutes = Router();
bookingRoutes.use(requirePermission("BOOKINGS", "access"));

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida (AAAA-MM-DD)");
const hhmm = z.string().regex(/^\d{2}:\d{2}$/, "Hora inválida (HH:MM)");
const reasonBody = z.object({ reason: z.string().trim().min(3, "Escriba el motivo").max(300) });

// ================================================================== Resumen

bookingRoutes.get(
  "/summary",
  handler({}, async () => {
    const row = await one<{ upcoming: number; pending: number; today: number; blocks: number; amenities: number }>(
      `SELECT (SELECT COUNT(*)::int FROM bookings WHERE status = 'approved' AND ends_at > now()) AS upcoming,
              (SELECT COUNT(*)::int FROM bookings WHERE status = 'pending' AND starts_at > now()) AS pending,
              (SELECT COUNT(*)::int FROM bookings WHERE status IN ('pending', 'approved') AND starts_at::date = CURRENT_DATE) AS today,
              (SELECT COUNT(*)::int FROM amenity_blocks WHERE ends_at IS NULL OR ends_at > now()) AS blocks,
              (SELECT COUNT(*)::int FROM amenities WHERE is_active) AS amenities`
    );
    return row;
  })
);

// ================================================================== Áreas

const amenityBody = z
  .object({
    name: z.string().trim().min(2, "Escriba el nombre").max(80),
    icon: z.enum(AMENITY_ICONS),
    description: optText(500),
    rules: optText(4000),
    mode: z.enum(["exclusive", "shared"]),
    capacity: z.coerce.number().int().min(1).max(2000),
    openTime: hhmm,
    closeTime: hhmm,
    weekdays: z.array(z.number().int().min(1).max(7)).min(1, "Elija al menos un día").max(7),
    slotMinutes: z.union([z.literal(30), z.literal(60), z.literal(120)]),
    maxDurationMinutes: z.coerce.number().int().min(30).max(1440),
    minAdvanceHours: z.coerce.number().int().min(0).max(720),
    maxAdvanceDays: z.coerce.number().int().min(1).max(365),
    cancelHours: z.coerce.number().int().min(0).max(720),
    maxActivePerUnit: z.coerce.number().int().min(1).max(50).nullish(),
    cost: z.coerce.number().min(0).max(1e10),
    requiresApproval: z.boolean(),
    blockDelinquent: z.boolean(),
    isActive: z.boolean().default(true)
  })
  .refine((b) => b.closeTime > b.openTime, { message: "La hora de cierre debe ser posterior a la de apertura", path: ["closeTime"] })
  .refine((b) => b.maxDurationMinutes >= b.slotMinutes && b.maxDurationMinutes % b.slotMinutes === 0, {
    message: "La duración máxima debe ser múltiplo del bloque",
    path: ["maxDurationMinutes"]
  });

const AMENITY_COLUMNS = `name, icon, description, rules, mode, capacity, open_time, close_time, weekdays, slot_minutes,
  max_duration_minutes, min_advance_hours, max_advance_days, cancel_hours, max_active_per_unit, cost, requires_approval,
  block_delinquent, is_active`;

const amenityValues = (b: z.infer<typeof amenityBody>) => [
  b.name,
  b.icon,
  b.description,
  b.rules,
  b.mode,
  b.capacity,
  b.openTime,
  b.closeTime,
  [...new Set(b.weekdays)].sort(),
  b.slotMinutes,
  b.maxDurationMinutes,
  b.minAdvanceHours,
  b.maxAdvanceDays,
  b.cancelHours,
  b.maxActivePerUnit ?? null,
  b.cost,
  b.requiresApproval,
  b.blockDelinquent,
  b.isActive
];

const duplicateName = (err: unknown) => {
  if ((err as { code?: string }).code === "23505") throw conflict("DUPLICATE_NAME", "Ya existe un área con ese nombre");
  throw err;
};

bookingRoutes.get(
  "/amenities",
  handler({}, async () => {
    const rows = await query<AmenityRow & { upcoming: number; pending: number }>(
      `SELECT ${AMENITY_SELECT},
              (SELECT COUNT(*)::int FROM bookings b WHERE b.amenity_id = a.id AND b.status = 'approved' AND b.ends_at > now()) AS upcoming,
              (SELECT COUNT(*)::int FROM bookings b WHERE b.amenity_id = a.id AND b.status = 'pending' AND b.starts_at > now()) AS pending
         FROM amenities a ORDER BY a.is_active DESC, a.name`
    );
    return rows.map(withAmenityPhoto);
  })
);

bookingRoutes.post(
  "/amenities",
  requirePermission("BOOKINGS", "add_new"),
  handler({ body: amenityBody }, async ({ req, body }) => {
    const row = await withTx(txCtx(req), (client) =>
      one<{ id: string }>(
        `INSERT INTO amenities (${AMENITY_COLUMNS}, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, fn_current_app_user())
         RETURNING id`,
        amenityValues(body),
        client
      )
    ).catch(duplicateName);
    return withAmenityPhoto((await amenityById(row!.id))!);
  })
);

bookingRoutes.put(
  "/amenities/:id",
  requirePermission("BOOKINGS", "edit"),
  handler({ params: idParams, body: amenityBody }, async ({ req, params, body }) => {
    const row = await withTx(txCtx(req), (client) =>
      one<{ id: string }>(
        `UPDATE amenities SET (${AMENITY_COLUMNS}, updated_by) =
           ($2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, fn_current_app_user())
          WHERE id = $1 RETURNING id`,
        [params.id, ...amenityValues(body)],
        client
      )
    ).catch(duplicateName);
    if (!row) throw notFound("Área no encontrada");
    return withAmenityPhoto((await amenityById(row.id))!);
  })
);

bookingRoutes.put(
  "/amenities/:id/photo",
  requirePermission("BOOKINGS", "edit"),
  rawUpload,
  handler({ params: idParams }, async ({ req, params }) => {
    if (!(await amenityById(params.id))) throw notFound("Área no encontrada");
    const stored = await replaceImage({
      req,
      condominiumId: condominiumOf(req),
      profile: "amenity",
      purpose: "amenity_photo",
      withTx: (fn) => withTx(txCtx(req), fn),
      attach: async (client, fileId) => {
        const prev = await one<{ prev: string | null }>(
          `UPDATE amenities x SET photo_file_id = $2 FROM (SELECT photo_file_id AS prev FROM amenities WHERE id = $1) old
            WHERE x.id = $1 RETURNING old.prev`,
          [params.id, fileId],
          client
        );
        return prev?.prev ?? null;
      }
    });
    return { card: signedUrl(stored.storageKey, "480x360.webp"), cover: signedUrl(stored.storageKey, "1200x675.webp"), full: signedUrl(stored.storageKey, "orig.webp") };
  })
);

bookingRoutes.get(
  "/amenities/:id/availability",
  handler({ params: idParams, query: z.object({ date: isoDate }) }, async ({ params, query: q }) => {
    const a = await amenityById(params.id);
    if (!a) throw notFound("Área no encontrada");
    return availability(a, q.date, null, true);
  })
);

// ================================================================== Calendario

bookingRoutes.get(
  "/calendar",
  handler({ query: z.object({ amenityId: z.uuid().optional(), from: isoDate, to: isoDate }) }, async ({ query: q }) => {
    if (q.to < q.from) throw badRequest("BAD_RANGE", "El rango de fechas no es válido");
    const [bookings, blocks] = await Promise.all([
      query<BookingRow>(
        `SELECT ${BOOKING_SELECT} ${BOOKING_JOINS}
          WHERE b.status IN ('pending', 'approved') AND b.starts_at < ($3::date + 1)::timestamptz AND b.ends_at > $2::date::timestamptz
            AND ($1::uuid IS NULL OR b.amenity_id = $1)
          ORDER BY b.starts_at LIMIT 1000`,
        [q.amenityId ?? null, q.from, q.to]
      ),
      query(
        `SELECT k.id, k.kind, k.reason, k.amenity_id AS "amenityId", a.name AS "amenityName", k.unit_id AS "unitId", u.code AS "unitCode",
                to_char(k.starts_at, 'YYYY-MM-DD"T"HH24:MI') AS "startsLocal", to_char(k.ends_at, 'YYYY-MM-DD"T"HH24:MI') AS "endsLocal"
           FROM amenity_blocks k LEFT JOIN amenities a ON a.id = k.amenity_id LEFT JOIN units u ON u.id = k.unit_id
          WHERE k.starts_at < ($3::date + 1)::timestamptz AND (k.ends_at IS NULL OR k.ends_at > $2::date::timestamptz)
            AND ($1::uuid IS NULL OR k.amenity_id IS NULL OR k.amenity_id = $1) AND k.kind <> 'restriction'
          ORDER BY k.starts_at`,
        [q.amenityId ?? null, q.from, q.to]
      )
    ]);
    return { bookings, blocks };
  })
);

// ================================================================== Reservas

const listQuery = z.object({
  status: z.enum(["pending", "approved", "rejected", "cancelled"]).optional(),
  amenityId: z.uuid().optional(),
  unitId: z.uuid().optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  scope: z.enum(["upcoming", "past", "all"]).default("all"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(50)
});

function listWhere(q: z.infer<typeof listQuery>) {
  const where: string[] = [];
  const params: unknown[] = [];
  const add = (sql: string, v: unknown) => {
    params.push(v);
    where.push(sql.replace("?", `$${params.length}`));
  };
  if (q.status) add("b.status = ?", q.status);
  if (q.amenityId) add("b.amenity_id = ?", q.amenityId);
  if (q.unitId) add("b.unit_id = ?", q.unitId);
  if (q.from) add("b.starts_at >= ?::date::timestamptz", q.from);
  if (q.to) add("b.starts_at < (?::date + 1)::timestamptz", q.to);
  if (q.scope === "upcoming") where.push(q.status ? "b.ends_at > now()" : "b.ends_at > now() AND b.status IN ('pending', 'approved')");
  if (q.scope === "past") where.push("b.ends_at <= now()");
  return { sql: where.length ? `WHERE ${where.join(" AND ")}` : "", params, order: q.scope === "upcoming" ? "b.starts_at ASC" : "b.starts_at DESC" };
}

bookingRoutes.get(
  "/list",
  handler({ query: listQuery }, async ({ query: q }) => {
    const w = listWhere(q);
    const [rows, total] = await Promise.all([
      query<BookingRow>(
        `SELECT ${BOOKING_SELECT} ${BOOKING_JOINS} ${w.sql} ORDER BY ${w.order}
          LIMIT ${q.pageSize} OFFSET ${(q.page - 1) * q.pageSize}`,
        w.params
      ),
      one<{ n: number }>(`SELECT COUNT(*)::int AS n FROM bookings b ${w.sql}`, w.params)
    ]);
    return { rows, total: total?.n ?? 0 };
  })
);

bookingRoutes.get(
  "/list/export",
  requirePermission("BOOKINGS", "download"),
  handler({ query: listQuery.extend({ format: z.enum(["xlsx", "pdf"]).default("xlsx") }) }, async ({ req, res, query: q }) => {
    const w = listWhere(q);
    const rows = await query<BookingRow>(`SELECT ${BOOKING_SELECT} ${BOOKING_JOINS} ${w.sql} ORDER BY ${w.order} LIMIT 5000`, w.params);
    const c = await condoMoney(condominiumOf(req));
    const columns: ExportColumn<BookingRow>[] = [
      { header: "Fecha", width: 11, value: (b) => `${b.date.slice(8, 10)}/${b.date.slice(5, 7)}/${b.date.slice(0, 4)}` },
      { header: "Horario", width: 12, value: (b) => `${b.timeFrom}–${b.timeTo}` },
      { header: "Área", width: 22, value: (b) => b.amenityName },
      { header: "Filial", width: 10, value: (b) => (b.unitTower ? `${b.unitTower} ${b.unitCode}` : b.unitCode) },
      { header: "Personas", width: 8, value: (b) => b.guests },
      { header: "Estado", width: 12, value: (b) => BOOKING_STATUS_LABEL[b.status] },
      { header: "Costo", width: 12, value: (b) => (b.cost > 0 ? money(b.cost, c) : "") },
      { header: "Reservó", width: 20, value: (b) => b.bookedByName ?? "" },
      { header: "Notas", width: 30, value: (b) => b.cancelReason ?? b.reviewNotes ?? b.notes ?? "" }
    ];
    const spec = {
      title: "Reservaciones",
      subtitle: [q.from && `Desde ${q.from}`, q.to && `hasta ${q.to}`, q.status && BOOKING_STATUS_LABEL[q.status]].filter(Boolean).join(" · ") || "Todas",
      condominium: c.name,
      color: c.color,
      timezone: c.timezone,
      columns,
      rows,
      fileBase: "reservaciones"
    };
    await (q.format === "pdf" ? sendPdf(res, spec) : sendXlsx(res, spec));
  })
);

bookingRoutes.get(
  "/list/:id",
  handler({ params: idParams }, async ({ params }) => {
    const b = await bookingById(params.id);
    if (!b) throw bookingNotFound();
    return b;
  })
);

bookingRoutes.post(
  "/list",
  requirePermission("BOOKINGS", "add_new"),
  handler(
    {
      body: z.object({
        amenityId: z.uuid(),
        unitId: z.uuid(),
        date: isoDate,
        time: hhmm,
        minutes: z.coerce.number().int().min(15).max(1440),
        guests: z.coerce.number().int().min(1).max(2000).default(1),
        notes: optText(500)
      })
    },
    async ({ req, body }) => {
      const condominiumId = condominiumOf(req);
      const r = await withTx(txCtx(req), (client) => createBooking(client, body, true));
      const b = (await bookingById(r.id))!;
      await broadcastBooking(condominiumId, b);
      await notifyBooking(condominiumId, b, "created_by_admin", authOf(req).userId);
      return b;
    }
  )
);

bookingRoutes.post(
  "/list/:id/approve",
  requirePermission("BOOKINGS", "approve"),
  handler({ params: idParams, body: z.object({ notes: optText(500) }) }, async ({ req, params, body }) => {
    const condominiumId = condominiumOf(req);
    await withTx(txCtx(req), async (client) => {
      const row = await one<{ id: string }>(
        `UPDATE bookings SET status = 'approved', reviewed_by = fn_current_app_user(), reviewed_at = now(), review_notes = $2
          WHERE id = $1 AND status = 'pending' AND starts_at > now() RETURNING id`,
        [params.id, body.notes],
        client
      );
      if (!row) throw conflict("NOT_PENDING", "La reserva ya fue revisada o el horario ya pasó");
      await chargeBooking(client, params.id);
    });
    const b = (await bookingById(params.id))!;
    await broadcastBooking(condominiumId, b);
    await notifyBooking(condominiumId, b, "approved", authOf(req).userId);
    return b;
  })
);

bookingRoutes.post(
  "/list/:id/reject",
  requirePermission("BOOKINGS", "approve"),
  handler({ params: idParams, body: z.object({ notes: z.string().trim().min(3, "Escriba el motivo del rechazo").max(500) }) }, async ({ req, params, body }) => {
    const condominiumId = condominiumOf(req);
    const row = await withTx(txCtx(req), (client) =>
      one<{ id: string }>(
        `UPDATE bookings SET status = 'rejected', reviewed_by = fn_current_app_user(), reviewed_at = now(), review_notes = $2
          WHERE id = $1 AND status = 'pending' RETURNING id`,
        [params.id, body.notes],
        client
      )
    );
    if (!row) throw conflict("NOT_PENDING", "La reserva ya fue revisada");
    const b = (await bookingById(params.id))!;
    await broadcastBooking(condominiumId, b);
    await notifyBooking(condominiumId, b, "rejected", authOf(req).userId);
    return b;
  })
);

bookingRoutes.post(
  "/list/:id/cancel",
  requirePermission("BOOKINGS", "delete"),
  handler({ params: idParams, body: reasonBody }, async ({ req, params, body }) => {
    const condominiumId = condominiumOf(req);
    if (!(await bookingById(params.id))) throw bookingNotFound();
    await withTx(txCtx(req), async (client) => {
      const row = await one<{ id: string }>(
        `UPDATE bookings SET status = 'cancelled', cancelled_by = fn_current_app_user(), cancelled_at = now(), cancel_reason = $2
          WHERE id = $1 AND status IN ('pending', 'approved') AND ends_at > now() RETURNING id`,
        [params.id, body.reason],
        client
      );
      if (!row) throw conflict("NOT_CANCELLABLE", "La reserva ya terminó o ya estaba cancelada");
      // Cancela la administración: el cargo siempre se anula
      await voidBookingCharge(client, params.id, `Reservación cancelada por la administración: ${body.reason}`);
    });
    const b = (await bookingById(params.id))!;
    await broadcastBooking(condominiumId, b);
    await notifyBooking(condominiumId, b, "cancelled_by_admin", authOf(req).userId);
    return b;
  })
);

// ================================================================== Feriados, cierres y restricciones

const BLOCK_SELECT = `k.id, k.kind, k.reason, k.amenity_id AS "amenityId", a.name AS "amenityName", k.unit_id AS "unitId",
  u.code AS "unitCode", u.tower AS "unitTower", k.starts_at AS "startsAt", k.ends_at AS "endsAt",
  to_char(k.starts_at, 'YYYY-MM-DD HH24:MI') AS "startsLocal", to_char(k.ends_at, 'YYYY-MM-DD HH24:MI') AS "endsLocal",
  (k.ends_at IS NULL OR k.ends_at > now()) AS active, cb.names AS "createdByName", k.created_at AS "createdAt"`;
const BLOCK_JOINS = `FROM amenity_blocks k LEFT JOIN amenities a ON a.id = k.amenity_id LEFT JOIN units u ON u.id = k.unit_id
  LEFT JOIN users cb ON cb.id = k.created_by`;

bookingRoutes.get(
  "/blocks",
  handler({ query: z.object({ scope: z.enum(["active", "all"]).default("active") }) }, async ({ query: q }) =>
    query(
      `SELECT ${BLOCK_SELECT} ${BLOCK_JOINS}
        ${q.scope === "active" ? "WHERE k.ends_at IS NULL OR k.ends_at > now()" : ""}
        ORDER BY k.starts_at DESC LIMIT 300`
    )
  )
);

bookingRoutes.post(
  "/blocks",
  requirePermission("BOOKINGS", "configure"),
  handler(
    {
      body: z
        .object({
          kind: z.enum(["holiday", "unavailable", "restriction"]),
          amenityId: z.uuid().nullish(),
          unitId: z.uuid().nullish(),
          from: isoDate,
          fromTime: hhmm.nullish(),
          to: isoDate.nullish(),
          toTime: hhmm.nullish(),
          reason: z.string().trim().min(3, "Escriba el motivo").max(200),
          cancelBookings: z.boolean().default(false)
        })
        .refine((b) => (b.kind === "restriction") === Boolean(b.unitId), { message: "La restricción es para una filial", path: ["unitId"] })
    },
    async ({ req, body }) => {
      const condominiumId = condominiumOf(req);
      const result = await withTx(txCtx(req), async (client) => {
        const block = await one<{ id: string; startsAt: Date; endsAt: Date | null }>(
          `INSERT INTO amenity_blocks (amenity_id, unit_id, kind, starts_at, ends_at, reason, created_by)
           VALUES ($1, $2, $3, ($4::date + COALESCE($5::text, '00:00')::time)::timestamptz,
                   CASE WHEN $6::date IS NULL THEN NULL
                        WHEN $7::text IS NULL THEN ($6::date + 1)::timestamptz
                        ELSE ($6::date + $7::text::time)::timestamptz END,
                   $8, fn_current_app_user())
           RETURNING id, starts_at AS "startsAt", ends_at AS "endsAt"`,
          [body.amenityId ?? null, body.unitId ?? null, body.kind, body.from, body.fromTime ?? null, body.to ?? null, body.toTime ?? null, body.reason],
          client
        ).catch((err: { code?: string }) => {
          if (err.code === "23514") throw badRequest("BAD_RANGE", "El final debe ser posterior al inicio");
          throw err;
        });
        // Reservas activas que chocan con el bloqueo
        const affected = await query<{ id: string }>(
          `SELECT id FROM bookings WHERE status IN ('pending', 'approved') AND ends_at > now()
              AND ($1::uuid IS NULL OR amenity_id = $1) AND ($2::uuid IS NULL OR unit_id = $2)
              AND starts_at < COALESCE($4::timestamptz, 'infinity') AND ends_at > $3`,
          [body.amenityId ?? null, body.unitId ?? null, block!.startsAt, block!.endsAt],
          client
        );
        if (body.cancelBookings && affected.length) {
          const reason = `${BLOCK_KIND_LABEL[body.kind]}: ${body.reason}`.slice(0, 300);
          await client.query(
            `UPDATE bookings SET status = 'cancelled', cancelled_by = fn_current_app_user(), cancelled_at = now(), cancel_reason = $2
              WHERE id = ANY ($1::uuid[])`,
            [affected.map((a) => a.id), reason]
          );
          for (const a of affected) await voidBookingCharge(client, a.id, `Reservación cancelada · ${reason}`);
        }
        return { id: block!.id, affected: affected.map((a) => a.id) };
      });

      if (body.cancelBookings) {
        for (const id of result.affected) {
          const b = (await bookingById(id))!;
          await broadcastBooking(condominiumId, b);
          await notifyBooking(condominiumId, b, "cancelled_by_admin", authOf(req).userId);
        }
      }
      const block = await one(`SELECT ${BLOCK_SELECT} ${BLOCK_JOINS} WHERE k.id = $1`, [result.id]);
      return { block, affected: result.affected.length, cancelled: body.cancelBookings ? result.affected.length : 0 };
    }
  )
);

bookingRoutes.delete(
  "/blocks/:id",
  requirePermission("BOOKINGS", "configure"),
  handler({ params: idParams }, async ({ req, params }) => {
    const row = await withTx(txCtx(req), (client) => one<{ id: string }>(`DELETE FROM amenity_blocks WHERE id = $1 RETURNING id`, [params.id], client));
    if (!row) throw notFound("Bloqueo no encontrado");
    return undefined;
  })
);
