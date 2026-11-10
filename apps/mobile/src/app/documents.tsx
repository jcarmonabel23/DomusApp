/**
 * @project DomusApp - Mobile
 * @file src/app/documents.tsx
 * @description Documentos del condominio (reglamentos, circulares, formularios…) con filtro por tipo; se abren o descargan
 */

import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { Chip, EmptyState, ScreenHeader } from "@/components/access";
import { Notice } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { DOCUMENT_CATEGORY, fmtDay, openFile, type DocumentItem } from "@/lib/community";
import { useBrand } from "@/theme/brand";
import { colors, radius } from "@/theme/colors";

const sizeText = (b: number | null) => (!b ? "" : b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`);

export default function DocumentsScreen() {
  const brand = useBrand();
  const [rows, setRows] = useState<DocumentItem[] | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await api<DocumentItem[]>("/resident/documents"));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudieron cargar los documentos");
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const present = [...new Set((rows ?? []).map((d) => d.category))];
  const list = (rows ?? []).filter((d) => !category || d.category === category);

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <ScreenHeader title="Documentos" />
      {present.length > 1 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} style={{ flexGrow: 0 }}>
          <Chip label="Todos" active={!category} onPress={() => setCategory(null)} />
          {present.map((c) => (
            <Chip key={c} label={DOCUMENT_CATEGORY[c]?.label ?? c} active={category === c} onPress={() => setCategory(c)} />
          ))}
        </ScrollView>
      )}
      <FlatList
        data={list}
        keyExtractor={(d) => d.id}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
        ListHeaderComponent={error ? <Notice text={error} /> : undefined}
        ListEmptyComponent={rows && !error ? <EmptyState icon="folder-shared" title="Aún no hay documentos" text="Cuando la administración publique reglamentos o circulares, aparecerán aquí." /> : undefined}
        renderItem={({ item: d }) => {
          const meta = DOCUMENT_CATEGORY[d.category] ?? DOCUMENT_CATEGORY.other;
          return (
            <Pressable
              onPress={() => openFile(d.file)}
              accessibilityRole="button"
              accessibilityLabel={`${d.title}, ${meta.label}. Abrir`}
              style={({ pressed }) => [styles.card, pressed && { opacity: 0.85 }]}
            >
              <View style={[styles.icon, { backgroundColor: brand.primarySoft }]}>
                <MaterialIcons name={meta.icon} size={26} color={brand.primary} />
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={styles.title}>{d.title}</Text>
                {d.description && (
                  <Text style={styles.meta} numberOfLines={2}>
                    {d.description}
                  </Text>
                )}
                <Text style={styles.meta}>
                  {meta.label.replace(/s$/, "")} · {fmtDay(d.publishedOn)}
                  {d.fileBytes ? ` · ${d.file?.kind === "pdf" ? "PDF" : "Imagen"} ${sizeText(d.fileBytes)}` : ""}
                </Text>
              </View>
              <MaterialIcons name={d.file?.kind === "pdf" ? "file-download" : "open-in-new"} size={24} color={brand.primary} />
            </Pressable>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  chips: { paddingHorizontal: 16, paddingVertical: 12, gap: 8 },
  content: { padding: 16, paddingTop: 4, gap: 10, paddingBottom: 40 },
  card: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: colors.background, borderRadius: radius.md, padding: 14 },
  icon: { width: 48, height: 48, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 16, fontWeight: "700", color: colors.text },
  meta: { fontSize: 13, color: colors.textMuted }
});
