/**
 * @project DomusApp - Mobile
 * @file src/app/agreements.tsx
 * @description Seguimiento a acuerdos de asamblea: pendientes (con los vencidos marcados) o todos
 */

import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { EmptyState, ScreenHeader } from "@/components/access";
import { Notice } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import type { Agreement } from "@/lib/community";
import { useBrand } from "@/theme/brand";
import { colors } from "@/theme/colors";
import { AgreementCard } from "./assembly";

type Scope = "open" | "all";

export default function AgreementsScreen() {
  const brand = useBrand();
  const [scope, setScope] = useState<Scope>("open");
  const [rows, setRows] = useState<Agreement[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (s: Scope) => {
    setLoading(true);
    setError(null);
    try {
      setRows(await api<Agreement[]>(`/resident/agreements?scope=${s}`));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudieron cargar los acuerdos");
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load(scope);
    }, [load, scope])
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <ScreenHeader title="Seguimiento a acuerdos" />
      <View style={[styles.tabs, { backgroundColor: brand.primary }]} accessibilityRole="tablist">
        {(["open", "all"] as const).map((s) => (
          <Pressable key={s} onPress={() => setScope(s)} accessibilityRole="tab" accessibilityState={{ selected: scope === s }} style={[styles.tab, scope === s && styles.tabActive]}>
            <Text style={[styles.tabText, scope === s && styles.tabTextActive]}>{s === "open" ? "Pendientes" : "Todos"}</Text>
          </Pressable>
        ))}
      </View>
      <FlatList
        data={rows ?? []}
        keyExtractor={(g) => g.id}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={() => load(scope)} />}
        ListHeaderComponent={error ? <Notice text={error} /> : undefined}
        ListEmptyComponent={
          rows && !error ? <EmptyState icon="handshake" title={scope === "open" ? "No hay acuerdos pendientes" : "Aún no hay acuerdos"} text="Los acuerdos de cada asamblea y su avance aparecen aquí." /> : undefined
        }
        renderItem={({ item }) => <AgreementCard g={item} showAssembly />}
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
  content: { padding: 16, gap: 12, paddingBottom: 40 }
});
