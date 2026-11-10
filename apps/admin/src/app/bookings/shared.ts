/**
 * @project DomusApp - Admin
 * @file src/app/bookings/shared.ts
 * @description Reservaciones: tipos, etiquetas, íconos de las áreas y utilidades de fecha
 */

import {
  IconBallFootball,
  IconBarbell,
  IconBuildingCommunity,
  IconChess,
  IconConfetti,
  IconDeviceLaptop,
  IconFlame,
  IconMoodKid,
  IconPool,
  type Icon
} from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@clients/apiClient";

export const AMENITY_ICON: Record<string, { icon: Icon; label: string; color: string }> = {
  pool: { icon: IconPool, label: "Piscina", color: "cyan" },
  bbq: { icon: IconFlame, label: "Rancho / BBQ", color: "orange" },
  event: { icon: IconConfetti, label: "Salón de eventos", color: "grape" },
  sports: { icon: IconBallFootball, label: "Cancha", color: "green" },
  gym: { icon: IconBarbell, label: "Gimnasio", color: "red" },
  playground: { icon: IconMoodKid, label: "Juegos infantiles", color: "yellow" },
  games: { icon: IconChess, label: "Sala de juegos", color: "indigo" },
  cowork: { icon: IconDeviceLaptop, label: "Cowork", color: "blue" },
  other: { icon: IconBuildingCommunity, label: "Otra", color: "gray" }
};

export const BOOKING_STATUS: Record<string, { label: string; color: string }> = {
  pending: { label: "Por aprobar", color: "yellow" },
  approved: { label: "Aprobada", color: "teal" },
  rejected: { label: "Rechazada", color: "red" },
  cancelled: { label: "Cancelada", color: "gray" }
};

export const BLOCK_KIND: Record<string, { label: string; color: string }> = {
  holiday: { label: "Feriado", color: "violet" },
  unavailable: { label: "No disponible", color: "orange" },
  restriction: { label: "Restricción", color: "red" }
};

export const SLOT_STYLE: Record<string, { label: string; bg: string; fg: string }> = {
  available: { label: "Disponible", bg: "var(--mantine-color-green-0)", fg: "var(--mantine-color-green-8)" },
  reserved: { label: "Reservado", bg: "var(--mantine-color-blue-1)", fg: "var(--mantine-color-blue-9)" },
  pending: { label: "Por aprobar", bg: "var(--mantine-color-yellow-1)", fg: "var(--mantine-color-yellow-9)" },
  holiday: { label: "Feriado", bg: "var(--mantine-color-violet-1)", fg: "var(--mantine-color-violet-9)" },
  unavailable: { label: "No disponible", bg: "var(--mantine-color-orange-1)", fg: "var(--mantine-color-orange-9)" },
  past: { label: "Pasado", bg: "var(--mantine-color-gray-1)", fg: "var(--mantine-color-gray-6)" },
  closed: { label: "Cerrado", bg: "var(--mantine-color-gray-2)", fg: "var(--mantine-color-gray-6)" }
};

export const WEEKDAY_LABEL = ["", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
export const WEEKDAY_SHORT = ["", "L", "K", "M", "J", "V", "S", "D"];

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
  slotMinutes: 30 | 60 | 120;
  maxDurationMinutes: number;
  minAdvanceHours: number;
  maxAdvanceDays: number;
  cancelHours: number;
  maxActivePerUnit: number | null;
  cost: number;
  requiresApproval: boolean;
  blockDelinquent: boolean;
  isActive: boolean;
  photo: { card: string; cover: string; full: string } | null;
  upcoming?: number;
  pending?: number;
}

export interface Booking {
  id: string;
  amenityId: string;
  amenityName: string;
  amenityIcon: string;
  unitId: string;
  unitCode: string;
  unitTower: string | null;
  startsAt: string;
  endsAt: string;
  date: string;
  timeFrom: string;
  timeTo: string;
  guests: number;
  notes: string | null;
  status: "pending" | "approved" | "rejected" | "cancelled";
  cost: number;
  chargeId: string | null;
  chargeVoided: boolean;
  bookedByName: string | null;
  reviewedByName: string | null;
  reviewedAt: string | null;
  reviewNotes: string | null;
  cancelledByName: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  createdAt: string;
  started: boolean;
}

export interface Slot {
  time: string;
  startsAt: string;
  endsAt: string;
  status: "available" | "reserved" | "mine" | "holiday" | "unavailable" | "past";
  reason?: string;
  left?: number;
  bookings?: { id: string; unitCode: string; status: string; guests: number }[];
}

export interface DayAvailability {
  date: string;
  open: boolean;
  reason: string | null;
  slots: Slot[];
}

export interface Block {
  id: string;
  kind: "holiday" | "unavailable" | "restriction";
  reason: string;
  amenityId: string | null;
  amenityName: string | null;
  unitId: string | null;
  unitCode: string | null;
  unitTower: string | null;
  startsLocal: string;
  endsLocal: string | null;
  active: boolean;
  createdByName: string | null;
}

/** Áreas del condominio (compartida por pestañas y formularios) */
export function useAmenities() {
  return useQuery({ queryKey: ["bookings", "amenities"], queryFn: () => apiGet<Amenity[]>("/bookings/amenities") });
}

export const unitName = (b: { unitCode: string | null; unitTower?: string | null }) => (b.unitTower ? `${b.unitCode} · ${b.unitTower}` : (b.unitCode ?? ""));

/** "AAAA-MM-DD" de una fecha local */
export const isoOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const parseIso = (s: string) => new Date(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)));
export const addDays = (s: string, n: number) => {
  const d = parseIso(s);
  d.setDate(d.getDate() + n);
  return isoOf(d);
};
/** Lunes de la semana de `s` */
export const mondayOf = (s: string) => addDays(s, -((parseIso(s).getDay() + 6) % 7));
/** 1 = lunes … 7 = domingo */
export const isoDow = (s: string) => ((parseIso(s).getDay() + 6) % 7) + 1;
/** "sáb 14 nov" */
export const dayLabel = (s: string) => new Intl.DateTimeFormat("es", { weekday: "short", day: "numeric", month: "short" }).format(parseIso(s));

export const durationText = (minutes: number) =>
  minutes % 60 === 0 ? `${minutes / 60} h` : minutes > 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes} min`;
