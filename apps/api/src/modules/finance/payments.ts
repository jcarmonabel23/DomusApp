/**
 * @project DomusApp - API
 * @file src/modules/finance/payments.ts
 * @description Pagos: lectura, aprobación / rechazo (panel o webhook de la pasarela) y avisos
 */

import type { Request, Response } from "express";
import { one, query, runInCondominium, withTx, type Db } from "../../db.js";
import { logger } from "../../lib/logger.js";
import { emitToUnit, emitToUser } from "../../lib/realtime.js";
import { fileKey, signedUrl } from "../files/images.js";
import { adminUserIds, notify, unitUserIds } from "../notifications/service.js";
import { type GatewayEvent, gatewayByName, verifySignature } from "./gateway.js";
import { METHOD_LABEL, condoMoney, money } from "./shared.js";

export const PAYMENT_SELECT = `p.id, p.unit_id AS "unitId", u.code AS "unitCode", u.tower AS "unitTower",
  p.method, p.amount::float8 AS amount, to_char(p.paid_on, 'YYYY-MM-DD') AS "paidOn", p.reference,
  p.bank_account_id AS "bankAccountId", ba.bank AS "bankName", p.notes, p.status, p.review_notes AS "reviewNotes",
  p.reviewed_at AS "reviewedAt", rv.names AS "reviewedByName", sb.names AS "submittedByName", p.submitted_by AS "submittedBy",
  p.card_brand AS "cardBrand", p.card_last4 AS "cardLast4", p.gateway, p.created_at AS "createdAt",
  p.receipt_file_id AS "receiptFileId", p.condominium_id AS "condominiumId"`;

export const PAYMENT_JOINS = `FROM payments p
  JOIN units u ON u.id = p.unit_id
  LEFT JOIN bank_accounts ba ON ba.id = p.bank_account_id
  LEFT JOIN users rv ON rv.id = p.reviewed_by
  LEFT JOIN users sb ON sb.id = p.submitted_by`;

export interface PaymentRow {
  id: string;
  unitId: string;
  unitCode: string;
  unitTower: string | null;
  method: string;
  amount: number;
  paidOn: string;
  reference: string | null;
  bankAccountId: string | null;
  bankName: string | null;
  notes: string | null;
  status: "pending" | "approved" | "rejected";
  reviewNotes: string | null;
  reviewedAt: string | null;
  reviewedByName: string | null;
  submittedByName: string | null;
  submittedBy: string | null;
  cardBrand: string | null;
  cardLast4: string | null;
  gateway: string | null;
  createdAt: string;
  receiptFileId: string | null;
  condominiumId: string;
  receipt?: { preview: string; full: string } | null;
}

/** Agrega las URL firmadas del comprobante y quita columnas internas */
export function withReceipt(p: PaymentRow): PaymentRow {
  const key = fileKey(p.condominiumId, p.receiptFileId);
  return { ...p, receipt: key ? { preview: signedUrl(key, "800.webp"), full: signedUrl(key, "orig.webp") } : null };
}

export async function paymentById(id: string, db?: Db): Promise<PaymentRow | null> {
  const p = await one<PaymentRow>(`SELECT ${PAYMENT_SELECT} ${PAYMENT_JOINS} WHERE p.id = $1`, [id], db);
  return p ? withReceipt(p) : null;
}

/** Evento en vivo para la filial y los administradores (no para la caseta: es información privada) */
export async function broadcastPayment(condominiumId: string, p: PaymentRow): Promise<void> {
  emitToUnit(condominiumId, p.unitId, "finance:update", { unitId: p.unitId, paymentId: p.id, status: p.status });
  if (p.submittedBy) emitToUser(p.submittedBy, "finance:update", { unitId: p.unitId, paymentId: p.id, status: p.status });
  for (const id of await adminUserIds(condominiumId)) emitToUser(id, "finance:update", { unitId: p.unitId, paymentId: p.id, status: p.status });
}

/** Aviso a la filial del resultado de su pago */
export async function notifyPaymentResult(condominiumId: string, p: PaymentRow, actorId?: string): Promise<void> {
  const m = await condoMoney(condominiumId);
  const approved = p.status === "approved";
  await notify(
    condominiumId,
    [...(await unitUserIds(condominiumId, p.unitId)), ...(p.submittedBy ? [p.submittedBy] : [])],
    {
      kind: "payment",
      title: approved ? `Pago aplicado: ${money(p.amount, m)}` : `Pago rechazado: ${money(p.amount, m)}`,
      body: approved
        ? `${METHOD_LABEL[p.method]}${p.cardLast4 ? ` · ${p.cardBrand} •••• ${p.cardLast4}` : ""} · filial ${p.unitCode}`
        : (p.reviewNotes ?? "Revise los datos e intente de nuevo"),
      data: { unitId: p.unitId, paymentId: p.id }
    },
    actorId
  );
}

/** Aviso a la administración de un comprobante por revisar */
export async function notifyPendingReview(condominiumId: string, p: PaymentRow): Promise<void> {
  const m = await condoMoney(condominiumId);
  await notify(condominiumId, await adminUserIds(condominiumId), {
    kind: "payment",
    title: `Comprobante por revisar: ${money(p.amount, m)}`,
    body: `${METHOD_LABEL[p.method]} · filial ${p.unitCode}${p.submittedByName ? ` · ${p.submittedByName}` : ""}`,
    data: { unitId: p.unitId, paymentId: p.id }
  });
}

// ------------------------------------------------------------------ Webhook de la pasarela

/**
 * POST /api/v1/finance/webhooks/:gateway — público, lo autoriza la firma HMAC.
 * Se monta ANTES de express.json: la firma se calcula sobre el cuerpo exacto que llegó.
 */
export async function paymentWebhook(req: Request, res: Response): Promise<void> {
  const name = String(req.params.gateway);
  const raw = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : "";
  if (!gatewayByName(name) || !verifySignature(raw, req.header("x-domus-signature"))) {
    res.status(401).json({ error: { code: "BAD_SIGNATURE", message: "Firma inválida" } });
    return;
  }
  let event: GatewayEvent;
  try {
    event = JSON.parse(raw) as GatewayEvent;
  } catch {
    res.status(400).json({ error: { code: "BAD_PAYLOAD", message: "Cuerpo inválido" } });
    return;
  }
  const { condominiumId, paymentId } = event.data?.metadata ?? {};
  if (!/^[0-9a-f-]{36}$/.test(condominiumId ?? "") || !/^[0-9a-f-]{36}$/.test(paymentId ?? "")) {
    res.status(400).json({ error: { code: "BAD_PAYLOAD", message: "Faltan metadatos" } });
    return;
  }

  try {
    await runInCondominium(condominiumId, async () => {
      const settled = await withTx({ condominiumId, traceId: req.traceId }, async (client) => {
        // Idempotencia: un evento repetido choca con el índice único y no se procesa otra vez
        const fresh = await one<{ id: string }>(
          `INSERT INTO payment_gateway_events (payment_id, gateway, event_id, event, payload)
           SELECT $1, $2, $3, $4, $5 WHERE EXISTS (SELECT 1 FROM payments WHERE id = $1)
           ON CONFLICT (gateway, event_id) DO NOTHING RETURNING id`,
          [paymentId, name, event.id, event.type, event],
          client
        );
        if (!fresh) return null;
        const ok = event.type === "payment.succeeded";
        return one<{ id: string }>(
          `UPDATE payments
              SET status = $2, reviewed_at = NOW(), card_brand = $3, card_last4 = $4,
                  review_notes = $5
            WHERE id = $1 AND status = 'pending' AND gateway = $6 AND gateway_ref = $7 AND amount = $8
           RETURNING id`,
          [
            paymentId,
            ok ? "approved" : "rejected",
            event.data.card?.brand ?? null,
            event.data.card?.last4 ?? null,
            ok ? null : (event.data.failureMessage ?? "Pago rechazado por la pasarela"),
            name,
            event.data.ref,
            event.data.amount
          ],
          client
        );
      });
      if (settled) {
        const p = (await paymentById(paymentId))!;
        await broadcastPayment(condominiumId, p);
        await notifyPaymentResult(condominiumId, p);
        if (p.status === "approved") {
          const m = await condoMoney(condominiumId);
          await notify(condominiumId, await adminUserIds(condominiumId), {
            kind: "payment",
            title: `Pago en línea recibido: ${money(p.amount, m)}`,
            body: `Filial ${p.unitCode}${p.cardLast4 ? ` · ${p.cardBrand} •••• ${p.cardLast4}` : ""}`,
            data: { unitId: p.unitId, paymentId: p.id }
          });
        }
      }
    });
    res.json({ received: true });
  } catch (err) {
    logger.error({ err, eventId: event.id }, "[pasarela] error procesando webhook");
    res.status(500).json({ error: { code: "INTERNAL", message: "Error procesando el evento" } });
  }
}

export async function pendingCount(): Promise<number> {
  const r = await query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM payments WHERE status = 'pending' AND method <> 'online'`);
  return r[0]?.n ?? 0;
}
