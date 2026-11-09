/**
 * @project DomusApp - API
 * @file src/modules/finance/resident.ts
 * @description Finanzas en la app del Propietario / Inquilino
 *
 *  GET  /resident/finance                          saldos de sus filiales, cuentas del condominio y si hay pago en línea
 *  GET  /resident/finance/units/:unitId/statement  estado de cuenta (movimientos con saldo corrido)
 *  POST /resident/finance/payments                 reporta un pago manual (transferencia / depósito) → en revisión
 *  PUT  /resident/finance/payments/:id/receipt     foto del comprobante (solo quien lo reportó, mientras está en revisión)
 *  POST /resident/finance/online                   inicia un pago en línea (crea el intento en la pasarela)
 *  POST /resident/finance/online/:id/confirm       envía la tarjeta a la pasarela; el resultado llega por webhook
 *  GET  /resident/finance/payments/:id             estado de un pago (la app lo consulta mientras procesa)
 *
 * Solo puede ver y pagar las filiales vinculadas a su cuenta.
 */

import { Router } from "express";
import { z } from "zod";
import { one, query, withTx } from "../../db.js";
import { conflict, forbidden, handler, idParams, notFound } from "../../lib/http.js";
import { requireRole } from "../../security/authorize.js";
import { authOf, condominiumOf, txCtx } from "../../security/context.js";
import { assertResidentUnit, optText, residentUnitIds } from "../access/shared.js";
import { rawUpload, replaceImage, signedUrl } from "../files/images.js";
import { BANK_SELECT } from "./admin.js";
import { gateway } from "./gateway.js";
import { PAYMENT_JOINS, PAYMENT_SELECT, broadcastPayment, notifyPendingReview, paymentById, withReceipt, type PaymentRow } from "./payments.js";
import { EXPIRED_NOTE } from "./generate.js";
import { balancesToday, condoMoney, financeSettings, ledger, money } from "./shared.js";

export const residentFinanceRoutes = Router();
residentFinanceRoutes.use(requireRole("owner", "tenant", "admin"));

const unitParams = z.object({ unitId: z.uuid() });
const amount = z.coerce.number().positive("El monto debe ser mayor que cero").max(1e11);

residentFinanceRoutes.get(
  "/finance",
  handler({}, async ({ req }) => {
    const units = await residentUnitIds(authOf(req).userId);
    const settings = await financeSettings();
    const m = await condoMoney(condominiumOf(req));
    const [balances, banks] = await Promise.all([
      units.length ? balancesToday(units, settings.graceDays) : Promise.resolve([]),
      query(`SELECT ${BANK_SELECT} FROM bank_accounts WHERE is_active ORDER BY bank`)
    ]);
    return {
      units: balances,
      bankAccounts: banks,
      onlinePayments: settings.onlinePayments,
      currency: { code: m.currency, symbol: m.symbol, decimals: m.decimals },
      graceDays: settings.graceDays,
      dueDay: settings.dueDay
    };
  })
);

residentFinanceRoutes.get(
  "/finance/units/:unitId/statement",
  handler({ params: unitParams }, async ({ req, params }) => {
    await assertResidentUnit(authOf(req).userId, params.unitId);
    const settings = await financeSettings();
    const [[balance], rows, payments] = await Promise.all([
      balancesToday([params.unitId], settings.graceDays),
      ledger(params.unitId),
      query<PaymentRow>(
        `SELECT ${PAYMENT_SELECT} ${PAYMENT_JOINS}
          WHERE p.unit_id = $1 AND p.status <> 'approved' AND NOT (p.method = 'online' AND p.status = 'pending')
            AND p.review_notes IS DISTINCT FROM $2
          ORDER BY p.created_at DESC LIMIT 10`,
        [params.unitId, EXPIRED_NOTE]
      )
    ]);
    return { balance, rows: rows.reverse(), payments: payments.map(withReceipt) };
  })
);

residentFinanceRoutes.post(
  "/finance/payments",
  handler(
    {
      body: z.object({
        unitId: z.uuid(),
        method: z.enum(["transfer", "deposit"]),
        amount,
        paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        reference: z.string().trim().min(3, "Escriba el número de referencia o comprobante").max(60),
        bankAccountId: z.uuid().nullish(),
        notes: optText(500)
      })
    },
    async ({ req, body }) => {
      await assertResidentUnit(authOf(req).userId, body.unitId);
      const dup = await one<{ id: string }>(
        `SELECT id FROM payments WHERE unit_id = $1 AND reference = $2 AND status <> 'rejected' AND method <> 'online'`,
        [body.unitId, body.reference]
      );
      if (dup) throw conflict("DUPLICATE_REFERENCE", "Ese número de referencia ya fue reportado para esta filial");
      const r = await withTx(txCtx(req), (client) =>
        one<{ id: string }>(
          `INSERT INTO payments (unit_id, method, amount, paid_on, reference, bank_account_id, notes, submitted_by)
           VALUES ($1, $2, $3, LEAST($4::date, CURRENT_DATE), $5, $6, $7, fn_current_app_user()) RETURNING id`,
          [body.unitId, body.method, body.amount, body.paidOn, body.reference, body.bankAccountId ?? null, body.notes],
          client
        )
      );
      const p = (await paymentById(r!.id))!;
      await broadcastPayment(condominiumOf(req), p);
      await notifyPendingReview(condominiumOf(req), p);
      return p;
    }
  )
);

residentFinanceRoutes.put(
  "/finance/payments/:id/receipt",
  rawUpload,
  handler({ params: idParams }, async ({ req, params }) => {
    const auth = authOf(req);
    const p = await one<{ submittedBy: string | null; status: string; method: string }>(
      `SELECT submitted_by AS "submittedBy", status, method FROM payments WHERE id = $1`,
      [params.id]
    );
    if (!p) throw notFound("Pago no encontrado");
    if (p.submittedBy !== auth.userId) throw forbidden("NOT_YOURS", "Solo quien reportó el pago puede adjuntar el comprobante");
    if (p.status !== "pending" || p.method === "online") throw conflict("NOT_PENDING", "El pago ya fue revisado");
    const stored = await replaceImage({
      req,
      condominiumId: condominiumOf(req),
      profile: "receipt",
      purpose: "payment_receipt",
      withTx: (fn) => withTx(txCtx(req), fn),
      attach: async (client, fileId) => {
        const prev = await one<{ prev: string | null }>(
          `UPDATE payments x SET receipt_file_id = $2 FROM (SELECT receipt_file_id AS prev FROM payments WHERE id = $1) old
            WHERE x.id = $1 RETURNING old.prev`,
          [params.id, fileId],
          client
        );
        return prev?.prev ?? null;
      }
    });
    return { preview: signedUrl(stored.storageKey, "800.webp"), full: signedUrl(stored.storageKey, "orig.webp") };
  })
);

residentFinanceRoutes.post(
  "/finance/online",
  handler({ body: z.object({ unitId: z.uuid(), amount }) }, async ({ req, body }) => {
    const condominiumId = condominiumOf(req);
    await assertResidentUnit(authOf(req).userId, body.unitId);
    const settings = await financeSettings();
    if (!settings.onlinePayments) throw conflict("ONLINE_DISABLED", "El condominio no tiene pagos en línea activos");
    const m = await condoMoney(condominiumId);
    const gw = gateway();
    // El pago se crea primero (para tener id en los metadatos) y la referencia se completa enseguida
    const r = await withTx(txCtx(req), async (client) => {
      const tmpRef = `pending_${crypto.randomUUID()}`;
      const row = await one<{ id: string; code: string }>(
        `INSERT INTO payments (unit_id, method, amount, gateway, gateway_ref, submitted_by)
         VALUES ($1, 'online', $2, $3, $4, fn_current_app_user())
         RETURNING id, (SELECT code FROM units WHERE id = $1) AS code`,
        [body.unitId, body.amount, gw.name, tmpRef],
        client
      );
      const intent = await gw.createIntent({
        amount: body.amount,
        currency: m.currency,
        description: `Pago filial ${row!.code}`,
        metadata: { condominiumId, paymentId: row!.id }
      });
      await client.query(`UPDATE payments SET gateway_ref = $2 WHERE id = $1`, [row!.id, intent.ref]);
      return { id: row!.id, ref: intent.ref };
    });
    return { paymentId: r.id, amount: body.amount, display: money(body.amount, m), gateway: gw.name };
  })
);

residentFinanceRoutes.post(
  "/finance/online/:id/confirm",
  handler(
    {
      params: idParams,
      body: z.object({
        number: z.string().trim().min(12).max(23),
        expMonth: z.coerce.number().int(),
        expYear: z.coerce.number().int(),
        cvc: z.string().trim().max(4),
        holder: z.string().trim().min(3, "Escriba el nombre del titular").max(80)
      })
    },
    async ({ req, params, body }) => {
      const auth = authOf(req);
      const p = await one<{ submittedBy: string | null; status: string; method: string; ref: string | null }>(
        `SELECT submitted_by AS "submittedBy", status, method, gateway_ref AS ref FROM payments WHERE id = $1`,
        [params.id]
      );
      if (!p || p.method !== "online") throw notFound("Pago no encontrado");
      if (p.submittedBy !== auth.userId) throw forbidden("NOT_YOURS", "Este pago lo inició otra cuenta");
      if (p.status !== "pending") throw conflict("ALREADY_SETTLED", "Este pago ya fue procesado");
      // La tarjeta va directo a la pasarela: no se registra en la BD ni en los logs
      const result = await gateway().confirm(p.ref!, body);
      return { status: result.status, card: result.card };
    }
  )
);

residentFinanceRoutes.get(
  "/finance/payments/:id",
  handler({ params: idParams }, async ({ req, params }) => {
    const p = await paymentById(params.id);
    if (!p) throw notFound("Pago no encontrado");
    const units = await residentUnitIds(authOf(req).userId);
    if (!units.includes(p.unitId) && p.submittedBy !== authOf(req).userId) throw notFound("Pago no encontrado");
    return p;
  })
);
