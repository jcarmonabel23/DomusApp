/**
 * @project DomusApp - Admin
 * @file src/app/assemblies/shared.ts
 * @description Asambleas y acuerdos: tipos y etiquetas
 */

import type { FileRef } from "@/app/suppliers/shared";

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
  supplierId: string | null;
  supplierName: string | null;
  dueOn: string | null;
  status: "pending" | "in_progress" | "done" | "cancelled";
  progressNotes: string | null;
  completedAt: string | null;
  overdue: boolean;
}

export type AssemblyDetail = Omit<Assembly, "agreements"> & { agreements: Agreement[] };

export const KIND: Record<Assembly["kind"], string> = { ordinary: "Ordinaria", extraordinary: "Extraordinaria" };

export const ASSEMBLY_STATUS: Record<Assembly["status"], { label: string; color: string }> = {
  scheduled: { label: "Convocada", color: "blue" },
  held: { label: "Celebrada", color: "teal" },
  cancelled: { label: "Cancelada", color: "gray" }
};

export const AGREEMENT_STATUS: Record<Agreement["status"], { label: string; color: string }> = {
  pending: { label: "Pendiente", color: "yellow" },
  in_progress: { label: "En proceso", color: "blue" },
  done: { label: "Cumplido", color: "teal" },
  cancelled: { label: "Anulado", color: "gray" }
};
