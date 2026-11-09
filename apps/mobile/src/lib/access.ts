/**
 * @project DomusApp - Mobile
 * @file src/lib/access.ts
 * @description Tipos, etiquetas y fechas del control de acceso (residente y guarda)
 */

export type AuthKind = "temporary" | "permanent" | "employee";

export interface Photo {
  thumb: string;
  medium: string;
  full: string;
}

export interface Phone {
  names: string;
  phone: string;
}

export interface Authorization {
  id: string;
  unitId: string;
  unitCode: string;
  unitTower: string | null;
  kind: AuthKind;
  names: string;
  idNumber: string | null;
  plate: string | null;
  occupation: string | null;
  validFrom: string | null;
  validTo: string | null;
  weekdays: number[] | null;
  timeFrom: string | null;
  timeTo: string | null;
  callToConfirm: boolean;
  deleteAfterUse: boolean;
  instructions: string | null;
  status: "active" | "used" | "revoked";
  lastEntryAt: string | null;
  lastExitAt: string | null;
  validToday: boolean;
  withinHours: boolean;
  expired: boolean;
  photo: Photo | null;
  /** Solo en la caseta */
  phones?: Phone[];
  insideLogId?: string | null;
}

export interface Vehicle {
  id: string;
  unitId: string;
  unitCode: string;
  unitTower: string | null;
  plate: string;
  kind: string;
  brand: string | null;
  model: string | null;
  color: string | null;
  notes: string | null;
  isActive: boolean;
  phones?: Phone[];
}

export interface AccessLog {
  id: string;
  unitId: string;
  unitCode: string;
  unitTower: string | null;
  authorizationId: string | null;
  kind: string;
  names: string;
  idNumber: string | null;
  plate: string | null;
  notes: string | null;
  status: "pending" | "inside" | "exited" | "denied";
  response: "approved" | "denied" | null;
  respondedAt: string | null;
  entryAt: string | null;
  exitAt: string | null;
  createdAt: string;
  phones?: Phone[];
}

export interface ResidentUnit {
  id: string;
  code: string;
  tower: string | null;
}

export const KIND_TITLE: Record<AuthKind, string> = { temporary: "Temporal", permanent: "Permanente", employee: "Empleado" };

export const LOG_KIND_LABEL: Record<string, string> = {
  temporary: "Visita temporal",
  permanent: "Autorizado permanente",
  employee: "Empleado",
  resident: "Residente",
  unannounced: "Visita no anunciada",
  delivery: "Entrega",
  service: "Servicio"
};

export const VEHICLE_KIND: Record<string, string> = { car: "Automóvil", motorcycle: "Motocicleta", truck: "Camión", bicycle: "Bicicleta", other: "Otro" };

/** ISO: 1 = lunes … 7 = domingo */
export const WEEKDAY_SHORT = ["L", "K", "M", "J", "V", "S", "D"];

const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const DAYS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];

const pad = (n: number) => String(n).padStart(2, "0");

/** Fecha local del dispositivo en formato AAAA-MM-DD */
export const isoDay = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export const parseDay = (iso: string): Date => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
};

export const addDays = (d: Date, n: number): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

/** "lun 9 nov" */
export const fmtDayShort = (iso: string): string => {
  const d = parseDay(iso);
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
};

/** "9 nov 2026, 14:05" (o "Hoy, 14:05") */
export function fmtDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (isoDay(d) === isoDay(new Date())) return `Hoy, ${time}`;
  if (isoDay(d) === isoDay(addDays(new Date(), -1))) return `Ayer, ${time}`;
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${time}`;
}

export const fmtTime = (value: string | null | undefined): string => {
  if (!value) return "—";
  const d = new Date(value);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** Texto de la vigencia: fecha o rango, días y horario */
export function validityText(a: Pick<Authorization, "validFrom" | "validTo" | "weekdays" | "timeFrom" | "timeTo">): string {
  const parts: string[] = [];
  if (a.validFrom && a.validTo) parts.push(a.validFrom === a.validTo ? fmtDayShort(a.validFrom) : `${fmtDayShort(a.validFrom)} al ${fmtDayShort(a.validTo)}`);
  else if (a.validTo) parts.push(`Hasta ${fmtDayShort(a.validTo)}`);
  else if (a.validFrom) parts.push(`Desde ${fmtDayShort(a.validFrom)}`);
  if (a.weekdays?.length && a.weekdays.length < 7) parts.push(a.weekdays.map((d) => WEEKDAY_SHORT[d - 1]).join(" "));
  if (a.timeFrom && a.timeTo) parts.push(`${a.timeFrom} a ${a.timeTo}`);
  return parts.join(" · ") || "Sin vencimiento";
}

/** Estado del permiso como lo muestran las tarjetas */
export function permitStatus(a: Authorization): { label: string; tone: "ok" | "muted" | "warn" } {
  if (a.status === "used") return { label: "Utilizado", tone: "muted" };
  if (a.status === "revoked") return { label: "Eliminado", tone: "muted" };
  if (a.expired) return { label: "Vencido", tone: "warn" };
  if (a.validToday) return { label: "Vigente hoy", tone: "ok" };
  return { label: "Programado", tone: "ok" };
}

export const unitLabel = (u: { code?: string; unitCode?: string; tower?: string | null; unitTower?: string | null }): string => {
  const code = u.code ?? u.unitCode ?? "";
  const tower = u.tower ?? u.unitTower;
  return tower ? `${code} · ${tower}` : code;
};

/** Normaliza la placa como lo hace la API: mayúsculas y solo letras y números */
export const normalizePlate = (v: string): string => v.toUpperCase().replace(/[^A-Z0-9]/g, "");
