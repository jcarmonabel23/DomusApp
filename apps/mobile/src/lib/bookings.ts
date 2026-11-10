/**
 * @project DomusApp - Mobile
 * @file src/lib/bookings.ts
 * @description Reservaciones de áreas comunes: tipos, íconos, etiquetas y formatos
 */

import type MaterialIcons from "@expo/vector-icons/MaterialIcons";
import type { ComponentProps } from "react";

type IconName = ComponentProps<typeof MaterialIcons>["name"];

export interface Amenity {
  id: string;
  name: string;
  icon: string;
  description: string | null;
  rules: string | null;
  mode: "exclusive" | "shared";
  capacity: number;
  openTime: string;
  closeTime: string;
  weekdays: number[];
  slotMinutes: number;
  maxDurationMinutes: number;
  minAdvanceHours: number;
  maxAdvanceDays: number;
  cancelHours: number;
  maxActivePerUnit: number | null;
  cost: number;
  requiresApproval: boolean;
  blockDelinquent: boolean;
  photo: { card: string; cover: string; full: string } | null;
  nextBooking?: { id: string; date: string; timeFrom: string; status: string } | null;
}

export type SlotStatus = "available" | "reserved" | "mine" | "holiday" | "unavailable" | "past";

export interface Slot {
  time: string;
  startsAt: string;
  endsAt: string;
  status: SlotStatus;
  reason?: string;
  left?: number;
}

export interface DayAvailability {
  date: string;
  open: boolean;
  reason: string | null;
  slots: Slot[];
}

export interface Booking {
  id: string;
  amenityId: string;
  amenityName: string;
  amenityIcon: string;
  unitId: string;
  unitCode: string;
  unitTower: string | null;
  date: string;
  timeFrom: string;
  timeTo: string;
  startsAt: string;
  guests: number;
  notes: string | null;
  status: "pending" | "approved" | "rejected" | "cancelled";
  cost: number;
  chargeId: string | null;
  chargeVoided: boolean;
  reviewNotes: string | null;
  cancelReason: string | null;
  cancelHours: number;
  started: boolean;
}

export const AMENITY_ICON: Record<string, { icon: IconName; bg: string; fg: string }> = {
  pool: { icon: "pool", bg: "#dff4fb", fg: "#0b7fa6" },
  bbq: { icon: "outdoor-grill", bg: "#fdebdc", fg: "#b4500f" },
  event: { icon: "celebration", bg: "#f3e5f9", fg: "#7b2d9c" },
  sports: { icon: "sports-soccer", bg: "#e2f5e6", fg: "#22783a" },
  gym: { icon: "fitness-center", bg: "#fde4e4", fg: "#b42525" },
  playground: { icon: "child-care", bg: "#fff6d6", fg: "#8a6400" },
  games: { icon: "casino", bg: "#e6e9fb", fg: "#3946a8" },
  cowork: { icon: "laptop", bg: "#e3effc", fg: "#1a5fa8" },
  other: { icon: "holiday-village", bg: "#eceff3", fg: "#4b5563" }
};

export const amenityIcon = (icon: string) => AMENITY_ICON[icon] ?? AMENITY_ICON.other;

export const STATUS: Record<Booking["status"], { label: string; bg: string; fg: string }> = {
  pending: { label: "Por aprobar", bg: "#fff4dd", fg: "#8a5a00" },
  approved: { label: "Confirmada", bg: "#dff7ec", fg: "#13795b" },
  rejected: { label: "Rechazada", bg: "#fde2e4", fg: "#b42525" },
  cancelled: { label: "Cancelada", bg: "#eceff3", fg: "#4b5563" }
};

export const SLOT: Record<SlotStatus | "selected", { label: string; bg: string; fg: string; border: string }> = {
  available: { label: "Disponible", bg: "#ffffff", fg: "#1f2328", border: "#cfd6de" },
  selected: { label: "Su elección", bg: "#1572d3", fg: "#ffffff", border: "#1572d3" },
  mine: { label: "Su reserva", bg: "#dff7ec", fg: "#13795b", border: "#9fdcc2" },
  reserved: { label: "Reservado", bg: "#e7f2fd", fg: "#5d7fa3", border: "#e7f2fd" },
  holiday: { label: "Feriado", bg: "#f3e5f9", fg: "#7b2d9c", border: "#f3e5f9" },
  unavailable: { label: "No disponible", bg: "#fdebdc", fg: "#b4500f", border: "#fdebdc" },
  past: { label: "No disponible", bg: "#f2f3f5", fg: "#9aa1ab", border: "#f2f3f5" }
};

export const WEEKDAY_SHORT = ["", "L", "K", "M", "J", "V", "S", "D"];

export const durationText = (minutes: number) =>
  minutes % 60 === 0 ? `${minutes / 60} h` : minutes > 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes} min`;

const DAYS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/** "2026-11-14" → "sáb 14 nov" */
export function dayText(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return `${DAYS[date.getDay()]} ${d} ${MONTHS[m - 1]}`;
}

/** Días abiertos en texto: "todos los días" o "L M J V" */
export const weekdaysText = (w: number[]) => (w.length === 7 ? "todos los días" : w.map((d) => WEEKDAY_SHORT[d]).join(" "));
