/**
 * @project DomusApp - Mobile
 * @file src/app/announcements.tsx
 * @description Comunicados de la administración
 */

import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useCallback, useEffect, useState } from "react";
import { FlatList, RefreshControl, StyleSheet, Text, View } from "react-native";
import { EmptyState, ScreenHeader } from "@/components/access";
import { Notice } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { fmtDateTime } from "@/lib/access";
import type { Announcement } from "@/lib/alerts";
import { colors, radius } from "@/theme/colors";

export default function AnnouncementsScreen() {
  const [rows, setRows] = useState<Announcement[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await api<Announcement[]>("/messages/announcements"));
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

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <ScreenHeader title="Comunicados" />
      {error && (
        <View style={{ padding: 12 }}>
          <Notice text={error} />
        </View>
      )}
      <FlatList
        data={rows ?? []}
        keyExtractor={(a) => a.id}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
        contentContainerStyle={{ padding: 12, gap: 10, paddingBottom: 32 }}
        renderItem={({ item: a }) => (
          <View style={styles.card}>
            <View style={styles.head}>
              {a.isPinned && <MaterialIcons name="push-pin" size={18} color={colors.primary} />}
              <Text style={styles.title}>{a.title}</Text>
            </View>
            <Text style={styles.body}>{a.body}</Text>
            <Text style={styles.meta}>
              {fmtDateTime(a.publishedAt)}
              {a.createdByName ? ` · ${a.createdByName}` : ""}
            </Text>
          </View>
        )}
        ListEmptyComponent={rows && !error ? <EmptyState icon="campaign" accent="mark-email-read" title="Sin comunicados" text="Aquí verá los avisos de la administración." /> : undefined}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.background, borderRadius: radius.md, padding: 16, gap: 8 },
  head: { flexDirection: "row", alignItems: "center", gap: 6 },
  title: { flex: 1, fontSize: 17, fontWeight: "700", color: colors.text },
  body: { fontSize: 15, color: colors.text, lineHeight: 21 },
  meta: { fontSize: 12, color: colors.textMuted }
});
