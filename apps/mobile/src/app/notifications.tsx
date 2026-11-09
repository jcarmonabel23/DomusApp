/**
 * @project DomusApp - Mobile
 * @file src/app/notifications.tsx
 * @description Bandeja de la campana: avisos de alertas, visitas, mensajes y comunicados
 */

import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useCallback, useEffect, useState, type ComponentProps } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { EmptyState, ScreenHeader } from "@/components/access";
import { Notice } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { fmtDateTime } from "@/lib/access";
import { openNotification, type AppNotification } from "@/lib/notifications";
import { setUnread, useRealtime } from "@/lib/realtime";
import { colors, radius } from "@/theme/colors";

const ICON: Record<AppNotification["kind"], { icon: ComponentProps<typeof MaterialIcons>["name"]; color: string }> = {
  alert: { icon: "notifications-active", color: colors.danger },
  alert_update: { icon: "health-and-safety", color: colors.warning },
  visit: { icon: "doorbell", color: colors.primary },
  visit_update: { icon: "how-to-reg", color: colors.primary },
  message: { icon: "chat", color: colors.success },
  announcement: { icon: "campaign", color: "#7c3aed" },
  payment: { icon: "payments", color: "#13795b" },
  charge: { icon: "receipt-long", color: colors.warning }
};

export default function NotificationsScreen() {
  const [rows, setRows] = useState<AppNotification[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api<{ rows: AppNotification[]; unread: number }>("/notifications?limit=50");
      setRows(r.rows);
      setUnread(r.unread);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo cargar");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useRealtime<{ notification: AppNotification }>("notification", ({ notification }) => setRows((r) => [notification, ...(r ?? [])]));

  const open = async (n: AppNotification) => {
    if (!n.readAt) {
      setRows((r) => r?.map((x) => (x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x)) ?? null);
      api<{ unread: number }>(`/notifications/${n.id}/read`, { method: "POST", body: {} })
        .then((r) => setUnread(r.unread))
        .catch(() => undefined);
    }
    openNotification(n.kind, n.data);
  };

  const readAll = async () => {
    await api("/notifications/read-all", { method: "POST", body: {} }).catch(() => undefined);
    setUnread(0);
    setRows((r) => r?.map((x) => ({ ...x, readAt: x.readAt ?? new Date().toISOString() })) ?? null);
  };

  const anyUnread = rows?.some((n) => !n.readAt);

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <ScreenHeader
        title="Notificaciones"
        right={
          anyUnread ? (
            <Pressable onPress={readAll} hitSlop={10} accessibilityRole="button" accessibilityLabel="Marcar todo como leído">
              <MaterialIcons name="done-all" size={26} color={colors.onPrimary} />
            </Pressable>
          ) : undefined
        }
      />
      {error && (
        <View style={{ padding: 12 }}>
          <Notice text={error} />
        </View>
      )}
      <FlatList
        data={rows ?? []}
        keyExtractor={(n) => n.id}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
        contentContainerStyle={{ padding: 12, gap: 8, paddingBottom: 32 }}
        renderItem={({ item: n }) => {
          const meta = ICON[n.kind] ?? ICON.message;
          return (
            <Pressable onPress={() => open(n)} style={[styles.row, !n.readAt && styles.unread]} accessibilityRole="button">
              <View style={[styles.icon, { backgroundColor: `${meta.color}1a` }]}>
                <MaterialIcons name={meta.icon} size={24} color={meta.color} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.title, !n.readAt && { fontWeight: "700" }]}>{n.title}</Text>
                {n.body && (
                  <Text style={styles.body} numberOfLines={3}>
                    {n.body}
                  </Text>
                )}
                <Text style={styles.time}>{fmtDateTime(n.createdAt)}</Text>
              </View>
              {!n.readAt && <View style={styles.dot} />}
            </Pressable>
          );
        }}
        ListEmptyComponent={rows && !error ? <EmptyState icon="notifications-none" accent="check" title="Sin notificaciones" text="Aquí llegan alertas, visitas, mensajes de la caseta y comunicados." /> : undefined}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: 12, alignItems: "flex-start", backgroundColor: colors.background, borderRadius: radius.md, padding: 14 },
  unread: { backgroundColor: colors.primarySoft },
  icon: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 15, color: colors.text, fontWeight: "500" },
  body: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
  time: { fontSize: 12, color: colors.textMuted, marginTop: 4 },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary, marginTop: 6 }
});
