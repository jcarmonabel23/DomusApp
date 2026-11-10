// =====================================================================
//  DomusApp · scripts/smoke/lib.mjs
//  Utilidades comunes de las pruebas de humo: llamadas a la API por el
//  proxy del panel, lectura de OTP desde Mailpit y login completo.
// =====================================================================

import { deflateSync } from "node:zlib";

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

// ------------------------------------------------------------ Archivos de prueba

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
/** PNG sólido de w × h (para subir fotos) */
export function png(w = 320, h = 200, rgb = [60, 160, 220]) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: w }, () => rgb).flat())]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.concat(Array.from({ length: h }, () => row)))),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

/** PDF mínimo válido (cabecera %PDF- y fin %%EOF) para subir documentos */
export function pdf(text = "Prueba DomusApp") {
  const body = `BT /F1 18 Tf 72 720 Td (${text.replace(/[()\\]/g, "")}) Tj ET`;
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${body.length} >>\nstream\n${body}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
  ];
  let out = "%PDF-1.4\n";
  const offsets = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}
