/**
 * @project DomusApp - Mobile
 * @file src/lib/finance.ts
 * @description Tipos y formatos de Finanzas (estado de cuenta, pagos manuales y en línea)
 */

import { useCallback } from "react";
import { useSession } from "./session";

export interface Currency {
  code: string;
  symbol: string;
  decimals: number;
}

export interface UnitBalance {
  unitId: string;
  unitCode: string;
  unitTower: string | null;
  charged: number;
  paid: number;
  /** Positivo = debe; negativo = saldo a favor */
  balance: number;
  open: number;
  overdue: number;
  overdueCapital: number;
  oldestDue: string | null;
  /** Pagos reportados aún en revisión */
  pending: number;
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
}

export interface FinanceHome {
  units: UnitBalance[];
  bankAccounts: BankAccount[];
  onlinePayments: boolean;
  currency: Currency;
  graceDays: number;
  dueDay: number;
}

export interface Movement {
  id: string;
  type: "charge" | "payment";
  date: string;
  dueDate: string | null;
  kind: string;
  concept: string;
  debit: number;
  credit: number;
  balance: number;
  status: string | null;
  open: number | null;
}

export interface Payment {
  id: string;
  unitId: string;
  unitCode: string;
  method: "online" | "transfer" | "deposit" | "cash" | "other";
  amount: number;
  paidOn: string;
  reference: string | null;
  bankName: string | null;
  notes: string | null;
  status: "pending" | "approved" | "rejected";
  reviewNotes: string | null;
  cardBrand: string | null;
  cardLast4: string | null;
  createdAt: string;
  receipt: { preview: string; full: string } | null;
}

export interface Statement {
  balance: UnitBalance;
  /** Más recientes primero */
  rows: Movement[];
  /** Pagos en revisión o rechazados (no suman al saldo) */
  payments: Payment[];
}

export const METHOD_LABEL: Record<string, string> = {
  online: "En línea",
  transfer: "Transferencia",
  deposit: "Depósito",
  cash: "Efectivo",
  other: "Otro"
};

export const CHARGE_LABEL: Record<string, string> = {
  ordinary: "Cuota",
  extraordinary: "Extraordinaria",
  interest: "Interés",
  fine: "Multa",
  special: "Cargo especial"
};

/** Monto con el símbolo y los decimales de la moneda del condominio: ₡85,000.00 */
export function formatMoney(amount: number, c: Pick<Currency, "symbol" | "decimals">): string {
  const sign = amount < 0 ? "-" : "";
  const [int, dec] = Math.abs(amount).toFixed(c.decimals).split(".");
  return `${sign}${c.symbol}${int.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${dec ? `.${dec}` : ""}`;
}

/** Formateador con la moneda de la sesión */
export function useMoney(): (n: number) => string {
  const currency = useSession((s) => s.session?.condominium?.currency);
  return useCallback((n: number) => formatMoney(n, currency ?? { symbol: "", decimals: 2 }), [currency]);
}

const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/** "2026-11-10" → "10 nov 2026" */
export const fmtDate = (iso: string | null | undefined): string => {
  if (!iso) return "";
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
};

/** Texto escrito por el usuario → número ("85 000,50" o "85,000.50") */
export function parseAmount(text: string): number {
  const clean = text.replace(/[^\d.,]/g, "");
  const lastSep = Math.max(clean.lastIndexOf(","), clean.lastIndexOf("."));
  // Un separador con 1-2 dígitos al final es decimal; el resto son miles
  if (lastSep >= 0 && clean.length - lastSep - 1 <= 2) {
    return Number(`${clean.slice(0, lastSep).replace(/[.,]/g, "")}.${clean.slice(lastSep + 1)}`) || 0;
  }
  return Number(clean.replace(/[.,]/g, "")) || 0;
}
