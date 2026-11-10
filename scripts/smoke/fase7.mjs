// =====================================================================
//  DomusApp · scripts/smoke/fase7.mjs
//  Pruebas de humo de la fase 7 (gestión administrativa) con SEED_DEMO=true:
//  permisos; proveedores (contactos, personal, contratos y su PDF, directorio de la app);
//  casos (alta desde la app y el panel, correlativo concurrente, denuncia anónima,
//  visibilidad entre filiales, adjuntos, notas internas, estados, confirmación con
//  calificación, reapertura y avisos); asambleas y acuerdos (convocatoria con aviso,
//  acta, numeración, avance, cancelación); documentos (archivo, audiencia, aviso) e
//  inventario (bitácora, mantenimiento, traslado, estado, baja, foto) y exportes.
//  Es repetible: lo que crea lleva un sello y al final se desactiva o se borra.
//    node scripts/smoke/fase7.mjs
// =====================================================================

import { BASE, call, finish, login, ok, pdf, png, socket } from "./lib.mjs";

console.log(`════════ Fase 7 · gestión administrativa (${BASE})`);

const stamp = Date.now().toString(36).toUpperCase();
const TZ = "America/Costa_Rica";
const dayPlus = (n) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date(Date.now() + n * 86_400_000));

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
const os = socket(O, condo);
await Promise.all([as.ready, os.ready]);

const fin = await call("GET", "/resident/finance", { token: O });
const a101 = fin.body.units.find((u) => u.unitCode === "A-101").unitId;

const notifs = async (token) => (await call("GET", "/notifications", { token })).body?.rows ?? [];
const download = async (url) => {
  const r = await fetch(`${BASE}${url}`);
  return { status: r.status, type: r.headers.get("content-type"), disposition: r.headers.get("content-disposition"), head: Buffer.from(await r.arrayBuffer()).subarray(0, 5).toString() };
};

// ------------------------------------------------------------ Permisos
const panels = ["/cases", "/suppliers", "/assemblies", "/documents", "/inventory"];
const denied = await Promise.all(panels.flatMap((p) => [call("GET", p, { token: G }), call("GET", p, { token: O })]));
ok("guarda y propietario no entran a los módulos del panel", denied.every((r) => r.status === 403), denied.map((r) => r.status));
const gCases = await call("GET", "/resident/cases", { token: G });
ok("el guarda no usa los casos de residentes", gCases.status === 403, gCases.status);

// ================================================================== Proveedores
const sups = await call("GET", "/suppliers", { token: A });
ok("proveedores demo con contratos", sups.status === 200 && sups.body.length >= 6 && sups.body.some((s) => s.expiring > 0) && sups.body.some((s) => s.expired > 0), sups.body?.length);
const supSum = await call("GET", "/suppliers/summary", { token: A });
ok("resumen: activos, contratos, por vencer y personal", supSum.status === 200 && supSum.body.active >= 6 && supSum.body.expiring >= 1 && supSum.body.staff >= 5, supSum.body);

const supBody = { name: `Proveedor de prueba ${stamp}`, category: "maintenance", phone: "8888-0000", email: "prueba@example.com", notes: "Nota interna", showToResidents: true };
const sup = await call("POST", "/suppliers", { token: A, body: supBody });
ok("crea un proveedor", sup.status === 200 && sup.body.name === supBody.name && sup.body.contacts.length === 0, sup.body);
const dupSup = await call("POST", "/suppliers", { token: A, body: supBody });
ok("no repite el nombre", dupSup.status === 409, dupSup.body);
const badMail = await call("POST", "/suppliers", { token: A, body: { ...supBody, name: `Otro ${stamp}`, email: "no-es-correo" } });
ok("valida el correo", badMail.status === 400, badMail.body);
const S = sup.body.id;

await call("POST", `/suppliers/${S}/contacts`, { token: A, body: { names: "Contacto Uno", phone: "8000-0001", isPrimary: true } });
const c2 = await call("POST", `/suppliers/${S}/contacts`, { token: A, body: { names: "Contacto Dos", phone: "8000-0002", isPrimary: true } });
ok("un solo contacto principal", c2.status === 200 && c2.body.contacts.filter((c) => c.isPrimary).length === 1 && c2.body.contacts[0].names === "Contacto Dos", c2.body?.contacts);
const st = await call("POST", `/suppliers/${S}/staff`, { token: A, body: { names: "Técnico de prueba", idNumber: "1-1111-1111", role: "Técnico", schedule: "L a V" } });
ok("agrega personal designado", st.status === 200 && st.body.staff.length === 1 && st.body.staff[0].isActive, st.body?.staff);
const badRange = await call("POST", `/suppliers/${S}/contracts`, { token: A, body: { title: "Contrato mal", startsOn: dayPlus(5), endsOn: dayPlus(1), frequency: "monthly" } });
ok("el contrato no termina antes de empezar", badRange.status === 400, badRange.body);
const ct = await call("POST", `/suppliers/${S}/contracts`, { token: A, body: { title: "Mantenimiento general", startsOn: dayPlus(-20), endsOn: dayPlus(10), amount: 150000, frequency: "monthly" } });
const contract = ct.body?.contracts?.[0];
ok("contrato vigente que vence en 10 días queda «por vencer»", ct.status === 200 && contract?.status === "expiring" && ct.body.expiring === 1, contract);
const badFile = await call("PUT", `/suppliers/contracts/${contract.id}/file`, { token: A, raw: Buffer.from("esto no es un pdf ni una imagen, solo texto plano de prueba"), rawType: "application/pdf" });
ok("rechaza archivos que no son PDF ni imagen", badFile.status === 415, badFile.body);
const ctFile = await call("PUT", `/suppliers/contracts/${contract.id}/file`, { token: A, raw: pdf("Contrato de prueba"), rawType: "application/pdf" });
const cFile = ctFile.body?.contracts?.[0]?.file;
ok("sube el PDF del contrato", ctFile.status === 200 && cFile?.kind === "pdf" && cFile.full.includes("orig.pdf"), cFile);
const dl = await download(cFile.full);
ok("el PDF se entrega como descarga", dl.status === 200 && dl.type === "application/pdf" && dl.disposition?.startsWith("attachment") && dl.head === "%PDF-", dl);
const tampered = await fetch(`${BASE}${cFile.full.replace(/sig=[0-9a-f]+/, "sig=" + "0".repeat(32))}`);
ok("…y con la firma alterada no", tampered.status === 403, tampered.status);

const dir = await call("GET", "/resident/suppliers", { token: O });
const mineDir = dir.body?.find((s) => s.id === S);
ok("directorio de la app: solo los compartidos, con contacto y «nuevo»", dir.status === 200 && mineDir?.isNew && mineDir.contact?.names === "Contacto Dos" && !dir.body.some((s) => s.name.startsWith("Seguridad Integral")), dir.body?.map((s) => s.name));
ok("…sin las notas internas", mineDir && !("notes" in mineDir), mineDir);
const supXl = await call("GET", "/suppliers/export?format=xlsx", { token: A });
ok("exporta proveedores a Excel", supXl.status === 200 && supXl.headers.get("content-type")?.includes("spreadsheetml"));

// ================================================================== Casos
const demoCases = await call("GET", "/cases?scope=all&pageSize=100", { token: A });
const anonDemo = demoCases.body?.rows?.find((c) => c.isAnonymous);
ok("bandeja del panel con casos demo", demoCases.status === 200 && demoCases.body.total >= 6, demoCases.body?.total);
ok("una denuncia anónima no muestra quién la hizo", anonDemo && anonDemo.reportedByName === null && anonDemo.reportedById === null && anonDemo.unitId === null, anonDemo);

const newCase = (token, body) => call("POST", "/resident/cases", { token, body });
const k1 = await newCase(O, { category: "damage", title: `Puerta del gimnasio ${stamp}`, description: "La puerta del gimnasio no cierra bien y queda abierta de noche.", location: "Gimnasio", unitId: a101 });
ok("el propietario reporta un daño", k1.status === 200 && k1.body.status === "open" && k1.body.code.startsWith("#") && k1.body.unitId === a101 && k1.body.mine, k1.body);
const K = k1.body.id;
ok("la administración recibe el aviso y el evento", (await notifs(A)).some((n) => n.kind === "case" && n.data?.caseId === K) && Boolean(await as.waitFor("cases:update", (d) => d.id === K)));
const short = await newCase(O, { category: "damage", title: "Algo", description: "corto" });
ok("valida asunto y descripción", short.status === 400, short.body);
const anonBad = await newCase(O, { category: "complaint", title: "Queja anónima", description: "Esto no debería poder ser anónimo.", anonymous: true });
ok("solo las denuncias pueden ser anónimas", anonBad.status === 400, anonBad.body);
const anon = await newCase(O, { category: "report", title: `Denuncia ${stamp}`, description: "Alguien deja basura fuera del depósito todas las noches.", anonymous: true, unitId: a101 });
ok("denuncia anónima: sin filial y visible para quien la hizo", anon.status === 200 && anon.body.isAnonymous && anon.body.unitId === null && anon.body.mine, anon.body);
const anonAdmin = await call("GET", `/cases/${anon.body.id}`, { token: A });
ok("…la administración no ve al autor", anonAdmin.status === 200 && anonAdmin.body.reportedByName === null && anonAdmin.body.reportedById === null, anonAdmin.body);
const aNotif = (await notifs(A)).find((n) => n.data?.caseId === anon.body.id);
ok("…ni en el aviso", aNotif && aNotif.body.startsWith("Anónimo") && !aNotif.body.includes("A-101"), aNotif);

const tList = await call("GET", "/resident/cases", { token: TN });
ok("otra filial no ve los casos ajenos", tList.status === 200 && !tList.body.some((c) => c.id === K || c.id === anon.body.id), tList.body?.map((c) => c.code));
const tGet = await call("GET", `/resident/cases/${K}`, { token: TN });
ok("…ni por enlace directo", tGet.status === 404, tGet.status);

const ph = await call("POST", `/resident/cases/${K}/files`, { token: O, raw: png(400, 300, [200, 80, 60]) });
ok("adjunta una foto", ph.status === 200 && ph.body.files.length === 1 && ph.body.files[0].kind === "image" && ph.body.files[0].preview, ph.body?.files);
const pf = await call("POST", `/resident/cases/${K}/files`, { token: O, raw: pdf("Cotización"), rawType: "application/pdf" });
ok("…y un PDF", pf.status === 200 && pf.body.files.length === 2 && pf.body.files[1].kind === "pdf", pf.body?.files);
const img = await fetch(`${BASE}${ph.body.files[0].preview}`);
ok("la vista previa de la foto se descarga", img.status === 200 && img.headers.get("content-type") === "image/webp");

const byNum = await call("GET", `/cases?search=${encodeURIComponent(k1.body.code)}`, { token: A });
ok("el panel busca por número", byNum.body?.rows?.length === 1 && byNum.body.rows[0].id === K, byNum.body);
const note = await call("POST", `/cases/${K}/updates`, { token: A, body: { body: "Nota interna: revisar bisagra", internal: true } });
ok("nota interna en el panel", note.status === 200 && note.body.updates.some((u) => u.isInternal), note.body?.updates);
const oView = await call("GET", `/resident/cases/${K}`, { token: O });
ok("…que el residente no ve", oView.status === 200 && !oView.body.updates.some((u) => u.isInternal || u.body?.includes("Nota interna")), oView.body?.updates);
const intFile = await call("POST", `/cases/${K}/files?internal=true`, { token: A, raw: png(64, 64) });
const oView2 = await call("GET", `/resident/cases/${K}`, { token: O });
ok("adjunto interno oculto en la app", intFile.body?.files?.length === 3 && oView2.body.files.length === 2, { panel: intFile.body?.files?.length, app: oView2.body?.files?.length });
const intStatus = await call("POST", `/cases/${K}/updates`, { token: A, body: { status: "in_progress", internal: true } });
ok("una nota interna no cambia el estado", intStatus.status === 400, intStatus.body);

const sups2 = await call("GET", "/cases/supplier-options", { token: A });
const plumber = sups2.body?.find((s) => s.name.startsWith("Fontanería"));
const asg = await call("PUT", `/cases/${K}`, { token: A, body: { category: "damage", title: k1.body.title, location: "Gimnasio", priority: "high", supplierId: plumber.id, assignee: "Conserjería", dueOn: dayPlus(-1) } });
ok("asigna proveedor, responsable, prioridad y compromiso (vencido)", asg.status === 200 && asg.body.supplierName === plumber.name && asg.body.priority === "high" && asg.body.overdue, asg.body);
const prog = await call("POST", `/cases/${K}/updates`, { token: A, body: { status: "in_progress", body: "Ya viene el técnico." } });
ok("pasa a en proceso con respuesta", prog.status === 200 && prog.body.status === "in_progress" && prog.body.updates.some((u) => u.statusTo === "in_progress"), prog.body?.status);
ok("al propietario le llega el aviso y el evento", (await notifs(O)).some((n) => n.kind === "case" && n.data?.caseId === K && n.title.includes("en proceso")) && Boolean(await os.waitFor("cases:update", (d) => d.id === K)));
const rejNo = await call("POST", `/cases/${K}/updates`, { token: A, body: { status: "rejected" } });
ok("rechazar exige explicación", rejNo.status === 400, rejNo.body);
const reply = await call("POST", `/resident/cases/${K}/comments`, { token: O, body: { body: "Gracias, quedo atento." } });
ok("el residente responde", reply.status === 200 && reply.body.updates.at(-1)?.side === "resident", reply.body?.updates?.at(-1));
const closeEarly = await call("POST", `/resident/cases/${K}/close`, { token: O, body: { rating: 5 } });
ok("no confirma un caso que aún no está resuelto", closeEarly.status === 409, closeEarly.body);
const res = await call("POST", `/cases/${K}/updates`, { token: A, body: { status: "resolved", body: "Se ajustó la bisagra y el cierre." } });
ok("se marca resuelto", res.status === 200 && res.body.status === "resolved" && res.body.resolvedAt, res.body?.status);
const close = await call("POST", `/resident/cases/${K}/close`, { token: O, body: { rating: 4, comment: "Bien, aunque tardó." } });
ok("el residente confirma y califica", close.status === 200 && close.body.status === "closed" && close.body.rating === 4 && close.body.closedAt, close.body);
const afterClose = await call("POST", `/resident/cases/${K}/comments`, { token: O, body: { body: "Otro comentario" } });
ok("un caso cerrado ya no recibe comentarios", afterClose.status === 409, afterClose.body);
const reopenAdmin = await call("POST", `/cases/${K}/updates`, { token: A, body: { status: "open" } });
ok("…ni cambia de estado", reopenAdmin.status === 409, reopenAdmin.body);

const k2 = await newCase(O, { category: "improvement", title: `Más luz en el pasillo ${stamp}`, description: "El pasillo del segundo piso está muy oscuro en la noche." });
await call("POST", `/cases/${k2.body.id}/updates`, { token: A, body: { status: "resolved", body: "Se cambiaron los bombillos." } });
const reopen = await call("POST", `/resident/cases/${k2.body.id}/reopen`, { token: O, body: { body: "Uno de los bombillos ya se quemó otra vez." } });
ok("el residente reabre un caso resuelto", reopen.status === 200 && reopen.body.status === "open" && reopen.body.resolvedAt === null, reopen.body);
ok("…y la administración recibe «Reabierto»", (await notifs(A)).some((n) => n.data?.caseId === k2.body.id && n.title.startsWith("Reabierto")));
await call("POST", `/cases/${k2.body.id}/updates`, { token: A, body: { status: "rejected", body: "Prueba de humo: se cierra." } });

const [p1, p2] = await Promise.all([
  call("POST", "/cases", { token: A, body: { category: "improvement", title: `Concurrente A ${stamp}`, description: "Caso creado en paralelo A", priority: "urgent" } }),
  call("POST", "/cases", { token: A, body: { category: "improvement", title: `Concurrente B ${stamp}`, description: "Caso creado en paralelo B", priority: "low" } })
]);
ok("casos simultáneos reciben números distintos", p1.status === 200 && p2.status === 200 && p1.body.number !== p2.body.number && p1.body.source === "panel", [p1.body?.number, p2.body?.number]);
const sum = await call("GET", "/cases/summary", { token: A });
ok("resumen de casos (urgentes, vencidos, tiempo medio, calificación)", sum.status === 200 && sum.body.urgent >= 1 && sum.body.overdue >= 1 && typeof sum.body.avgHours === "number" && sum.body.rating > 0, sum.body);
for (const p of [p1, p2]) await call("POST", `/cases/${p.body.id}/updates`, { token: A, body: { status: "rejected", body: "Prueba de humo: se cierra." } });
await call("POST", `/cases/${anon.body.id}/updates`, { token: A, body: { status: "rejected", body: "Prueba de humo: se cierra." } });
const finished = await call("GET", "/resident/cases?scope=finished", { token: O });
ok("historial de la app con los cerrados", finished.status === 200 && finished.body.some((c) => c.id === K && c.status === "closed"), finished.body?.length);
const casePdf = await fetch(`${BASE}/api/v1/cases/export?format=pdf&scope=all`, { headers: { authorization: `Bearer ${A}` } });
ok("exporta casos a PDF", casePdf.status === 200 && Buffer.from(await casePdf.arrayBuffer()).subarray(0, 5).toString() === "%PDF-");

// ================================================================== Asambleas y acuerdos
const aSum = await call("GET", "/assemblies/summary", { token: A });
ok("resumen: próxima asamblea y acuerdos vencidos", aSum.status === 200 && aSum.body.next?.title && aSum.body.agreements.overdue >= 1, aSum.body);
const asmBody = { title: `Asamblea de prueba ${stamp}`, kind: "extraordinary", date: dayPlus(7), time: "19:30", location: "Salón de eventos", agenda: "1. Quórum\n2. Votación" };
const asm = await call("POST", "/assemblies?notify=true", { token: A, body: asmBody });
ok("convoca una asamblea", asm.status === 200 && asm.body.status === "scheduled" && asm.body.time === "19:30" && asm.body.date === asmBody.date, asm.body);
const M = asm.body.id;
ok("…y los residentes reciben la convocatoria", (await notifs(O)).some((n) => n.kind === "assembly" && n.data?.assemblyId === M && n.title.startsWith("Convocatoria")));
const early = await call("POST", `/assemblies/${M}/held`, { token: A, body: { attendanceUnits: 10, quorumReached: true } });
ok("no se registra como celebrada antes de su fecha", early.status === 409, early.body);
const ag1 = await call("POST", `/assemblies/${M}/agreements`, { token: A, body: { title: "Aprobar la cuota extraordinaria", responsible: "Junta", dueOn: dayPlus(30) } });
const ag2 = await call("POST", `/assemblies/${M}/agreements`, { token: A, body: { title: "Contratar la remodelación", supplierId: S } });
ok("acuerdos con número correlativo", ag2.status === 200 && ag2.body.agreements.map((g) => g.number).join() === "1,2" && ag2.body.agreements[1].supplierName === supBody.name, ag2.body?.agreements);
const g1 = ag1.body.agreements[0];
const done = await call("PUT", `/assemblies/agreements/${g1.id}`, { token: A, body: { ...g1, status: "done", progressNotes: "Aprobada" } });
ok("un acuerdo cumplido guarda la fecha", done.status === 200 && done.body.agreements[0].status === "done" && done.body.agreements[0].completedAt && done.body.agreementsDone === 1, done.body?.agreements?.[0]);
const mins = await call("PUT", `/assemblies/${M}/minutes`, { token: A, raw: pdf("Acta"), rawType: "application/pdf" });
ok("sube el acta (PDF)", mins.status === 200 && mins.body.minutes?.kind === "pdf", mins.body?.minutes);
const rList = await call("GET", "/resident/assemblies", { token: O });
ok("la app lista la asamblea (próximas primero)", rList.status === 200 && rList.body[0].status === "scheduled" && rList.body.some((a) => a.id === M), rList.body?.map((a) => a.title));
const rDet = await call("GET", `/resident/assemblies/${M}`, { token: O });
ok("…con agenda, acta y acuerdos", rDet.status === 200 && rDet.body.agenda && rDet.body.minutes?.full && rDet.body.agreements.length === 2, rDet.body);
const rAg = await call("GET", "/resident/agreements", { token: O });
ok("seguimiento de acuerdos en la app (pendientes, con vencidos)", rAg.status === 200 && rAg.body.some((g) => g.overdue) && rAg.body.every((g) => g.status === "pending" || g.status === "in_progress"), rAg.body?.length);
const delHas = await call("DELETE", `/assemblies/${M}`, { token: A });
ok("no se borra una asamblea con acuerdos", delHas.status === 409, delHas.body);
const cancelNo = await call("POST", `/assemblies/${M}/cancel`, { token: A, body: {} });
const cancel = await call("POST", `/assemblies/${M}/cancel`, { token: A, body: { reason: "Prueba de humo" } });
ok("cancelar exige motivo y avisa", cancelNo.status === 400 && cancel.status === 200 && cancel.body.status === "cancelled" && (await notifs(O)).some((n) => n.data?.assemblyId === M && n.title === "Asamblea cancelada"), cancel.body?.status);
const tmp = await call("POST", "/assemblies?notify=false", { token: A, body: { ...asmBody, title: `Borrador ${stamp}` } });
const delTmp = await call("DELETE", `/assemblies/${tmp.body.id}`, { token: A });
ok("borra una convocatoria sin acuerdos", delTmp.status === 200, delTmp.body);
const agXl = await call("GET", "/assemblies/agreements/export?format=xlsx&scope=all", { token: A });
ok("exporta los acuerdos a Excel", agXl.status === 200 && agXl.headers.get("content-type")?.includes("spreadsheetml"));

// ================================================================== Documentos
const rDocs = await call("GET", "/resident/documents", { token: O });
ok("documentos de la app: reglamentos primero, sin los internos", rDocs.status === 200 && rDocs.body[0].category === "regulation" && !rDocs.body.some((d) => d.audience === "staff") && rDocs.body.every((d) => d.file?.full), rDocs.body?.map((d) => d.title));
const docBody = { title: `Circular de prueba ${stamp}`, category: "circular", description: "Prueba", audience: "residents", publishedOn: dayPlus(0) };
const doc = await call("POST", "/documents", { token: A, body: docBody });
const D = doc.body?.id;
const noFile = await call("GET", "/resident/documents", { token: O });
ok("sin archivo no aparece en la app", doc.status === 200 && !noFile.body.some((d) => d.id === D), doc.body);
const up = await call("PUT", `/documents/${D}/file?notify=true`, { token: A, raw: pdf("Circular"), rawType: "application/pdf" });
const withFile = await call("GET", "/resident/documents", { token: O });
ok("con archivo aparece y avisa a los residentes", up.status === 200 && up.body.file?.kind === "pdf" && withFile.body.some((d) => d.id === D) && (await notifs(O)).some((n) => n.kind === "document" && n.data?.documentId === D), up.body);
const docDl = await download(withFile.body.find((d) => d.id === D).file.full);
ok("…y se descarga con su nombre", docDl.status === 200 && docDl.head === "%PDF-" && docDl.disposition?.includes("Circular"), docDl);
const staffOnly = await call("PUT", `/documents/${D}`, { token: A, body: { ...docBody, audience: "staff" } });
const hidden = await call("GET", "/resident/documents", { token: O });
ok("pasarlo a «solo administración» lo oculta en la app", staffOnly.status === 200 && !hidden.body.some((d) => d.id === D));
const delDoc = await call("DELETE", `/documents/${D}`, { token: A });
const gone = await download(up.body.file.full);
ok("borrar el documento borra su archivo", delDoc.status === 200 && gone.status === 404, { del: delDoc.status, file: gone.status });

// ================================================================== Inventario
const inv = await call("GET", "/inventory/summary", { token: A });
ok("resumen del inventario", inv.status === 200 && inv.body.items >= 8 && inv.body.value > 0 && inv.body.maintenanceDue >= 2 && inv.body.damaged >= 1, inv.body);
const due = await call("GET", "/inventory?maintenance=due", { token: A });
ok("filtro de mantenimientos por vencer", due.status === 200 && due.body.some((i) => i.code === "INV-003" && i.maintenanceOverdue), due.body?.map((i) => i.code));
const opts = await call("GET", "/inventory/options", { token: A });
const salon = opts.body?.amenities?.find((a) => a.name === "Salón de eventos");
const itemBody = { code: `t-${stamp}`, name: "Proyector de prueba", category: "electronics", amenityId: salon.id, quantity: 2, unitValue: 250000, condition: "good", maintenanceMonths: 6 };
const it = await call("POST", "/inventory", { token: A, body: itemBody });
ok("registra un bien (código en mayúsculas, valor total)", it.status === 200 && it.body.code === `T-${stamp}` && it.body.totalValue === 500000 && it.body.amenityName === "Salón de eventos", it.body);
const dupIt = await call("POST", "/inventory", { token: A, body: itemBody });
ok("no repite el código", dupIt.status === 409, dupIt.body);
const I = it.body.id;
const mt = await call("POST", `/inventory/${I}/logs`, { token: A, body: { kind: "maintenance", happenedOn: "2026-10-15", description: "Limpieza del filtro", cost: 15000, supplierId: S } });
ok("mantenimiento recalcula el próximo (+6 meses)", mt.status === 200 && mt.body.nextMaintenanceOn === "2027-04-15" && mt.body.logs[0].supplierName === supBody.name, mt.body?.nextMaintenanceOn);
const mvNo = await call("POST", `/inventory/${I}/logs`, { token: A, body: { kind: "move", happenedOn: dayPlus(0), description: "Traslado" } });
const mv = await call("POST", `/inventory/${I}/logs`, { token: A, body: { kind: "move", happenedOn: dayPlus(0), description: "A la oficina", location: "Oficina de administración" } });
ok("traslado exige destino y lo actualiza", mvNo.status === 400 && mv.status === 200 && mv.body.location === "Oficina de administración" && mv.body.amenityId === null, mv.body?.location);
const br = await call("POST", `/inventory/${I}/logs`, { token: A, body: { kind: "condition", happenedOn: dayPlus(0), description: "No enciende", condition: "broken" } });
const rp = await call("POST", `/inventory/${I}/logs`, { token: A, body: { kind: "repair", happenedOn: dayPlus(0), description: "Cambio de lámpara", cost: 40000 } });
ok("cambio de estado y reparación", br.body?.condition === "broken" && rp.body?.condition === "good" && rp.body.logs.length === 4, [br.body?.condition, rp.body?.condition]);
const iph = await call("PUT", `/inventory/${I}/photo`, { token: A, raw: png(300, 300, [90, 90, 90]) });
ok("foto del bien", iph.status === 200 && iph.body.photo?.thumb, iph.body?.photo);
const ret = await call("POST", `/inventory/${I}/logs`, { token: A, body: { kind: "retire", happenedOn: dayPlus(0), description: "Obsoleto" } });
const afterRet = await call("POST", `/inventory/${I}/logs`, { token: A, body: { kind: "note", happenedOn: dayPlus(0), description: "Nota" } });
ok("baja: queda inactivo y no admite más movimientos", ret.body?.isActive === false && ret.body.retireReason === "Obsoleto" && afterRet.status === 409, ret.body?.isActive);
const invXl = await call("GET", "/inventory/export?format=xlsx&active=all", { token: A });
ok("exporta el inventario a Excel", invXl.status === 200 && invXl.headers.get("content-type")?.includes("spreadsheetml"));
const delIt = await call("DELETE", `/inventory/${I}`, { token: A });
const photoGone = await fetch(`${BASE}${iph.body.photo.thumb}`);
ok("borrar el bien borra su foto", delIt.status === 200 && photoGone.status === 404, photoGone.status);

// ------------------------------------------------------------ Limpieza
const delCt = await call("DELETE", `/suppliers/contracts/${contract.id}`, { token: A });
const cGone = await download(cFile.full);
ok("borrar el contrato borra su archivo", delCt.status === 200 && cGone.status === 404, { del: delCt.status, file: cGone.status });
const off = await call("PUT", `/suppliers/${S}`, { token: A, body: { ...supBody, isActive: false } });
const dir2 = await call("GET", "/resident/suppliers", { token: O });
ok("el proveedor desactivado sale del directorio", off.status === 200 && !dir2.body.some((s) => s.id === S), off.body?.isActive);

as.close();
os.close();
finish();
