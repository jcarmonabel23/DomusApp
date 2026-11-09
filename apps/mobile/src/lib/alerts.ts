/**
 * @project DomusApp - Mobile
 * @file src/lib/alerts.ts
 * @description Tipos, etiquetas e íconos de las alertas de pánico y de la mensajería
 */

import type MaterialIcons from "@expo/vector-icons/MaterialIcons";
import type { ComponentProps } from "react";
import type { Phone } from "./access";

type IconName = ComponentProps<typeof MaterialIcons>["name"];

export type AlertKind =
  | "robbery"
  | "fire"
  | "flood"
  | "intruder"
  | "vandalism"
  | "short_circuit"
  | "domestic_violence"
  | "medical"
  | "accident"
  | "other";

/** En el orden en que se muestran en el botón de pánico */
export const ALERT_KINDS: { kind: AlertKind; label: string; icon: IconName; color: string }[] = [
  { kind: "robbery", label: "Robo", icon: "local-police", color: "#c62828" },
  { kind: "intruder", label: "Intrusos", icon: "directions-run", color: "#ad1457" },
  { kind: "fire", label: "Incendio", icon: "local-fire-department", color: "#e65100" },
  { kind: "medical", label: "Enfermedad", icon: "medical-services", color: "#2e7d32" },
  { kind: "domestic_violence", label: "Violencia doméstica", icon: "front-hand", color: "#6a1b9a" },
  { kind: "accident", label: "Accidente", icon: "personal-injury", color: "#00838f" },
  { kind: "flood", label: "Inundación", icon: "water-damage", color: "#1565c0" },
  { kind: "short_circuit", label: "Cortocircuito", icon: "electrical-services", color: "#f9a825" },
  { kind: "vandalism", label: "Vandalismo", icon: "broken-image", color: "#4e342e" },
  { kind: "other", label: "Otra emergencia", icon: "report", color: "#455a64" }
];

export const alertMeta = (kind: string) => ALERT_KINDS.find((k) => k.kind === kind) ?? ALERT_KINDS[ALERT_KINDS.length - 1];

export interface AlertItem {
  id: string;
  unitId: string | null;
  unitCode: string | null;
  unitTower: string | null;
  kind: AlertKind;
  notes: string | null;
  status: "active" | "acknowledged" | "attended";
  resolution: string | null;
  raisedAt: string;
  acknowledgedAt: string | null;
  attendedAt: string | null;
  raisedByName: string | null;
  acknowledgedByName: string | null;
  attendedByName: string | null;
  ackSeconds: number | null;
  attendSeconds: number | null;
  phones: Phone[];
}

export const ALERT_STATUS: Record<AlertItem["status"], { label: string; color: string }> = {
  active: { label: "Enviada a la caseta", color: "#e5484d" },
  acknowledged: { label: "Un guarda va en camino", color: "#f5a623" },
  attended: { label: "Atendida", color: "#2ecc87" }
};

/** 75 → "1 min 15 s" */
export function fmtDuration(s: number | null | undefined): string {
  if (s === null || s === undefined) return "—";
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min${s % 60 ? ` ${s % 60} s` : ""}`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

export interface Thread {
  unitId: string;
  code: string;
  tower: string | null;
  last: { body: string; side: "guard" | "resident"; createdAt: string } | null;
  unread: number;
}

export interface ChatMessage {
  id: string;
  side: "guard" | "resident";
  body: string;
  createdAt: string;
  senderId: string | null;
  senderName: string | null;
  unitId?: string;
}

export interface Announcement {
  id: string;
  title: string;
  body: string;
  audience: "all" | "residents" | "guards";
  isPinned: boolean;
  publishedAt: string;
  createdByName: string | null;
}
