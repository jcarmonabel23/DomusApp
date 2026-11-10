/**
 * @project DomusApp - Mobile
 * @file src/app/cases.tsx
 * @description Casos: los que reportó la cuenta y los de sus filiales (activos e historial) y botón para reportar
 */

import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { EmptyState, Fab, ScreenHeader } from "@/components/access";
import { Notice } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { fmtDateTime, unitLabel } from "@/lib/access";
import { CASE_CATEGORY, CASE_STATUS, type CaseItem } from "@/lib/community";
import { useRealtime } from "@/lib/realtime";
import { useBrand } from "@/theme/brand";
import { colors, radius } from "@/theme/colors";

type Scope = "active" | "finished";

export default function CasesScreen() {
  const brand = useBrand();
  const [scope, setScope] = useState<Scope>("active");
  const [rows, setRows] = useState<CaseItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (s: Scope) => {
    setLoading(true);
    setError(null);
    try {
      setRows(await api<CaseItem[]>(`/resident/cases?scope=${s}`));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudieron cargar los casos");
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load(scope);
    }, [load, scope])
  );
  useRealtime("cases:update", () => void load(scope));

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <ScreenHeader title="Casos" />
      <View style={[styles.tabs, { backgroundColor: brand.primary }]} accessibilityRole="tablist">
        {(["active", "finished"] as const).map((s) => (
          <Pressable key={s} onPress={() => setScope(s)} accessibilityRole="tab" accessibilityState={{ selected: scope === s }} style={[styles.tab, scope === s && styles.tabActive]}>
            <Text style={[styles.tabText, scope === s && styles.tabTextActive]}>{s === "active" ? "En seguimiento" : "Historial"}</Text>
          </Pressable>
        ))}
      </View>
      <FlatList
        data={rows ?? []}
        keyExtractor={(c) => c.id}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={() => load(scope)} />}
        ListHeaderComponent={error ? <Notice text={error} /> : undefined}
        ListEmptyComponent={
          rows && !error ? (
            <EmptyState
              icon="support-agent"
              accent={scope === "active" ? "add" : "history"}
              title={scope === "active" ? "No tiene casos abiertos" : "Sin casos cerrados"}
              text={scope === "active" ? "Reporte un daño, una queja o una sugerencia y dele seguimiento aquí." : undefined}
              action={scope === "active" ? { label: "Reportar un caso", onPress: () => router.push("/case-new") } : undefined}
            />
          ) : undefined
        }
        renderItem={({ item: c }) => {
          const cat = CASE_CATEGORY[c.category];
          const st = CASE_STATUS[c.status];
          return (
            <Pressable
              onPress={() => router.push({ pathname: "/case", params: { id: c.id } })}
              accessibilityRole="button"
              accessibilityLabel={`${cat.label} ${c.code}: ${c.title}. ${st.label}`}
              style={({ pressed }) => [styles.card, pressed && { opacity: 0.85 }]}
            >
              <View style={[styles.icon, { backgroundColor: cat.bg }]}>
                <MaterialIcons name={cat.icon} size={26} color={cat.fg} />
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={styles.meta}>
                  {cat.label} {c.code}
                  {c.isAnonymous ? " · anónimo" : c.unitCode ? ` · ${unitLabel(c)}` : ""}
                </Text>
                <Text style={styles.title} numberOfLines={2}>
                  {c.title}
                </Text>
                <View style={styles.row}>
                  <View style={[styles.badge, { backgroundColor: st.bg }]}>
                    <Text style={[styles.badgeText, { color: st.fg }]}>{st.label}</Text>
                  </View>
                  <Text style={styles.meta}>{fmtDateTime(c.lastActivityAt)}</Text>
                </View>
                {c.status === "resolved" && <Text style={[styles.meta, { color: "#13795b", fontWeight: "700" }]}>Confirme si quedó resuelto</Text>}
              </View>
              <MaterialIcons name="chevron-right" size={24} color={colors.textMuted} />
            </Pressable>
          );
        }}
      />
      <Fab icon="add" label="Reportar un caso" onPress={() => router.push("/case-new")} />
    </View>
  );
}

const styles = StyleSheet.create({
  tabs: { flexDirection: "row" },
  tab: { flex: 1, alignItems: "center", paddingVertical: 14, borderBottomWidth: 3, borderBottomColor: "transparent" },
  tabActive: { borderBottomColor: colors.onPrimary },
  tabText: { fontSize: 16, color: "rgba(255,255,255,0.75)" },
  tabTextActive: { color: colors.onPrimary, fontWeight: "700" },
  content: { padding: 16, gap: 12, paddingBottom: 100 },
  card: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: colors.background, borderRadius: radius.md, padding: 14 },
  icon: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 16, fontWeight: "700", color: colors.text },
  meta: { fontSize: 13, color: colors.textMuted },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 4 },
  badge: { borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 3 },
  badgeText: { fontSize: 12, fontWeight: "700" }
});
