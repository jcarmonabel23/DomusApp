/**
 * @project DomusApp - API
 * @file src/modules/finance/gateway.ts
 * @description Pasarela de pago detrás de una interfaz, con una implementación SIMULADA
 *
 * Flujo (igual al de una pasarela real como Stripe, Tilopay o Wompi):
 *   1. createIntent  → la pasarela devuelve una referencia; el pago queda "pending".
 *   2. confirm       → se envían los datos de tarjeta a la pasarela (DomusApp nunca los guarda: solo marca
 *                      y últimos 4). La respuesta es "processing".
 *   3. webhook       → la pasarela avisa el resultado a POST /api/v1/finance/webhooks/<pasarela>, firmado con
 *                      HMAC-SHA256 (cabecera x-domus-signature: t=<unix>,v1=<hex>). Solo el webhook aprueba
 *                      o rechaza el pago: así un cliente no puede marcarse pagado.
 *
 * Tarjetas de prueba de la simulada:
 *   4242 4242 4242 4242  aprobada          4000 0000 0000 0002  rechazada (card_declined)
 *   4000 0000 0000 9995  fondos insuficientes                    cualquier otra válida → no es de prueba
 * Para conectar una pasarela real: implementar PaymentGateway y registrarla en GATEWAYS.
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { config } from "../../config.js";
import { badRequest, conflict } from "../../lib/http.js";
import { logger } from "../../lib/logger.js";

export interface CardInput {
  number: string;
  expMonth: number;
  expYear: number;
  cvc: string;
  holder: string;
}

export interface IntentInput {
  amount: number;
  currency: string;
  description: string;
  metadata: { condominiumId: string; paymentId: string };
}

export interface GatewayEvent {
  id: string;
  type: "payment.succeeded" | "payment.failed";
  data: {
    ref: string;
    amount: number;
    currency: string;
    metadata: { condominiumId: string; paymentId: string };
    card?: { brand: string; last4: string };
    failureCode?: string;
    failureMessage?: string;
  };
}

export interface PaymentGateway {
  name: string;
  createIntent(input: IntentInput): Promise<{ ref: string }>;
  confirm(ref: string, card: CardInput): Promise<{ status: "processing"; card: { brand: string; last4: string } }>;
}

// ------------------------------------------------------------------ Firma de webhooks

export function signPayload(body: string, timestamp = Math.floor(Date.now() / 1000)): string {
  const sig = createHmac("sha256", config.PAYMENT_WEBHOOK_SECRET).update(`${timestamp}.${body}`).digest("hex");
  return `t=${timestamp},v1=${sig}`;
}

/** Verifica la firma y que no tenga más de 5 minutos (evita reenvíos viejos) */
export function verifySignature(rawBody: string, header: string | undefined): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=") as [string, string]));
  const t = Number(parts.t);
  if (!Number.isInteger(t) || Math.abs(Date.now() / 1000 - t) > 300 || !/^[0-9a-f]{64}$/.test(parts.v1 ?? "")) return false;
  const expected = createHmac("sha256", config.PAYMENT_WEBHOOK_SECRET).update(`${t}.${rawBody}`).digest();
  return timingSafeEqual(expected, Buffer.from(parts.v1, "hex"));
}

// ------------------------------------------------------------------ Validación de tarjeta

function luhn(num: string): boolean {
  let sum = 0;
  let dbl = false;
  for (let i = num.length - 1; i >= 0; i--) {
    let d = Number(num[i]);
    if (dbl) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    dbl = !dbl;
  }
  return sum % 10 === 0;
}

const brandOf = (n: string) => (n.startsWith("4") ? "Visa" : /^5[1-5]/.test(n) ? "Mastercard" : /^3[47]/.test(n) ? "Amex" : "Tarjeta");

export function validateCard(card: CardInput): string {
  const n = card.number.replace(/\D/g, "");
  if (n.length < 13 || n.length > 19 || !luhn(n)) throw badRequest("CARD_INVALID", "El número de tarjeta no es válido");
  const now = new Date();
  const exp = new Date(card.expYear < 100 ? 2000 + card.expYear : card.expYear, card.expMonth, 1);
  if (card.expMonth < 1 || card.expMonth > 12 || exp <= now) throw badRequest("CARD_EXPIRED", "La tarjeta está vencida");
  if (!/^\d{3,4}$/.test(card.cvc)) throw badRequest("CARD_CVC", "El código de seguridad no es válido");
  return n;
}

// ------------------------------------------------------------------ Pasarela simulada

interface SimIntent {
  amount: number;
  currency: string;
  metadata: IntentInput["metadata"];
  confirmed: boolean;
  createdAt: number;
}

const TEST_CARDS: Record<string, { ok: boolean; code?: string; message?: string }> = {
  "4242424242424242": { ok: true },
  "5555555555554444": { ok: true },
  "4000000000000002": { ok: false, code: "card_declined", message: "La tarjeta fue rechazada" },
  "4000000000009995": { ok: false, code: "insufficient_funds", message: "Fondos insuficientes" }
};

class SimulatedGateway implements PaymentGateway {
  name = "simulated";
  private intents = new Map<string, SimIntent>();

  async createIntent(input: IntentInput) {
    // Limpia intentos de más de 1 hora
    const cutoff = Date.now() - 3_600_000;
    for (const [k, v] of this.intents) if (v.createdAt < cutoff) this.intents.delete(k);
    const ref = `sim_pi_${randomBytes(12).toString("hex")}`;
    this.intents.set(ref, { ...input, confirmed: false, createdAt: Date.now() });
    return { ref };
  }

  async confirm(ref: string, card: CardInput) {
    const intent = this.intents.get(ref);
    if (!intent) throw conflict("INTENT_EXPIRED", "El intento de pago venció. Inicie el pago de nuevo");
    if (intent.confirmed) throw conflict("INTENT_USED", "Este pago ya se está procesando");
    const number = validateCard(card);
    const outcome = TEST_CARDS[number];
    if (!outcome) throw badRequest("NOT_TEST_CARD", "Pasarela de prueba: use una tarjeta de prueba (4242 4242 4242 4242)");
    intent.confirmed = true;
    const cardInfo = { brand: brandOf(number), last4: number.slice(-4) };

    // La "red" de la tarjeta responde un momento después, por webhook (como una pasarela real)
    const event: GatewayEvent = {
      id: `sim_evt_${randomBytes(12).toString("hex")}`,
      type: outcome.ok ? "payment.succeeded" : "payment.failed",
      data: {
        ref,
        amount: intent.amount,
        currency: intent.currency,
        metadata: intent.metadata,
        card: cardInfo,
        ...(outcome.ok ? {} : { failureCode: outcome.code, failureMessage: outcome.message })
      }
    };
    setTimeout(() => void deliverWebhook(this.name, event), config.PAYMENT_SIM_DELAY_MS).unref();
    return { status: "processing" as const, card: cardInfo };
  }
}

/** Envía el webhook a la propia API (como lo haría la pasarela desde Internet), con reintentos */
async function deliverWebhook(gateway: string, event: GatewayEvent, attempt = 1): Promise<void> {
  const body = JSON.stringify(event);
  try {
    const res = await fetch(`http://127.0.0.1:${config.PORT}/api/v1/finance/webhooks/${gateway}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-domus-signature": signPayload(body) },
      body,
      signal: AbortSignal.timeout(10_000)
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (err) {
    if (attempt >= 5) {
      logger.error({ err, eventId: event.id }, "[pasarela] webhook no entregado");
      return;
    }
    setTimeout(() => void deliverWebhook(gateway, event, attempt + 1), attempt * 2_000).unref();
  }
}

const GATEWAYS: Record<string, PaymentGateway> = { simulated: new SimulatedGateway() };

export function gateway(): PaymentGateway {
  return GATEWAYS[config.PAYMENT_GATEWAY];
}

export function gatewayByName(name: string): PaymentGateway | null {
  return GATEWAYS[name] ?? null;
}
