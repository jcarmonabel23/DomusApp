/**
 * @project DomusApp - API
 * @file src/modules/bookings/resident.ts
 * @description Reservaciones en la app del Propietario / Inquilino
 *
 *  GET  /resident/bookings/amenities                     áreas activas (con foto) y la reserva próxima de cada una
 *  GET  /resident/bookings/amenities/:id                 detalle: reglamento, horario, reglas y sus próximas reservas
 *  GET  /resident/bookings/amenities/:id/availability    horarios de un día (?date=AAAA-MM-DD&unitId=)
 *  POST /resident/bookings                               reserva (queda aprobada o por aprobar según el área)
 *  GET  /resident/bookings/mine                          reservas de sus filiales (?scope=upcoming|past)
 *  POST /resident/bookings/:id/cancel                    cancela (con la anticipación del área se anula el cargo)
 */

import { Router } from "express";
import { z } from "zod";
import { one, query, withTx } from "../../db.js";
import { conflict, handler, idParams, notFound } from "../../lib/http.js";
import { requireRole } from "../../security/authorize.js";
import { authOf, condominiumOf, txCtx } from "../../security/context.js";
import { assertResidentUnit, optText, residentUnitIds } from "../access/shared.js";
import {
  AMENITY_SELECT,
  BOOKING_JOINS,
  BOOKING_SELECT,
  amenityById,
  availability,
  bookingById,
  bookingNotFound,
  broadcastBooking,
  createBooking,
  notifyBooking,
  voidBookingCharge,
  withAmenityPhoto,
  type AmenityRow,
  type BookingRow
} from "./shared.js";

export const residentBookingRoutes = Router();
residentBookingRoutes.use(requireRole("owner", "tenant", "admin"));

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida (AAAA-MM-DD)");

/** Filial para consultar: la pedida (si es suya) o la primera */
async function pickUnit(userId: string, unitId?: string | null): Promise<string | null> {
  const units = await residentUnitIds(userId);
  if (unitId) {
    if (!units.includes(unitId)) await assertResidentUnit(userId, unitId);
    return unitId;
  }
  return units[0] ?? null;
}

residentBookingRoutes.get(
  "/bookings/amenities",
  handler({}, async ({ req }) => {
    const units = await residentUnitIds(authOf(req).userId);
    const rows = await query<AmenityRow & { nextBooking: { id: string; date: string; timeFrom: string; status: string } | null }>(
      `SELECT ${AMENITY_SELECT},
              (SELECT json_build_object('id', b.id, 'date', to_char(b.starts_at, 'YYYY-MM-DD'), 'timeFrom', to_char(b.starts_at, 'HH24:MI'), 'status', b.status)
                 FROM bookings b WHERE b.amenity_id = a.id AND b.unit_id = ANY ($1::uuid[]) AND b.status IN ('pending', 'approved') AND b.ends_at > now()
                ORDER BY b.starts_at LIMIT 1) AS "nextBooking"
         FROM amenities a WHERE a.is_active ORDER BY a.name`,
      [units]
    );
    return rows.map(withAmenityPhoto);
  })
);

residentBookingRoutes.get(
  "/bookings/amenities/:id",
  handler({ params: idParams }, async ({ params }) => {
    const a = await amenityById(params.id);
    if (!a || !a.isActive) throw notFound("Área no encontrada");
    return withAmenityPhoto(a);
  })
);

residentBookingRoutes.get(
  "/bookings/amenities/:id/availability",
  handler({ params: idParams, query: z.object({ date: isoDate, unitId: z.uuid().optional() }) }, async ({ req, params, query: q }) => {
    const a = await amenityById(params.id);
    if (!a || !a.isActive) throw notFound("Área no encontrada");
    const unitId = await pickUnit(authOf(req).userId, q.unitId);
    return availability(a, q.date, unitId);
  })
);

residentBookingRoutes.post(
  "/bookings",
  handler(
    {
      body: z.object({
        amenityId: z.uuid(),
        unitId: z.uuid(),
        date: isoDate,
        time: z.string().regex(/^\d{2}:\d{2}$/, "Hora inválida (HH:MM)"),
        minutes: z.coerce.number().int().min(15).max(1440),
        guests: z.coerce.number().int().min(1).max(2000).default(1),
        notes: optText(500),
        acceptRules: z.literal(true, { error: "Debe aceptar el reglamento del área" })
      })
    },
    async ({ req, body }) => {
      const condominiumId = condominiumOf(req);
      await assertResidentUnit(authOf(req).userId, body.unitId);
      const r = await withTx(txCtx(req), (client) => createBooking(client, body, false));
      const b = (await bookingById(r.id))!;
      await broadcastBooking(condominiumId, b);
      if (b.status === "pending") await notifyBooking(condominiumId, b, "requested", authOf(req).userId);
      return b;
    }
  )
);

residentBookingRoutes.get(
  "/bookings/mine",
  handler({ query: z.object({ scope: z.enum(["upcoming", "past"]).default("upcoming") }) }, async ({ req, query: q }) => {
    const units = await residentUnitIds(authOf(req).userId);
    if (!units.length) return [];
    const upcoming = q.scope === "upcoming";
    return query<BookingRow>(
      `SELECT ${BOOKING_SELECT} ${BOOKING_JOINS}
        WHERE b.unit_id = ANY ($1::uuid[])
          AND ${upcoming ? "b.ends_at > now() AND b.status IN ('pending', 'approved')" : "(b.ends_at <= now() OR b.status IN ('rejected', 'cancelled'))"}
        ORDER BY b.starts_at ${upcoming ? "ASC" : "DESC"} LIMIT 100`,
      [units]
    );
  })
);

residentBookingRoutes.post(
  "/bookings/:id/cancel",
  handler({ params: idParams, body: z.object({ reason: optText(300) }) }, async ({ req, params, body }) => {
    const auth = authOf(req);
    const condominiumId = condominiumOf(req);
    const current = await bookingById(params.id);
    if (!current || !(await residentUnitIds(auth.userId)).includes(current.unitId)) throw bookingNotFound();

    const outcome = await withTx(txCtx(req), async (client) => {
      const row = await one<{ id: string; onTime: boolean }>(
        `UPDATE bookings b SET status = 'cancelled', cancelled_by = fn_current_app_user(), cancelled_at = now(), cancel_reason = $2
           FROM amenities a
          WHERE b.id = $1 AND a.id = b.amenity_id AND b.status IN ('pending', 'approved') AND b.starts_at > now()
          RETURNING b.id, (b.starts_at - now() >= make_interval(hours => a.cancel_hours)) AS "onTime"`,
        [params.id, body.reason],
        client
      );
      if (!row) throw conflict("NOT_CANCELLABLE", "La reserva ya empezó o ya estaba cancelada");
      const refunded = row.onTime ? await voidBookingCharge(client, params.id, "Reservación cancelada a tiempo") : false;
      return { refunded };
    });

    const b = (await bookingById(params.id))!;
    await broadcastBooking(condominiumId, b);
    if (current.status === "approved" || current.status === "pending") await notifyBooking(condominiumId, b, "cancelled_by_resident", auth.userId);
    return { ...b, refunded: outcome.refunded, chargeKept: Boolean(b.chargeId) && !b.chargeVoided };
  })
);
