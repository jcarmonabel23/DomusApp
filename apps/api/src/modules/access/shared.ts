/**
 * @project DomusApp - API
 * @file src/modules/access/shared.ts
 * @description Reglas comunes del control de acceso (residente, caseta y panel)
 *
 * Fechas y horas: db.ts fija la zona horaria del condominio en cada conexión, así que
 * CURRENT_DATE y LOCALTIME ya son "hoy" y "ahora" en el condominio, no en el servidor.
 */

import { z } from "zod";
import { one, query } from "../../db.js";
import { badRequest, forbidden } from "../../lib/http.js";
import { brandForCondominium, sendVisitNotice } from "../../lib/mailer.js";
import { notify } from "../notifications/service.js";
import { emitToStaff, emitToUnit } from "../../lib/realtime.js";
import { logger } from "../../lib/logger.js";
import { fileKey, photoUrls } from "../files/images.js";

export const KINDS = ["temporary", "permanent", "employee"] as const;

export const KIND_LABEL: Record<string, string> = {
  temporary: "Temporal",
  permanent: "Permanente",
  employee: "Empleado",
  resident: "Residente",
  unannounced: "Visita no anunciada",
  delivery: "Entrega",
  service: "Servicio"
};

/** Placa normalizada: mayúsculas, sin espacios ni guiones ("abc-123" → "ABC123") */
export const plateSchema = z
  .string()
  .trim()
  .max(20)
  .transform((v) => v.toUpperCase().replace(/[^A-Z0-9]/g, ""))
  .refine((v) => v === "" || /^[A-Z0-9]{2,15}$/.test(v), "Placa inválida")
  .transform((v) => v || null);

export const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => v || null);

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha AAAA-MM-DD");
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Hora HH:MM");

/** Cuerpo de un autorizado (lo usan la app del residente y, a futuro, el panel) */
export const authorizationBody = z
  .object({
    unitId: z.uuid(),
    kind: z.enum(KINDS),
    names: z.string().trim().min(2).max(120),
    idNumber: optText(30),
    plate: plateSchema.nullish().transform((v) => v ?? null),
    occupation: optText(60),
    validFrom: isoDate.nullish(),
    validTo: isoDate.nullish(),
    weekdays: z.array(z.number().int().min(1).max(7)).max(7).nullish(),
    timeFrom: hhmm.nullish(),
    timeTo: hhmm.nullish(),
    callToConfirm: z.boolean().default(false),
    deleteAfterUse: z.boolean().default(false),
    instructions: optText(500)
  })
  .transform((b) => {
    // Normaliza por tipo: el temporal es de fecha o rango; los demás no llevan "un solo uso"
    const temporary = b.kind === "temporary";
    return {
      ...b,
      validFrom: b.validFrom ?? null,
      validTo: temporary ? (b.validTo ?? b.validFrom ?? null) : (b.validTo ?? null),
      weekdays: b.kind === "employee" && b.weekdays?.length ? [...new Set(b.weekdays)].sort() : null,
      timeFrom: b.kind === "employee" && b.timeFrom && b.timeTo ? b.timeFrom : null,
      timeTo: b.kind === "employee" && b.timeFrom && b.timeTo ? b.timeTo : null,
      occupation: b.kind === "employee" ? b.occupation : null,
      deleteAfterUse: temporary ? b.deleteAfterUse : false
    };
  })
  .superRefine((b, ctx) => {
    if (b.kind === "temporary" && !b.validFrom) ctx.addIssue({ code: "custom", path: ["validFrom"], message: "Indique la fecha de la visita" });
    if (b.validFrom && b.validTo && b.validTo < b.validFrom) ctx.addIssue({ code: "custom", path: ["validTo"], message: "La fecha final es anterior a la inicial" });
    if (b.timeFrom && b.timeTo && b.timeTo <= b.timeFrom) ctx.addIssue({ code: "custom", path: ["timeTo"], message: "La hora final debe ser posterior a la inicial" });
  });

export type AuthorizationInput = z.infer<typeof authorizationBody>;

/** Reglas de fechas que dependen de "hoy" en el condominio */
export async function assertAuthorizationDates(b: AuthorizationInput): Promise<void> {
  const today = (await one<{ d: string }>(`SELECT to_char(CURRENT_DATE, 'YYYY-MM-DD') AS d`))!.d;
  if (b.validTo && b.validTo < today) throw badRequest("DATE_PAST", "La autorización ya estaría vencida: revise las fechas");
  if (b.kind === "temporary" && b.validFrom && b.validTo) {
    const days = (Date.parse(b.validTo) - Date.parse(b.validFrom)) / 86_400_000;
    if (days > 90) throw badRequest("RANGE_TOO_LONG", "Un autorizado temporal cubre como máximo 90 días; use uno permanente");
  }
}

/** Condición SQL: el autorizado `a` vale HOY (sin mirar la hora) */
export const VALID_TODAY = `(a.status = 'active'
  AND (a.valid_from IS NULL OR a.valid_from <= CURRENT_DATE)
  AND (a.valid_to IS NULL OR a.valid_to >= CURRENT_DATE)
  AND (a.weekdays IS NULL OR EXTRACT(ISODOW FROM CURRENT_DATE)::int = ANY (a.weekdays)))`;

/** Condición SQL: además está dentro de su horario (si tiene) */
export const WITHIN_HOURS = `(a.time_from IS NULL OR LOCALTIME BETWEEN a.time_from AND a.time_to)`;

/** Columnas de un autorizado en formato de la API (requiere alias a = authorizations, u = units) */
export const AUTHORIZATION_SELECT = `
  a.id, a.unit_id AS "unitId", u.code AS "unitCode", u.tower AS "unitTower",
  a.kind, a.names, a.id_number AS "idNumber", a.plate, a.occupation,
  a.photo_file_id AS "photoFileId", a.condominium_id AS "condominiumId",
  to_char(a.valid_from, 'YYYY-MM-DD') AS "validFrom", to_char(a.valid_to, 'YYYY-MM-DD') AS "validTo",
  a.weekdays, to_char(a.time_from, 'HH24:MI') AS "timeFrom", to_char(a.time_to, 'HH24:MI') AS "timeTo",
  a.call_to_confirm AS "callToConfirm", a.delete_after_use AS "deleteAfterUse", a.instructions,
  a.status, a.last_entry_at AS "lastEntryAt", a.last_exit_at AS "lastExitAt", a.created_at AS "createdAt",
  ${VALID_TODAY} AS "validToday", ${WITHIN_HOURS} AS "withinHours",
  (a.status = 'active' AND a.valid_to IS NOT NULL AND a.valid_to < CURRENT_DATE) AS expired`;

/** Reemplaza photoFileId/condominiumId por las URLs firmadas de la foto */
export function withPhoto<T extends { photoFileId: string | null; condominiumId: string }>(row: T) {
  const { photoFileId, condominiumId, ...rest } = row;
  return { ...rest, photo: photoUrls(fileKey(condominiumId, photoFileId)) };
}

/** Filiales a las que está vinculada la cuenta (vía su ficha de persona) en el condominio activo */
export async function residentUnitIds(userId: string): Promise<string[]> {
  const rows = await query<{ unit_id: string }>(
    `SELECT up.unit_id FROM units_people up
       JOIN people p ON p.id = up.person_id AND p.is_active
       JOIN units u ON u.id = up.unit_id AND u.is_active
      WHERE p.user_id = $1`,
    [userId]
  );
  return rows.map((r) => r.unit_id);
}

export async function assertResidentUnit(userId: string, unitId: string): Promise<void> {
  if (!(await residentUnitIds(userId)).includes(unitId)) {
    throw forbidden("UNIT_FORBIDDEN", "Esa filial no está vinculada a su cuenta");
  }
}

/** Teléfonos para "llamar a la casa": personas de la filial, el contacto principal primero */
export const UNIT_PHONES = `COALESCE((SELECT json_agg(json_build_object('names', p.names, 'phone', p.phone) ORDER BY up.is_primary DESC, p.names)
     FROM units_people up JOIN people p ON p.id = up.person_id AND p.is_active
    WHERE up.unit_id = u.id AND p.phone IS NOT NULL), '[]')`;

/**
 * Avisa a las cuentas vinculadas a la filial que hay una visita no anunciada: correo + campana, socket y push.
 * Devuelve cuántos correos salieron. Nunca lanza.
 */
export async function notifyUnannounced(
  condominiumId: string,
  unitId: string,
  visit: { visitor: string; kind: string; plate: string | null; logId: string }
): Promise<number> {
  try {
    const unit = await one<{ code: string }>(`SELECT code FROM units WHERE id = $1`, [unitId]);
    const recipients = await query<{ id: string; email: string; names: string }>(
      `SELECT DISTINCT u.id, u.email, u.names
         FROM units_people up
         JOIN people p ON p.id = up.person_id AND p.is_active AND p.user_id IS NOT NULL
         JOIN users u ON u.id = p.user_id AND u.is_active
         JOIN users_condominiums uc ON uc.user_id = u.id AND uc.condominium_id = $2 AND uc.is_active
        WHERE up.unit_id = $1`,
      [unitId, condominiumId]
    );
    const kindLabel = KIND_LABEL[visit.kind] ?? visit.kind;
    await notify(condominiumId, recipients.map((r) => r.id), {
      kind: "visit",
      title: `${visit.visitor} está en la caseta`,
      body: [kindLabel, visit.plate && `Placa ${visit.plate}`, `Filial ${unit?.code ?? ""}`, "¿Lo deja pasar?"].filter(Boolean).join(" · "),
      data: { unitId, logId: visit.logId }
    });
    const brand = await brandForCondominium(condominiumId);
    let sent = 0;
    for (const r of recipients) {
      const ok = await sendVisitNotice(
        r.email,
        r.names,
        { visitor: visit.visitor, unitCode: unit?.code ?? "", kindLabel: KIND_LABEL[visit.kind] ?? visit.kind, plate: visit.plate },
        brand
      );
      if (ok) sent++;
    }
    return sent;
  } catch (err) {
    logger.error({ err, unitId }, "[access] no se pudo avisar la visita");
    return 0;
  }
}

/** Avisa por socket que cambió la caseta: refresca los tableros de los guardas y, si aplica, la app de la filial */
export function accessChanged(condominiumId: string, unitId?: string | null): void {
  emitToStaff(condominiumId, "access:update", { unitId: unitId ?? null });
  if (unitId) emitToUnit(condominiumId, unitId, "visit:update", { unitId });
}
