/**
 * @project DomusApp - Mobile
 * @file src/app/(tabs)/index.tsx
 * @description Inicio del Propietario / Inquilino: saludo, visitas que esperan respuesta, estado de sus alertas, botón de pánico,
 *              sus filiales y accesos rápidos
 */

import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { router, useFocusEffect, type Href } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { MyAlerts } from "@/components/MyAlerts";
import { PendingVisits } from "@/components/PendingVisits";
import type { AccessLog } from "@/lib/access";
import { api, ApiError } from "@/lib/api";
import { useRealtime } from "@/lib/realtime";
import { useSession } from "@/lib/session";
import { colors, radius } from "@/theme/colors";

interface ResidentHome {
  person: { id: string; names: string } | null;
  units: { id: string; code: string; tower: string | null; kind: string; relation: string; isPrimary: boolean; peopleCount: number }[];
}

const RELATION: Record<string, string> = { owner: "Propietario", tenant: "Inquilino", resident: "Residente" };
const KIND: Record<string, string> = {
  house: "Casa",
  apartment: "Apartamento",
  commercial: "Local",
  office: "Oficina",
  lot: "Lote",
  parking: "Parqueo",
  storage: "Bodega",
  other: "Filial"
};

const SHORTCUTS: { icon: "person-add-alt-1" | "directions-car" | "history" | "receipt-long"; label: string; href: Href | null }[] = [
  { icon: "person-add-alt-1", label: "Nuevo autorizado", href: { pathname: "/authorization", params: { kind: "temporary" } } },
  { icon: "directions-car", label: "Mis vehículos", href: "/vehicles" },
  { icon: "history", label: "Mis visitas", href: "/visits" },
  { icon: "receipt-long", label: "Estado de cuenta", href: "/finance" }
];

export default function HomeScreen() {
  const names = useSession((s) => s.session?.user.names ?? "");
  const condo = useSession((s) => s.session?.condominium);
  const [data, setData] = useState<ResidentHome | null>(null);
  const [pending, setPending] = useState<AccessLog[]>([]);
  const [tick, setTick] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [home, visits] = await Promise.all([
        api<ResidentHome>("/resident/home"),
        api<{ pending: AccessLog[] }>("/resident/visits?limit=1").catch(() => ({ pending: [] }))
      ]);
      setData(home);
      setPending(visits.pending);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo cargar");
    } finally {
      setLoading(false);
    }
  }, []);

  // Al volver a la pestaña se refresca (p. ej. una visita que llegó a la caseta)
  useFocusEffect(
    useCallback(() => {
      void load();
      setTick((t) => t + 1);
    }, [load, condo?.id])
  );

  // En vivo: una visita en la caseta o su respuesta desde otra cuenta de la filial
  useRealtime("visit:update", () => void load());
  useRealtime<{ notification: { kind: string } }>("notification", ({ notification }) => {
    if (notification.kind === "visit") void load();
  });

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}>
      <View style={styles.hero}>
        <Text style={styles.hello}>¡Hola, {names.split(" ")[0]}!</Text>
        <Text style={styles.heroText}>{condo?.name}</Text>
      </View>

      <PendingVisits visits={pending} onChange={load} />
      <MyAlerts refreshKey={tick} />

      <Pressable
        style={({ pressed }) => [styles.panic, pressed && { opacity: 0.85 }]}
        onPress={() => router.push("/panic")}
        accessibilityRole="button"
        accessibilityLabel="Botón de pánico"
      >
        <MaterialIcons name="notifications-active" size={34} color={colors.onPrimary} />
        <View style={{ flex: 1 }}>
          <Text style={styles.panicTitle}>Botón de pánico</Text>
          <Text style={styles.panicText}>Avisa al guarda de seguridad al instante</Text>
        </View>
        <MaterialIcons name="chevron-right" size={28} color={colors.onPrimary} />
      </Pressable>

      <Text style={styles.section}>Mis filiales</Text>
      {error && <Text style={styles.error}>{error}</Text>}
      {data && data.units.length === 0 && <Text style={styles.empty}>Aún no tiene filiales asignadas. Consulte a la administración.</Text>}
      {data?.units.map((u) => (
        <View key={u.id} style={styles.unit}>
          <View style={styles.unitIcon}>
            <MaterialIcons name={u.kind === "house" ? "house" : u.kind === "office" ? "business" : "apartment"} size={26} color={colors.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.unitCode}>
              {KIND[u.kind] ?? "Filial"} {u.code}
            </Text>
            <Text style={styles.unitText}>
              {[u.tower, RELATION[u.relation] ?? u.relation].filter(Boolean).join(" · ")}
              {u.isPrimary ? " · Contacto principal" : ""}
            </Text>
          </View>
        </View>
      ))}

      <View style={styles.grid}>
        {SHORTCUTS.map((s) => (
          <Pressable
            key={s.label}
            style={[styles.tile, !s.href && { opacity: 0.5 }]}
            disabled={!s.href}
            onPress={() => s.href && router.push(s.href)}
            accessibilityRole="button"
          >
            <MaterialIcons name={s.icon} size={32} color={colors.primary} />
            <Text style={styles.tileText}>{s.label}</Text>
          </Pressable>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { paddingBottom: 32 },
  hero: {
    backgroundColor: colors.primaryTint,
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 28,
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28
  },
  hello: { color: colors.onPrimary, fontSize: 26, fontWeight: "700" },
  heroText: { color: colors.onPrimary, fontSize: 16, marginTop: 6 },
  panic: {
    marginHorizontal: 16,
    marginTop: 20,
    backgroundColor: colors.danger,
    borderRadius: radius.md,
    padding: 18,
    flexDirection: "row",
    alignItems: "center",
    gap: 14
  },
  panicTitle: { color: colors.onPrimary, fontSize: 18, fontWeight: "700" },
  panicText: { color: colors.onPrimary, fontSize: 13, marginTop: 2 },
  section: { marginHorizontal: 16, marginTop: 22, marginBottom: 8, fontSize: 13, fontWeight: "700", color: colors.textMuted, textTransform: "uppercase" },
  error: { marginHorizontal: 16, color: colors.danger },
  empty: { marginHorizontal: 16, color: colors.textMuted },
  unit: { flexDirection: "row", alignItems: "center", gap: 12, marginHorizontal: 16, marginBottom: 8, padding: 14, borderRadius: radius.md, backgroundColor: colors.surface },
  unitIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" },
  unitCode: { fontSize: 16, fontWeight: "700", color: colors.text },
  unitText: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
  grid: { flexDirection: "row", flexWrap: "wrap", paddingHorizontal: 10, marginTop: 12 },
  tile: {
    width: "46%",
    margin: "2%",
    backgroundColor: colors.background,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 22,
    alignItems: "center",
    gap: 10
  },
  tileText: { fontSize: 15, fontWeight: "600", color: colors.text, textAlign: "center" }
});
