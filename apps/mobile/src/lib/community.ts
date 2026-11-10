/**
 * @project DomusApp - Mobile
 * @file src/lib/community.ts
 * @description Fase 7 en la app: casos, documentos, asambleas, acuerdos y directorio de proveedores
 */

import type MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { Alert, Linking } from "react-native";
import type { ComponentProps } from "react";
import { fileUrl } from "@/lib/api";

type IconName = ComponentProps<typeof MaterialIcons>["name"];

export interface FileRef {
  kind: "pdf" | "image";
  preview: string | null;
  full: string;
}

/** Abre un archivo (PDF o imagen) en el navegador del teléfono; el PDF se descarga y se abre con el visor */
export async function openFile(file: FileRef | null | undefined): Promise<void> {
  const url = fileUrl(file?.full);
  if (!url) return;
  try {
    await Linking.openURL(url);
  } catch {
    Alert.alert("No se pudo abrir el archivo", "Intente de nuevo en unos minutos.");
  }
}

// ------------------------------------------------------------------ Casos

export type CaseStatus = "open" | "in_progress" | "resolved" | "closed" | "rejected";
export type CaseCategory = "damage" | "improvement" | "complaint" | "suggestion" | "report";

export interface CaseItem {
  id: string;
  code: string;
  category: CaseCategory;
  title: string;
  description: string;
  location: string | null;
  unitId: string | null;
  unitCode: string | null;
  unitTower: string | null;
  status: CaseStatus;
  isAnonymous: boolean;
  mine: boolean;
  reportedByName: string | null;
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
  authorName: string | null;
  createdAt: string;
}

export type CaseFile = FileRef & { id: string; side: string; name: string | null; createdAt: string };
export type CaseDetail = CaseItem & { updates: CaseUpdate[]; files: CaseFile[] };

export const CASE_CATEGORY: Record<CaseCategory, { label: string; icon: IconName; bg: string; fg: string; hint: string }> = {
  damage: { label: "Daño", icon: "build", bg: "#fdebdc", fg: "#b4500f", hint: "Algo se rompió o no funciona" },
  improvement: { label: "Mejora", icon: "auto-awesome", bg: "#e2f5e6", fg: "#22783a", hint: "Una idea para mejorar el condominio" },
  complaint: { label: "Queja", icon: "report-problem", bg: "#fde2e4", fg: "#b42525", hint: "Algo le molesta o no se atendió" },
  suggestion: { label: "Sugerencia", icon: "lightbulb", bg: "#e3effc", fg: "#1a5fa8", hint: "Una propuesta para la administración" },
  report: { label: "Denuncia", icon: "gavel", bg: "#f3e5f9", fg: "#7b2d9c", hint: "Una falta al reglamento (puede ser anónima)" }
};

export const CASE_STATUS: Record<CaseStatus, { label: string; bg: string; fg: string }> = {
  open: { label: "Recibido", bg: "#e7f2fd", fg: "#1a5fa8" },
  in_progress: { label: "En proceso", bg: "#fff4dd", fg: "#8a5a00" },
  resolved: { label: "Resuelto", bg: "#dff7ec", fg: "#13795b" },
  closed: { label: "Cerrado", bg: "#eceff3", fg: "#4b5563" },
  rejected: { label: "No procede", bg: "#fde2e4", fg: "#b42525" }
};

// ------------------------------------------------------------------ Documentos

export interface DocumentItem {
  id: string;
  title: string;
  category: string;
  description: string | null;
  publishedOn: string;
  fileBytes: number | null;
  file: FileRef | null;
}

export const DOCUMENT_CATEGORY: Record<string, { label: string; icon: IconName }> = {
  regulation: { label: "Reglamentos", icon: "gavel" },
  circular: { label: "Circulares", icon: "campaign" },
  minutes: { label: "Actas", icon: "description" },
  manual: { label: "Manuales", icon: "menu-book" },
  form: { label: "Formularios", icon: "assignment" },
  financial: { label: "Informes", icon: "bar-chart" },
  other: { label: "Otros", icon: "folder" }
};

// ------------------------------------------------------------------ Asambleas y acuerdos

export interface Assembly {
  id: string;
  title: string;
  kind: "ordinary" | "extraordinary";
  scheduledAt: string;
  date: string;
  time: string;
  location: string | null;
  meetingUrl: string | null;
  agenda: string | null;
  status: "scheduled" | "held" | "cancelled";
  attendanceUnits: number | null;
  quorumReached: boolean | null;
  summary: string | null;
  cancelReason: string | null;
  totalUnits: number;
  agreements: number;
  agreementsDone: number;
  minutes: FileRef | null;
}

export interface Agreement {
  id: string;
  assemblyId: string;
  assemblyTitle: string;
  assemblyDate: string;
  number: number;
  title: string;
  description: string | null;
  responsible: string | null;
  supplierName: string | null;
  dueOn: string | null;
  status: "pending" | "in_progress" | "done" | "cancelled";
  progressNotes: string | null;
  overdue: boolean;
}

export const AGREEMENT_STATUS: Record<Agreement["status"], { label: string; bg: string; fg: string }> = {
  pending: { label: "Pendiente", bg: "#fff4dd", fg: "#8a5a00" },
  in_progress: { label: "En proceso", bg: "#e7f2fd", fg: "#1a5fa8" },
  done: { label: "Cumplido", bg: "#dff7ec", fg: "#13795b" },
  cancelled: { label: "Anulado", bg: "#eceff3", fg: "#4b5563" }
};

export const ASSEMBLY_KIND = { ordinary: "Ordinaria", extraordinary: "Extraordinaria" } as const;

// ------------------------------------------------------------------ Proveedores

export interface SupplierItem {
  id: string;
  name: string;
  category: string;
  phone: string | null;
  email: string | null;
  website: string | null;
  contact: { names: string; role: string | null; phone: string | null } | null;
  isNew: boolean;
}

export const SUPPLIER_CATEGORY: Record<string, string> = {
  security: "Seguridad",
  cleaning: "Limpieza",
  maintenance: "Mantenimiento",
  gardening: "Jardinería",
  elevators: "Ascensores",
  pools: "Piscinas",
  plumbing: "Fontanería",
  electrical: "Electricidad",
  pest_control: "Fumigación",
  administration: "Administración",
  other: "Otros"
};

/** "2026-11-14" → "14/11/2026" */
export const fmtDay = (d: string | null | undefined) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : "—");
