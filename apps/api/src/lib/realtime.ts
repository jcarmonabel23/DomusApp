/**
 * @project DomusApp - API
 * @file src/lib/realtime.ts
 * @description Tiempo real con Socket.IO (ruta /api/socket.io, detrás del mismo proxy que la API)
 *
 * - El cliente se conecta con { auth: { token, condominiumId } }: se valida igual que una petición HTTP
 *   (resolveAuth: sesión viva, usuario activo, condominio elegible).
 * - Salas: user:<id> · staff:<condominio> (guardas y administradores) · unit:<condominio>:<filial>
 *   (cuentas vinculadas a la filial).
 * - Cada minuto se revisa que la sesión siga viva y en el mismo condominio; si no, se desconecta
 *   (el cliente reconecta con el token nuevo).
 * - El servidor solo EMITE avisos; toda escritura pasa por la API REST (con su validación y auditoría).
 */

import type { Server as HttpServer } from "node:http";
import { Server, type Socket } from "socket.io";
import { config } from "../config.js";
import { one, runInCondominium } from "../db.js";
import { residentUnitIds } from "../modules/access/shared.js";
import { resolveAuth } from "../security/authenticate.js";
import type { AuthContext } from "../security/context.js";
import { logger } from "./logger.js";

let io: Server | null = null;

const rooms = {
  user: (userId: string) => `user:${userId}`,
  staff: (condominiumId: string) => `staff:${condominiumId}`,
  unit: (condominiumId: string, unitId: string) => `unit:${condominiumId}:${unitId}`
};

export const isStaff = (role: AuthContext["role"]): boolean => role === "guard" || role === "admin";

async function stillValid(auth: AuthContext): Promise<boolean> {
  const row = await one(
    `SELECT 1 FROM users_sessions s JOIN users u ON u.id = s.user_id AND u.is_active
      WHERE s.id = $1 AND s.revoked_at IS NULL AND s.expires_at > NOW()
        AND s.condominium_id IS NOT DISTINCT FROM $2::uuid
        AND NOT (s.client = 'web' AND s.last_used_at < NOW() - make_interval(mins => $3))`,
    [auth.sessionId, auth.condominiumId, config.SESSION_IDLE_MINUTES]
  );
  return Boolean(row);
}

export function initRealtime(server: HttpServer): Server {
  io = new Server(server, {
    path: "/api/socket.io",
    serveClient: false,
    // El proxy del panel publica todo bajo un solo origen; la app móvil no envía Origin
    cors: { origin: false },
    pingInterval: 20_000,
    pingTimeout: 20_000,
    maxHttpBufferSize: 10_000
  });

  io.use(async (socket, next) => {
    try {
      const { token, condominiumId } = (socket.handshake.auth ?? {}) as { token?: string; condominiumId?: string };
      if (!token) return next(Object.assign(new Error("TOKEN_MISSING"), { data: { code: "TOKEN_MISSING" } }));
      const auth = await resolveAuth(token, condominiumId ?? null, false);
      if (!auth.condominiumId || auth.mustChangePassword) {
        return next(Object.assign(new Error("FORBIDDEN"), { data: { code: "FORBIDDEN" } }));
      }
      socket.data.auth = auth;
      next();
    } catch (err) {
      const code = (err as { code?: string }).code ?? "UNAUTHORIZED";
      next(Object.assign(new Error(code), { data: { code } }));
    }
  });

  io.on("connection", (socket: Socket) => {
    const auth = socket.data.auth as AuthContext;
    const condominiumId = auth.condominiumId!;
    void (async () => {
      try {
        await socket.join(rooms.user(auth.userId));
        if (isStaff(auth.role)) await socket.join(rooms.staff(condominiumId));
        if (auth.role !== "guard") {
          const units = await runInCondominium(condominiumId, () => residentUnitIds(auth.userId));
          await Promise.all(units.map((u) => socket.join(rooms.unit(condominiumId, u))));
        }
        socket.emit("ready", { role: auth.role, condominiumId });
      } catch (err) {
        logger.error({ err }, "[realtime] no se pudo preparar la conexión");
        socket.disconnect(true);
      }
    })();

    const check = setInterval(() => {
      stillValid(auth)
        .then((ok) => {
          if (!ok) {
            socket.emit("session:ended");
            socket.disconnect(true);
          }
        })
        .catch(() => undefined);
    }, 60_000);
    socket.on("disconnect", () => clearInterval(check));
  });

  logger.info("[realtime] Socket.IO listo en /api/socket.io");
  return io;
}

export const emitToUser = (userId: string, event: string, data: unknown) => io?.to(rooms.user(userId)).emit(event, data);
export const emitToStaff = (condominiumId: string, event: string, data: unknown) => io?.to(rooms.staff(condominiumId)).emit(event, data);
export const emitToUnit = (condominiumId: string, unitId: string, event: string, data: unknown) =>
  io?.to(rooms.unit(condominiumId, unitId)).emit(event, data);

/** Cierra los sockets (apagado ordenado) */
export function closeRealtime(): Promise<void> {
  return new Promise((resolve) => (io ? io.close(() => resolve()) : resolve()));
}
