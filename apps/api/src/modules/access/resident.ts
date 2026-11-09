/**
 * @project DomusApp - API
 * @file src/modules/access/resident.ts
 * @description Control de acceso desde la app del Propietario / Inquilino
 *
 * Todo se limita a las filiales vinculadas a la cuenta (residentUnitIds) dentro del condominio
 * activo (RLS). Un autorizado "eliminado" queda revocado: la bitácora conserva su historia.
 */

import { Router } from "express";
import { z } from "zod";
import { one, query, withTx } from "../../db.js";
import { conflict, handler, idParams, notFound } from "../../lib/http.js";
import { requireRole } from "../../security/authorize.js";
import { authOf, condominiumOf, txCtx } from "../../security/context.js";
import { rawUpload, replaceImage } from "../files/images.js";
import {
  AUTHORIZATION_SELECT,
  KINDS,
  accessChanged,
  assertAuthorizationDates,
  assertResidentUnit,
  authorizationBody,
  optText,
  plateSchema,
  residentUnitIds,
  withPhoto
} from "./shared.js";
import { notify, staffUserIds } from "../notifications/service.js";

export const residentAccessRoutes = Router();

residentAccessRoutes.use(requireRole("owner", "tenant", "admin"));

// ------------------------------------------------------------------ Autorizados

residentAccessRoutes.get(
  "/authorizations",
  handler({ query: z.object({ kind: z.enum(KINDS).optional() }) }, async ({ req, query: f }) => {
    const units = await residentUnitIds(authOf(req).userId);
    const rows = await query<{ photoFileId: string | null; condominiumId: string }>(
      `SELECT ${AUTHORIZATION_SELECT}
         FROM authorizations a JOIN units u ON u.id = a.unit_id
        WHERE a.unit_id = ANY ($1) AND a.status <> 'revoked' AND ($2::text IS NULL OR a.kind = $2)
        ORDER BY (a.status = 'active') DESC, a.created_at DESC
        LIMIT 200`,
      [units, f.kind ?? null]
    );
    return rows.map(withPhoto);
  })
);

/** Autorizado propio (de una filial de la cuenta) o 404 */
async function ownAuthorization(userId: string, id: string) {
  const units = await residentUnitIds(userId);
  const row = await one<{ id: string; status: string; photo_file_id: string | null }>(
    `SELECT id, status, photo_file_id FROM authorizations WHERE id = $1 AND unit_id = ANY ($2)`,
    [id, units]
  );
  if (!row) throw notFound("Autorizado no encontrado");
  return row;
}

residentAccessRoutes.post(
  "/authorizations",
  handler({ body: authorizationBody }, async ({ body, req }) => {
    await assertResidentUnit(authOf(req).userId, body.unitId);
    await assertAuthorizationDates(body);
    const row = await withTx(txCtx(req), (client) =>
      one<{ id: string }>(
        `INSERT INTO authorizations (unit_id, kind, names, id_number, plate, occupation, valid_from, valid_to, weekdays,
                                     time_from, time_to, call_to_confirm, delete_after_use, instructions, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, fn_current_app_user()) RETURNING id`,
        [
          body.unitId, body.kind, body.names, body.idNumber, body.plate, body.occupation, body.validFrom, body.validTo,
          body.weekdays, body.timeFrom, body.timeTo, body.callToConfirm, body.deleteAfterUse, body.instructions
        ],
        client
      )
    );
    return { id: row!.id };
  })
);

residentAccessRoutes.put(
  "/authorizations/:id",
  handler({ params: idParams, body: authorizationBody }, async ({ params, body, req }) => {
    const userId = authOf(req).userId;
    const current = await ownAuthorization(userId, params.id);
    if (current.status !== "active") throw conflict("NOT_EDITABLE", "Este permiso ya fue utilizado; cree uno nuevo");
    await assertResidentUnit(userId, body.unitId);
    await assertAuthorizationDates(body);
    await withTx(txCtx(req), (client) =>
      client.query(
        `UPDATE authorizations SET unit_id = $2, kind = $3, names = $4, id_number = $5, plate = $6, occupation = $7,
                valid_from = $8, valid_to = $9, weekdays = $10, time_from = $11, time_to = $12, call_to_confirm = $13,
                delete_after_use = $14, instructions = $15, updated_by = fn_current_app_user()
          WHERE id = $1`,
        [
          params.id, body.unitId, body.kind, body.names, body.idNumber, body.plate, body.occupation, body.validFrom, body.validTo,
          body.weekdays, body.timeFrom, body.timeTo, body.callToConfirm, body.deleteAfterUse, body.instructions
        ]
      )
    );
    return undefined;
  })
);

/** Eliminar = revocar: deja de valer en la caseta y desaparece de la app */
residentAccessRoutes.delete(
  "/authorizations/:id",
  handler({ params: idParams }, async ({ params, req }) => {
    await ownAuthorization(authOf(req).userId, params.id);
    await withTx(txCtx(req), (client) =>
      client.query(`UPDATE authorizations SET status = 'revoked', updated_by = fn_current_app_user() WHERE id = $1`, [params.id])
    );
    return undefined;
  })
);

/** PUT /resident/authorizations/:id/photo — cuerpo crudo (JPG/PNG/WebP) */
residentAccessRoutes.put(
  "/authorizations/:id/photo",
  rawUpload,
  handler({ params: idParams }, async ({ params, req }) => {
    await ownAuthorization(authOf(req).userId, params.id);
    await replaceImage({
      req,
      condominiumId: condominiumOf(req),
      profile: "photo",
      purpose: "authorization_photo",
      withTx: (fn) => withTx(txCtx(req), fn),
      attach: async (client, fileId) => {
        const prev = await one<{ photo_file_id: string | null }>(`SELECT photo_file_id FROM authorizations WHERE id = $1`, [params.id], client);
        await client.query(`UPDATE authorizations SET photo_file_id = $2, updated_by = fn_current_app_user() WHERE id = $1`, [params.id, fileId]);
        return prev?.photo_file_id ?? null;
      }
    });
    const row = await one<{ photoFileId: string | null; condominiumId: string }>(
      `SELECT ${AUTHORIZATION_SELECT} FROM authorizations a JOIN units u ON u.id = a.unit_id WHERE a.id = $1`,
      [params.id]
    );
    return withPhoto(row!);
  })
);

// ------------------------------------------------------------------ Vehículos

const vehicleBody = z.object({
  unitId: z.uuid(),
  plate: plateSchema.refine((v) => v !== null, "Indique la placa"),
  kind: z.enum(["car", "motorcycle", "truck", "bicycle", "other"]).default("car"),
  brand: optText(40),
  model: optText(40),
  color: optText(30),
  notes: optText(300)
});

export const VEHICLE_SELECT = `v.id, v.unit_id AS "unitId", u.code AS "unitCode", u.tower AS "unitTower", v.plate, v.kind,
  v.brand, v.model, v.color, v.notes, v.is_active AS "isActive"`;

residentAccessRoutes.get(
  "/vehicles",
  handler({}, async ({ req }) =>
    query(
      `SELECT ${VEHICLE_SELECT} FROM vehicles v JOIN units u ON u.id = v.unit_id
        WHERE v.unit_id = ANY ($1) AND v.is_active ORDER BY u.code, v.plate`,
      [await residentUnitIds(authOf(req).userId)]
    )
  )
);

residentAccessRoutes.post(
  "/vehicles",
  handler({ body: vehicleBody }, async ({ body, req }) => {
    await assertResidentUnit(authOf(req).userId, body.unitId);
    if (await one(`SELECT 1 FROM vehicles WHERE plate = $1 AND is_active`, [body.plate])) {
      throw conflict("DUPLICATED", `La placa ${body.plate} ya está registrada en el condominio`);
    }
    const row = await withTx(txCtx(req), (client) =>
      one<{ id: string }>(
        `INSERT INTO vehicles (unit_id, plate, kind, brand, model, color, notes, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, fn_current_app_user()) RETURNING id`,
        [body.unitId, body.plate, body.kind, body.brand, body.model, body.color, body.notes],
        client
      )
    );
    return { id: row!.id };
  })
);

residentAccessRoutes.delete(
  "/vehicles/:id",
  handler({ params: idParams }, async ({ params, req }) => {
    const units = await residentUnitIds(authOf(req).userId);
    const row = await withTx(txCtx(req), (client) =>
      one(`DELETE FROM vehicles WHERE id = $1 AND unit_id = ANY ($2) RETURNING id`, [params.id, units], client)
    );
    if (!row) throw notFound("Vehículo no encontrado");
    return undefined;
  })
);

// ------------------------------------------------------------------ Visitas

export const LOG_SELECT = `l.id, l.unit_id AS "unitId", u.code AS "unitCode", u.tower AS "unitTower",
  l.authorization_id AS "authorizationId", l.kind, l.names, l.id_number AS "idNumber", l.plate, l.notes, l.status,
  l.response, l.responded_at AS "respondedAt", l.entry_at AS "entryAt", l.exit_at AS "exitAt", l.created_at AS "createdAt"`;

/** Últimas visitas de las filiales de la cuenta (tablero "Mis últimas visitas") y las pendientes */
residentAccessRoutes.get(
  "/visits",
  handler({ query: z.object({ limit: z.coerce.number().int().min(1).max(100).default(20) }) }, async ({ req, query: f }) => {
    const units = await residentUnitIds(authOf(req).userId);
    const [pending, recent] = await Promise.all([
      query(
        `SELECT ${LOG_SELECT} FROM access_logs l JOIN units u ON u.id = l.unit_id
          WHERE l.unit_id = ANY ($1) AND l.status = 'pending' AND l.response IS NULL
            AND l.created_at > NOW() - INTERVAL '12 hours'
          ORDER BY l.created_at DESC`,
        [units]
      ),
      query(
        `SELECT ${LOG_SELECT} FROM access_logs l JOIN units u ON u.id = l.unit_id
          WHERE l.unit_id = ANY ($1) AND l.status IN ('inside', 'exited', 'denied')
          ORDER BY COALESCE(l.entry_at, l.created_at) DESC LIMIT $2`,
        [units, f.limit]
      )
    ]);
    return { pending, recent };
  })
);

/** El residente autoriza o rechaza una visita no anunciada que espera en la caseta */
residentAccessRoutes.post(
  "/visits/:id/respond",
  handler({ params: idParams, body: z.object({ approve: z.boolean() }) }, async ({ params, body, req }) => {
    const units = await residentUnitIds(authOf(req).userId);
    const row = await withTx(txCtx(req), (client) =>
      one<{ unit_id: string; names: string; unit_code: string }>(
        `UPDATE access_logs SET response = $3, responded_by = fn_current_app_user(), responded_at = NOW()
          WHERE id = $1 AND unit_id = ANY ($2) AND status = 'pending' AND response IS NULL
          RETURNING id, unit_id, names, (SELECT code FROM units WHERE id = access_logs.unit_id) AS unit_code`,
        [params.id, units, body.approve ? "approved" : "denied"],
        client
      )
    );
    if (!row) throw conflict("ALREADY_RESOLVED", "La visita ya fue atendida en la caseta o por otra persona de la filial");
    const condominiumId = condominiumOf(req);
    accessChanged(condominiumId, row.unit_id);
    await notify(
      condominiumId,
      await staffUserIds(condominiumId),
      {
        kind: "visit_update",
        title: `${row.unit_code}: ${body.approve ? "deje pasar" : "NO deje pasar"} a ${row.names}`,
        body: `Respondió ${authOf(req).names}`,
        data: { logId: params.id, unitId: row.unit_id }
      },
      authOf(req).userId
    );
    return undefined;
  })
);
