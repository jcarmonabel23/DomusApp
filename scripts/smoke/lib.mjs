// =====================================================================
//  DomusApp · scripts/smoke/lib.mjs
//  Utilidades comunes de las pruebas de humo: llamadas a la API por el
//  proxy del panel, lectura de OTP desde Mailpit y login completo.
// =====================================================================

export const BASE = process.env.BASE ?? "http://localhost:8090";
export const MAILPIT = process.env.MAILPIT ?? "http://127.0.0.1:8026";
export const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? "Demo-Domus-2026";
export const API = `${BASE}/api/v1`;

const counters = { failed: 0, passed: 0 };
export function ok(name, cond, extra) {
  if (cond) {
    counters.passed++;
    console.log(`  ✓ ${name}`);
  } else {
    counters.failed++;
    console.log(`  ✗ ${name}${extra ? ` → ${JSON.stringify(extra).slice(0, 300)}` : ""}`);
  }
}

/** Imprime el resultado y termina el proceso con el código adecuado */
export function finish() {
  console.log(`\n${counters.passed} bien, ${counters.failed} con fallas`);
  process.exit(counters.failed ? 1 : 0);
}
export async function call(method, path, { token, body, cookie, condo, raw, rawType = "image/png" } = {}) {
  const headers = { "content-type": raw ? rawType : "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  if (cookie) headers.cookie = cookie;
  if (condo) headers["x-condominium-id"] = condo;
  const res = await fetch(`${API}${path}`, { method, headers, body: raw ?? (body ? JSON.stringify(body) : undefined) });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, body: json, setCookie: res.headers.get("set-cookie"), headers: res.headers };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Último código OTP enviado a `email` (Mailpit) */
export async function otpFor(email, after) {
  for (let i = 0; i < 20; i++) {
    const list = await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`)).json();
    const msg = list.messages?.find((m) => new Date(m.Created).getTime() >= after - 1000);
    if (msg) {
      const full = await (await fetch(`${MAILPIT}/api/v1/message/${msg.ID}`)).json();
      const code = full.Text?.match(/\b(\d{6})\b/)?.[1] ?? full.HTML?.match(/>(\d{6})</)?.[1];
      if (code) return code;
    }
    await sleep(300);
  }
  throw new Error(`no llegó el OTP de ${email}`);
}

export async function login(email, client = "web", password = DEMO_PASSWORD) {
  const started = Date.now();
  const s = await call("POST", "/auth/sign-in", { body: { email, password, client } });
  if (s.status !== 200) return { error: s };
  const code = await otpFor(email, started);
  const v = await call("POST", "/auth/otp/verify", { body: { challengeId: s.body.challengeId, code } });
  return { ...v.body, status: v.status, cookie: v.setCookie?.split(";")[0] };
}

/**
 * Cliente Socket.IO mínimo (protocolo EIO 4 sobre el WebSocket nativo de Node 22, sin dependencias).
 * Guarda todos los eventos recibidos; `waitFor` espera uno que cumpla la condición.
 */
export function socket(token, condominiumId) {
  const url = `${BASE.replace(/^http/, "ws")}/api/socket.io/?EIO=4&transport=websocket`;
  const ws = new WebSocket(url);
  const events = [];
  const waiters = [];
  let resolveReady;
  const ready = new Promise((r) => (resolveReady = r));
  const push = (name, data) => {
    events.push({ name, data });
    for (const w of [...waiters]) {
      if (w.name === name && w.pred(data)) {
        waiters.splice(waiters.indexOf(w), 1);
        w.resolve(data);
      }
    }
  };
  ws.onmessage = ({ data }) => {
    const msg = String(data);
    if (msg.startsWith("0")) ws.send(`40${JSON.stringify({ token, condominiumId })}`);
    else if (msg === "2") ws.send("3");
    else if (msg.startsWith("40")) resolveReady({ ok: true });
    else if (msg.startsWith("44")) {
      const err = JSON.parse(msg.slice(2));
      push("connect_error", err);
      resolveReady({ ok: false, error: err });
    } else if (msg.startsWith("42")) {
      const [name, payload] = JSON.parse(msg.slice(2));
      push(name, payload);
    }
  };
  ws.onerror = () => resolveReady({ ok: false, error: "ws" });
  return {
    ready,
    events,
    waitFor(name, pred = () => true, timeoutMs = 4000) {
      const found = events.find((e) => e.name === name && pred(e.data));
      if (found) return Promise.resolve(found.data);
      return new Promise((resolve) => {
        const w = { name, pred, resolve };
        waiters.push(w);
        setTimeout(() => {
          const i = waiters.indexOf(w);
          if (i >= 0) {
            waiters.splice(i, 1);
            resolve(null);
          }
        }, timeoutMs);
      });
    },
    close: () => ws.close()
  };
}
