/**
 * @project DomusApp - Admin
 * @file src/app/finance/shared.ts
 * @description Finanzas: etiquetas, tipos y formato de montos en la moneda del condominio activo
 */

import { useCallback } from "react";
import { coreAuth } from "@/app/auth/store/coreAuth";
import { fmtMoney } from "@utils/format";

export const CHARGE_LABEL: Record<string, string> = {
  ordinary: "Cuota ordinaria",
  extraordinary: "Cuota extraordinaria",
  interest: "Interés moratorio",
  fine: "Multa",
  special: "Cargo especial"
};

export const CHARGE_COLOR: Record<string, string> = {
  ordinary: "blue",
  extraordinary: "violet",
  interest: "orange",
  fine: "red",
  special: "grape"
};

export const METHOD_LABEL: Record<string, string> = {
  online: "En línea",
  transfer: "Transferencia",
  deposit: "Depósito",
  cash: "Efectivo",
  other: "Otro"
};

export const PAYMENT_STATUS: Record<string, { label: string; color: string }> = {
  pending: { label: "En revisión", color: "yellow" },
  approved: { label: "Aprobado", color: "teal" },
  rejected: { label: "Rechazado", color: "red" }
};

export const EXPENSE_LABEL: Record<string, string> = {
  maintenance: "Mantenimiento",
  security: "Seguridad",
  cleaning: "Limpieza",
  utilities: "Servicios públicos",
  administration: "Administración",
  insurance: "Seguros",
  repairs: "Reparaciones",
  gardening: "Jardinería",
  other: "Otros"
};

export const PLAN_MODE_LABEL: Record<string, string> = {
  fixed: "Monto fijo por filial",
  aliquot: "Total repartido por alícuota",
  area: "Total repartido por m²"
};

export interface Receipt {
  preview: string;
  full: string;
}

export interface Balance {
  unitId: string;
  unitCode: string;
  unitTower: string | null;
  charged: number;
  paid: number;
  balance: number;
  open: number;
  overdue: number;
  overdueCapital: number;
  oldestDue: string | null;
  pending: number;
  payer?: { names: string; phone: string | null; email: string | null } | null;
}

export interface Payment {
  id: string;
  unitId: string;
  unitCode: string;
  method: string;
  amount: number;
  paidOn: string;
  reference: string | null;
  bankName: string | null;
  notes: string | null;
  status: "pending" | "approved" | "rejected";
  reviewNotes: string | null;
  reviewedAt: string | null;
  reviewedByName: string | null;
  submittedByName: string | null;
  cardBrand: string | null;
  cardLast4: string | null;
  createdAt: string;
  receipt: Receipt | null;
}

export interface BankAccount {
  id: string;
  bank: string;
  holder: string;
  number: string;
  iban: string | null;
  kind: "checking" | "savings";
  currencyCode: string;
  notes: string | null;
  isActive: boolean;
}

/** Formateador de montos con el símbolo y los decimales de la moneda del condominio activo */
export function useMoney(): (v: number | null | undefined) => string {
  const symbol = coreAuth((s) => s.condominium?.currency.symbol ?? "");
  const decimals = coreAuth((s) => s.condominium?.currency.decimals ?? 2);
  return useCallback((v) => (v === null || v === undefined ? "—" : `${symbol}${fmtMoney(v, decimals)}`), [symbol, decimals]);
}

export function useCurrency() {
  return coreAuth((s) => s.condominium?.currency) ?? { code: "USD", symbol: "$", decimals: 2 };
}

/** "2026-11-01" → "noviembre 2026" */
export const periodLabel = (p: string | null | undefined) =>
  p ? new Intl.DateTimeFormat("es", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${p.slice(0, 10)}T12:00:00Z`)) : "—";

/** "2026-11-09" → "09/11/2026" */
export const fmtDay = (d: string | null | undefined) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : "—");

export const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** Últimos 12 meses y los próximos 6, para elegir períodos */
export function periodOptions(back = 12, forward = 6) {
  const now = new Date();
  const out: { value: string; label: string }[] = [];
  for (let i = forward; i >= -back; i--) {
    const d = new Date(Date.UTC(now.getFullYear(), now.getMonth() + i, 1));
    const value = d.toISOString().slice(0, 10);
    out.push({ value, label: periodLabel(value) });
  }
  return out;
}
