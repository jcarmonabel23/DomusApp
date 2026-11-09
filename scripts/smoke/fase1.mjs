// =====================================================================
//  DomusApp · scripts/smoke/fase1.mjs
//  Pruebas de humo de la fase 1 contra el stack levantado con SEED_DEMO=true.
//  Pasan por el proxy del panel (como el navegador y la app) y leen los
//  códigos OTP desde la API de Mailpit.
//    node scripts/smoke/fase1.mjs   (BASE, MAILPIT y DEMO_PASSWORD por variables)
// =====================================================================

import { API, BASE, DEMO_PASSWORD, MAILPIT, call, finish, login, otpFor, ok, sleep } from "./lib.mjs";

console.log(`════════ Fase 1 · seguridad y núcleo (${BASE})`);

// ------------------------------------------------------------ Autenticación
const bad = await call("POST", "/auth/sign-in", { body: { email: "admin.demo@domusapp.local", password: "x" } });
ok("contraseña errada → 401 INVALID_CREDENTIALS", bad.status === 401 && bad.body?.error?.code === "INVALID_CREDENTIALS", bad.body);

const unknown = await call("POST", "/auth/sign-in", { body: { email: "nadie@domusapp.local", password: "x" } });
ok("correo inexistente responde igual", unknown.status === 401 && unknown.body?.error?.code === "INVALID_CREDENTIALS");

const ownerPanel = await call("POST", "/auth/sign-in", { body: { email: "propietario@domusapp.local", password: DEMO_PASSWORD, client: "web" } });
ok("propietario no entra al panel → PANEL_FORBIDDEN", ownerPanel.body?.error?.code === "PANEL_FORBIDDEN", ownerPanel.body);

const admin = await login("admin.demo@domusapp.local");
ok("admin: login con OTP abre sesión web", admin.status === 200 && !!admin.accessToken, admin);
ok("web: refresh en cookie httpOnly, no en el cuerpo", !!admin.cookie && admin.refreshToken === undefined);
ok("admin ve 2 condominios en su selector", admin.condominiums?.length === 2, admin.condominiums);
ok("condominio activo = Las Palmas (CR, CRC)", admin.condominium?.code === "DEMO" && admin.condominium?.currency?.code === "CRC");
ok("país trae la etiqueta del documento (Cédula)", admin.condominium?.country?.personIdLabel === "Cédula");
const unitsModule = admin.modules?.find((m) => m.code === "UNITS");
ok("módulo Filiales con permisos de admin", unitsModule?.permissions?.includes("add_new"));
ok("admin de condominio no ve el módulo de plataforma", !admin.modules?.some((m) => m.code === "CONDOMINIUMS"));

const T = admin.accessToken;
const PALMAS = admin.condominium.id;
const PLAZA = admin.condominiums.find((c) => c.id !== PALMAS).id;

// ------------------------------------------------------------ Datos del condominio
const units = await call("GET", "/units", { token: T });
ok("Las Palmas tiene 20 filiales", units.status === 200 && units.body.length === 20, units.body?.length);
const b302 = units.body.find((u) => u.code === "B-302");
ok("B-302: propietario + inquilino + residente", b302?.people?.length === 3 && b302.occupancy === "rented");

const summary = await call("GET", "/dashboard/summary", { token: T });
ok("tablero: 20 filiales, 1 alquilada, 2 vacías", summary.body?.units === 20 && summary.body?.rented === 1 && summary.body?.vacant === 2, summary.body);

const created = await call("POST", "/units", { token: T, body: { code: "SMOKE-1", tower: "Torre Z", kind: "house", occupancy: "vacant", aliquot: 1.5 } });
ok("alta de filial", created.status === 200 && created.body?.id);
const dup = await call("POST", "/units", { token: T, body: { code: "SMOKE-1", kind: "house", occupancy: "vacant" } });
ok("código duplicado → 409", dup.status === 409, dup.body);
const bulk = await call("POST", "/units/bulk", { token: T, body: { tower: "Torre Z", kind: "parking", codes: ["P-01", "P-02", "P-03"] } });
ok("alta por lote (3 parqueos)", bulk.body?.created === 3, bulk.body);

// ------------------------------------------------------------ Aislamiento entre condominios
const sw = await call("POST", "/auth/switch-condominium", { token: T, body: { condominiumId: PLAZA } });
ok("cambio a Oficentro Plaza Norte (PA, USD)", sw.body?.condominium?.code === "DEMO-OFI" && sw.body?.condominium?.currency?.code === "USD");
const stale = await call("GET", "/units", { token: T, condo: PALMAS });
ok("pantalla con el condominio viejo → 409 CONDOMINIUM_CHANGED", stale.status === 409 && stale.body?.error?.code === "CONDOMINIUM_CHANGED");
const plazaUnits = await call("GET", "/units", { token: T, condo: PLAZA });
ok("RLS: en Plaza Norte solo se ven sus 6 oficinas", plazaUnits.body?.length === 6, plazaUnits.body?.length);
const cross = await call("PUT", `/units/${created.body.id}`, { token: T, body: { code: "HACK", kind: "house", occupancy: "vacant" } });
ok("RLS: no se puede editar una filial de otro condominio → 404", cross.status === 404, cross.body);
await call("POST", "/auth/switch-condominium", { token: T, body: { condominiumId: PALMAS } });

// ------------------------------------------------------------ Personas y acceso a la app
const stamp = Date.now();
const newEmail = `smoke.${stamp}@demo.local`;
const person = await call("POST", "/people", { token: T, body: { names: "Persona Smoke", idNumber: `9-${stamp}`, email: newEmail } });
ok("alta de persona", person.status === 200, person.body);
const noUnits = await call("POST", `/people/${person.body.id}/access`, { token: T, body: {} });
ok("sin filial no se le da acceso → NO_UNITS", noUnits.body?.error?.code === "NO_UNITS");
const link = await call("PUT", `/people/${person.body.id}/units`, { token: T, body: { unitId: created.body.id, relation: "owner", isPrimary: true } });
ok("vínculo a filial como propietaria", link.status === 204, link.body);
const accessStarted = Date.now();
const access = await call("POST", `/people/${person.body.id}/access`, { token: T, body: {} });
ok("acceso a la app: crea la cuenta como propietario y envía el correo", access.body?.created && access.body?.role === "owner" && access.body?.emailed, access.body);
const welcome = await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${newEmail}`)}`)).json();
ok("llegó el correo de bienvenida", welcome.messages?.some((m) => new Date(m.Created).getTime() >= accessStarted - 1000));
const delUnit = await call("DELETE", `/units/${created.body.id}`, { token: T });
ok("filial con personas no se elimina → 409", delUnit.status === 409);

// ------------------------------------------------------------ Usuarios del condominio
const members = await call("GET", "/members", { token: T });
ok("usuarios: admin, guarda, propietarios e inquilino", members.body?.some((m) => m.role === "guard") && members.body?.some((m) => m.role === "tenant"));
const me = members.body.find((m) => m.email === "admin.demo@domusapp.local");
const self = await call("PATCH", `/members/${me.id}`, { token: T, body: { isActive: false } });
ok("no puede desactivarse a sí mismo → SELF_LOCKOUT", self.body?.error?.code === "SELF_LOCKOUT", self.body);
const guardAdd = await call("POST", "/members", { token: T, body: { email: `guarda.${stamp}@demo.local`, names: "Guarda Smoke", role: "guard" } });
ok("alta de guarda", guardAdd.status === 200 && guardAdd.body?.created, guardAdd.body);

// ------------------------------------------------------------ App móvil
const owner = await login("propietario@domusapp.local", "mobile");
ok("propietario: login móvil", owner.status === 200 && owner.condominium?.role === "owner", owner);
ok("móvil: refresh en el cuerpo, sin cookie", typeof owner.refreshToken === "string" && !owner.cookie);
ok("móvil: sin cierre por inactividad", owner.idleMinutes === null);
const home = await call("GET", "/resident/home", { token: owner.accessToken });
ok("propietario ve sus 2 filiales (A-101 y B-302)", home.body?.units?.length === 2, home.body);
const forbidden = await call("GET", "/units", { token: owner.accessToken });
ok("propietario no usa la API del panel → 403", forbidden.status === 403);

const r1 = await call("POST", "/auth/refresh", { body: { refreshToken: owner.refreshToken } });
ok("refresh móvil rota el token", r1.status === 200 && r1.body?.refreshToken && r1.body.refreshToken !== owner.refreshToken);
await sleep(16_000); // pasa la ventana de gracia de carreras
const reuse = await call("POST", "/auth/refresh", { body: { refreshToken: owner.refreshToken } });
ok("reusar un refresh viejo → REFRESH_REUSED", reuse.body?.error?.code === "REFRESH_REUSED", reuse.body);
const afterReuse = await call("GET", "/resident/home", { token: r1.body.accessToken });
ok("…y revoca todas las sesiones del usuario", afterReuse.status === 401);

const guard = await login("guarda@domusapp.local", "mobile");
ok("guarda: login móvil con rol guard", guard.condominium?.role === "guard", guard);

// ------------------------------------------------------------ Plataforma
const platform = await call("GET", "/condominiums", { token: T });
ok("admin de condominio no administra la plataforma → 403", platform.status === 403);

// ------------------------------------------------------------ Limpieza
await call("DELETE", `/people/${person.body.id}/units/${created.body.id}`, { token: T });
await call("DELETE", `/units/${created.body.id}`, { token: T });
for (const u of (await call("GET", "/units?tower=Torre%20Z", { token: T })).body ?? []) await call("DELETE", `/units/${u.id}`, { token: T });
await call("POST", "/auth/logout", { cookie: admin.cookie });
const afterLogout = await call("POST", "/auth/refresh", { cookie: admin.cookie });
ok("logout invalida el refresh", afterLogout.status === 401);

finish();
