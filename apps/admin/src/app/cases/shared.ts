/**
 * @project DomusApp - Admin
 * @file src/app/cases/shared.ts
 * @description Casos: tipos, etiquetas y colores
 */

import type { FileRef } from "@/app/suppliers/shared";

export type CaseStatus = "open" | "in_progress" | "resolved" | "closed" | "rejected";

export interface CaseRow {
  id: string;
  number: number;
  code: string;
  category: string;
  title: string;
  description: string;
  location: string | null;
  unitId: string | null;
  unitCode: string | null;
  unitTower: string | null;
  priority: "low" | "normal" | "high" | "urgent";
  status: CaseStatus;
  isAnonymous: boolean;
  source: "app" | "panel";
  reportedByName: string | null;
  supplierId: string | null;
  supplierName: string | null;
  assignee: string | null;
  dueOn: string | null;
  overdue: boolean;
  resolvedAt: string | null;
  closedAt: string | null;
  rating: number | null;
  ratingComment: string | null;
  updates: number;
  files: number;
  lastActivityAt: string;
  createdAt: string;
}

export interface CaseUpdate {
  id: string;
  side: "resident" | "staff";
  body: string | null;
  statusFrom: CaseStatus | null;
  statusTo: CaseStatus | null;
  isInternal: boolean;
  authorName: string | null;
  createdAt: string;
}

export type CaseFile = FileRef & { id: string; updateId: string | null; side: string; isInternal: boolean; name: string | null; createdAt: string };

export type CaseDetail = CaseRow & { updates: CaseUpdate[]; files: CaseFile[] };

export const CATEGORY: Record<string, { label: string; color: string }> = {
  damage: { label: "Daño", color: "orange" },
  improvement: { label: "Mejora", color: "teal" },
  complaint: { label: "Queja", color: "red" },
  suggestion: { label: "Sugerencia", color: "blue" },
  report: { label: "Denuncia", color: "grape" }
};

export const STATUS: Record<CaseStatus, { label: string; color: string }> = {
  open: { label: "Abierto", color: "blue" },
  in_progress: { label: "En proceso", color: "yellow" },
  resolved: { label: "Resuelto", color: "teal" },
  closed: { label: "Cerrado", color: "gray" },
  rejected: { label: "Rechazado", color: "red" }
};

export const PRIORITY: Record<string, { label: string; color: string }> = {
  low: { label: "Baja", color: "gray" },
  normal: { label: "Normal", color: "blue" },
  high: { label: "Alta", color: "orange" },
  urgent: { label: "Urgente", color: "red" }
};

export const labels = (m: Record<string, { label: string }>) => Object.entries(m).map(([value, v]) => ({ value, label: v.label }));

/** Filial, "Anónimo" o "Administración" (casos registrados en el panel sin filial) */
export const caseUnit = (c: Pick<CaseRow, "isAnonymous" | "unitCode" | "unitTower" | "source">) =>
  c.isAnonymous ? "Anónimo" : c.unitCode ? (c.unitTower ? `${c.unitCode} · ${c.unitTower}` : c.unitCode) : c.source === "panel" ? "Administración" : "—";
