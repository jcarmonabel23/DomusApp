/**
 * @project DomusApp - Mobile
 * @file src/components/ThreadsList.tsx
 * @description Conversaciones con la caseta: el guarda ve todas las filiales que escribieron (y puede iniciar
 *              una nueva); el residente ve una por cada filial suya
 */

import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { FlatList, Modal, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from "react-native";
import { Chip, EmptyState, Fab } from "@/components/access";
import { Button, Notice } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { fmtDateTime, unitLabel } from "@/lib/access";
import type { Thread } from "@/lib/alerts";
import { useRealtime } from "@/lib/realtime";
import { colors, radius } from "@/theme/colors";

export function ThreadsList({ guard }: Readonly<{ guard: boolean }>) {
  const [rows, setRows] = useState<Thread[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [picker, setPicker] = useState(false);
  const [units, setUnits] = useState<{ id: string; code: string; tower: string | null }[]>([]);
  const [filter, setFilter] = useState("");

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      setRows(await api<Thread[]>("/messages/threads"));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo cargar");
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load(true);
    }, [load])
  );
  useRealtime("message:new", () => void load(true));

  const openPicker = async () => {
    setPicker(true);
    if (units.length === 0) setUnits(await api<typeof units>("/guard/units").catch(() => []));
  };

  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return (f ? units.filter((u) => unitLabel(u).toLowerCase().includes(f)) : units).slice(0, 60);
  }, [units, filter]);

  const go = (unitId: string) => {
    setPicker(false);
    router.push({ pathname: "/chat", params: { unitId } });
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      {error && (
        <View style={{ padding: 12 }}>
          <Notice text={error} />
        </View>
      )}
      <FlatList
        data={rows ?? []}
        keyExtractor={(t) => t.unitId}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={() => load()} />}
        contentContainerStyle={{ padding: 12, gap: 8, paddingBottom: 110 }}
        renderItem={({ item: t }) => (
          <Pressable style={styles.row} onPress={() => go(t.unitId)} accessibilityRole="button">
            <View style={styles.avatar}>
              <MaterialIcons name={guard ? "apartment" : "local-police"} size={24} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <View style={styles.line}>
                <Text style={styles.title}>{guard ? `Filial ${unitLabel(t)}` : `Caseta · ${unitLabel(t)}`}</Text>
                {t.last && <Text style={styles.time}>{fmtDateTime(t.last.createdAt)}</Text>}
              </View>
              <View style={styles.line}>
                <Text style={[styles.preview, t.unread > 0 && { color: colors.text, fontWeight: "600" }]} numberOfLines={1}>
                  {t.last ? `${(t.last.side === "guard") === guard ? "Usted: " : ""}${t.last.body}` : "Sin mensajes todavía"}
                </Text>
                {t.unread > 0 && (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>{t.unread}</Text>
                  </View>
                )}
              </View>
            </View>
          </Pressable>
        )}
        ListEmptyComponent={
          rows && !error ? (
            <EmptyState
              icon="forum"
              accent="chat"
              title="Sin conversaciones"
              text={guard ? "Cuando una filial escriba a la caseta aparecerá aquí." : "Escriba a la caseta cuando lo necesite."}
              action={guard ? { label: "Escribir a una filial", onPress: openPicker } : undefined}
            />
          ) : undefined
        }
      />

      {guard && <Fab icon="edit" label="Nuevo mensaje" onPress={openPicker} />}

      <Modal visible={picker} transparent animationType="slide" onRequestClose={() => setPicker(false)}>
        <Pressable style={styles.backdrop} onPress={() => setPicker(false)} accessibilityRole="button" accessibilityLabel="Cerrar" />
        <View style={styles.sheet}>
          <Text style={styles.sheetTitle}>Escribir a una filial</Text>
          <TextInput value={filter} onChangeText={setFilter} placeholder="Código o torre" placeholderTextColor={colors.textMuted} style={styles.input} />
          <View style={styles.wrap}>
            {shown.map((u) => (
              <Chip key={u.id} label={unitLabel(u)} onPress={() => go(u.id)} />
            ))}
          </View>
          <Button title="Cancelar" variant="ghost" onPress={() => setPicker(false)} />
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: colors.background, borderRadius: radius.md, padding: 14 },
  avatar: { width: 46, height: 46, borderRadius: 23, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" },
  line: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  title: { fontSize: 16, fontWeight: "700", color: colors.text, flexShrink: 1 },
  time: { fontSize: 12, color: colors.textMuted },
  preview: { flex: 1, fontSize: 14, color: colors.textMuted, marginTop: 2 },
  badge: { minWidth: 22, height: 22, borderRadius: 11, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center", paddingHorizontal: 6 },
  badgeText: { color: colors.onPrimary, fontSize: 12, fontWeight: "700" },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)" },
  sheet: { backgroundColor: colors.background, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: 20, paddingBottom: 32, gap: 12, maxHeight: "75%" },
  sheetTitle: { fontSize: 19, fontWeight: "700", color: colors.text },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: 14, paddingVertical: 10, fontSize: 16, color: colors.text },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 }
});
