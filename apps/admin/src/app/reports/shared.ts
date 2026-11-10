/**
 * @project DomusApp - Admin
 * @file src/app/reports/shared.ts
 * @description Reportes: tipos de la respuesta de /reports/indicators, períodos rápidos y formato de duraciones
 */

import dayjs from "dayjs";

type Series<K extends string> = ({ period: string } & Record<K, number>)[];

export interface Indicators {
  from: string;
  to: string;
  days: number;
  bucket: "day" | "month";
  generatedAt: string;
  currency: { code: string; symbol: string; decimals: number };
  sections: string[];
  finance: {
    billed: number;
    collected: number;
    payments: number;
    expenses: number;
    net: number;
    collectionRate: number | null;
    byPeriod: Series<"billed" | "collected" | "expenses">;
    byMethod: { method: string; label: string; amount: number; count: number }[];
    expensesByCategory: { category: string; label: string; amount: number }[];
  } | null;
  delinquency: {
    asOf: string;
    units: number;
    delinquent: number;
    delinquencyRate: number;
    receivable: number;
    overdue: number;
    credit: number;
    aging: { key: string; label: string; units: number; amount: number }[];
    topDebtors: { unitId: string; unit: string; overdue: number; open: number; oldestDue: string | null; days: number }[];
  } | null;
  access: {
    entries: number;
    visitors: number;
    vehicles: number;
    unannounced: number;
    denied: number;
    insideNow: number;
    avgStayMinutes: number | null;
    peakHour: number | null;
    byPeriod: Series<"entries">;
    byKind: { kind: string; label: string; count: number }[];
    byHour: { hour: number; count: number }[];
    byWeekday: { day: number; label: string; count: number }[];
    topUnits: { unit: string; count: number }[];
  } | null;
  alerts: {
    total: number;
    attended: number;
    open: number;
    avgAckSeconds: number | null;
    medianAckSeconds: number | null;
    maxAckSeconds: number | null;
    avgAttendSeconds: number | null;
    ackWithin5: number | null;
    byPeriod: Series<"count" | "avgAckSeconds">;
    byKind: { kind: string; label: string; count: number; avgAckSeconds: number | null }[];
  } | null;
  cases: {
    opened: number;
    resolved: number;
    openNow: number;
    overdueNow: number;
    avgResolutionHours: number | null;
    avgRating: number | null;
    ratings: number;
    byPeriod: Series<"opened" | "resolved">;
    byCategory: { category: string; label: string; count: number; open: number }[];
    byStatus: { status: string; label: string; count: number }[];
  } | null;
  bookings: {
    approved: number;
    pending: number;
    cancelled: number;
    rejected: number;
    hours: number;
    revenue: number;
    byAmenity: { name: string; approved: number; hours: number; revenue: number; cancelled: number }[];
  } | null;
}

export type PresetKey = "month" | "3m" | "6m" | "12m" | "year" | "custom";

const f = (d: dayjs.Dayjs) => d.format("YYYY-MM-DD");

/** Períodos rápidos (hasta hoy, según el reloj del navegador) */
export const PRESETS: { key: Exclude<PresetKey, "custom">; label: string; range: () => { from: string; to: string } }[] = [
  { key: "month", label: "Este mes", range: () => ({ from: f(dayjs().startOf("month")), to: f(dayjs()) }) },
  { key: "3m", label: "3 meses", range: () => ({ from: f(dayjs().subtract(2, "month").startOf("month")), to: f(dayjs()) }) },
  { key: "6m", label: "6 meses", range: () => ({ from: f(dayjs().subtract(5, "month").startOf("month")), to: f(dayjs()) }) },
  { key: "12m", label: "12 meses", range: () => ({ from: f(dayjs().subtract(11, "month").startOf("month")), to: f(dayjs()) }) },
  { key: "year", label: "Este año", range: () => ({ from: f(dayjs().startOf("year")), to: f(dayjs()) }) }
];

/** Colores de Mantine para series sin significado propio (repartos) */
export const PALETTE = ["domus.6", "teal.6", "orange.5", "grape.5", "yellow.6", "cyan.6", "pink.5", "gray.6"];

/** 754 → "12 min 34 s" · 7300 → "2 h 2 min" · 200000 → "2 d 7 h" */
export function duration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return "—";
  const s = Math.round(seconds);
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min${s % 60 ? ` ${s % 60} s` : ""}`;
  if (s < 172_800) {
    const h = Math.floor(s / 3600);
    const m = Math.round((s % 3600) / 60);
    return `${h} h${m ? ` ${m} min` : ""}`;
  }
  const d = Math.floor(s / 86_400);
  const h = Math.round((s % 86_400) / 3600);
  return `${d} d${h ? ` ${h} h` : ""}`;
}
