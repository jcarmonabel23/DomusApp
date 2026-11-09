/**
 * @project DomusApp - Mobile
 * @file src/lib/notifications.ts
 * @description Notificaciones del sistema: canales, permiso, token push y avisos locales
 *
 * - Push remoto: requiere un build propio (EAS). En Expo Go no hay token y se sigue sin push: la app
 *   recibe todo por el socket mientras está abierta y por la campana al volver.
 * - Con la app abierta, cada aviso del socket se muestra como notificación local (banner + sonido).
 * - Tocar una notificación abre la pantalla que corresponde.
 */

import Constants, { ExecutionEnvironment } from "expo-constants";
import * as Notifications from "expo-notifications";
import { router } from "expo-router";
import { Platform } from "react-native";
import { api } from "./api";
import { sessionStore } from "./session";

export interface AppNotification {
  id: string;
  kind: "alert" | "alert_update" | "visit" | "visit_update" | "message" | "announcement" | "payment" | "charge";
  title: string;
  body: string | null;
  data: { alertId?: string; unitId?: string; announcementId?: string; logId?: string; paymentId?: string };
  readAt: string | null;
  createdAt: string;
}

let pushToken: string | null = null;

/** En Expo Go el archivo de la sirena no está empaquetado como sonido de notificación: se usa el del sistema */
const IN_EXPO_GO = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
const ALERT_SOUND = IN_EXPO_GO ? "default" : "alarm.wav";
/** Los canales de Android no cambian de sonido después de creados: el id lleva el sonido */
const ALERT_CHANNEL = IN_EXPO_GO ? "alerts" : "alerts-siren";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false
  })
});

/** Canales de Android: las alertas suenan aunque el teléfono esté en "no molestar" (si el sistema lo permite) */
async function ensureChannels() {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync(ALERT_CHANNEL, {
    name: "Alertas de pánico",
    importance: Notifications.AndroidImportance.MAX,
    sound: ALERT_SOUND,
    vibrationPattern: [0, 600, 300, 600, 300, 600],
    bypassDnd: true,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC
  });
  await Notifications.setNotificationChannelAsync("default", {
    name: "Avisos",
    importance: Notifications.AndroidImportance.HIGH
  });
}

/** Pide permiso y registra el token push en la API (si el entorno lo permite). Nunca lanza. */
export async function setupNotifications(): Promise<void> {
  try {
    await ensureChannels();
    const perm = await Notifications.getPermissionsAsync();
    const granted = perm.granted || (await Notifications.requestPermissionsAsync()).granted;
    if (!granted) return;
    const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    if (!projectId) return; // Expo Go / sin EAS: sin push remoto
    pushToken = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
    await api("/notifications/push-token", { method: "POST", body: { token: pushToken, platform: Platform.OS } });
  } catch {
    // sin push: la campana y el socket siguen funcionando
  }
}

/** Banner local para un aviso que llegó por el socket con la app abierta */
export function presentLocal(n: AppNotification): void {
  void Notifications.scheduleNotificationAsync({
    content: {
      title: n.title,
      body: n.body ?? undefined,
      data: { kind: n.kind, ...n.data },
      sound: n.kind === "alert" ? ALERT_SOUND : "default",
      ...(Platform.OS === "android" ? { channelId: n.kind === "alert" ? ALERT_CHANNEL : "default" } : {})
    },
    trigger: null
  }).catch(() => undefined);
}

/** Abre la pantalla de un aviso (campana o notificación del sistema) */
export function openNotification(kind: string, data: AppNotification["data"]): void {
  const guard = sessionStore.get().session?.condominium?.role === "guard";
  if (kind === "alert" || kind === "alert_update") router.push(guard ? "/alerts" : "/");
  else if (kind === "message" && data.unitId) router.push({ pathname: "/chat", params: { unitId: data.unitId } });
  else if (kind === "announcement") router.push("/announcements");
  else if ((kind === "payment" || kind === "charge") && !guard) router.push("/finance");
  else router.push("/");
}

/** Tocar una notificación del sistema (también la que abrió la app) */
export function listenNotificationTaps(): () => void {
  const sub = Notifications.addNotificationResponseReceivedListener((r) => {
    const data = r.notification.request.content.data as { kind?: string } & AppNotification["data"];
    if (data?.kind) openNotification(data.kind, data);
  });
  return () => sub.remove();
}
