/**
 * @project DomusApp - Mobile
 * @file src/app/my-bookings.tsx
 * @description Mis reservas: próximas (con cancelación) e historial de las filiales de la cuenta
 */

import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Alert, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { EmptyState, ScreenHeader } from "@/components/access";
import { Notice } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { unitLabel } from "@/lib/access";
import { STATUS, amenityIcon, dayText, type Booking } from "@/lib/bookings";
import { useMoney } from "@/lib/finance";
import { useRealtime } from "@/lib/realtime";
import { useBrand } from "@/theme/brand";
import { colors, radius } from "@/theme/colors";

type Scope = "upcoming" | "past";

export default function MyBookingsScreen() {
  const brand = useBrand();
  const money = useMoney();
  const [scope, setScope] = useState<Scope>("upcoming");
  const [rows, setRows] = useState<Booking[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (s: Scope) => {
    setLoading(true);
    setError(null);
    try {
      setRows(await api<Booking[]>(`/resident/bookings/mine?scope=${s}`));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudieron cargar las reservas");
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load(scope);
    }, [load, scope])
  );
  useRealtime("bookings:update", () => void load(scope));

  const cancel = (b: Booking) => {
    const hoursLeft = (new Date(b.startsAt).getTime() - Date.now()) / 3_600_000;
    const charged = b.chargeId && !b.chargeVoided;
    const note = charged
      ? hoursLeft >= b.cancelHours
        ? `Se anulará el cargo de ${money(b.cost)}.`
        : `Faltan menos de ${b.cancelHours} h: el cargo de ${money(b.cost)} se mantiene.`
      : "";
    Alert.alert("Cancelar reserva", `${b.amenityName}, ${dayText(b.date)} ${b.timeFrom}–${b.timeTo}. ${note}`.trim(), [
      { text: "No", style: "cancel" },
      {
        text: "Cancelar reserva",
        style: "destructive",
        onPress: async () => {
          try {
            const r = await api<Booking & { refunded: boolean; chargeKept: boolean }>(`/resident/bookings/${b.id}/cancel`, { method: "POST", body: {} });
            if (r.chargeKept) Alert.alert("Reserva cancelada", "El cargo se mantiene porque se canceló con poca anticipación.");
            void load(scope);
          } catch (err) {
            Alert.alert("No se pudo cancelar", err instanceof ApiError ? err.message : "Intente de nuevo");
          }
        }
      }
    ]);
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <ScreenHeader title="Mis reservas" />
      <View style={[styles.tabs, { backgroundColor: brand.primary }]} accessibilityRole="tablist">
        {(["upcoming", "past"] as const).map((s) => (
          <Pressable
            key={s}
            onPress={() => setScope(s)}
            accessibilityRole="tab"
            accessibilityState={{ selected: scope === s }}
            style={[styles.tab, scope === s && styles.tabActive]}
          >
            <Text style={[styles.tabText, scope === s && styles.tabTextActive]}>{s === "upcoming" ? "Próximas" : "Historial"}</Text>
          </Pressable>
        ))}
      </View>
      <FlatList
        data={rows ?? []}
        keyExtractor={(b) => b.id}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={() => load(scope)} />}
        ListHeaderComponent={error ? <Notice text={error} /> : undefined}
        ListEmptyComponent={
          rows && !error ? (
            <EmptyState
              icon="event-available"
              accent={scope === "upcoming" ? "add" : "history"}
              title={scope === "upcoming" ? "No tiene reservas próximas" : "Sin reservas anteriores"}
              text={scope === "upcoming" ? "Reserve la piscina, el rancho o el salón desde la pestaña Reservaciones." : undefined}
              action={scope === "upcoming" ? { label: "Reservar un área", onPress: () => router.back() } : undefined}
            />
          ) : undefined
        }
        renderItem={({ item: b }) => {
          const meta = amenityIcon(b.amenityIcon);
          const st = STATUS[b.status];
          const canCancel = scope === "upcoming" && !b.started && (b.status === "pending" || b.status === "approved");
          return (
            <View style={styles.card}>
              <View style={[styles.icon, { backgroundColor: meta.bg }]}>
                <MaterialIcons name={meta.icon} size={28} color={meta.fg} />
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={styles.name}>{b.amenityName}</Text>
                <Text style={styles.when}>
                  {dayText(b.date)} · {b.timeFrom}–{b.timeTo}
                </Text>
                <Text style={styles.meta}>
                  {b.guests} persona(s) · {unitLabel(b)}
                  {b.cost > 0 ? ` · ${money(b.cost)}${b.chargeVoided ? " (anulado)" : ""}` : ""}
                </Text>
                {(b.reviewNotes ?? b.cancelReason) && (
                  <Text style={styles.meta} numberOfLines={2}>
                    {b.status === "cancelled" ? `Cancelada: ${b.cancelReason}` : b.reviewNotes}
                  </Text>
                )}
                <View style={styles.row}>
                  <View style={[styles.badge, { backgroundColor: st.bg }]}>
                    <Text style={[styles.badgeText, { color: st.fg }]}>{st.label}</Text>
                  </View>
                  {canCancel && (
                    <Pressable onPress={() => cancel(b)} accessibilityRole="button" accessibilityLabel={`Cancelar reserva de ${b.amenityName}`} hitSlop={8} style={styles.cancel}>
                      <Text style={styles.cancelText}>Cancelar</Text>
                    </Pressable>
                  )}
                </View>
              </View>
            </View>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  tabs: { flexDirection: "row" },
  tab: { flex: 1, alignItems: "center", paddingVertical: 14, borderBottomWidth: 3, borderBottomColor: "transparent" },
  tabActive: { borderBottomColor: colors.onPrimary },
  tabText: { fontSize: 16, color: "rgba(255,255,255,0.75)" },
  tabTextActive: { color: colors.onPrimary, fontWeight: "700" },
  content: { padding: 16, gap: 12, paddingBottom: 40 },
  card: { flexDirection: "row", gap: 12, backgroundColor: colors.background, borderRadius: radius.md, padding: 14 },
  icon: { width: 52, height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center" },
  name: { fontSize: 16, fontWeight: "700", color: colors.text },
  when: { fontSize: 15, color: colors.text, textTransform: "capitalize" },
  meta: { fontSize: 13, color: colors.textMuted },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 6 },
  badge: { borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 3 },
  badgeText: { fontSize: 12, fontWeight: "700" },
  cancel: { minHeight: 32, justifyContent: "center", paddingHorizontal: 6 },
  cancelText: { color: colors.danger, fontWeight: "700", fontSize: 14 }
});
