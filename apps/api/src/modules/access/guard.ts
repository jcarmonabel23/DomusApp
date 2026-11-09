/**
 * @project DomusApp - API
 * @file src/modules/access/guard.ts
 * @description Caseta: lo que ve y registra el Guarda de seguridad (también un administrador)
 *
 *  GET  /guard/board            esperados hoy, adentro ahora y visitas pendientes (con búsqueda)
 *  GET  /guard/search?q=        nombre, documento o placa: autorizados y vehículos de residentes
 *  GET  /guard/units            filiales para la visita no anunciada (con teléfonos)
 *  POST /guard/entries          ingreso de un autorizado (authorizationId) o de un residente (vehicleId)
 *  POST /guard/visits           visita no anunciada → pendiente + aviso a la filial
 *  POST /guard/entries/:id/admit   deja pasar una visita pendiente (aprobada o confirmada por teléfono)
 *  POST /guard/entries/:id/deny    la rechaza
 *  POST /guard/entries/:id/exit    registra la salida
 */

import { Router } from "express";
import { z } from "zod";
import { one, query, withTx } from "../../db.js";
import { badRequest, conflict, handler, idParams, notFound } from "../../lib/http.js";
import { requireRole } from "../../security/authorize.js";
import { condominiumOf, txCtx } from "../../security/context.js";
import { LOG_SELECT, VEHICLE_SELECT } from "./resident.js";
import {
  AUTHORIZATION_SELECT,
  UNIT_PHONES,
  VALID_TODAY,
  accessChanged,
  notifyUnannounced,
  optText,
  plateSchema,
  withPhoto
} from "./shared.js";

export const guardRoutes = Router();

guardRoutes.use(requireRole("guard", "admin"));

const term = z.object({ q: z.string().trim().max(60).optional() });

/** Coincidencia por nombre, documento o placa (la placa se compara normalizada) */
const MATCH = (alias: string) => `($1::text IS NULL
  OR ${alias}.names ILIKE '%' || $1 || '%'
  OR ${alias}.id_number ILIKE '%' || $1 || '%'
  OR ${alias}.plate LIKE '%' || upper(regexp_replace($1, '[^A-Za-z0-9]', '', 'g')) || '%'
  OR u.code ILIKE '%' || $1 || '%')`;

const AUTH_WITH_EXTRAS = `${AUTHORIZATION_SELECT}, ${UNIT_PHONES} AS phones,
  (SELECT l.id FROM access_logs l WHERE l.authorization_id = a.id AND l.status = 'inside' LIMIT 1) AS "insideLogId"`;

guardRoutes.get(
  "/board",
  handler({ query: term }, async ({ query: f }) => {
    const q = f.q || null;
    const [expected, inside, pending] = await Promise.all([
      query<{ photoFileId: string | null; condominiumId: string }>(
        `SELECT ${AUTH_WITH_EXTRAS}
           FROM authorizations a JOIN units u ON u.id = a.unit_id AND u.is_active
          WHERE ${VALID_TODAY} AND ${MATCH("a")}
          ORDER BY (a.kind = 'temporary') DESC, a.names
          LIMIT 300`,
        [q]
      ),
      query(
        `SELECT ${LOG_SELECT} FROM access_logs l JOIN units u ON u.id = l.unit_id
          WHERE l.status = 'inside' AND ${MATCH("l")}
          ORDER BY l.entry_at DESC LIMIT 300`,
        [q]
      ),
      query(
        `SELECT ${LOG_SELECT}, ${UNIT_PHONES} AS phones FROM access_logs l JOIN units u ON u.id = l.unit_id
          WHERE l.status = 'pending' AND l.created_at > NOW() - INTERVAL '12 hours'
          ORDER BY l.created_at DESC`
      )
    ]);
    return { expected: expected.map(withPhoto), inside, pending };
  })
);

guardRoutes.get(
  "/search",
  handler({ query: z.object({ q: z.string().trim().min(2).max(60) }) }, async ({ query: f }) => {
    const [authorizations, vehicles] = await Promise.all([
      query<{ photoFileId: string | null; condominiumId: string }>(
        `SELECT ${AUTH_WITH_EXTRAS}
           FROM authorizations a JOIN units u ON u.id = a.unit_id AND u.is_active
          WHERE a.status = 'active' AND ${MATCH("a")}
          ORDER BY ${VALID_TODAY} DESC, a.names LIMIT 50`,
        [f.q]
      ),
      query(
        `SELECT ${VEHICLE_SELECT}, ${UNIT_PHONES} AS phones
           FROM vehicles v JOIN units u ON u.id = v.unit_id AND u.is_active
          WHERE v.is_active AND (v.plate LIKE '%' || upper(regexp_replace($1, '[^A-Za-z0-9]', '', 'g')) || '%' OR u.code ILIKE '%' || $1 || '%')
          ORDER BY v.plate LIMIT 50`,
        [f.q]
      )
    ]);
    return { authorizations: authorizations.map(withPhoto), vehicles };
  })
);

guardRoutes.get(
  "/units",
  handler({}, () =>
    query(
      `SELECT u.id, u.code, u.tower, ${UNIT_PHONES} AS phones
         FROM units u WHERE u.is_active
        ORDER BY u.tower NULLS FIRST, length(u.code), u.code`
    )
  )
);

// ------------------------------------------------------------------ Ingresos

const entryBody = z
  .object({
    authorizationId: z.uuid().optional(),
    vehicleId: z.uuid().optional(),
    plate: plateSchema.nullish().transform((v) => v ?? null),
    notes: optText(500),
    /** El guarda confirma que llamó a la filial (permiso con «llamar» o fuera de horario) */
    confirmed: z.boolean().default(false)
  })
  .refine((b) => Boolean(b.authorizationId) !== Boolean(b.vehicleId), "Indique el autorizado o el vehículo");

guardRoutes.post(
  "/entries",
  handler({ body: entryBody }, async ({ body, req }) => {
    if (body.authorizationId) {
      const a = await one<{
        id: string;
        unit_id: string;
        kind: string;
        names: string;
        id_number: string | null;
        plate: string | null;
        valid_today: boolean;
        within_hours: boolean;
        call_to_confirm: boolean;
        delete_after_use: boolean;
        inside: boolean;
      }>(
        `SELECT a.id, a.unit_id, a.kind, a.names, a.id_number, a.plate, a.call_to_confirm, a.delete_after_use,
                ${VALID_TODAY} AS valid_today,
                (a.time_from IS NULL OR LOCALTIME BETWEEN a.time_from AND a.time_to) AS within_hours,
                EXISTS (SELECT 1 FROM access_logs l WHERE l.authorization_id = a.id AND l.status = 'inside') AS inside
           FROM authorizations a WHERE a.id = $1`,
        [body.authorizationId]
      );
      if (!a) throw notFound("Autorizado no encontrado");
      if (!a.valid_today) throw conflict("NOT_VALID_TODAY", "El permiso no es válido hoy (vencido, utilizado o fuera de sus días)");
      if (a.inside) throw conflict("ALREADY_INSIDE", `${a.names} ya está registrado adentro; registre primero su salida`);
      if (!a.within_hours && !body.confirmed) {
        throw conflict("OUTSIDE_HOURS", "Está fuera del horario autorizado: confirme con la filial antes de dejarlo pasar");
      }
      if (a.call_to_confirm && !body.confirmed) {
        throw conflict("CALL_REQUIRED", "La filial pidió que la llamen para confirmar este ingreso");
      }
      const log = await withTx(txCtx(req), async (client) => {
        const row = await one<{ id: string }>(
          `INSERT INTO access_logs (unit_id, authorization_id, kind, names, id_number, plate, notes, status, entry_at, entry_by, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'inside', NOW(), fn_current_app_user(), fn_current_app_user()) RETURNING id`,
          [a.unit_id, a.id, a.kind, a.names, a.id_number, body.plate ?? a.plate, body.notes],
          client
        );
        await client.query(
          `UPDATE authorizations SET last_entry_at = NOW(), last_exit_at = NULL,
                  status = CASE WHEN delete_after_use THEN 'used' ELSE status END
            WHERE id = $1`,
          [a.id]
        );
        return row!;
      });
      accessChanged(condominiumOf(req), a.unit_id);
      return { id: log.id };
    }

    // Residente que entra en su vehículo registrado
    const v = await one<{ id: string; unit_id: string; plate: string; unit_code: string }>(
      `SELECT v.id, v.unit_id, v.plate, u.code AS unit_code FROM vehicles v JOIN units u ON u.id = v.unit_id
        WHERE v.id = $1 AND v.is_active`,
      [body.vehicleId]
    );
    if (!v) throw notFound("Vehículo no encontrado");
    if (await one(`SELECT 1 FROM access_logs WHERE vehicle_id = $1 AND status = 'inside'`, [v.id])) {
      throw conflict("ALREADY_INSIDE", `El vehículo ${v.plate} ya está registrado adentro`);
    }
    const log = await withTx(txCtx(req), (client) =>
      one<{ id: string }>(
        `INSERT INTO access_logs (unit_id, vehicle_id, kind, names, plate, notes, status, entry_at, entry_by, created_by)
         VALUES ($1, $2, 'resident', $3, $4, $5, 'inside', NOW(), fn_current_app_user(), fn_current_app_user()) RETURNING id`,
        [v.unit_id, v.id, `Residente ${v.unit_code}`, v.plate, body.notes],
        client
      )
    );
    accessChanged(condominiumOf(req), v.unit_id);
    return { id: log!.id };
  })
);

const visitBody = z.object({
  unitId: z.uuid(),
  kind: z.enum(["unannounced", "delivery", "service"]).default("unannounced"),
  names: z.string().trim().min(2).max(120),
  idNumber: optText(30),
  plate: plateSchema.nullish().transform((v) => v ?? null),
  notes: optText(500)
});

guardRoutes.post(
  "/visits",
  handler({ body: visitBody }, async ({ body, req }) => {
    const unit = await one(`SELECT 1 FROM units WHERE id = $1 AND is_active`, [body.unitId]);
    if (!unit) throw notFound("Filial no encontrada");
    const row = await withTx(txCtx(req), (client) =>
      one<{ id: string }>(
        `INSERT INTO access_logs (unit_id, kind, names, id_number, plate, notes, status, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, 'pending', fn_current_app_user()) RETURNING id`,
        [body.unitId, body.kind, body.names, body.idNumber, body.plate, body.notes],
        client
      )
    );
    const notified = await notifyUnannounced(condominiumOf(req), body.unitId, { visitor: body.names, kind: body.kind, plate: body.plate, logId: row!.id });
    accessChanged(condominiumOf(req), body.unitId);
    return { id: row!.id, notified };
  })
);

guardRoutes.post(
  "/entries/:id/admit",
  handler({ params: idParams, body: z.object({ confirmed: z.boolean().default(false), notes: optText(500) }) }, async ({ params, body, req }) => {
    const log = await one<{ status: string; response: string | null; unit_id: string }>(`SELECT status, response, unit_id FROM access_logs WHERE id = $1`, [params.id]);
    if (!log) throw notFound("Visita no encontrada");
    if (log.status !== "pending") throw conflict("ALREADY_RESOLVED", "La visita ya fue atendida");
    if (log.response === "denied") throw conflict("DENIED_BY_RESIDENT", "La filial rechazó esta visita");
    if (log.response !== "approved" && !body.confirmed) {
      throw conflict("AWAITING_RESPONSE", "La filial aún no responde: llame para confirmar o espere su respuesta en la app");
    }
    await withTx(txCtx(req), (client) =>
      client.query(
        `UPDATE access_logs SET status = 'inside', entry_at = NOW(), entry_by = fn_current_app_user(),
                notes = NULLIF(concat_ws(' · ', COALESCE($2, notes), CASE WHEN response IS NULL THEN 'Confirmado por teléfono' END), '')
          WHERE id = $1`,
        [params.id, body.notes]
      )
    );
    accessChanged(condominiumOf(req), log.unit_id);
    return undefined;
  })
);

guardRoutes.post(
  "/entries/:id/deny",
  handler({ params: idParams, body: z.object({ notes: optText(500) }) }, async ({ params, body, req }) => {
    const row = await withTx(txCtx(req), (client) =>
      one(
        `UPDATE access_logs SET status = 'denied', notes = COALESCE($2, notes) WHERE id = $1 AND status = 'pending' RETURNING id, unit_id`,
        [params.id, body.notes],
        client
      )
    );
    if (!row) throw conflict("ALREADY_RESOLVED", "La visita ya fue atendida");
    accessChanged(condominiumOf(req), (row as { unit_id: string }).unit_id);
    return undefined;
  })
);

guardRoutes.post(
  "/entries/:id/exit",
  handler({ params: idParams }, async ({ params, req }) => {
    const row = await withTx(txCtx(req), async (client) => {
      const log = await one<{ authorization_id: string | null; unit_id: string }>(
        `UPDATE access_logs SET status = 'exited', exit_at = NOW(), exit_by = fn_current_app_user()
          WHERE id = $1 AND status = 'inside' RETURNING authorization_id, unit_id`,
        [params.id],
        client
      );
      if (log?.authorization_id) {
        await client.query(`UPDATE authorizations SET last_exit_at = NOW() WHERE id = $1`, [log.authorization_id]);
      }
      return log;
    });
    if (!row) throw badRequest("NOT_INSIDE", "Ese registro no está adentro (ya salió o no ingresó)");
    accessChanged(condominiumOf(req), row.unit_id);
    return undefined;
  })
);
