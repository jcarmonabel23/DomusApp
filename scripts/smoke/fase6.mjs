// =====================================================================
//  DomusApp · scripts/smoke/fase6.mjs
//  Pruebas de humo de la fase 6 (áreas comunes y reservaciones) con SEED_DEMO=true:
//  permisos, áreas y disponibilidad, feriado, restricción por filial, morosidad,
//  validaciones (horario, bloques, duración, capacidad, límite por filial),
//  cruces y concurrencia, aprobación / rechazo con avisos, cargo al estado de
//  cuenta y su anulación al cancelar, bloqueos que cancelan reservas, foto y exportes.
//  Es repetible: crea un área de prueba, cancela lo que reservó y la desactiva.
//    node scripts/smoke/fase6.mjs
// =====================================================================

import { BASE, call, finish, login, ok, png, socket } from "./lib.mjs";

console.log(`════════ Fase 6 · áreas comunes y reservaciones (${BASE})`);

const stamp = Date.now().toString(36).toUpperCase();
const TZ = "America/Costa_Rica";
const dayPlus = (n) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date(Date.now() + n * 86_400_000));
const D = dayPlus(2);

// ------------------------------------------------------------ Sesiones
const owner = await login("propietario@domusapp.local", "mobile");
const tenant = await login("inquilino@domusapp.local", "mobile");
const guard = await login("guarda@domusapp.local", "mobile");
const admin = await login("admin.demo@domusapp.local", "web");
ok("sesiones: propietario, inquilino, guarda y admin", [owner, tenant, guard, admin].every((s) => s.accessToken));
const O = owner.accessToken;
const TN = tenant.accessToken;
const G = guard.accessToken;
const A = admin.accessToken;
const condo = owner.condominium?.id;
const as = socket(A, condo);
await as.ready;

// ------------------------------------------------------------ Permisos
const gSum = await call("GET", "/bookings/summary", { token: G });
const oSum = await call("GET", "/bookings/summary", { token: O });
ok("guarda y propietario no entran al panel de reservaciones", gSum.status === 403 && oSum.status === 403, { g: gSum.status, o: oSum.status });
const gRes = await call("GET", "/resident/bookings/amenities", { token: G });
ok("el guarda no reserva", gRes.status === 403, gRes.status);

// ------------------------------------------------------------ Áreas y disponibilidad (datos demo)
const list = await call("GET", "/resident/bookings/amenities", { token: O });
const byName = Object.fromEntries((list.body ?? []).map((a) => [a.name, a]));
ok("la app lista las áreas activas", list.status === 200 && byName["Piscina"] && byName["Rancho BBQ"] && byName["Salón de eventos"], Object.keys(byName));
ok("…con la próxima reserva de la filial", byName["Rancho BBQ"]?.nextBooking?.status === "approved", byName["Rancho BBQ"]?.nextBooking);
const detail = await call("GET", `/resident/bookings/amenities/${byName["Salón de eventos"].id}`, { token: O });
ok("detalle con reglamento, horario y costo", detail.status === 200 && detail.body.rules?.length > 10 && detail.body.cost === 35000 && detail.body.requiresApproval, detail.body);

const fin = await call("GET", "/resident/finance", { token: O });
const a101 = fin.body.units.find((u) => u.unitCode === "A-101").unitId;
const b302 = fin.body.units.find((u) => u.unitCode === "B-302").unitId;

const bbqDay = dayPlus(5);
const avO = await call("GET", `/resident/bookings/amenities/${byName["Rancho BBQ"].id}/availability?date=${bbqDay}&unitId=${a101}`, { token: O });
const avT = await call("GET", `/resident/bookings/amenities/${byName["Rancho BBQ"].id}/availability?date=${bbqDay}`, { token: TN });
const at12 = (r) => r.body?.slots?.find((s) => s.time === "12:00")?.status;
ok("disponibilidad: la reserva propia sale como «mía» y para otra filial «reservado»", at12(avO) === "mine" && at12(avT) === "reserved", [at12(avO), at12(avT)]);

const xmas = `${new Date().getFullYear()}-12-25`;
const avX = await call("GET", `/resident/bookings/amenities/${byName["Salón de eventos"].id}/availability?date=${xmas}`, { token: O });
ok("feriado: Navidad sale como feriado", avX.status === 200 && avX.body.slots.length > 0 && avX.body.slots.every((s) => s.status === "holiday"), avX.body?.slots?.[0]);

const salonDay = dayPlus(10);
const avR = await call("GET", `/resident/bookings/amenities/${byName["Salón de eventos"].id}/availability?date=${salonDay}`, { token: TN });
ok("restricción: B-302 ve el salón no disponible", avR.body?.slots?.every((s) => s.status === "unavailable" || s.status === "reserved"), avR.body?.slots?.[0]);
const restricted = await call("POST", "/resident/bookings", {
  token: TN,
  body: { amenityId: byName["Salón de eventos"].id, unitId: b302, date: salonDay, time: "10:00", minutes: 120, guests: 10, acceptRules: true }
});
ok("…y no puede reservarlo", restricted.status === 409 && restricted.body?.error?.code === "RESTRICTED", restricted.body);

const delinquent = await call("POST", "/resident/bookings", {
  token: TN,
  body: { amenityId: byName["Rancho BBQ"].id, unitId: b302, date: dayPlus(6), time: "10:00", minutes: 60, guests: 4, acceptRules: true }
});
ok("morosidad: B-302 con saldo vencido no reserva el rancho", delinquent.status === 409 && delinquent.body?.error?.code === "DELINQUENT", delinquent.body);

const soon = await call("POST", "/resident/bookings", {
  token: O,
  body: { amenityId: byName["Salón de eventos"].id, unitId: a101, date: dayPlus(1), time: "20:00", minutes: 60, guests: 10, acceptRules: true }
});
ok("anticipación mínima: el salón no se reserva para mañana", soon.status === 409 && soon.body?.error?.code === "TOO_SOON", soon.body);

// ------------------------------------------------------------ Área de prueba
const amenityBody = {
  name: `Área de prueba ${stamp}`,
  icon: "games",
  description: "Creada por las pruebas de humo",
  rules: "1. Probar.\n2. Cancelar al final.",
  mode: "exclusive",
  capacity: 6,
  openTime: "08:00",
  closeTime: "20:00",
  weekdays: [1, 2, 3, 4, 5, 6, 7],
  slotMinutes: 60,
  maxDurationMinutes: 120,
  minAdvanceHours: 0,
  maxAdvanceDays: 30,
  cancelHours: 24,
  maxActivePerUnit: 1,
  cost: 5000,
  requiresApproval: false,
  blockDelinquent: false
};
const bad = await call("POST", "/bookings/amenities", { token: A, body: { ...amenityBody, closeTime: "07:00" } });
ok("valida el horario del área", bad.status === 400, bad.body);
const created = await call("POST", "/bookings/amenities", { token: A, body: amenityBody });
const area = created.body;
ok("crea el área de prueba", created.status === 200 && area?.id && area.weekdays.length === 7, created.body);
const dup = await call("POST", "/bookings/amenities", { token: A, body: amenityBody });
ok("no repite el nombre", dup.status === 409, dup.body);

const photo = await call("PUT", `/bookings/amenities/${area.id}/photo`, { token: A, raw: png() });
ok("sube la foto del área", photo.status === 200 && photo.body?.card, photo.body);
const img = await fetch(`${BASE}${photo.body.card}`);
ok("…y la sirve firmada", img.status === 200 && img.headers.get("content-type") === "image/webp", img.status);

// ------------------------------------------------------------ Validaciones de la reserva
const reserve = (token, unitId, time, minutes = 60, extra = {}) =>
  call("POST", "/resident/bookings", { token, body: { amenityId: area.id, unitId, date: D, time, minutes, guests: 4, acceptRules: true, ...extra } });

const noRules = await reserve(O, a101, "10:00", 60, { acceptRules: false });
ok("exige aceptar el reglamento", noRules.status === 400, noRules.body);
const misaligned = await reserve(O, a101, "10:30");
ok("solo en bloques del área", misaligned.status === 400 && misaligned.body?.error?.code === "BAD_SLOT", misaligned.body);
const tooLong = await reserve(O, a101, "10:00", 180);
ok("respeta la duración máxima", tooLong.status === 400 && tooLong.body?.error?.code === "TOO_LONG", tooLong.body);
const late = await reserve(O, a101, "19:00", 120);
ok("dentro del horario del área", late.status === 400 && late.body?.error?.code === "OUT_OF_HOURS", late.body);
const crowd = await reserve(O, a101, "10:00", 60, { guests: 10 });
ok("respeta la capacidad", crowd.status === 400 && crowd.body?.error?.code === "OVER_CAPACITY", crowd.body);
const foreign = await reserve(TN, a101, "10:00");
ok("no reserva para una filial ajena", foreign.status === 403, foreign.body);

// ------------------------------------------------------------ Reserva directa con cargo
const mine = await reserve(O, a101, "10:00");
ok("reserva aprobada al momento (el área no pide aprobación)", mine.status === 200 && mine.body.status === "approved" && mine.body.timeFrom === "10:00" && mine.body.timeTo === "11:00", mine.body);
ok("…con el cargo en el estado de cuenta", Boolean(mine.body.chargeId) && mine.body.cost === 5000, mine.body);
const st = await call("GET", `/resident/finance/units/${a101}/statement`, { token: O });
ok("el estado de cuenta muestra la reservación", st.body?.rows?.some((r) => r.concept.startsWith(`Reservación Área de prueba ${stamp}`)), st.body?.rows?.slice(0, 2));
const taken = await reserve(TN, b302, "10:00");
ok("horario ocupado (área exclusiva)", taken.status === 409 && taken.body?.error?.code === "SLOT_TAKEN", taken.body);
const limit = await reserve(O, a101, "12:00");
ok("límite de reservas activas por filial", limit.status === 409 && limit.body?.error?.code === "LIMIT_REACHED", limit.body);
const avMine = await call("GET", `/resident/bookings/amenities/${area.id}/availability?date=${D}&unitId=${a101}`, { token: O });
ok("disponibilidad del área de prueba", avMine.body?.slots?.find((s) => s.time === "10:00")?.status === "mine" && avMine.body.slots.find((s) => s.time === "11:00")?.status === "available", avMine.body?.slots?.slice(2, 4));
ok("la administración recibe el evento en vivo", Boolean(await as.waitFor("bookings:update", (d) => d.bookingId === mine.body.id)));

const upcoming = await call("GET", "/resident/bookings/mine", { token: O });
ok("mis reservas: próximas", upcoming.body?.some((b) => b.id === mine.body.id), upcoming.body?.length);

// ------------------------------------------------------------ Con aprobación
const upd = await call("PUT", `/bookings/amenities/${area.id}`, { token: A, body: { ...amenityBody, requiresApproval: true } });
ok("el área pasa a pedir aprobación", upd.status === 200 && upd.body.requiresApproval === true, upd.body);
const req1 = await reserve(TN, b302, "14:00");
ok("la solicitud queda por aprobar y sin cargo", req1.status === 200 && req1.body.status === "pending" && !req1.body.chargeId, req1.body);
const adminNotifs = await call("GET", "/notifications", { token: A });
ok("la administración recibe el aviso de la solicitud", adminNotifs.body?.rows?.some((n) => n.kind === "booking" && n.data?.bookingId === req1.body.id), adminNotifs.body?.rows?.[0]);
const rejNo = await call("POST", `/bookings/list/${req1.body.id}/reject`, { token: A, body: {} });
ok("rechazar exige motivo", rejNo.status === 400, rejNo.body);
const rej = await call("POST", `/bookings/list/${req1.body.id}/reject`, { token: A, body: { notes: "Ese día hay mantenimiento" } });
ok("rechaza con motivo", rej.status === 200 && rej.body.status === "rejected", rej.body);
const req2 = await reserve(TN, b302, "14:00");
ok("el horario rechazado vuelve a quedar libre", req2.status === 200 && req2.body.status === "pending", req2.body);
const appr = await call("POST", `/bookings/list/${req2.body.id}/approve`, { token: A, body: {} });
ok("aprueba y genera el cargo", appr.status === 200 && appr.body.status === "approved" && Boolean(appr.body.chargeId), appr.body);
const again = await call("POST", `/bookings/list/${req2.body.id}/approve`, { token: A, body: {} });
ok("no se aprueba dos veces", again.status === 409, again.body);
const tNotifs = await call("GET", "/notifications", { token: TN });
ok("al inquilino le llega «Reserva aprobada»", tNotifs.body?.rows?.some((n) => n.kind === "booking" && n.title === "Reserva aprobada" && n.data?.bookingId === req2.body.id), tNotifs.body?.rows?.[0]);

// ------------------------------------------------------------ Concurrencia (la administración reserva a nombre de filiales)
const [c1, c2] = await Promise.all([
  call("POST", "/bookings/list", { token: A, body: { amenityId: area.id, unitId: a101, date: D, time: "16:00", minutes: 60, guests: 2 } }),
  call("POST", "/bookings/list", { token: A, body: { amenityId: area.id, unitId: b302, date: D, time: "16:00", minutes: 60, guests: 2 } })
]);
const statuses = [c1.status, c2.status].sort();
ok("dos reservas simultáneas del mismo horario: entra una sola", statuses[0] === 200 && statuses[1] === 409, [c1.body, c2.body]);

// ------------------------------------------------------------ Cancelación
const foreignCancel = await call("POST", `/resident/bookings/${mine.body.id}/cancel`, { token: TN, body: {} });
ok("no cancela la reserva de otra filial", foreignCancel.status === 404, foreignCancel.body);
const cancel = await call("POST", `/resident/bookings/${mine.body.id}/cancel`, { token: O, body: { reason: "Prueba de humo" } });
ok("cancelando a tiempo se anula el cargo", cancel.status === 200 && cancel.body.status === "cancelled" && cancel.body.refunded === true && cancel.body.chargeVoided === true, cancel.body);
const cancel2 = await call("POST", `/resident/bookings/${mine.body.id}/cancel`, { token: O, body: {} });
ok("no se cancela dos veces", cancel2.status === 409, cancel2.body);
const past = await call("GET", "/resident/bookings/mine?scope=past", { token: O });
ok("la cancelada pasa al historial", past.body?.some((b) => b.id === mine.body.id), past.body?.length);

// ------------------------------------------------------------ Bloqueo que cancela reservas
const block = await call("POST", "/bookings/blocks", {
  token: A,
  body: { kind: "unavailable", amenityId: area.id, from: D, fromTime: "15:00", to: D, toTime: "18:00", reason: "Fumigación (prueba)", cancelBookings: true }
});
ok("bloqueo: cancela la reserva que choca", block.status === 200 && block.body.affected === 1 && block.body.cancelled === 1, block.body);
const avB = await call("GET", `/bookings/amenities/${area.id}/availability?date=${D}`, { token: A });
ok("…y el horario queda no disponible", avB.body?.slots?.find((s) => s.time === "16:00")?.status === "unavailable", avB.body?.slots?.find((s) => s.time === "16:00"));
const badBlock = await call("POST", "/bookings/blocks", { token: A, body: { kind: "restriction", from: D, reason: "Sin filial" } });
ok("la restricción exige filial", badBlock.status === 400, badBlock.body);
const del = await call("DELETE", `/bookings/blocks/${block.body.block.id}`, { token: A });
const avB2 = await call("GET", `/bookings/amenities/${area.id}/availability?date=${D}`, { token: A });
ok("quitar el bloqueo libera el horario", del.status === 204 && avB2.body?.slots?.find((s) => s.time === "16:00")?.status === "available", del.status);

// ------------------------------------------------------------ Panel: resumen, calendario, listado y exportes
const sum = await call("GET", "/bookings/summary", { token: A });
ok("resumen del panel", sum.status === 200 && sum.body.amenities >= 5 && sum.body.pending >= 1 && sum.body.blocks >= 2, sum.body);
const cal = await call("GET", `/bookings/calendar?from=${dayPlus(0)}&to=${dayPlus(13)}`, { token: A });
ok("calendario: reservas y feriados del rango", cal.status === 200 && cal.body.bookings.some((b) => b.amenityName === "Rancho BBQ") && Array.isArray(cal.body.blocks), cal.body?.bookings?.length);
const pend = await call("GET", "/bookings/list?status=pending&scope=upcoming", { token: A });
ok("solicitudes por aprobar (incluye la del salón)", pend.body?.rows?.some((b) => b.amenityName === "Salón de eventos"), pend.body?.total);
const xl = await call("GET", "/bookings/list/export?format=xlsx", { token: A });
ok("exporta a Excel", xl.status === 200 && xl.headers.get("content-type")?.includes("spreadsheetml"));
const pdf = await fetch(`${BASE}/api/v1/bookings/list/export?format=pdf`, { headers: { authorization: `Bearer ${A}` } });
ok("exporta a PDF", pdf.status === 200 && Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString() === "%PDF-");

// ------------------------------------------------------------ Limpieza: cancela lo reservado y desactiva el área
const left = await call("GET", `/bookings/list?amenityId=${area.id}&scope=upcoming&pageSize=50`, { token: A });
for (const b of left.body?.rows ?? []) {
  if (b.status === "approved" || b.status === "pending") await call("POST", `/bookings/list/${b.id}/cancel`, { token: A, body: { reason: "Limpieza de la prueba de humo" } });
}
const off = await call("PUT", `/bookings/amenities/${area.id}`, { token: A, body: { ...amenityBody, isActive: false } });
const after = await call("GET", "/resident/bookings/amenities", { token: O });
ok("el área desactivada ya no sale en la app", off.status === 200 && !after.body?.some((a) => a.id === area.id), off.body?.isActive);
const st2 = await call("GET", `/resident/finance/units/${b302}/statement`, { token: TN });
const testCharges = (st2.body?.rows ?? []).filter((r) => r.concept.startsWith(`Reservación Área de prueba ${stamp}`));
ok("cancelar desde el panel anula los cargos de la prueba", testCharges.length === 0, testCharges);

as.close();
finish();
