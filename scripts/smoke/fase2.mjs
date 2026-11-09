// =====================================================================
//  DomusApp · scripts/smoke/fase2.mjs
//  Pruebas de humo de la fase 2 (control de acceso) con SEED_DEMO=true:
//  autorizados, fotos con URL firmada, vehículos, caseta del guarda,
//  visitas no anunciadas con respuesta del residente, bitácora y exportes.
//    node scripts/smoke/fase2.mjs
// =====================================================================

import { deflateSync } from "node:zlib";
import { BASE, MAILPIT, call, finish, login, ok, sleep } from "./lib.mjs";

console.log(`════════ Fase 2 · control de acceso (${BASE})`);

// ------------------------------------------------------------ Utilidades
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
/** PNG RGB de size×size de un color (sin dependencias) */
function png(size = 64, rgb = [21, 114, 211]) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: size }, () => rgb).flat())]);
  const raw = Buffer.concat(Array.from({ length: size }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

/** "Hoy" en la zona del condominio demo (Costa Rica) */
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Costa_Rica" }).format(new Date());
const yesterday = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Costa_Rica" }).format(new Date(Date.now() - 86_400_000));

async function mailCount(email, subjectPart, after) {
  const list = await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`)).json();
  return (list.messages ?? []).filter((m) => new Date(m.Created).getTime() >= after - 1000 && m.Subject.includes(subjectPart)).length;
}

// ------------------------------------------------------------ Sesiones
const owner = await login("propietario@domusapp.local", "mobile");
const guard = await login("guarda@domusapp.local", "mobile");
const tenant = await login("inquilino@domusapp.local", "mobile");
const admin = await login("admin.demo@domusapp.local", "web");
ok("sesiones: propietario, guarda, inquilino y admin", [owner, guard, tenant, admin].every((s) => s.accessToken));
const O = owner.accessToken;
const G = guard.accessToken;
const TN = tenant.accessToken;
const A = admin.accessToken;

const home = await call("GET", "/resident/home", { token: O });
const a101 = home.body.units.find((u) => u.code === "A-101");
const allUnits = await call("GET", "/guard/units", { token: G });
const foreign = allUnits.body.find((u) => !home.body.units.some((h) => h.id === u.id));
ok("guarda ve las filiales con teléfonos", allUnits.status === 200 && Array.isArray(allUnits.body[0]?.phones));

// ------------------------------------------------------------ Autorizados (residente)
const temp = await call("POST", "/resident/authorizations", {
  token: O,
  body: { unitId: a101.id, kind: "temporary", names: "Visita Smoke", idNumber: "9-0000-0001", plate: "smk-101", validFrom: today, deleteAfterUse: true, instructions: "Viene en taxi" }
});
ok("propietario crea un temporal para hoy", temp.status === 200 && temp.body?.id, temp.body);

const foreignAuth = await call("POST", "/resident/authorizations", {
  token: O,
  body: { unitId: foreign.id, kind: "temporary", names: "Intruso", validFrom: today }
});
ok("no puede autorizar en una filial ajena → 403", foreignAuth.status === 403 && foreignAuth.body?.error?.code === "UNIT_FORBIDDEN", foreignAuth.body);

const past = await call("POST", "/resident/authorizations", { token: O, body: { unitId: a101.id, kind: "temporary", names: "Ayer", validFrom: yesterday } });
ok("fecha pasada → 400 DATE_PAST", past.status === 400 && past.body?.error?.code === "DATE_PAST", past.body);

const noDate = await call("POST", "/resident/authorizations", { token: O, body: { unitId: a101.id, kind: "temporary", names: "Sin fecha" } });
ok("temporal sin fecha → 400", noDate.status === 400);

const employee = await call("POST", "/resident/authorizations", {
  token: O,
  body: { unitId: a101.id, kind: "employee", names: "Empleada Smoke", occupation: "Limpieza", weekdays: [1, 2, 3, 4, 5, 6, 7], callToConfirm: true }
});
ok("propietario registra una empleada (todos los días, llamar)", employee.status === 200, employee.body);

// Foto con URL firmada
const photo = await call("PUT", `/resident/authorizations/${temp.body.id}/photo`, { token: O, raw: png(), rawType: "image/png" });
ok("sube la foto del autorizado", photo.status === 200 && photo.body?.photo?.thumb, photo.body);
const img = await fetch(`${BASE}${photo.body.photo.thumb}`);
ok("la URL firmada entrega la miniatura WebP", img.status === 200 && img.headers.get("content-type") === "image/webp");
const tampered = await fetch(`${BASE}${photo.body.photo.thumb.replace(/sig=[0-9a-f]{4}/, "sig=0000")}`);
ok("firma alterada → 403", tampered.status === 403);
const notImage = await call("PUT", `/resident/authorizations/${temp.body.id}/photo`, { token: O, raw: Buffer.from("<svg onload=alert(1)>"), rawType: "image/png" });
ok("archivo que no es imagen → 415", notImage.status === 415, notImage.body);

const list = await call("GET", "/resident/authorizations?kind=temporary", { token: O });
ok("lista de temporales con foto", list.body?.some((a) => a.id === temp.body.id && a.photo?.medium && a.validToday === true), list.body?.[0]);

// ------------------------------------------------------------ Vehículos
const plate = `SMK${String(Date.now()).slice(-4)}`;
const veh = await call("POST", "/resident/vehicles", { token: O, body: { unitId: a101.id, plate: `${plate.slice(0, 3)}-${plate.slice(3)}`, brand: "Toyota", color: "Gris" } });
ok("registra vehículo (placa normalizada)", veh.status === 200, veh.body);
const vehDup = await call("POST", "/resident/vehicles", { token: O, body: { unitId: a101.id, plate: plate.toLowerCase() } });
ok("placa repetida → 409", vehDup.status === 409);

// ------------------------------------------------------------ Roles
const ownerGuard = await call("GET", "/guard/board", { token: O });
ok("propietario no usa la caseta → 403", ownerGuard.status === 403);
const guardResident = await call("GET", "/resident/authorizations", { token: G });
ok("guarda no usa la app del residente → 403", guardResident.status === 403);

// ------------------------------------------------------------ Caseta
const board = await call("GET", "/guard/board", { token: G });
const expected = board.body?.expected?.find((a) => a.id === temp.body.id);
ok("el temporal aparece en «esperados hoy» con foto e indicaciones", expected?.photo?.thumb && expected.instructions === "Viene en taxi", board.body?.expected?.length);

const entry = await call("POST", "/guard/entries", { token: G, body: { authorizationId: temp.body.id } });
ok("guarda registra el ingreso", entry.status === 200 && entry.body?.id, entry.body);
const again = await call("POST", "/guard/entries", { token: G, body: { authorizationId: temp.body.id } });
ok("un solo uso: ya no vale → 409", again.status === 409, again.body);

const inside = await call("GET", "/guard/board", { token: G });
ok("aparece «adentro»", inside.body?.inside?.some((l) => l.id === entry.body.id));
const exit = await call("POST", `/guard/entries/${entry.body.id}/exit`, { token: G });
ok("registra la salida", exit.status === 204);
const exit2 = await call("POST", `/guard/entries/${entry.body.id}/exit`, { token: G });
ok("salida duplicada → 400", exit2.status === 400);

const used = await call("GET", "/resident/authorizations?kind=temporary", { token: O });
const usedRow = used.body.find((a) => a.id === temp.body.id);
ok("el residente lo ve «utilizado» con ingreso y salida", usedRow?.status === "used" && usedRow.lastEntryAt && usedRow.lastExitAt, usedRow);

const callReq = await call("POST", "/guard/entries", { token: G, body: { authorizationId: employee.body.id } });
ok("«llamar a la casa»: sin confirmar → 409 CALL_REQUIRED", callReq.body?.error?.code === "CALL_REQUIRED", callReq.body);
const callOk = await call("POST", "/guard/entries", { token: G, body: { authorizationId: employee.body.id, confirmed: true } });
ok("confirmado por teléfono → ingresa", callOk.status === 200);
await call("POST", `/guard/entries/${callOk.body.id}/exit`, { token: G });

const search = await call("GET", `/guard/search?q=${plate.slice(0, 3)}-${plate.slice(3)}`, { token: G });
const foundVeh = search.body?.vehicles?.find((v) => v.plate === plate);
ok("búsqueda por placa encuentra el vehículo del residente", Boolean(foundVeh), search.body);
const vEntry = await call("POST", "/guard/entries", { token: G, body: { vehicleId: foundVeh?.id } });
ok("ingreso de residente por su vehículo", vEntry.status === 200, vEntry.body);
await call("POST", `/guard/entries/${vEntry.body.id}/exit`, { token: G });

// ------------------------------------------------------------ Visita no anunciada
const t0 = Date.now();
const visit = await call("POST", "/guard/visits", { token: G, body: { unitId: a101.id, names: "Mensajero Smoke", kind: "delivery", plate: "MOTO99" } });
ok("guarda anuncia una visita no anunciada", visit.status === 200 && visit.body?.notified >= 1, visit.body);
const early = await call("POST", `/guard/entries/${visit.body.id}/admit`, { token: G });
ok("sin respuesta ni llamada → 409 AWAITING_RESPONSE", early.body?.error?.code === "AWAITING_RESPONSE", early.body);

const pending = await call("GET", "/resident/visits", { token: O });
ok("el propietario la ve pendiente en la app", pending.body?.pending?.some((v) => v.id === visit.body.id));
await sleep(500);
ok("…y le llegó el aviso por correo", (await mailCount("propietario@domusapp.local", "Visita en la caseta", t0)) >= 1);

const tenantResp = await call("POST", `/resident/visits/${visit.body.id}/respond`, { token: TN, body: { approve: true } });
ok("el inquilino de otra filial no puede responderla → 409", tenantResp.status === 409);
const approve = await call("POST", `/resident/visits/${visit.body.id}/respond`, { token: O, body: { approve: true } });
ok("el propietario la aprueba", approve.status === 204);
const twice = await call("POST", `/resident/visits/${visit.body.id}/respond`, { token: O, body: { approve: false } });
ok("responder dos veces → 409", twice.status === 409);
const admit = await call("POST", `/guard/entries/${visit.body.id}/admit`, { token: G });
ok("aprobada: el guarda la deja pasar", admit.status === 204);
await call("POST", `/guard/entries/${visit.body.id}/exit`, { token: G });

const visit2 = await call("POST", "/guard/visits", { token: G, body: { unitId: a101.id, names: "Desconocido Smoke" } });
await call("POST", `/resident/visits/${visit2.body.id}/respond`, { token: O, body: { approve: false } });
const admit2 = await call("POST", `/guard/entries/${visit2.body.id}/admit`, { token: G, body: { confirmed: true } });
ok("rechazada por la filial: no se puede dejar pasar", admit2.body?.error?.code === "DENIED_BY_RESIDENT", admit2.body);
const deny = await call("POST", `/guard/entries/${visit2.body.id}/deny`, { token: G });
ok("el guarda la cierra como rechazada", deny.status === 204);

// ------------------------------------------------------------ Panel
const summary = await call("GET", "/access/summary", { token: A });
ok("panel: resumen de acceso", summary.status === 200 && typeof summary.body?.entriesToday === "number" && summary.body.entriesToday >= 4, summary.body);
const logs = await call("GET", `/access/logs?from=${today}&q=smoke`, { token: A });
ok("bitácora del día con quién registró", logs.body?.total >= 4 && logs.body.rows.some((r) => r.entryByName && r.exitAt), logs.body?.total);
const xlsx = await call("GET", `/access/logs/export?format=xlsx&from=${today}`, { token: A });
ok("exporta la bitácora a Excel", xlsx.status === 200 && xlsx.headers.get("content-type")?.includes("spreadsheetml"));
const pdfRes = await fetch(`${BASE}/api/v1/access/logs/export?format=pdf&from=${today}`, { headers: { authorization: `Bearer ${A}` } });
const pdfHead = Buffer.from(await pdfRes.arrayBuffer()).subarray(0, 5).toString();
ok("exporta la bitácora a PDF", pdfRes.status === 200 && pdfHead === "%PDF-");
const ownerPanel = await call("GET", "/access/logs", { token: O });
ok("el propietario no ve la bitácora del panel → 403", ownerPanel.status === 403);

const revoke = await call("POST", `/access/authorizations/${employee.body.id}/revoke`, { token: A });
ok("la administración revoca a la empleada", revoke.status === 204);
const afterRevoke = await call("POST", "/guard/entries", { token: G, body: { authorizationId: employee.body.id, confirmed: true } });
ok("revocada: la caseta la rechaza", afterRevoke.body?.error?.code === "NOT_VALID_TODAY", afterRevoke.body);

const adminVeh = await call("GET", `/access/vehicles?q=${plate}`, { token: A });
ok("panel: vehículos con su filial", adminVeh.body?.[0]?.unitCode === "A-101", adminVeh.body);
const delVeh = await call("DELETE", `/resident/vehicles/${veh.body.id}`, { token: O });
ok("el residente elimina su vehículo", delVeh.status === 204);

// ------------------------------------------------------------ Logo del condominio
const logo = await call("PUT", "/settings/logo", { token: A, raw: png(200, [11, 95, 179]) });
ok("sube el logo del condominio", logo.status === 200 && logo.body?.logo?.header, logo.body);
const me = await call("GET", "/auth/me", { token: A });
ok("la sesión trae el logo", Boolean(me.body?.condominium?.logo?.square), me.body?.condominium);
const logoImg = await fetch(`${BASE}${me.body.condominium.logo.doc}`);
ok("variante PNG del logo para documentos", logoImg.status === 200 && logoImg.headers.get("content-type") === "image/png");
const delLogo = await call("DELETE", "/settings/logo", { token: A });
ok("quita el logo", delLogo.status === 204);

// Limpieza: el temporal de prueba se revoca desde la app
const del = await call("DELETE", `/resident/authorizations/${temp.body.id}`, { token: O });
const gone = await call("GET", "/resident/authorizations", { token: O });
ok("eliminar = revocar y desaparece de la app", del.status === 204 && !gone.body.some((a) => a.id === temp.body.id));

finish();
