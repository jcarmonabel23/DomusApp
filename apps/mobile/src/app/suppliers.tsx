/**
 * @project DomusApp - Mobile
 * @file src/app/suppliers.tsx
 * @description Directorio de proveedores recomendados por la administración: llamar, escribir o visitar su sitio
 */

import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { FlatList, Linking, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { EmptyState, ScreenHeader } from "@/components/access";
import { Notice } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { SUPPLIER_CATEGORY, type SupplierItem } from "@/lib/community";
import { useBrand } from "@/theme/brand";
import { colors, radius } from "@/theme/colors";

const tel = (p: string) => `tel:${p.replace(/[^\d+]/g, "")}`;

export default function SuppliersScreen() {
  const brand = useBrand();
  const [rows, setRows] = useState<SupplierItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await api<SupplierItem[]>("/resident/suppliers"));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo cargar el directorio");
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const Action = ({ icon, label, url }: { icon: "call" | "email" | "language"; label: string; url: string }) => (
    <Pressable onPress={() => void Linking.openURL(url)} accessibilityRole="button" accessibilityLabel={label} style={[styles.action, { borderColor: brand.primary }]}>
      <MaterialIcons name={icon} size={18} color={brand.primary} />
      <Text style={[styles.actionText, { color: brand.primary }]}>{label.split(" ")[0]}</Text>
    </Pressable>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <ScreenHeader title="Proveedores" />
      <FlatList
        data={rows ?? []}
        keyExtractor={(s) => s.id}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
        ListHeaderComponent={
          error ? <Notice text={error} /> : rows?.length ? <Text style={styles.intro}>Proveedores que la administración recomienda para trabajos en su filial.</Text> : undefined
        }
        ListEmptyComponent={rows && !error ? <EmptyState icon="storefront" title="Aún no hay proveedores" text="La administración irá agregando proveedores de confianza." /> : undefined}
        renderItem={({ item: s }) => {
          const phone = s.contact?.phone ?? s.phone;
          return (
            <View style={styles.card}>
              <View style={styles.row}>
                <Text style={styles.title}>{s.name}</Text>
                {s.isNew && (
                  <View style={[styles.badge, { backgroundColor: brand.primarySoft }]}>
                    <Text style={[styles.badgeText, { color: brand.primary }]}>Nuevo</Text>
                  </View>
                )}
              </View>
              <Text style={styles.meta}>{SUPPLIER_CATEGORY[s.category] ?? s.category}</Text>
              {s.contact && (
                <Text style={styles.meta}>
                  Contacto: {s.contact.names}
                  {s.contact.role ? ` (${s.contact.role})` : ""}
                </Text>
              )}
              <View style={styles.actions}>
                {phone && <Action icon="call" label={`Llamar a ${s.name}`} url={tel(phone)} />}
                {s.email && <Action icon="email" label={`Correo a ${s.name}`} url={`mailto:${s.email}`} />}
                {s.website && <Action icon="language" label={`Sitio de ${s.name}`} url={/^https?:\/\//.test(s.website) ? s.website : `https://${s.website}`} />}
              </View>
            </View>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 12, paddingBottom: 40 },
  intro: { fontSize: 14, color: colors.textMuted, marginBottom: 4 },
  card: { backgroundColor: colors.background, borderRadius: radius.md, padding: 14, gap: 4 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { fontSize: 16, fontWeight: "700", color: colors.text, flexShrink: 1 },
  meta: { fontSize: 13, color: colors.textMuted },
  badge: { borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2 },
  badgeText: { fontSize: 11, fontWeight: "800" },
  actions: { flexDirection: "row", gap: 8, marginTop: 8, flexWrap: "wrap" },
  action: { flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1.5, borderRadius: radius.pill, paddingHorizontal: 14, minHeight: 40 },
  actionText: { fontSize: 14, fontWeight: "700" }
});
