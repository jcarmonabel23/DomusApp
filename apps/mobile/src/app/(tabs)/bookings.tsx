/**
 * @project DomusApp - Mobile
 * @file src/app/(tabs)/bookings.tsx
 * @description Reservaciones: saludo, buscador y cuadrícula de áreas comunes (como en las capturas de referencia).
 *              El botón del calendario abre "Mis reservas".
 */

import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { Image } from "expo-image";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from "react-native";
import { EmptyState } from "@/components/access";
import { Notice } from "@/components/ui";
import { api, ApiError, fileUrl } from "@/lib/api";
import { amenityIcon, dayText, type Amenity } from "@/lib/bookings";
import { useRealtime } from "@/lib/realtime";
import { useSession } from "@/lib/session";
import { useBrand } from "@/theme/brand";
import { colors, radius } from "@/theme/colors";

export default function BookingsScreen() {
  const brand = useBrand();
  const names = useSession((s) => s.session?.user.names ?? "");
  const [rows, setRows] = useState<Amenity[] | null>(null);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await api<Amenity[]>("/resident/bookings/amenities"));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudieron cargar las áreas");
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );
  useRealtime("bookings:update", () => void load());

  const q = search.trim().toLowerCase();
  const list = (rows ?? []).filter((a) => !q || a.name.toLowerCase().includes(q));
  const first = names.split(" ")[0];

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={[styles.hero, { backgroundColor: brand.primaryTint }]}>
        <View style={styles.heroRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.hello} accessibilityRole="header">
              ¡Hola {first}!
            </Text>
            <Text style={styles.heroText}>Toque el área común en la que quiere reservar su espacio</Text>
          </View>
          <Pressable
            onPress={() => router.push("/my-bookings")}
            accessibilityRole="button"
            accessibilityLabel="Mis reservas"
            style={({ pressed }) => [styles.calendar, pressed && { opacity: 0.7 }]}
          >
            <MaterialIcons name="calendar-month" size={30} color={colors.onPrimary} />
          </Pressable>
        </View>
        <View style={styles.search}>
          <MaterialIcons name="search" size={24} color="rgba(255,255,255,0.85)" />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Buscar área común…"
            placeholderTextColor="rgba(255,255,255,0.85)"
            style={styles.searchInput}
            accessibilityLabel="Buscar área común"
            returnKeyType="search"
          />
        </View>
      </View>

      <FlatList
        data={list}
        keyExtractor={(a) => a.id}
        numColumns={2}
        columnWrapperStyle={{ gap: 12 }}
        contentContainerStyle={styles.grid}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
        ListHeaderComponent={error ? <Notice text={error} /> : undefined}
        ListEmptyComponent={
          rows && !error ? (
            <EmptyState
              icon="event-available"
              accent={q ? "search-off" : "add"}
              title={q ? "Sin resultados" : "Aún no hay áreas para reservar"}
              text={q ? `Ninguna área coincide con «${search.trim()}».` : "Cuando la administración las publique, aparecerán aquí."}
            />
          ) : undefined
        }
        renderItem={({ item: a }) => {
          const meta = amenityIcon(a.icon);
          return (
            <Pressable
              onPress={() => router.push({ pathname: "/amenity", params: { id: a.id } })}
              accessibilityRole="button"
              accessibilityLabel={`${a.name}${a.nextBooking ? `, tiene reserva el ${dayText(a.nextBooking.date)}` : ""}`}
              style={({ pressed }) => [styles.card, pressed && { opacity: 0.85 }]}
            >
              {a.photo ? (
                <Image source={{ uri: fileUrl(a.photo.card) }} style={styles.photo} contentFit="cover" accessibilityIgnoresInvertColors />
              ) : (
                <View style={[styles.photo, { backgroundColor: meta.bg, alignItems: "center", justifyContent: "center" }]}>
                  <MaterialIcons name={meta.icon} size={52} color={meta.fg} />
                </View>
              )}
              <Text style={styles.name} numberOfLines={2}>
                {a.name}
              </Text>
              {a.nextBooking && (
                <View style={[styles.next, { backgroundColor: a.nextBooking.status === "pending" ? "#fff4dd" : "#dff7ec" }]}>
                  <MaterialIcons name={a.nextBooking.status === "pending" ? "hourglass-top" : "event-available"} size={13} color={a.nextBooking.status === "pending" ? "#8a5a00" : "#13795b"} />
                  <Text style={[styles.nextText, { color: a.nextBooking.status === "pending" ? "#8a5a00" : "#13795b" }]}>
                    {dayText(a.nextBooking.date)} {a.nextBooking.timeFrom}
                  </Text>
                </View>
              )}
            </Pressable>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 24, borderBottomLeftRadius: 28, borderBottomRightRadius: 28, gap: 18 },
  heroRow: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  hello: { fontSize: 26, fontWeight: "800", color: colors.onPrimary },
  heroText: { fontSize: 16, color: colors.onPrimary, opacity: 0.95, marginTop: 4 },
  calendar: { width: 64, height: 56, borderRadius: radius.md, backgroundColor: "rgba(255,255,255,0.22)", alignItems: "center", justifyContent: "center" },
  search: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "rgba(255,255,255,0.25)", borderRadius: radius.pill, paddingHorizontal: 18, height: 54 },
  searchInput: { flex: 1, fontSize: 17, color: colors.onPrimary },
  grid: { padding: 16, gap: 12, paddingBottom: 32 },
  card: { flex: 1, maxWidth: "50%", borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.md, padding: 10, alignItems: "center", gap: 10, backgroundColor: colors.background },
  photo: { width: "100%", aspectRatio: 4 / 3, borderRadius: radius.sm },
  name: { fontSize: 17, fontWeight: "600", color: colors.text, textAlign: "center", minHeight: 44 },
  next: { flexDirection: "row", alignItems: "center", gap: 4, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 3 },
  nextText: { fontSize: 12, fontWeight: "700" }
});
