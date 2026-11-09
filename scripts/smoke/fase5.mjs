// =====================================================================
//  DomusApp · scripts/smoke/fase5.mjs
//  Pruebas de humo de la fase 5 (finanzas) con SEED_DEMO=true:
//  permisos, saldos y morosidad (FIFO), estado de cuenta, generación
//  idempotente, cuotas por alícuota, cargos y anulación, pagos manuales
//  con comprobante (aprobar / rechazar), pasarela simulada con webhook
//  firmado (aprobada / rechazada), gastos, parámetros y exportes.
//    node scripts/smoke/fase5.mjs
// =====================================================================

import { deflateSync } from "node:zlib";
import { BASE, call, finish, login, ok, sleep, socket } from "./lib.mjs";

console.log(`════════ Fase 5 · finanzas (${BASE})`);

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
function png(size = 64, rgb = [240, 240, 240]) {
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
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.concat(Array.from({ length: size }, () => row)))),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

const stamp = Date.now().toString(36).toUpperCase();
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Costa_Rica" }).format(new Date());
const thisMonth = `${today.slice(0, 7)}-01`;

/** Espera a que un pago en línea salga de "pending" (lo resuelve el webhook) */
async function settled(token, id, timeout = 15_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const r = await call("GET", `/resident/finance/payments/${id}`, { token });
    if (r.body?.status && r.body.status !== "pending") return r.body;
    await sleep(400);
  }
  return null;
}

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

// ------------------------------------------------------------ Permisos
const gSum = await call("GET", "/finance/summary", { token: G });
const oSum = await call("GET", "/finance/summary", { token: O });
ok("guarda y propietario no entran al panel de finanzas", gSum.status === 403 && oSum.status === 403, { g: gSum.status, o: oSum.status });
const gRes = await call("GET", "/resident/finance", { token: G });
ok("el guarda no tiene estado de cuenta", gRes.status === 403, gRes.status);

// ------------------------------------------------------------ Resumen y morosidad
const sum = await call("GET", "/finance/summary", { token: A });
ok(
  "resumen: por cobrar, vencido, morosos y comprobantes por revisar",
  sum.status === 200 && sum.body.receivable > 0 && sum.body.overdue > 0 && sum.body.delinquent >= 2 && sum.body.units === 20 && sum.body.settings?.interestRate === 2,
  sum.body
);

const late = await call("GET", "/finance/balances?only=overdue", { token: A });
const codes = (late.body?.rows ?? []).map((b) => b.unitCode);
ok("morosidad: B-302 y A-202 en mora; A-101 al día", codes.includes("B-302") && codes.includes("A-202") && !codes.includes("A-101"), codes);
const a202Bal = late.body.rows.find((b) => b.unitCode === "A-202");
ok("A-202 debe la cuota vencida del mes pasado (FIFO)", a202Bal?.overdueCapital >= 85000 && a202Bal.oldestDue, a202Bal);
ok("la morosidad trae el responsable de pago", Boolean(a202Bal?.payer?.names), a202Bal?.payer);

const gen1 = await call("POST", "/finance/generate", { token: A });
const gen2 = await call("POST", "/finance/generate", { token: A });
ok("generar el mes es idempotente (la segunda vez no crea nada)", gen1.status === 200 && gen2.status === 200 && gen2.body.created === 0 && gen2.body.interest === 0, [gen1.body, gen2.body]);

// ------------------------------------------------------------ App: saldos y estado de cuenta
const oFin = await call("GET", "/resident/finance", { token: O });
const a101 = oFin.body?.units?.find((u) => u.unitCode === "A-101");
const b302 = oFin.body?.units?.find((u) => u.unitCode === "B-302");
ok("propietario ve el saldo de A-101 y B-302", oFin.status === 200 && a101 && b302 && b302.overdue > 0, oFin.body?.units);
ok("…las cuentas bancarias y el pago en línea", oFin.body?.bankAccounts?.length >= 2 && oFin.body.onlinePayments === true && oFin.body.currency?.code === "CRC", oFin.body);
const tFin = await call("GET", "/resident/finance", { token: TN });
ok("inquilino solo ve B-302", tFin.body?.units?.length === 1 && tFin.body.units[0].unitCode === "B-302", tFin.body?.units);

const st = await call("GET", `/resident/finance/units/${b302.unitId}/statement`, { token: TN });
ok(
  "estado de cuenta: cuotas, intereses y pagos con saldo corrido",
  st.status === 200 && st.body.rows.some((r) => r.kind === "interest") && st.body.rows.some((r) => r.type === "payment") && typeof st.body.rows[0].balance === "number",
  st.body?.rows?.slice(0, 3)
);
const stForeign = await call("GET", `/resident/finance/units/${a101.unitId}/statement`, { token: TN });
ok("inquilino no ve el estado de cuenta de una filial ajena", stForeign.status === 403, stForeign.body);

// ------------------------------------------------------------ Pago manual con comprobante
const as = socket(A, condo);
const ts = socket(TN, condo);
await Promise.all([as.ready, ts.ready]);
await Promise.all([as.waitFor("ready"), ts.waitFor("ready")]);

const dup = await call("POST", "/resident/finance/payments", {
  token: TN,
  body: { unitId: b302.unitId, method: "transfer", amount: 85000, paidOn: today, reference: "TRF-88231" }
});
ok("referencia repetida → 409", dup.status === 409 && dup.body?.error?.code === "DUPLICATE_REFERENCE", dup.body);

const bank = oFin.body.bankAccounts[0].id;
const rep1 = await call("POST", "/resident/finance/payments", {
  token: TN,
  body: { unitId: b302.unitId, method: "transfer", amount: 1000, paidOn: today, reference: `SMK-${stamp}-1`, bankAccountId: bank, notes: "Cuota atrasada" }
});
ok("inquilino reporta una transferencia → en revisión", rep1.status === 200 && rep1.body.status === "pending", rep1.body);
const adminNotif = await as.waitFor("notification", (n) => n.notification?.kind === "payment" && n.notification?.data?.paymentId === rep1.body?.id);
ok("la administración recibe el aviso en vivo", /Comprobante por revisar/.test(adminNotif?.notification?.title ?? ""), adminNotif);

const notMine = await call("PUT", `/resident/finance/payments/${rep1.body.id}/receipt`, { token: O, raw: png() });
ok("solo quien reportó adjunta el comprobante", notMine.status === 403, notMine.body);
const receipt = await call("PUT", `/resident/finance/payments/${rep1.body.id}/receipt`, { token: TN, raw: png(300) });
ok("sube la foto del comprobante", receipt.status === 200 && receipt.body?.preview?.includes("800.webp"), receipt.body);

const pending = await call("GET", "/finance/payments?status=pending", { token: A });
const pRow = pending.body?.rows?.find((p) => p.id === rep1.body.id);
ok("el panel lista el pago pendiente con su comprobante", Boolean(pRow?.receipt?.preview), pRow);
const img = await fetch(`${BASE}${pRow.receipt.preview}`);
ok("el comprobante se sirve por URL firmada", img.status === 200 && img.headers.get("content-type") === "image/webp");

const before = (await call("GET", "/resident/finance", { token: TN })).body.units[0];
const appr = await call("POST", `/finance/payments/${rep1.body.id}/approve`, { token: A, body: { notes: "Verificado en el banco" } });
ok("la administración aprueba el pago", appr.status === 200 && appr.body.status === "approved", appr.body);
const tNotif = await ts.waitFor("notification", (n) => n.notification?.kind === "payment" && n.notification?.data?.paymentId === rep1.body.id);
ok("al inquilino le llega «Pago aplicado» en vivo", /Pago aplicado/.test(tNotif?.notification?.title ?? ""), tNotif);
const after = (await call("GET", "/resident/finance", { token: TN })).body.units[0];
ok("el saldo de B-302 baja lo aprobado", Math.round(before.balance - after.balance) === 1000, { before: before.balance, after: after.balance });
const again = await call("POST", `/finance/payments/${rep1.body.id}/approve`, { token: A, body: {} });
ok("no se aprueba dos veces", again.status === 409, again.body);

const rep2 = await call("POST", "/resident/finance/payments", {
  token: TN,
  body: { unitId: b302.unitId, method: "deposit", amount: 1000, paidOn: today, reference: `SMK-${stamp}-2` }
});
const rejNo = await call("POST", `/finance/payments/${rep2.body.id}/reject`, { token: A, body: { notes: "" } });
ok("rechazar exige el motivo", rejNo.status === 400, rejNo.body);
const rej = await call("POST", `/finance/payments/${rep2.body.id}/reject`, { token: A, body: { notes: "No aparece en el estado bancario" } });
ok("la administración rechaza un pago con motivo", rej.status === 200 && rej.body.status === "rejected", rej.body);

// ------------------------------------------------------------ Pasarela simulada
const intent = await call("POST", "/resident/finance/online", { token: O, body: { unitId: a101.unitId, amount: 1000 } });
ok("inicia un pago en línea", intent.status === 200 && intent.body.paymentId && intent.body.gateway === "simulated", intent.body);
const pid = intent.body.paymentId;
const card = (number) => ({ number, expMonth: 12, expYear: new Date().getFullYear() + 2, cvc: "123", holder: "Henderson Rojas" });

const notYours = await call("POST", `/resident/finance/online/${pid}/confirm`, { token: TN, body: card("4242424242424242") });
ok("otra cuenta no confirma el pago", notYours.status === 403, notYours.body);
const luhnBad = await call("POST", `/resident/finance/online/${pid}/confirm`, { token: O, body: card("4242424242424241") });
ok("tarjeta inválida (Luhn) → 400", luhnBad.status === 400 && luhnBad.body?.error?.code === "CARD_INVALID", luhnBad.body);
const realCard = await call("POST", `/resident/finance/online/${pid}/confirm`, { token: O, body: card("4111111111111111") });
ok("la pasarela de prueba solo acepta tarjetas de prueba", realCard.status === 400 && realCard.body?.error?.code === "NOT_TEST_CARD", realCard.body);
const conf = await call("POST", `/resident/finance/online/${pid}/confirm`, { token: O, body: card("4242 4242 4242 4242") });
ok("confirma con la tarjeta de prueba → procesando", conf.status === 200 && conf.body.status === "processing" && conf.body.card?.last4 === "4242", conf.body);
const twice = await call("POST", `/resident/finance/online/${pid}/confirm`, { token: O, body: card("4242424242424242") });
ok("no se confirma dos veces", twice.status === 409, twice.body);
const done = await settled(O, pid);
ok("el webhook firmado aprueba el pago", done?.status === "approved" && done.cardLast4 === "4242" && done.cardBrand === "Visa", done);

const intent2 = await call("POST", "/resident/finance/online", { token: O, body: { unitId: a101.unitId, amount: 5000 } });
await call("POST", `/resident/finance/online/${intent2.body.paymentId}/confirm`, { token: O, body: card("4000000000000002") });
const declined = await settled(O, intent2.body.paymentId);
ok("tarjeta rechazada → pago rechazado con motivo", declined?.status === "rejected" && /rechazada/i.test(declined.reviewNotes ?? ""), declined);

const forged = await fetch(`${BASE}/api/v1/finance/webhooks/simulated`, {
  method: "POST",
  headers: { "content-type": "application/json", "x-domus-signature": `t=${Math.floor(Date.now() / 1000)},v1=${"0".repeat(64)}` },
  body: JSON.stringify({ id: "evt_fake", type: "payment.succeeded", data: { ref: "x", amount: 1, currency: "CRC", metadata: { condominiumId: condo, paymentId: pid } } })
});
ok("webhook con firma falsa → 401", forged.status === 401);

// ------------------------------------------------------------ Cargos manuales y anulación
const os = socket(O, condo);
await os.ready;
await os.waitFor("ready");
const fine = await call("POST", "/finance/charges", {
  token: A,
  body: { unitIds: [a101.unitId], kind: "fine", concept: `Multa de prueba ${stamp}`, amount: 25000, dueDate: today }
});
ok("la administración carga una multa", fine.status === 200 && fine.body.created === 1, fine.body);
const fineNotif = await os.waitFor("notification", (n) => n.notification?.kind === "charge");
ok("al propietario le llega el aviso del cargo", /Multa/.test(fineNotif?.notification?.title ?? ""), fineNotif);
const fineRow = (await call("GET", `/finance/charges?unitId=${a101.unitId}&kind=fine`, { token: A })).body.rows.find((c) => c.concept.includes(stamp));
const voidNo = await call("POST", `/finance/charges/${fineRow.id}/void`, { token: A, body: { reason: "" } });
const voidOk = await call("POST", `/finance/charges/${fineRow.id}/void`, { token: A, body: { reason: "Prueba de humo" } });
const voidAgain = await call("POST", `/finance/charges/${fineRow.id}/void`, { token: A, body: { reason: "Otra vez" } });
ok("anular exige motivo, anula y no anula dos veces", voidNo.status === 400 && voidOk.status === 200 && voidAgain.status === 409, [voidNo.status, voidOk.status, voidAgain.status]);

// ------------------------------------------------------------ Cuota por alícuota
const plan = await call("POST", "/finance/plans", {
  token: A,
  body: { name: `Fondo de prueba ${stamp}`, kind: "extraordinary", mode: "aliquot", amount: 200000, scope: "units", unitIds: [a101.unitId, b302.unitId], startPeriod: thisMonth, endPeriod: thisMonth }
});
ok("crea una cuota extraordinaria por alícuota", plan.status === 200 && plan.body.id, plan.body);
const gen3 = await call("POST", "/finance/generate", { token: A });
ok("la genera para las dos filiales", gen3.body?.created === 2, gen3.body);
const planCharges = (await call("GET", `/finance/charges?period=${thisMonth}&kind=extraordinary&pageSize=200`, { token: A })).body.rows.filter((c) => c.planId === plan.body.id);
ok("reparte por alícuota (5 % y 5 % → mitad cada una)", planCharges.length === 2 && planCharges.every((c) => c.amount === 100000), planCharges.map((c) => c.amount));
for (const c of planCharges) await call("POST", `/finance/charges/${c.id}/void`, { token: A, body: { reason: "Limpieza de la prueba de humo" } });
await call("PUT", `/finance/plans/${plan.body.id}`, {
  token: A,
  body: { name: `Fondo de prueba ${stamp}`, kind: "extraordinary", mode: "aliquot", amount: 200000, scope: "units", unitIds: [a101.unitId, b302.unitId], startPeriod: thisMonth, endPeriod: thisMonth, isActive: false }
});

// ------------------------------------------------------------ Gastos, cuentas y parámetros
const exp = await call("POST", "/finance/expenses", {
  token: A,
  body: { spentOn: today, category: "maintenance", supplier: "Prueba S.A.", description: `Gasto de prueba ${stamp}`, amount: 12345 }
});
const expList = await call("GET", `/finance/expenses?from=${today}`, { token: A });
ok("registra un gasto y suma en el período", exp.status === 200 && expList.body.rows.some((e) => e.description.includes(stamp)), exp.body);
const expReceipt = await call("PUT", `/finance/expenses/${exp.body.id}/receipt`, { token: A, raw: png(200) });
ok("adjunta la factura del gasto", expReceipt.status === 200 && expReceipt.body?.preview, expReceipt.body);
const expVoid = await call("POST", `/finance/expenses/${exp.body.id}/void`, { token: A, body: { reason: "Prueba de humo" } });
ok("anula el gasto", expVoid.status === 200, expVoid.body);

const settings = await call("GET", "/finance/settings", { token: A });
const put = await call("PUT", "/finance/settings", { token: A, body: { ...settings.body, graceDays: settings.body.graceDays } });
const badRate = await call("PUT", "/finance/settings", { token: A, body: { ...settings.body, interestRate: 50 } });
ok("parámetros: guarda y valida el interés (máx. 10 %)", put.status === 200 && badRate.status === 400, [put.status, badRate.status]);

// ------------------------------------------------------------ Exportes
const xl = await call("GET", "/finance/balances/export?only=overdue&format=xlsx", { token: A });
ok("exporta la morosidad a Excel", xl.status === 200 && xl.headers.get("content-type")?.includes("spreadsheetml"));
const pdfOf = async (path) => {
  const r = await fetch(`${BASE}/api/v1${path}`, { headers: { authorization: `Bearer ${A}` } });
  return r.status === 200 && Buffer.from(await r.arrayBuffer()).subarray(0, 5).toString() === "%PDF-";
};
ok("estado de cuenta en PDF", await pdfOf(`/finance/units/${b302.unitId}/statement/export?format=pdf`));
ok("pagos y gastos en PDF", (await pdfOf("/finance/payments/export?format=pdf")) && (await pdfOf("/finance/expenses/export?format=pdf")));

as.close();
ts.close();
os.close();
finish();
