/**
 * @project DomusApp - Mobile
 * @file src/app/visits.tsx
 * @description Mis últimas visitas: ingresos y salidas registrados por la caseta para las filiales de la cuenta
 */

import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useCallback, useEffect, useState } from "react";
import { FlatList, RefreshControl, StyleSheet, Text, View } from "react-native";
import { EmptyState, ScreenHeader } from "@/components/access";
import { PendingVisits } from "@/components/PendingVisits";
import { Notice } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { LOG_KIND_LABEL, fmtDateTime, fmtTime, type AccessLog } from "@/lib/access";
import { colors, radius } from "@/theme/colors";

const STATUS = {
  inside: { label: "Adentro", color: colors.success },
  exited: { label: "Salió", color: colors.textMuted },
  denied: { label: "No ingresó", color: colors.danger },
  pending: { label: "En la caseta", color: colors.warning }
} as const;

export default function VisitsScreen() {
  const [data, setData] = useState<{ pending: AccessLog[]; recent: AccessLog[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api("/resident/visits?limit=100"));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo cargar");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <ScreenHeader title="Mis últimas visitas" />
      <FlatList
        data={data?.recent ?? []}
        keyExtractor={(l) => l.id}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
        contentContainerStyle={{ paddingBottom: 32, gap: 8 }}
        ListHeaderComponent={
          <View style={{ gap: 8 }}>
            {error && (
              <View style={{ margin: 12 }}>
                <Notice text={error} />
              </View>
            )}
            <PendingVisits visits={data?.pending ?? []} onChange={load} />
            <View style={{ height: 4 }} />
          </View>
        }
        renderItem={({ item: l }) => {
          const st = STATUS[l.status];
          return (
            <View style={styles.row}>
              <MaterialIcons name={l.plate ? "directions-car" : "person"} size={26} color={colors.primary} />
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{l.names}</Text>
                <Text style={styles.meta}>
                  {[LOG_KIND_LABEL[l.kind] ?? l.kind, l.plate && `Placa ${l.plate}`].filter(Boolean).join(" · ")}
                </Text>
                <Text style={styles.meta}>
                  {l.entryAt ? `Ingresó ${fmtDateTime(l.entryAt)}` : fmtDateTime(l.createdAt)}
                  {l.exitAt ? ` · salió ${fmtTime(l.exitAt)}` : ""}
                </Text>
              </View>
              <Text style={[styles.status, { color: st.color }]}>{st.label}</Text>
            </View>
          );
        }}
        ListEmptyComponent={data && !error ? <EmptyState icon="history" accent="schedule" title="Aún no hay visitas" text="Aquí verá cada ingreso y salida registrado en la caseta." /> : undefined}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: colors.background, marginHorizontal: 12, borderRadius: radius.md, padding: 14 },
  name: { fontSize: 16, fontWeight: "700", color: colors.text },
  meta: { fontSize: 13, color: colors.textMuted },
  status: { fontSize: 13, fontWeight: "700" }
});
