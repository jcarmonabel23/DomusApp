/**
 * @project DomusApp - Admin
 * @file src/global/clients/realtime.ts
 * @description Conexión de tiempo real (Socket.IO en /api/socket.io, mismo origen que la API)
 *
 * - Una sola conexión por pestaña, abierta mientras hay sesión. Se autentica con el access token vigente
 *   y el condominio activo; al cambiar de condominio o de token se reconecta.
 * - Si el servidor la rechaza por token vencido, renueva la sesión y reintenta.
 * - useRealtime(evento, fn) suscribe un componente mientras está montado.
 */

import { useEffect, useRef } from "react";
import { io, type Socket } from "socket.io-client";
import { coreAuth } from "@auth/store/coreAuth";
import { refreshSession, validToken } from "./apiClient";

let socket: Socket | null = null;
let condominiumId: string | null = null;

/** Oyentes por evento: sobreviven a reconexiones y a sockets nuevos */
const listeners = new Map<string, Set<(data: unknown) => void>>();

function connect(condo: string) {
  socket?.disconnect();
  condominiumId = condo;
  socket = io({
    path: "/api/socket.io",
    transports: ["websocket"],
    reconnectionDelay: 2_000,
    reconnectionDelayMax: 15_000,
    // Se evalúa en cada (re)conexión: siempre con el token vigente
    auth: (cb) => {
      validToken()
        .then((token) => cb({ token, condominiumId: condo }))
        .catch(() => cb({ token: null, condominiumId: condo }));
    }
  });
  socket.onAny((event: string, data: unknown) => {
    for (const fn of listeners.get(event) ?? []) fn(data);
  });
  socket.on("connect_error", (err: Error & { data?: { code?: string } }) => {
    const code = err.data?.code ?? err.message;
    if (code === "TOKEN_INVALID" || code === "TOKEN_MISSING") {
      refreshSession()
        .then(() => socket?.connect())
        .catch(() => undefined);
    }
  });
  socket.on("session:ended", () => {
    // La API decidirá en la próxima llamada (cierre por inactividad o revocación)
    socket?.disconnect();
  });
}

function disconnect() {
  socket?.disconnect();
  socket = null;
  condominiumId = null;
}

/** Abre/cierra la conexión siguiendo la sesión (se llama una vez al cargar la app) */
export function startRealtime(): () => void {
  const sync = () => {
    const { isAuthenticated, condominium } = coreAuth.getState();
    if (!isAuthenticated || !condominium) return disconnect();
    if (condominium.id !== condominiumId) connect(condominium.id);
  };
  sync();
  return coreAuth.subscribe(sync);
}

/** Suscribe `handler` al evento mientras el componente está montado */
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
