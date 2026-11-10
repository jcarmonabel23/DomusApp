/**
 * @project DomusApp - Mobile
 * @file src/app/assemblies.tsx
 * @description Asambleas: la próxima convocatoria arriba y luego las anteriores con su acta
 */

import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { EmptyState, ScreenHeader } from "@/components/access";
import { Notice } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { dayText } from "@/lib/bookings";
import { ASSEMBLY_KIND, type Assembly } from "@/lib/community";
import { useBrand } from "@/theme/brand";
import { colors, radius } from "@/theme/colors";

export const ASSEMBLY_STATUS: Record<Assembly["status"], { label: string; bg: string; fg: string }> = {
  scheduled: { label: "Convocada", bg: "#e7f2fd", fg: "#1a5fa8" },
  held: { label: "Celebrada", bg: "#dff7ec", fg: "#13795b" },
  cancelled: { label: "Cancelada", bg: "#eceff3", fg: "#4b5563" }
};

export default function AssembliesScreen() {
  const brand = useBrand();
  const [rows, setRows] = useState<Assembly[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await api<Assembly[]>("/resident/assemblies"));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudieron cargar las asambleas");
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <ScreenHeader
        title="Asambleas"
        right={
          <Pressable onPress={() => router.push("/agreements")} accessibilityRole="button" accessibilityLabel="Seguimiento a acuerdos" hitSlop={10}>
            <MaterialIcons name="handshake" size={26} color={colors.onPrimary} />
          </Pressable>
        }
      />
      <FlatList
        data={rows ?? []}
        keyExtractor={(a) => a.id}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
        ListHeaderComponent={error ? <Notice text={error} /> : undefined}
        ListEmptyComponent={rows && !error ? <EmptyState icon="groups" title="Aún no hay asambleas" text="Aquí verá las convocatorias, las actas y los acuerdos." /> : undefined}
        renderItem={({ item: a, index }) => {
          const st = ASSEMBLY_STATUS[a.status];
          const upcoming = a.status === "scheduled" && index === 0;
          return (
            <Pressable
              onPress={() => router.push({ pathname: "/assembly", params: { id: a.id } })}
              accessibilityRole="button"
              accessibilityLabel={`${a.title}, ${dayText(a.date)} ${a.time}, ${st.label}`}
              style={({ pressed }) => [styles.card, upcoming && { borderColor: brand.primary, borderWidth: 2 }, pressed && { opacity: 0.85 }]}
            >
              <View style={[styles.date, { backgroundColor: upcoming ? brand.primary : brand.primarySoft }]}>
                <Text style={[styles.day, { color: upcoming ? colors.onPrimary : brand.primary }]}>{a.date.slice(8, 10)}</Text>
                <Text style={[styles.month, { color: upcoming ? colors.onPrimary : brand.primary }]}>{dayText(a.date).split(" ")[2]}</Text>
              </View>
              <View style={{ flex: 1, gap: 3 }}>
                {upcoming && <Text style={[styles.next, { color: brand.primary }]}>PRÓXIMA ASAMBLEA</Text>}
                <Text style={styles.title}>{a.title}</Text>
                <Text style={styles.meta}>
                  {ASSEMBLY_KIND[a.kind]} · {a.time}
                  {a.location ? ` · ${a.location}` : ""}
                </Text>
                <View style={styles.row}>
                  <View style={[styles.badge, { backgroundColor: st.bg }]}>
                    <Text style={[styles.badgeText, { color: st.fg }]}>{st.label}</Text>
                  </View>
                  {a.minutes && <Text style={styles.meta}>Acta disponible</Text>}
                  {a.agreements > 0 && (
                    <Text style={styles.meta}>
                      {a.agreementsDone}/{a.agreements} acuerdos
                    </Text>
                  )}
                </View>
              </View>
            </Pressable>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 12, paddingBottom: 40 },
  card: { flexDirection: "row", gap: 14, backgroundColor: colors.background, borderRadius: radius.md, padding: 14, borderWidth: 1, borderColor: colors.background },
  date: { width: 58, height: 64, borderRadius: radius.sm, alignItems: "center", justifyContent: "center" },
  day: { fontSize: 24, fontWeight: "800" },
  month: { fontSize: 13, fontWeight: "700", textTransform: "uppercase" },
  next: { fontSize: 11, fontWeight: "800", letterSpacing: 0.5 },
  title: { fontSize: 16, fontWeight: "700", color: colors.text },
  meta: { fontSize: 13, color: colors.textMuted },
  row: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 4, flexWrap: "wrap" },
  badge: { borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 3 },
  badgeText: { fontSize: 12, fontWeight: "700" }
});
