// =====================================================================
//  DomusApp · scripts/smoke/fase3.mjs
//  Pruebas de humo de la fase 3 (pánico, alertas y mensajería) con SEED_DEMO=true:
//  tiempo real por Socket.IO, ciclo de la alerta, campana, mensajes con la
//  caseta, comunicados, tokens push y avisos de visitas en vivo.
//    node scripts/smoke/fase3.mjs
// =====================================================================

import { BASE, call, finish, login, ok, sleep, socket } from "./lib.mjs";

console.log(`════════ Fase 3 · pánico, alertas y mensajería (${BASE})`);

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
const condo = owner.condominium?.id;

const home = await call("GET", "/resident/home", { token: O });
const a101 = home.body.units.find((u) => u.code === "A-101")?.id;
const b302 = home.body.units.find((u) => u.code === "B-302")?.id;
ok("propietario ve A-101 y B-302", Boolean(a101 && b302));

// ------------------------------------------------------------ Socket.IO
const anon = socket("no-es-un-token", condo);
const anonReady = await anon.ready;
ok("socket sin token válido → rechazado", !anonReady.ok, anonReady);
anon.close();

const gs = socket(G, condo);
const os = socket(O, condo);
const ts = socket(TN, condo);
const [gr, or, tr] = await Promise.all([gs.ready, os.ready, ts.ready]);
ok("socket del guarda, propietario e inquilino conectan", gr.ok && or.ok && tr.ok, { gr, or, tr });
const gReady = await gs.waitFor("ready");
ok("el socket confirma rol y condominio", gReady?.role === "guard" && gReady?.condominiumId === condo, gReady);
await os.waitFor("ready");
await ts.waitFor("ready");

// ------------------------------------------------------------ Alerta: activar
const bad = await call("POST", "/resident/alerts", { token: O, body: { kind: "zombies", unitId: a101 } });
ok("tipo de alerta inválido → 400", bad.status === 400, bad.body);
const foreign = await call("POST", "/resident/alerts", { token: TN, body: { kind: "fire", unitId: a101 } });
ok("inquilino no activa alertas de una filial ajena", foreign.status === 409 && foreign.body?.error?.code === "UNIT_FORBIDDEN", foreign.body);

const raised = await call("POST", "/resident/alerts", { token: O, body: { kind: "fire", unitId: a101, notes: "Humo en la cocina (smoke)" } });
ok("propietario activa alerta de incendio", raised.status === 200 && raised.body?.id && raised.body.duplicate === false, raised.body);
const alertId = raised.body?.id;

const live = await gs.waitFor("alert:new", (a) => a.id === alertId);
ok("la caseta recibe la alerta en tiempo real", live?.kind === "fire" && live?.unitCode === "A-101" && live?.status === "active", live);
const gNotif = await gs.waitFor("notification", (n) => n.notification?.kind === "alert" && n.notification?.data?.alertId === alertId);
ok("…y la campana del guarda suma el aviso", gNotif?.unread > 0 && /Incendio/.test(gNotif.notification.title), gNotif);

const again = await call("POST", "/resident/alerts", { token: O, body: { kind: "fire", unitId: a101 } });
ok("doble toque no duplica la alerta", again.body?.id === alertId && again.body?.duplicate === true, again.body);

const tenantView = await call("GET", "/resident/alerts", { token: TN });
ok("el inquilino (B-302) no ve la alerta de A-101", tenantView.status === 200 && !tenantView.body.open.some((a) => a.id === alertId));

const board = await call("GET", "/guard/alerts", { token: G });
const onBoard = board.body?.open?.find((a) => a.id === alertId);
ok("la caseta lista la alerta abierta con teléfonos de la filial", Array.isArray(onBoard?.phones), board.body);

const ownerAck = await call("POST", `/guard/alerts/${alertId}/ack`, { token: O, body: {} });
ok("un propietario no puede tomar alertas → 403", ownerAck.status === 403, ownerAck.body);

// ------------------------------------------------------------ Alerta: atender
const ack = await call("POST", `/guard/alerts/${alertId}/ack`, { token: G, body: {} });
ok("guarda: voy en camino", ack.status === 200 && ack.body?.status === "acknowledged" && ack.body.ackSeconds >= 0, ack.body);
const ownerUpdate = await os.waitFor("alert:update", (a) => a.id === alertId && a.status === "acknowledged");
ok("el propietario ve en vivo que un guarda va en camino", Boolean(ownerUpdate?.acknowledgedByName), ownerUpdate);

const ack2 = await call("POST", `/guard/alerts/${alertId}/ack`, { token: G, body: {} });
ok("tomarla dos veces → 409 ALREADY_ACKNOWLEDGED", ack2.status === 409 && ack2.body?.error?.code === "ALREADY_ACKNOWLEDGED", ack2.body);

const noRes = await call("POST", `/guard/alerts/${alertId}/attend`, { token: G, body: { resolution: "" } });
ok("cerrar sin resolución → 400", noRes.status === 400, noRes.body);
const attended = await call("POST", `/guard/alerts/${alertId}/attend`, { token: G, body: { resolution: "Se apagó la estufa; sin daños (smoke)" } });
ok("guarda: alerta atendida con resolución", attended.status === 200 && attended.body?.status === "attended" && attended.body.attendSeconds >= 0, attended.body);
const ownerDone = await os.waitFor("alert:update", (a) => a.id === alertId && a.status === "attended");
ok("el propietario recibe el cierre", ownerDone?.resolution?.includes("estufa"), ownerDone);

const mine = await call("GET", "/resident/alerts", { token: O });
ok("la alerta pasa a recientes del propietario", mine.body?.recent?.some((a) => a.id === alertId) && !mine.body.open.some((a) => a.id === alertId));

const adminAttend = await call("POST", `/alerts/${alertId}/attend`, { token: A, body: { resolution: "otra vez" } });
ok("panel: cerrar una ya atendida → 409", adminAttend.status === 409, adminAttend.body);

// ------------------------------------------------------------ Panel de alertas
const summary = await call("GET", "/alerts/summary", { token: A });
ok("panel: resumen con tiempos de respuesta", summary.status === 200 && summary.body.last30 >= 1 && "avgAckSeconds" in summary.body, summary.body);
const list = await call("GET", "/alerts?status=attended&kind=fire", { token: A });
ok("panel: historial filtrado", list.status === 200 && list.body.rows.some((a) => a.id === alertId) && list.body.total >= 1, list.body?.total);
const xlsx = await fetch(`${BASE}/api/v1/alerts/export?format=xlsx`, { headers: { authorization: `Bearer ${A}` } });
ok("panel: alertas a Excel", xlsx.status === 200 && (xlsx.headers.get("content-type") ?? "").includes("spreadsheetml"));
const pdf = await fetch(`${BASE}/api/v1/alerts/export?format=pdf`, { headers: { authorization: `Bearer ${A}` } });
const pdfHead = Buffer.from(await pdf.arrayBuffer()).subarray(0, 4).toString();
ok("panel: alertas a PDF", pdf.status === 200 && pdfHead === "%PDF");
const ownerPanel = await call("GET", "/alerts/summary", { token: O });
ok("un propietario no entra al módulo de alertas del panel", ownerPanel.status === 403, ownerPanel.body);

// ------------------------------------------------------------ Campana
const notifs = await call("GET", "/notifications", { token: O });
ok("campana del propietario: avisos de la alerta", notifs.status === 200 && notifs.body.unread > 0 && notifs.body.rows.some((n) => n.kind === "alert_update"), notifs.body?.unread);
const one = notifs.body.rows[0];
const readOne = await call("POST", `/notifications/${one.id}/read`, { token: O, body: {} });
ok("marcar un aviso como leído baja el contador", readOne.status === 200 && readOne.body.unread === notifs.body.unread - 1, readOne.body);
const readAll = await call("POST", "/notifications/read-all", { token: O, body: {} });
const unread0 = await call("GET", "/notifications/unread", { token: O });
ok("marcar todo como leído → 0", readAll.status === 200 && unread0.body?.unread === 0, unread0.body);
const stolen = await call("POST", `/notifications/${gNotif.notification.id}/read`, { token: O, body: {} });
const guardStill = await call("GET", "/notifications", { token: G });
ok("no se pueden marcar avisos de otra cuenta", stolen.status === 200 && guardStill.body.rows.find((n) => n.id === gNotif.notification.id)?.readAt === null);

// ------------------------------------------------------------ Mensajería con la caseta
const empty = await call("POST", `/messages/threads/${a101}`, { token: O, body: { body: "   " } });
ok("mensaje vacío → 400", empty.status === 400, empty.body);
const sent = await call("POST", `/messages/threads/${a101}`, { token: O, body: { body: "Hola caseta, ¿llegó mi paquete? (smoke)" } });
ok("propietario escribe a la caseta", sent.status === 200 && sent.body?.side === "resident", sent.body);
const gMsg = await gs.waitFor("message:new", (m) => m.id === sent.body?.id);
ok("el guarda lo recibe en vivo", gMsg?.unitCode === "A-101", gMsg);
const gMsgNotif = await gs.waitFor("notification", (n) => n.notification?.kind === "message" && n.notification.data?.unitId === a101);
ok("…con aviso en la campana", Boolean(gMsgNotif), gMsgNotif);

const threads = await call("GET", "/messages/threads", { token: G });
const t101 = threads.body?.find?.((t) => t.unitId === a101);
ok("la caseta ve el hilo de A-101 con no leídos", t101?.unread >= 1 && t101.last?.side === "resident", t101);
const thread = await call("GET", `/messages/threads/${a101}`, { token: G });
ok("abrir el hilo trae mensajes y teléfonos", thread.status === 200 && thread.body.side === "guard" && thread.body.messages.some((m) => m.id === sent.body.id) && Array.isArray(thread.body.unit.phones));
const threads2 = await call("GET", "/messages/threads", { token: G });
ok("…y lo marca como leído", threads2.body.find((t) => t.unitId === a101)?.unread === 0);

const reply = await call("POST", `/messages/threads/${a101}`, { token: G, body: { body: "Sí, está en la caseta. (smoke)" } });
ok("el guarda responde", reply.status === 200 && reply.body?.side === "guard");
const oMsg = await os.waitFor("message:new", (m) => m.id === reply.body?.id);
ok("el propietario recibe la respuesta en vivo", Boolean(oMsg));
const oUnread = await call("GET", "/messages/unread", { token: O });
ok("no leídos del propietario ≥ 1", oUnread.body?.unread >= 1, oUnread.body);
const tSees = await ts.waitFor("message:new", (m) => m.id === reply.body?.id, 800);
ok("el inquilino de B-302 no recibe mensajes de A-101", tSees === null);

const tenantThread = await call("GET", `/messages/threads/${a101}`, { token: TN });
ok("inquilino no abre el hilo de A-101 → 403", tenantThread.status === 403, tenantThread.body);
const tenantOwn = await call("GET", `/messages/threads/${b302}`, { token: TN });
ok("inquilino abre el hilo de su filial", tenantOwn.status === 200 && tenantOwn.body.side === "resident");
const ownerThreads = await call("GET", "/messages/threads", { token: O });
ok("propietario ve sus dos filiales como hilos", ownerThreads.body?.length === 2, ownerThreads.body);

// ------------------------------------------------------------ Comunicados
const ownerPost = await call("POST", "/announcements", { token: O, body: { title: "No", body: "No debería poder" } });
ok("un propietario no publica comunicados → 403", ownerPost.status === 403);
const ann = await call("POST", "/announcements", {
  token: A,
  body: { title: "Prueba de humo (smoke)", body: "Comunicado solo para residentes.", audience: "residents" }
});
ok("admin publica un comunicado para residentes", ann.status === 200 && ann.body.notified >= 2, ann.body);
const tAnn = await ts.waitFor("notification", (n) => n.notification?.kind === "announcement" && n.notification.data?.announcementId === ann.body?.id);
ok("el inquilino lo recibe en vivo", Boolean(tAnn), tAnn);
const gAnn = await gs.waitFor("notification", (n) => n.notification?.data?.announcementId === ann.body?.id, 800);
ok("el guarda no (audiencia: residentes)", gAnn === null);
const oList = await call("GET", "/messages/announcements", { token: O });
const gList = await call("GET", "/messages/announcements", { token: G });
ok("el propietario lo ve; el guarda no", oList.body.some((a) => a.id === ann.body.id) && !gList.body.some((a) => a.id === ann.body.id));
const aList = await call("GET", "/announcements", { token: A });
ok("panel: cuenta destinatarios", aList.body.find((a) => a.id === ann.body.id)?.recipients >= 2);
const del = await call("DELETE", `/announcements/${ann.body.id}`, { token: A });
const oList2 = await call("GET", "/messages/announcements", { token: O });
ok("retirar el comunicado lo oculta", del.status === 204 && !oList2.body.some((a) => a.id === ann.body.id));

// ------------------------------------------------------------ Push tokens
const badToken = await call("POST", "/notifications/push-token", { token: O, body: { token: "hola", platform: "android" } });
ok("token push inválido → 400", badToken.status === 400);
const pushToken = `ExponentPushToken[smoke${Date.now()}]`;
const okToken = await call("POST", "/notifications/push-token", { token: O, body: { token: pushToken, platform: "android" } });
ok("registra el token push del dispositivo", okToken.status === 204, okToken.body);
const rmToken = await call("DELETE", "/notifications/push-token", { token: O, body: { token: pushToken } });
ok("y lo quita al cerrar sesión", rmToken.status === 204);

// ------------------------------------------------------------ Visitas en vivo (fase 2 + tiempo real)
const visit = await call("POST", "/guard/visits", { token: G, body: { unitId: a101, kind: "unannounced", names: "Visita en vivo (smoke)" } });
ok("guarda registra visita no anunciada", visit.status === 200, visit.body);
const oVisit = await os.waitFor("notification", (n) => n.notification?.kind === "visit" && n.notification.data?.logId === visit.body?.id);
ok("el propietario recibe el aviso en vivo", Boolean(oVisit) && /caseta/.test(oVisit.notification.title), oVisit);
const resp = await call("POST", `/resident/visits/${visit.body.id}/respond`, { token: O, body: { approve: true } });
ok("el propietario la autoriza", resp.status === 204, resp.body);
const gUpd = await gs.waitFor("access:update", (d) => d.unitId === a101);
const gVisitNotif = await gs.waitFor("notification", (n) => n.notification?.kind === "visit_update" && n.notification.data?.logId === visit.body?.id);
ok("la caseta se entera al instante (tablero y campana)", Boolean(gUpd) && /deje pasar/.test(gVisitNotif?.notification?.title ?? ""), gVisitNotif);
await call("POST", `/guard/entries/${visit.body.id}/admit`, { token: G, body: {} });
await call("POST", `/guard/entries/${visit.body.id}/exit`, { token: G, body: {} });

for (const s of [gs, os, ts]) s.close();
await sleep(100);
finish();
