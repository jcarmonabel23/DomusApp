/**
 * @project DomusApp - Mobile
 * @file src/lib/guardAlerts.ts
 * @description Alertas de la caseta: un solo estado compartido por la alarma a pantalla completa y la pestaña
 *              Alertas. Se llena con la API y se mantiene al día con el socket (y un sondeo de respaldo).
 */

import { useSyncExternalStore } from "react";
import { api, ApiError } from "./api";
import type { AlertItem } from "./alerts";

interface State {
  open: AlertItem[];
  recent: AlertItem[];
  loaded: boolean;
  error: string | null;
}

let state: State = { open: [], recent: [], loaded: false, error: null };
const listeners = new Set<() => void>();

function set(patch: Partial<State>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export async function loadGuardAlerts(): Promise<void> {
  try {
    const r = await api<{ open: AlertItem[]; recent: AlertItem[] }>("/guard/alerts");
    set({ open: r.open, recent: r.recent, loaded: true, error: null });
  } catch (err) {
    set({ error: err instanceof ApiError ? err.message : "No se pudieron cargar las alertas" });
  }
}

/** Aplica un evento del socket sin esperar a la API */
export function applyAlert(a: AlertItem): void {
  if (a.status === "attended") {
    set({ open: state.open.filter((x) => x.id !== a.id), recent: [a, ...state.recent.filter((x) => x.id !== a.id)].slice(0, 30) });
  } else {
    const exists = state.open.some((x) => x.id === a.id);
    set({ open: exists ? state.open.map((x) => (x.id === a.id ? a : x)) : [...state.open, a] });
  }
}

export async function ackAlert(id: string): Promise<void> {
  applyAlert(await api<AlertItem>(`/guard/alerts/${id}/ack`, { method: "POST", body: {} }));
}

export async function attendAlert(id: string, resolution: string): Promise<void> {
  applyAlert(await api<AlertItem>(`/guard/alerts/${id}/attend`, { method: "POST", body: { resolution } }));
}

export function useGuardAlerts(): State {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state
  );
}
