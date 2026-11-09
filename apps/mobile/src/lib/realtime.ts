/**
 * @project DomusApp - Mobile
 * @file src/lib/realtime.ts
 * @description Tiempo real (Socket.IO en API_URL/api/socket.io) y contador de la campana
 *
 * - Una conexión mientras hay sesión; se autentica con el access token vigente y el condominio activo.
 *   Si cambia el condominio se reconecta; si la API rechaza el token, se renueva y reintenta.
 * - useRealtime(evento, fn) suscribe un componente mientras está montado.
 * - El contador de no leídos vive aquí (useUnread) y lo actualiza cada evento "notification".
 */

import { useEffect, useRef, useSyncExternalStore } from "react";
import { AppState } from "react-native";
import { io, type Socket } from "socket.io-client";
import { api, refreshSession, validToken } from "./api";
import { API_URL } from "./config";
import { sessionStore } from "./session";

let socket: Socket | null = null;
let condominiumId: string | null = null;
const listeners = new Map<string, Set<(data: unknown) => void>>();

const emitLocal = (event: string, data: unknown) => {
  for (const fn of listeners.get(event) ?? []) fn(data);
};

function connect(condo: string) {
  socket?.disconnect();
  condominiumId = condo;
  socket = io(API_URL, {
    path: "/api/socket.io",
    transports: ["websocket"],
    reconnectionDelay: 2_000,
    reconnectionDelayMax: 20_000,
    auth: (cb) => {
      validToken()
        .then((token) => cb({ token, condominiumId: condo }))
        .catch(() => cb({ token: null, condominiumId: condo }));
    }
  });
  socket.onAny((event: string, data: unknown) => emitLocal(event, data));
  socket.on("connect", () => {
    emitLocal("connected", null);
    void refreshUnread();
  });
  socket.on("connect_error", (err: Error & { data?: { code?: string } }) => {
    const code = err.data?.code ?? err.message;
    if (code === "TOKEN_INVALID" || code === "TOKEN_MISSING") {
      refreshSession()
        .then(() => socket?.connect())
        .catch(() => undefined);
    }
  });
}

function disconnect() {
  socket?.disconnect();
  socket = null;
  condominiumId = null;
  setUnread(0);
}

/** Sigue la sesión: conecta al iniciar, reconecta al cambiar de condominio y cierra al salir */
export function startRealtime(): () => void {
  const sync = () => {
    const { status, session } = sessionStore.get();
    const condo = session?.condominium?.id ?? null;
    const ready = status === "authenticated" && condo && !session?.user.mustChangePassword;
    if (!ready) return disconnect();
    if (condo !== condominiumId) connect(condo);
  };
  sync();
  const unsub = sessionStore.subscribe(sync);
  // Al volver del segundo plano: reconecta si hizo falta y pone al día la campana
  const appState = AppState.addEventListener("change", (s) => {
    if (s !== "active" || !socket) return;
    if (!socket.connected) socket.connect();
    void refreshUnread();
    emitLocal("resumed", null);
  });
  return () => {
    unsub();
    appState.remove();
    disconnect();
  };
}

export function useRealtime<T = unknown>(event: string, handler: (data: T) => void): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const fn = (data: unknown) => ref.current(data as T);
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event)!.add(fn);
    return () => {
      listeners.get(event)?.delete(fn);
    };
  }, [event]);
}

// ------------------------------------------------------------------ Campana

let unread = 0;
const unreadListeners = new Set<() => void>();

export function setUnread(n: number) {
  unread = n;
  unreadListeners.forEach((l) => l());
}

export async function refreshUnread(): Promise<void> {
  try {
    setUnread((await api<{ unread: number }>("/notifications/unread")).unread);
  } catch {
    // sin conexión: se mantiene el último valor
  }
}

export function useUnread(): number {
  return useSyncExternalStore(
    (l) => {
      unreadListeners.add(l);
      return () => unreadListeners.delete(l);
    },
    () => unread
  );
}

// Cada aviso nuevo trae el contador actualizado
listeners.set("notification", new Set([(d) => setUnread((d as { unread: number }).unread)]));
