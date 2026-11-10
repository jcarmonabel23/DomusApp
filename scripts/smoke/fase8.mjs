// =====================================================================
//  DomusApp · scripts/smoke/fase8.mjs
//  Pruebas de humo de la fase 8 (reportes y tablero) con SEED_DEMO=true:
//  permisos (guarda y residente no entran), validación del período, agrupación por día o
//  por mes, coherencia interna de cada sección (sumas de los repartos = total), cruce con
//  el resumen de Finanzas, que una alerta y un caso nuevos se reflejen al instante, la
//  historia de demostración, exportes completos o por sección (Excel y PDF), el bloque
//  "Hoy" del tablero y aislamiento entre condominios.
//    node scripts/smoke/fase8.mjs
// =====================================================================

import { API, BASE, call, finish, login, ok } from "./lib.mjs";

console.log(`════════ Fase 8 · reportes y tablero (${BASE})`);

const TZ = "America/Costa_Rica";
const dayPlus = (n) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date(Date.now() + n * 86_400_000));
const TODAY = dayPlus(0);
const sum = (rows, key) => rows.reduce((s, r) => s + r[key], 0);
const close = (a, b) => Math.abs(a - b) < 0.01;

// ------------------------------------------------------------ Sesiones y permisos
const owner = await login("propietario@domusapp.local", "mobile");
const guard = await login("guarda@domusapp.local", "mobile");
const admin = await login("admin.demo@domusapp.local", "web");
ok("sesiones: propietario, guarda y admin", [owner, guard, admin].every((s) => s.accessToken));
const O = owner.accessToken;
const G = guard.accessToken;
const A = admin.accessToken;
const PALMAS = admin.condominium.id;
const PLAZA = admin.condominiums.find((c) => c.id !== PALMAS).id;

const reports = admin.modules?.find((m) => m.code === "REPORTS");
ok("módulo Reportes en línea con ver y descargar", reports && !reports.isOffline && ["access", "view", "download"].every((p) => reports.permissions.includes(p)), reports);
ok("el guarda no entra a los reportes", (await call("GET", "/reports/indicators", { token: G })).status === 403);
ok("el propietario no entra a los reportes", (await call("GET", "/reports/indicators", { token: O })).status === 403);
ok("el guarda no exporta", (await call("GET", "/reports/export?format=pdf", { token: G })).status === 403);

// ------------------------------------------------------------ Período
const ind = (q = "") => call("GET", `/reports/indicators${q}`, { token: A });
const def = await ind();
const d = def.body;
ok("por defecto: seis meses calendario hasta hoy, agrupado por mes", def.status === 200 && d.to === TODAY && d.from.endsWith("-01") && d.bucket === "month" && d.finance.byPeriod.length === 6, {
  from: d?.from,
  to: d?.to,
  bucket: d?.bucket
});
ok("trae las seis secciones para el administrador", ["finance", "delinquency", "access", "alerts", "cases", "bookings"].every((s) => d.sections.includes(s) && d[s]), d.sections);
ok("moneda del condominio (CRC)", d.currency?.code === "CRC");
ok("fechas al revés → 400", (await ind(`?from=${TODAY}&to=${dayPlus(-3)}`)).body?.error?.code === "INVALID_RANGE");
ok("más de dos años → 400", (await ind(`?from=2020-01-01&to=${TODAY}`)).body?.error?.code === "RANGE_TOO_LONG");
ok("fecha mal escrita → 400", (await ind(`?from=01/11/2026`)).status === 400);
ok("fecha imposible → 400", (await ind(`?from=2026-02-31&to=2026-03-05`)).status === 400);

const week = (await ind(`?from=${dayPlus(-6)}&to=${TODAY}`)).body;
ok("una semana se agrupa por día (7 puntos en cada serie)", week.bucket === "day" && week.days === 7 && ["finance", "access", "alerts", "cases"].every((s) => week[s].byPeriod.length === 7), week.bucket);

// ------------------------------------------------------------ Coherencia por sección
const f = d.finance;
ok("finanzas: la serie suma el total facturado, cobrado y gastado", close(sum(f.byPeriod, "billed"), f.billed) && close(sum(f.byPeriod, "collected"), f.collected) && close(sum(f.byPeriod, "expenses"), f.expenses));
ok("finanzas: medios de pago y categorías suman el total", close(sum(f.byMethod, "amount"), f.collected) && close(sum(f.expensesByCategory, "amount"), f.expenses) && sum(f.byMethod, "count") === f.payments);
ok("finanzas: resultado = cobrado − gastos y cobranza = cobrado ÷ facturado", close(f.net, f.collected - f.expenses) && (f.billed === 0 || close(f.collectionRate, f.collected / f.billed)));

const fs = (await call("GET", "/finance/summary", { token: A })).body;
const q = d.delinquency;
ok("morosidad igual a la del módulo de Finanzas", q.delinquent === fs.delinquent && close(q.overdue, fs.overdue) && close(q.receivable, fs.receivable) && q.units === fs.units, { q, fs });
ok("morosidad: la antigüedad reparte todas las filiales y montos vencidos", sum(q.aging, "units") === q.delinquent && close(sum(q.aging, "amount"), q.overdue));
ok("morosidad: el ranking va de mayor a menor deuda", q.topDebtors.every((t, i, all) => i === 0 || all[i - 1].overdue >= t.overdue) && q.topDebtors.length <= 10);
const month = (await ind(`?from=${TODAY.slice(0, 8)}01&to=${TODAY}`)).body;
ok("cobrado del mes igual al resumen de Finanzas", close(month.finance.collected, fs.collected), { r: month.finance.collected, f: fs.collected });

const a = d.access;
ok("accesos: por hora, por día y por tipo suman el total", sum(a.byHour, "count") === a.entries && sum(a.byWeekday, "count") === a.entries && sum(a.byKind, "count") === a.entries && sum(a.byPeriod, "entries") === a.entries);
ok("accesos: 24 horas y 7 días; la hora pico es la de más ingresos", a.byHour.length === 24 && a.byWeekday.length === 7 && a.byHour[a.peakHour].count === Math.max(...a.byHour.map((h) => h.count)));
ok("historia de demostración: hay ingresos en cada uno de los seis meses", a.byPeriod.every((p) => p.entries > 0), a.byPeriod);

const al = d.alerts;
ok("alertas: tipos y serie suman el total", sum(al.byKind, "count") === al.total && sum(al.byPeriod, "count") === al.total);
ok("alertas: atendidas + sin cerrar = total; mediana ≤ máxima", al.attended + al.open === al.total && al.medianAckSeconds <= al.maxAckSeconds);
ok("historia de demostración: alertas en meses anteriores con tiempos de respuesta", al.byPeriod.slice(0, 5).some((p) => p.count > 0 && p.avgAckSeconds > 0));

const c = d.cases;
ok("casos: categorías, estados y serie suman los abiertos del período", sum(c.byCategory, "count") === c.opened && sum(c.byStatus, "count") === c.opened && sum(c.byPeriod, "opened") === c.opened);
ok("casos: tiempo de solución y calificación con la historia", c.avgResolutionHours > 0 && c.avgRating >= 1 && c.avgRating <= 5 && c.ratings > 0, c);

const b = d.bookings;
ok("reservas: las áreas suman confirmadas e ingresos", sum(b.byAmenity, "approved") === b.approved && close(sum(b.byAmenity, "revenue"), b.revenue));

// ------------------------------------------------------------ Lo nuevo se refleja al instante
const todayQ = `?from=${TODAY}&to=${TODAY}`;
const before = (await ind(todayQ)).body;
const fin = await call("GET", "/resident/finance", { token: O });
const a101 = fin.body.units.find((u) => u.unitCode === "A-101").unitId;
const raised = await call("POST", "/resident/alerts", { token: O, body: { kind: "medical", unitId: a101, notes: "Prueba de reportes (smoke)" } });
ok("el propietario activa una alerta", raised.status === 200, raised.body);
const dashOpen = (await call("GET", "/dashboard/summary", { token: A })).body?.today?.alerts?.open;
await call("POST", `/guard/alerts/${raised.body.id}/ack`, { token: G, body: {} });
await call("POST", `/guard/alerts/${raised.body.id}/attend`, { token: G, body: { resolution: "Prueba de reportes; sin novedad (smoke)" } });
const kase = await call("POST", "/resident/cases", { token: O, body: { category: "suggestion", title: "Sugerencia para reportes", description: "Caso de prueba del reporte de indicadores (smoke).", unitId: a101 } });
ok("el propietario abre un caso", kase.status === 200, kase.body);
const after = (await ind(todayQ)).body;
ok("la alerta suma 1 y queda atendida", after.alerts.total === before.alerts.total + 1 && after.alerts.attended === before.alerts.attended + 1);
ok("su tipo aparece con su tiempo de respuesta", after.alerts.byKind.some((k) => k.kind === "medical" && k.label === "Emergencia médica" && k.avgAckSeconds !== null));
ok("el caso suma 1 en su categoría y en pendientes", after.cases.opened === before.cases.opened + 1 && after.cases.byCategory.some((k) => k.category === "suggestion") && after.cases.openNow === before.cases.openNow + 1);
const rej = await call("POST", `/cases/${kase.body.id}/updates`, { token: A, body: { body: "Caso de prueba: se cierra (smoke).", status: "rejected" } });
ok("la administración rechaza el caso de prueba", rej.status === 200, rej.body);

// ------------------------------------------------------------ Tablero
const dash = (await call("GET", "/dashboard/summary", { token: A })).body;
const t = dash?.today;
ok("tablero: bloque Hoy con todos los módulos del administrador", t && ["alerts", "access", "finance", "cases", "bookings", "suppliers", "inventory", "assemblies"].every((k) => t[k] !== null), t);
ok("tablero: la alerta activa contaba en «sin cerrar»", dashOpen >= 1 && t.alerts.open === dashOpen - 1, { dashOpen, now: t.alerts.open });
ok("tablero: la morosidad coincide con el reporte", t.finance.delinquent === q.delinquent && close(t.finance.overdue, q.overdue));
ok("tablero: casos pendientes coinciden con el reporte", t.cases.open === after.cases.openNow - 1);
ok("tablero: hay una asamblea convocada en el demo", Boolean(t.assemblies.next?.title));
const gDash = await call("GET", "/dashboard/summary", { token: G });
ok("tablero: el guarda no ve finanzas, casos ni reportes", gDash.status === 403 || (gDash.body?.today?.finance === null && gDash.body?.today?.cases === null), gDash.body?.today);

// ------------------------------------------------------------ Exportes
const download = async (q) => {
  const res = await fetch(`${API}/reports/export${q}`, { headers: { authorization: `Bearer ${A}` } });
  const buf = Buffer.from(await res.arrayBuffer());
  return { status: res.status, type: res.headers.get("content-type"), name: res.headers.get("content-disposition"), buf };
};
const xl = await download("?format=xlsx");
ok("reporte completo en Excel", xl.status === 200 && xl.type.includes("spreadsheetml") && xl.buf.subarray(0, 2).toString() === "PK" && /reporte_indicadores_\d{8}\.xlsx/.test(xl.name));
const pdf = await download(`?format=pdf&from=${dayPlus(-30)}&to=${TODAY}`);
ok("reporte completo en PDF", pdf.status === 200 && pdf.type === "application/pdf" && pdf.buf.subarray(0, 5).toString() === "%PDF-" && pdf.buf.length > 3000);
const only = await download("?format=pdf&sections=alerts,cases");
ok("exporta solo las secciones pedidas (más liviano)", only.status === 200 && only.buf.length < pdf.buf.length);
ok("sección desconocida → 400", (await download("?format=xlsx&sections=alerts,ovnis")).status === 400);
ok("período inválido también en el exporte → 400", (await download(`?format=pdf&from=${TODAY}&to=${dayPlus(-1)}`)).status === 400);

// ------------------------------------------------------------ Aislamiento entre condominios
const sw = await call("POST", "/auth/switch-condominium", { token: A, body: { condominiumId: PLAZA } });
ok("cambio a Oficentro Plaza Norte", sw.status === 200);
const plaza = (await call("GET", "/reports/indicators", { token: A, condo: PLAZA })).body;
ok("RLS: Plaza Norte no ve las alertas ni los ingresos de Las Palmas", plaza.currency?.code === "USD" && plaza.alerts.total < d.alerts.total && plaza.access.entries < d.access.entries, {
  alerts: plaza.alerts?.total,
  access: plaza.access?.entries
});
ok("RLS: la morosidad es de sus propias filiales", plaza.delinquency.units < d.delinquency.units, plaza.delinquency.units);
const stale = await call("GET", "/reports/indicators", { token: A, condo: PALMAS });
ok("pantalla con el condominio viejo → 409", stale.status === 409);
await call("POST", "/auth/switch-condominium", { token: A, body: { condominiumId: PALMAS } });

finish();
