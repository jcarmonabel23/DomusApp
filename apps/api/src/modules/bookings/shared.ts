/**
 * @project DomusApp - API
 * @file src/modules/bookings/shared.ts
 * @description Reservaciones: consultas, disponibilidad por horario, validación de una reserva, cargo al
 *              estado de cuenta y avisos
 *
 * Fechas y horas: el cliente manda fecha local ("2026-11-14") y hora local ("10:00"); la conversión a instante
 * la hace PostgreSQL con la zona horaria del condominio (la fija cada consulta y transacción).
 *
 * Concurrencia: la reserva bloquea la fila del área (SELECT … FOR UPDATE) mientras valida cruces y capacidad,
 * así dos solicitudes simultáneas para el mismo horario no pasan las dos.
 */

import type pg from "pg";
import { one, query, type Db } from "../../db.js";
import { HttpError, badRequest, conflict, notFound } from "../../lib/http.js";
import { emitToUnit, emitToUser } from "../../lib/realtime.js";
import { fileKey, signedUrl } from "../files/images.js";
import { balancesToday, condoMoney, financeSettings, money } from "../finance/shared.js";
import { adminUserIds, notify, unitUserIds } from "../notifications/service.js";

export const AMENITY_ICONS = ["pool", "bbq", "event", "sports", "gym", "playground", "games", "cowork", "other"] as const;
export const BOOKING_STATUS_LABEL: Record<string, string> = {
  pending: "Por aprobar",
  approved: "Aprobada",
  rejected: "Rechazada",
  cancelled: "Cancelada"
};
export const BLOCK_KIND_LABEL: Record<string, string> = { holiday: "Feriado", unavailable: "No disponible", restriction: "Restricción" };
export const WEEKDAY_SHORT = ["", "L", "K", "M", "J", "V", "S", "D"];

// ------------------------------------------------------------------ Áreas

export const AMENITY_SELECT = `a.id, a.name, a.icon, a.description, a.rules, a.mode, a.capacity,
  to_char(a.open_time, 'HH24:MI') AS "openTime", to_char(a.close_time, 'HH24:MI') AS "closeTime",
  a.weekdays, a.slot_minutes AS "slotMinutes", a.max_duration_minutes AS "maxDurationMinutes",
  a.min_advance_hours AS "minAdvanceHours", a.max_advance_days AS "maxAdvanceDays", a.cancel_hours AS "cancelHours",
  a.max_active_per_unit AS "maxActivePerUnit", a.cost::float8 AS cost, a.requires_approval AS "requiresApproval",
  a.block_delinquent AS "blockDelinquent", a.is_active AS "isActive",
  a.photo_file_id AS "photoFileId", a.condominium_id AS "condominiumId"`;

export interface AmenityRow {
  id: string;
  name: string;
  icon: string;
  description: string | null;
  rules: string | null;
  mode: "exclusive" | "shared";
  capacity: number;
  openTime: string;
  closeTime: string;
  weekdays: number[];
  slotMinutes: number;
  maxDurationMinutes: number;
  minAdvanceHours: number;
  maxAdvanceDays: number;
  cancelHours: number;
  maxActivePerUnit: number | null;
  cost: number;
  requiresApproval: boolean;
  blockDelinquent: boolean;
  isActive: boolean;
  photoFileId: string | null;
  condominiumId: string;
}

/** Quita ids internos y agrega las URLs firmadas de la foto (tarjeta 4:3, portada 16:9 y completa) */
export function withAmenityPhoto<T extends { photoFileId: string | null; condominiumId: string }>(row: T) {
  const { photoFileId, condominiumId, ...rest } = row;
  const key = fileKey(condominiumId, photoFileId);
  return {
    ...rest,
    photo: key ? { card: signedUrl(key, "480x360.webp"), cover: signedUrl(key, "1200x675.webp"), full: signedUrl(key, "orig.webp") } : null
  };
}

export async function amenityById(id: string, db?: Db): Promise<AmenityRow | null> {
  return one<AmenityRow>(`SELECT ${AMENITY_SELECT} FROM amenities a WHERE a.id = $1`, [id], db);
}

// ------------------------------------------------------------------ Reservas

export const BOOKING_SELECT = `b.id, b.amenity_id AS "amenityId", a.name AS "amenityName", a.icon AS "amenityIcon", a.mode AS "amenityMode",
  b.unit_id AS "unitId", u.code AS "unitCode", u.tower AS "unitTower",
  b.starts_at AS "startsAt", b.ends_at AS "endsAt",
  to_char(b.starts_at, 'YYYY-MM-DD') AS date, to_char(b.starts_at, 'HH24:MI') AS "timeFrom", to_char(b.ends_at, 'HH24:MI') AS "timeTo",
  b.guests, b.notes, b.status, b.cost::float8 AS cost, b.charge_id AS "chargeId", (ch.voided_at IS NOT NULL) AS "chargeVoided",
  b.booked_by AS "bookedBy", bb.names AS "bookedByName", rv.names AS "reviewedByName", b.reviewed_at AS "reviewedAt",
  b.review_notes AS "reviewNotes", cb.names AS "cancelledByName", b.cancelled_at AS "cancelledAt", b.cancel_reason AS "cancelReason",
  b.created_at AS "createdAt", a.cancel_hours AS "cancelHours", (b.starts_at <= now()) AS "started"`;

export const BOOKING_JOINS = `FROM bookings b
  JOIN amenities a ON a.id = b.amenity_id
  JOIN units u ON u.id = b.unit_id
  LEFT JOIN charges ch ON ch.id = b.charge_id
  LEFT JOIN users bb ON bb.id = b.booked_by
  LEFT JOIN users rv ON rv.id = b.reviewed_by
  LEFT JOIN users cb ON cb.id = b.cancelled_by`;

export interface BookingRow {
  id: string;
  amenityId: string;
  amenityName: string;
  amenityIcon: string;
  amenityMode: string;
  unitId: string;
  unitCode: string;
  unitTower: string | null;
  startsAt: string;
  endsAt: string;
  date: string;
  timeFrom: string;
  timeTo: string;
  guests: number;
  notes: string | null;
  status: "pending" | "approved" | "rejected" | "cancelled";
  cost: number;
  chargeId: string | null;
  chargeVoided: boolean;
  bookedBy: string | null;
  bookedByName: string | null;
  reviewedByName: string | null;
  reviewedAt: string | null;
  reviewNotes: string | null;
  cancelledByName: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  createdAt: string;
  cancelHours: number;
  started: boolean;
}

export async function bookingById(id: string, db?: Db): Promise<BookingRow | null> {
  return one<BookingRow>(`SELECT ${BOOKING_SELECT} ${BOOKING_JOINS} WHERE b.id = $1`, [id], db);
}

/** "Rancho BBQ · 14/11 10:00–14:00" */
export const bookingLabel = (b: Pick<BookingRow, "amenityName" | "date" | "timeFrom" | "timeTo">) =>
  `${b.amenityName} · ${b.date.slice(8, 10)}/${b.date.slice(5, 7)} ${b.timeFrom}–${b.timeTo}`;

const unitName = (b: Pick<BookingRow, "unitCode" | "unitTower">) => (b.unitTower ? `${b.unitTower} ${b.unitCode}` : b.unitCode);

// ------------------------------------------------------------------ Disponibilidad

export type SlotStatus = "available" | "reserved" | "mine" | "holiday" | "unavailable" | "past";

export interface Slot {
  time: string;
  startsAt: string;
  endsAt: string;
  status: SlotStatus;
  reason?: string;
  /** Lugares libres (áreas compartidas) */
  left?: number;
  /** Reservas en ese horario (solo para la administración) */
  bookings?: { id: string; unitCode: string; status: string; guests: number }[];
}

export interface DayAvailability {
  date: string;
  open: boolean;
  reason: string | null;
  slots: Slot[];
}

interface Block {
  kind: string;
  reason: string;
  startsAt: Date;
  endsAt: Date | null;
}

interface ActiveBooking {
  id: string;
  unitId: string;
  unitCode: string;
  status: string;
  guests: number;
  startsAt: Date;
  endsAt: Date;
}

/**
 * @function availability
 * @description Horarios de un día con su estado. `unitId` = la filial que consulta (marca "mine" y aplica sus
 * restricciones); `staff` = vista de la administración (sin anticipación mínima ni máxima, con las reservas).
 */
export async function availability(a: AmenityRow, date: string, unitId: string | null, staff = false, db?: Db): Promise<DayAvailability> {
  const day = await one<{ dow: number; ahead: number; dayStart: Date; dayEnd: Date; earliest: Date; now: Date }>(
    `SELECT EXTRACT(ISODOW FROM $1::date)::int AS dow, ($1::date - CURRENT_DATE)::int AS ahead,
            $1::date::timestamptz AS "dayStart", ($1::date + 1)::timestamptz AS "dayEnd",
            now() + make_interval(hours => $2::int) AS earliest, now() AS now`,
    [date, staff ? 0 : a.minAdvanceHours],
    db
  );
  const d = day!;
  if (!a.weekdays.includes(d.dow)) return { date, open: false, reason: "El área no abre ese día", slots: [] };
  if (!staff && d.ahead > a.maxAdvanceDays) {
    return { date, open: false, reason: `Se reserva con hasta ${a.maxAdvanceDays} días de anticipación`, slots: [] };
  }
  if (!staff && d.ahead < 0) return { date, open: false, reason: "La fecha ya pasó", slots: [] };

  const [slots, blocks, bookings] = await Promise.all([
    query<{ time: string; startsAt: Date; endsAt: Date }>(
      `SELECT to_char(gs, 'HH24:MI') AS time, gs AS "startsAt", gs + make_interval(mins => $4::int) AS "endsAt"
         FROM generate_series(($1::date + $2::time)::timestamptz, ($1::date + $3::time)::timestamptz - make_interval(mins => $4::int),
                              make_interval(mins => $4::int)) gs`,
      [date, a.openTime, a.closeTime, a.slotMinutes],
      db
    ),
    query<Block>(
      `SELECT kind, reason, starts_at AS "startsAt", ends_at AS "endsAt" FROM amenity_blocks
        WHERE (amenity_id IS NULL OR amenity_id = $1) AND (unit_id IS NULL OR unit_id = $2)
          AND starts_at < $4 AND (ends_at IS NULL OR ends_at > $3)
        ORDER BY (kind = 'holiday') DESC, (kind = 'restriction') DESC`,
      [a.id, unitId, d.dayStart, d.dayEnd],
      db
    ),
    query<ActiveBooking>(
      `SELECT b.id, b.unit_id AS "unitId", u.code AS "unitCode", b.status, b.guests, b.starts_at AS "startsAt", b.ends_at AS "endsAt"
         FROM bookings b JOIN units u ON u.id = b.unit_id
        WHERE b.amenity_id = $1 AND b.status IN ('pending', 'approved') AND b.starts_at < $3 AND b.ends_at > $2`,
      [a.id, d.dayStart, d.dayEnd],
      db
    )
  ]);

  const overlaps = (s: { startsAt: Date; endsAt: Date | null }, from: Date, to: Date) => s.startsAt < to && (s.endsAt === null || s.endsAt > from);
  const allDay = blocks.find((b) => b.startsAt <= d.dayStart && (b.endsAt === null || b.endsAt >= d.dayEnd));

  const result: Slot[] = slots.map((s) => {
    const slot: Slot = { time: s.time, startsAt: s.startsAt.toISOString(), endsAt: s.endsAt.toISOString(), status: "available" };
    const here = bookings.filter((b) => overlaps(b, s.startsAt, s.endsAt));
    if (staff) slot.bookings = here.map((b) => ({ id: b.id, unitCode: b.unitCode, status: b.status, guests: b.guests }));
    const block = blocks.find((b) => overlaps(b, s.startsAt, s.endsAt));
    const used = here.reduce((n, b) => n + b.guests, 0);

    if (s.startsAt < d.now) slot.status = "past";
    else if (block) {
      slot.status = block.kind === "holiday" ? "holiday" : "unavailable";
      slot.reason = block.reason;
    } else if (unitId && here.some((b) => b.unitId === unitId)) slot.status = "mine";
    else if (a.mode === "exclusive" ? here.length > 0 : used >= a.capacity) slot.status = "reserved";
    else if (s.startsAt < d.earliest) {
      slot.status = "past";
      slot.reason = `Se reserva con al menos ${a.minAdvanceHours} h de anticipación`;
    }
    if (a.mode === "shared" && slot.status !== "past") slot.left = Math.max(0, a.capacity - used);
    return slot;
  });

  return { date, open: true, reason: allDay ? allDay.reason : null, slots: result };
}

// ------------------------------------------------------------------ Validar y crear

export interface BookingInput {
  amenityId: string;
  unitId: string;
  date: string;
  time: string;
  minutes: number;
  guests: number;
  notes: string | null;
}

/**
 * @function createBooking
 * @description Valida y registra una reserva dentro de la transacción `client`.
 * La administración (`staff`) no está sujeta a anticipación, morosidad ni límite por filial, y su reserva
 * queda aprobada directamente.
 */
export async function createBooking(client: pg.PoolClient, input: BookingInput, staff: boolean): Promise<{ id: string; status: string }> {
  const a = await one<AmenityRow>(`SELECT ${AMENITY_SELECT} FROM amenities a WHERE a.id = $1 FOR UPDATE`, [input.amenityId], client);
  if (!a) throw notFound("Área no encontrada");
  if (!a.isActive) throw conflict("AMENITY_INACTIVE", "El área no está disponible para reservas");

  const t = (await one<{ startsAt: Date; endsAt: Date; dow: number; ahead: number; offset: number; closesAt: Date; earliest: Date; future: boolean }>(
    `SELECT ($1::date + $2::time)::timestamptz AS "startsAt",
            ($1::date + $2::time)::timestamptz + make_interval(mins => $3::int) AS "endsAt",
            EXTRACT(ISODOW FROM $1::date)::int AS dow, ($1::date - CURRENT_DATE)::int AS ahead,
            (EXTRACT(EPOCH FROM ($2::time - $4::time)) / 60)::int AS "offset",
            ($1::date + $5::time)::timestamptz AS "closesAt",
            now() + make_interval(hours => $6::int) AS earliest,
            ($1::date + $2::time)::timestamptz > now() AS future`,
    [input.date, input.time, input.minutes, a.openTime, a.closeTime, staff ? 0 : a.minAdvanceHours],
    client
  ))!;

  if (!a.weekdays.includes(t.dow)) throw badRequest("CLOSED_DAY", "El área no abre ese día");
  if (t.offset < 0 || t.endsAt > t.closesAt) throw badRequest("OUT_OF_HOURS", `El horario del área es de ${a.openTime} a ${a.closeTime}`);
  if (t.offset % a.slotMinutes !== 0 || input.minutes % a.slotMinutes !== 0) {
    throw badRequest("BAD_SLOT", `Las reservas son en bloques de ${a.slotMinutes} minutos`);
  }
  if (input.minutes > a.maxDurationMinutes) throw badRequest("TOO_LONG", `La duración máxima es de ${durationText(a.maxDurationMinutes)}`);
  if (!t.future) throw badRequest("PAST", "Ese horario ya pasó");
  if (!staff && t.startsAt < t.earliest) throw conflict("TOO_SOON", `Esta área se reserva con al menos ${a.minAdvanceHours} h de anticipación`);
  if (!staff && t.ahead > a.maxAdvanceDays) throw conflict("TOO_FAR", `Se reserva con hasta ${a.maxAdvanceDays} días de anticipación`);
  if (input.guests > a.capacity) throw badRequest("OVER_CAPACITY", `La capacidad del área es de ${a.capacity} personas`);

  const block = await one<{ reason: string; kind: string }>(
    `SELECT reason, kind FROM amenity_blocks
      WHERE (amenity_id IS NULL OR amenity_id = $1) AND (unit_id IS NULL OR unit_id = $2)
        AND starts_at < $4 AND (ends_at IS NULL OR ends_at > $3)
      ORDER BY (kind = 'holiday') DESC LIMIT 1`,
    [a.id, input.unitId, t.startsAt, t.endsAt],
    client
  );
  if (block) {
    throw conflict(
      block.kind === "restriction" ? "RESTRICTED" : "BLOCKED",
      block.kind === "restriction" ? `Su filial tiene restringida esta área: ${block.reason}` : `No disponible: ${block.reason}`
    );
  }

  if (!staff && a.blockDelinquent) {
    const settings = await financeSettings(client);
    const [balance] = await balancesToday([input.unitId], settings.graceDays, client);
    if (balance && balance.overdue > 0) {
      throw conflict("DELINQUENT", "Esta área no se puede reservar con saldo vencido. Póngase al día en el estado de cuenta.");
    }
  }

  if (!staff && a.maxActivePerUnit) {
    const active = await one<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM bookings WHERE amenity_id = $1 AND unit_id = $2 AND status IN ('pending', 'approved') AND ends_at > now()`,
      [a.id, input.unitId],
      client
    );
    if ((active?.n ?? 0) >= a.maxActivePerUnit) {
      throw conflict("LIMIT_REACHED", `Su filial ya tiene ${a.maxActivePerUnit} reserva(s) activa(s) de esta área`);
    }
  }

  const overlap = await one<{ n: number; guests: number; mine: number }>(
    `SELECT COUNT(*)::int AS n, COALESCE(SUM(guests), 0)::int AS guests, COUNT(*) FILTER (WHERE unit_id = $4)::int AS mine
       FROM bookings WHERE amenity_id = $1 AND status IN ('pending', 'approved') AND starts_at < $3 AND ends_at > $2`,
    [a.id, t.startsAt, t.endsAt, input.unitId],
    client
  );
  if (overlap!.mine > 0) throw conflict("ALREADY_BOOKED", "Su filial ya tiene una reserva en ese horario");
  if (a.mode === "exclusive" && overlap!.n > 0) throw conflict("SLOT_TAKEN", "Ese horario ya está reservado");
  if (a.mode === "shared" && overlap!.guests + input.guests > a.capacity) {
    throw conflict("FULL", `Solo quedan ${Math.max(0, a.capacity - overlap!.guests)} lugar(es) en ese horario`);
  }

  const status = a.requiresApproval && !staff ? "pending" : "approved";
  const row = await one<{ id: string }>(
    `INSERT INTO bookings (amenity_id, unit_id, starts_at, ends_at, guests, notes, status, cost, booked_by,
                           reviewed_by, reviewed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, fn_current_app_user(),
             CASE WHEN $9 THEN fn_current_app_user() END, CASE WHEN $9 THEN now() END)
     RETURNING id`,
    [a.id, input.unitId, t.startsAt, t.endsAt, input.guests, input.notes, status, a.cost, staff],
    client
  );
  if (status === "approved") await chargeBooking(client, row!.id);
  return { id: row!.id, status };
}

export const durationText = (minutes: number) =>
  minutes % 60 === 0 ? `${minutes / 60} h` : minutes > 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes} min`;

// ------------------------------------------------------------------ Cargo al estado de cuenta

/** Carga el costo de la reserva a la filial (si tiene costo y aún no se cargó) */
export async function chargeBooking(client: pg.PoolClient, bookingId: string): Promise<void> {
  await client.query(
    `WITH ch AS (
       INSERT INTO charges (unit_id, kind, concept, amount, due_date, notes, created_by)
       SELECT b.unit_id, 'special', LEFT('Reservación ' || a.name || ' · ' || to_char(b.starts_at, 'DD/MM/YYYY HH24:MI'), 160),
              b.cost, GREATEST(CURRENT_DATE, b.starts_at::date), 'Reservación de área común', fn_current_app_user()
         FROM bookings b JOIN amenities a ON a.id = b.amenity_id
        WHERE b.id = $1 AND b.cost > 0 AND b.charge_id IS NULL
       RETURNING id
     )
     UPDATE bookings SET charge_id = ch.id FROM ch WHERE bookings.id = $1`,
    [bookingId]
  );
}

/** Anula el cargo de la reserva (si lo tiene y no estaba anulado) */
export async function voidBookingCharge(client: pg.PoolClient, bookingId: string, reason: string): Promise<boolean> {
  const r = await client.query(
    `UPDATE charges SET voided_at = now(), voided_by = fn_current_app_user(), void_reason = $2
      WHERE id = (SELECT charge_id FROM bookings WHERE id = $1) AND voided_at IS NULL`,
    [bookingId, reason.slice(0, 300)]
  );
  return (r.rowCount ?? 0) > 0;
}

// ------------------------------------------------------------------ Avisos y tiempo real

/** Evento en vivo para la filial, quien reservó y la administración */
export async function broadcastBooking(condominiumId: string, b: BookingRow): Promise<void> {
  const data = { bookingId: b.id, amenityId: b.amenityId, unitId: b.unitId, status: b.status };
  emitToUnit(condominiumId, b.unitId, "bookings:update", data);
  if (b.bookedBy) emitToUser(b.bookedBy, "bookings:update", data);
  for (const id of await adminUserIds(condominiumId)) emitToUser(id, "bookings:update", data);
}

export type BookingEvent = "requested" | "approved" | "rejected" | "cancelled_by_admin" | "cancelled_by_resident" | "created_by_admin";

/** Aviso según lo que pasó: a la administración (solicitud / cancelación) o a la filial (resultado) */
export async function notifyBooking(condominiumId: string, b: BookingRow, event: BookingEvent, actorId?: string): Promise<void> {
  const label = bookingLabel(b);
  const data = { bookingId: b.id, unitId: b.unitId, amenityId: b.amenityId };
  const m = b.cost > 0 ? await condoMoney(condominiumId) : null;
  const cost = m ? ` Se cargaron ${money(b.cost, m)} a su estado de cuenta.` : "";

  if (event === "requested" || event === "cancelled_by_resident") {
    await notify(
      condominiumId,
      await adminUserIds(condominiumId),
      {
        kind: "booking",
        title: event === "requested" ? `Reserva por aprobar · ${unitName(b)}` : `Reserva cancelada · ${unitName(b)}`,
        body: event === "requested" ? `${label} · ${b.guests} persona(s)` : `${label}${b.cancelReason ? ` · ${b.cancelReason}` : ""}`,
        data
      },
      actorId
    );
    return;
  }
  const text: Record<Exclude<BookingEvent, "requested" | "cancelled_by_resident">, { title: string; body: string }> = {
    approved: { title: "Reserva aprobada", body: `${label}.${cost}` },
    created_by_admin: { title: "La administración reservó para su filial", body: `${label}.${cost}` },
    rejected: { title: "Reserva rechazada", body: `${label}${b.reviewNotes ? `: ${b.reviewNotes}` : ""}` },
    cancelled_by_admin: { title: "Reserva cancelada por la administración", body: `${label}${b.cancelReason ? `: ${b.cancelReason}` : ""}` }
  };
  await notify(condominiumId, await unitUserIds(condominiumId, b.unitId), { kind: "booking", ...text[event], data }, actorId);
}

/** Error de "no se encontró" para reservas fuera del alcance de quien consulta */
export const bookingNotFound = (): HttpError => notFound("Reserva no encontrada");
