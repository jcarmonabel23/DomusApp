/**
 * @project DomusApp - Mobile
 * @file src/app/(tabs)/authorized.tsx
 * @description Autorizados de la filial: pestañas Temporales / Permanentes / Empleados, tarjetas con foto,
 *              estado del permiso, último ingreso y salida, y botón "+" para registrar uno nuevo
 */

import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Alert, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { EmptyState, Fab, PersonPhoto } from "@/components/access";
import { Notice } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { fmtDateTime, permitStatus, validityText, type AuthKind, type Authorization } from "@/lib/access";
import { colors, radius } from "@/theme/colors";

const TABS: { kind: AuthKind; label: string }[] = [
  { kind: "temporary", label: "Temporales" },
  { kind: "permanent", label: "Permanentes" },
  { kind: "employee", label: "Empleados" }
];

const TONE = { ok: colors.success, muted: colors.textMuted, warn: colors.warning };

function AuthorizationCard({ a, onRemove }: Readonly<{ a: Authorization; onRemove: (a: Authorization) => void }>) {
  const st = permitStatus(a);
  return (
    <Pressable
      style={styles.card}
      onPress={() => a.status === "active" && router.push({ pathname: "/authorization", params: { id: a.id, kind: a.kind } })}
      onLongPress={() => a.status === "active" && onRemove(a)}
      accessibilityRole="button"
    >
      <PersonPhoto uri={a.photo?.thumb} names={a.names} size={68} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.name} numberOfLines={1}>
          {a.names}
        </Text>
        <Text style={styles.meta}>
          Estado del permiso: <Text style={{ color: TONE[st.tone], fontWeight: "700" }}>{st.label}</Text>
        </Text>
        <Text style={styles.meta}>Último ingreso: {fmtDateTime(a.lastEntryAt)}</Text>
        <Text style={styles.meta}>Salida: {a.lastEntryAt ? (a.lastExitAt ? fmtDateTime(a.lastExitAt) : "Aún adentro") : "—"}</Text>
        <Text style={styles.validity} numberOfLines={1}>
          {[a.occupation, validityText(a)].filter(Boolean).join(" · ")}
        </Text>
      </View>
      {a.status === "active" && (
        <Pressable hitSlop={10} onPress={() => onRemove(a)} accessibilityRole="button" accessibilityLabel={`Eliminar a ${a.names}`}>
          <MaterialIcons name="delete-outline" size={24} color={colors.textMuted} />
        </Pressable>
      )}
    </Pressable>
  );
}

export default function AuthorizedScreen() {
  const [kind, setKind] = useState<AuthKind>("temporary");
  const [rows, setRows] = useState<Authorization[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (k: AuthKind) => {
    setLoading(true);
    setError(null);
    try {
      setRows(await api<Authorization[]>(`/resident/authorizations?kind=${k}`));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo cargar");
    } finally {
      setLoading(false);
    }
  }, []);

  // Recarga al volver del formulario
  useFocusEffect(
    useCallback(() => {
      void load(kind);
    }, [load, kind])
  );

  const remove = (a: Authorization) =>
    Alert.alert("Eliminar autorizado", `${a.names} ya no podrá ingresar con este permiso.`, [
      { text: "Cancelar", style: "cancel" },
      {
        text: "Eliminar",
        style: "destructive",
        onPress: async () => {
          try {
            await api(`/resident/authorizations/${a.id}`, { method: "DELETE" });
            void load(kind);
          } catch (err) {
            Alert.alert("No se pudo eliminar", err instanceof ApiError ? err.message : "Intente de nuevo");
          }
        }
      }
    ]);

  return (
    <View style={styles.screen}>
      <View style={styles.tabs}>
        {TABS.map((t) => (
          <Pressable
            key={t.kind}
            style={[styles.tab, kind === t.kind && styles.tabActive]}
            onPress={() => {
              setRows(null);
              setKind(t.kind);
            }}
            accessibilityRole="tab"
            accessibilityState={{ selected: kind === t.kind }}
          >
            <Text style={[styles.tabText, kind === t.kind && styles.tabTextActive]}>{t.label}</Text>
          </Pressable>
        ))}
      </View>

      {error && (
        <View style={{ padding: 12 }}>
          <Notice text={error} />
        </View>
      )}

      <FlatList
        data={rows ?? []}
        keyExtractor={(a) => a.id}
        renderItem={({ item }) => <AuthorizationCard a={item} onRemove={remove} />}
        contentContainerStyle={{ padding: 12, gap: 10, paddingBottom: 110 }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={() => load(kind)} />}
        ListEmptyComponent={
          rows && !error ? (
            <EmptyState
              icon={kind === "employee" ? "badge" : kind === "permanent" ? "verified-user" : "person-add-alt-1"}
              title={`Sin autorizados ${TABS.find((t) => t.kind === kind)!.label.toLowerCase()}`}
              text="Agréguelo para que la caseta sepa a quién dejar pasar."
              accent="add"
              action={{ label: "Agregar autorizado", onPress: () => router.push({ pathname: "/authorization", params: { kind } }) }}
            />
          ) : undefined
        }
      />

      <Fab label="Nuevo autorizado" onPress={() => router.push({ pathname: "/authorization", params: { kind } })} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  tabs: { flexDirection: "row", backgroundColor: colors.background, borderBottomWidth: 1, borderBottomColor: colors.border },
  tab: { flex: 1, paddingVertical: 14, alignItems: "center", borderBottomWidth: 3, borderBottomColor: "transparent" },
  tabActive: { borderBottomColor: colors.primary },
  tabText: { fontSize: 15, fontWeight: "600", color: colors.textMuted },
  tabTextActive: { color: colors.primary },
  card: { flexDirection: "row", alignItems: "center", gap: 14, backgroundColor: colors.background, borderRadius: radius.md, padding: 14 },
  name: { fontSize: 17, fontWeight: "700", color: colors.text },
  meta: { fontSize: 13, color: colors.textMuted },
  validity: { fontSize: 12, color: colors.primary, marginTop: 2 }
});
