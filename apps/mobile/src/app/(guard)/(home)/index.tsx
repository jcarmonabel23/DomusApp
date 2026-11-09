/**
 * @project DomusApp - Mobile
 * @file src/app/(guard)/(home)/index.tsx
 * @description Caseta del guarda: búsqueda por nombre, cédula o placa; esperados hoy, adentro y visitas que
 *              esperan respuesta. Ingreso y salida con un toque; si la filial pidió llamada (o está fuera de
 *              horario) se muestra a quién llamar antes de confirmar.
 */

import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, FlatList, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from "react-native";
import { AccountCard } from "@/components/AccountCard";
import { EmptyState, Fab, PersonPhoto } from "@/components/access";
import { CallConfirm, type CallConfirmRequest } from "@/components/CallConfirm";
import { Notice } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { useRealtime } from "@/lib/realtime";
import { KIND_TITLE, LOG_KIND_LABEL, VEHICLE_KIND, fmtTime, unitLabel, validityText, type AccessLog, type Authorization, type Vehicle } from "@/lib/access";
import { colors, radius } from "@/theme/colors";

interface Board {
  expected: Authorization[];
  inside: AccessLog[];
  pending: AccessLog[];
}

type Tab = "expected" | "inside" | "pending";

const NEEDS_CONFIRM = new Set(["CALL_REQUIRED", "OUTSIDE_HOURS"]);

export default function GuardBoard() {
  const [tab, setTab] = useState<Tab>("expected");
  const [q, setQ] = useState("");
  const [board, setBoard] = useState<Board | null>(null);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<CallConfirmRequest | null>(null);
  const qRef = useRef(q);
  qRef.current = q;

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    const term = qRef.current.trim();
    try {
      const qs = term ? `?q=${encodeURIComponent(term)}` : "";
      const [b, s] = await Promise.all([
        api<Board>(`/guard/board${qs}`),
        term.length >= 2 ? api<{ vehicles: Vehicle[] }>(`/guard/search${qs}`) : Promise.resolve({ vehicles: [] })
      ]);
      setBoard(b);
      setVehicles(s.vehicles);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo cargar la caseta");
    } finally {
      setLoading(false);
    }
  }, []);

  // Búsqueda con pausa al escribir
  useEffect(() => {
    const t = setTimeout(() => void load(true), 300);
    return () => clearTimeout(t);
  }, [q, load]);

  // Mientras la pantalla está visible se refresca sola (respuestas de las filiales, otros guardas)
  useFocusEffect(
    useCallback(() => {
      void load(true);
      const timer = setInterval(() => void load(true), 15_000);
      return () => clearInterval(timer);
    }, [load])
  );

  // En vivo: otro guarda registró algo, una filial respondió o llegó una visita
  useRealtime("access:update", () => void load(true));
  useRealtime("resumed", () => void load(true));

  const run = async (key: string, fn: () => Promise<unknown>, onConflict?: (err: ApiError) => boolean) => {
    setBusy(key);
    try {
      await fn();
      setConfirm(null);
      await load(true);
    } catch (err) {
      if (err instanceof ApiError && onConflict?.(err)) return;
      Alert.alert("No se pudo registrar", err instanceof ApiError ? err.message : "Intente de nuevo");
      void load(true);
    } finally {
      setBusy(null);
    }
  };

  const admitAuthorization = (a: Authorization, confirmed = false) =>
    run(
      a.id,
      () => api("/guard/entries", { method: "POST", body: { authorizationId: a.id, confirmed } }),
      (err) => {
        if (!NEEDS_CONFIRM.has(err.code)) return false;
        setConfirm({
          title: err.code === "CALL_REQUIRED" ? "Llame a la filial" : "Fuera de horario",
          message: `${err.message}. ${a.names} → ${unitLabel(a)}.`,
          phones: a.phones ?? [],
          confirmLabel: "Confirmado, registrar ingreso",
          onConfirm: () => void admitAuthorization(a, true)
        });
        return true;
      }
    );

  const exit = (logId: string) => run(logId, () => api(`/guard/entries/${logId}/exit`, { method: "POST", body: {} }));

  const admitVehicle = (v: Vehicle) => run(v.id, () => api("/guard/entries", { method: "POST", body: { vehicleId: v.id } }));

  const deny = (l: AccessLog) => run(l.id, () => api(`/guard/entries/${l.id}/deny`, { method: "POST", body: {} }));

  const admitVisit = (l: AccessLog, confirmed = false) =>
    run(
      l.id,
      () => api(`/guard/entries/${l.id}/admit`, { method: "POST", body: { confirmed } }),
      (err) => {
        if (err.code !== "AWAITING_RESPONSE") return false;
        setConfirm({
          title: "La filial no ha respondido",
          message: `Llame para confirmar si ${l.names} puede pasar a ${unitLabel(l)}.`,
          phones: l.phones ?? [],
          confirmLabel: "Confirmado por teléfono",
          onConfirm: () => void admitVisit(l, true),
          reject: { label: "No ingresa", onPress: () => void deny(l) }
        });
        return true;
      }
    );

  const counts = { expected: board?.expected.length ?? 0, inside: board?.inside.length ?? 0, pending: board?.pending.length ?? 0 };

  const renderExpected = (a: Authorization) => {
    const inside = Boolean(a.insideLogId);
    return (
      <View style={styles.card}>
        <PersonPhoto uri={a.photo?.thumb} names={a.names} size={56} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={styles.name}>{a.names}</Text>
          <Text style={styles.meta}>
            {[`Filial ${unitLabel(a)}`, KIND_TITLE[a.kind], a.occupation].filter(Boolean).join(" · ")}
          </Text>
          <Text style={styles.meta}>{[a.idNumber, a.plate && `Placa ${a.plate}`].filter(Boolean).join(" · ") || "Sin documento ni placa"}</Text>
          <Text style={styles.meta}>{validityText(a)}</Text>
          {(a.callToConfirm || !a.withinHours) && (
            <Text style={styles.warn}>{a.callToConfirm ? "Llamar a la filial antes de dejar pasar" : "Fuera de su horario"}</Text>
          )}
          {a.instructions && <Text style={styles.instructions}>“{a.instructions}”</Text>}
        </View>
        <ActionButton
          label={inside ? "Salida" : "Ingreso"}
          tone={inside ? "exit" : "enter"}
          busy={busy === a.id || busy === a.insideLogId}
          onPress={() => (inside ? void exit(a.insideLogId!) : void admitAuthorization(a))}
        />
      </View>
    );
  };

  const renderInside = (l: AccessLog) => (
    <View style={styles.card}>
      <View style={styles.iconBox}>
        <MaterialIcons name={l.plate ? "directions-car" : "person"} size={26} color={colors.primary} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.name}>{l.names}</Text>
        <Text style={styles.meta}>{[`Filial ${unitLabel(l)}`, LOG_KIND_LABEL[l.kind]].join(" · ")}</Text>
        <Text style={styles.meta}>
          {[l.plate && `Placa ${l.plate}`, `Ingresó ${fmtTime(l.entryAt)}`].filter(Boolean).join(" · ")}
        </Text>
      </View>
      <ActionButton label="Salida" tone="exit" busy={busy === l.id} onPress={() => void exit(l.id)} />
    </View>
  );

  const renderPending = (l: AccessLog) => {
    const state = l.response === "approved" ? "approved" : l.response === "denied" ? "denied" : "waiting";
    return (
      <View style={[styles.card, { alignItems: "flex-start" }]}>
        <View style={styles.iconBox}>
          <MaterialIcons name="doorbell" size={26} color={colors.warning} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={styles.name}>{l.names}</Text>
          <Text style={styles.meta}>{[`Filial ${unitLabel(l)}`, LOG_KIND_LABEL[l.kind], `desde ${fmtTime(l.createdAt)}`].join(" · ")}</Text>
          {l.plate && <Text style={styles.meta}>Placa {l.plate}</Text>}
          <Text style={[styles.response, { color: state === "approved" ? colors.success : state === "denied" ? colors.danger : colors.warning }]}>
            {state === "approved" ? "La filial autorizó el ingreso" : state === "denied" ? "La filial rechazó la visita" : "Esperando respuesta de la filial…"}
          </Text>
          <View style={{ flexDirection: "row", gap: 8, marginTop: 6 }}>
            {state !== "denied" && (
              <ActionButton label={state === "approved" ? "Ingreso" : "Llamar / confirmar"} tone="enter" busy={busy === l.id} onPress={() => void admitVisit(l)} />
            )}
            <ActionButton label={state === "denied" ? "Cerrar" : "No ingresa"} tone="exit" busy={false} onPress={() => void deny(l)} />
          </View>
        </View>
      </View>
    );
  };

  const searching = q.trim().length >= 2;

  return (
    <View style={styles.screen}>
      <View style={styles.searchBar}>
        <MaterialIcons name="search" size={22} color={colors.textMuted} />
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Nombre, cédula, placa o filial"
          placeholderTextColor={colors.textMuted}
          style={styles.search}
          autoCorrect={false}
          returnKeyType="search"
        />
        {q.length > 0 && (
          <Pressable hitSlop={10} onPress={() => setQ("")} accessibilityRole="button" accessibilityLabel="Limpiar búsqueda">
            <MaterialIcons name="close" size={20} color={colors.textMuted} />
          </Pressable>
        )}
      </View>

      <View style={styles.tabs}>
        {(
          [
            ["expected", "Esperados"],
            ["inside", "Adentro"],
            ["pending", "En caseta"]
          ] as const
        ).map(([key, label]) => (
          <Pressable key={key} style={[styles.tab, tab === key && styles.tabActive]} onPress={() => setTab(key)} accessibilityRole="tab" accessibilityLabel={`${label}, ${counts[key]}`} accessibilityState={{ selected: tab === key }}>
            <Text style={[styles.tabText, tab === key && styles.tabTextActive]}>{label}</Text>
            <View style={[styles.count, key === "pending" && counts.pending > 0 && { backgroundColor: colors.warning }]}>
              <Text style={styles.countText}>{counts[key]}</Text>
            </View>
          </Pressable>
        ))}
      </View>

      {error && (
        <View style={{ paddingHorizontal: 12, paddingTop: 10 }}>
          <Notice text={error} />
        </View>
      )}

      <FlatList<Authorization | AccessLog>
        data={(tab === "expected" ? board?.expected : tab === "inside" ? board?.inside : board?.pending) ?? []}
        keyExtractor={(x) => x.id}
        renderItem={({ item }) => (tab === "expected" ? renderExpected(item as Authorization) : tab === "inside" ? renderInside(item as AccessLog) : renderPending(item as AccessLog))}
        contentContainerStyle={{ padding: 12, gap: 10, paddingBottom: 110 }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={() => load()} />}
        ListHeaderComponent={
          tab === "expected" && searching && vehicles.length > 0 ? (
            <View style={{ gap: 10, marginBottom: 6 }}>
              <Text style={styles.section}>Vehículos de residentes</Text>
              {vehicles.map((v) => (
                <View key={v.id} style={styles.card}>
                  <View style={styles.iconBox}>
                    <MaterialIcons name="directions-car" size={26} color={colors.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.plate}>{v.plate}</Text>
                    <Text style={styles.meta}>
                      {[`Filial ${unitLabel(v)}`, [v.brand, v.model].filter(Boolean).join(" ") || VEHICLE_KIND[v.kind], v.color].filter(Boolean).join(" · ")}
                    </Text>
                  </View>
                  <ActionButton label="Ingreso" tone="enter" busy={busy === v.id} onPress={() => void admitVehicle(v)} />
                </View>
              ))}
              <Text style={styles.section}>Autorizados</Text>
            </View>
          ) : undefined
        }
        ListEmptyComponent={
          board ? (
            <EmptyState
              accent={searching ? "search" : "schedule"}
              icon={tab === "expected" ? "event-available" : tab === "inside" ? "meeting-room" : "doorbell"}
              title={
                searching
                  ? "Sin coincidencias"
                  : tab === "expected"
                    ? "Nadie esperado hoy"
                    : tab === "inside"
                      ? "No hay visitas adentro"
                      : "No hay visitas esperando"
              }
              text={tab === "expected" ? "Si llega alguien sin autorización, use + para avisar a la filial." : undefined}
            />
          ) : undefined
        }
        ListFooterComponent={
          <View style={{ marginTop: 24 }}>
            <AccountCard />
          </View>
        }
      />

      <Fab icon="person-add-alt-1" label="Visita no anunciada" onPress={() => router.push("/visit")} />
      <CallConfirm request={confirm} onClose={() => setConfirm(null)} busy={Boolean(busy)} />
    </View>
  );
}

function ActionButton({ label, tone, busy, onPress }: Readonly<{ label: string; tone: "enter" | "exit"; busy: boolean; onPress: () => void }>) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={busy}
      onPress={onPress}
      style={({ pressed }) => [styles.action, tone === "exit" && styles.actionExit, (pressed || busy) && { opacity: 0.6 }]}
    >
      <MaterialIcons name={tone === "enter" ? "login" : "logout"} size={18} color={tone === "enter" ? colors.onPrimary : colors.primary} />
      <Text style={[styles.actionText, tone === "exit" && { color: colors.primary }]}>{busy ? "…" : label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    margin: 12,
    marginBottom: 8,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border
  },
  search: { flex: 1, paddingVertical: 12, fontSize: 16, color: colors.text },
  tabs: { flexDirection: "row", backgroundColor: colors.background, borderBottomWidth: 1, borderBottomColor: colors.border },
  tab: { flex: 1, flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 6, paddingVertical: 12, borderBottomWidth: 3, borderBottomColor: "transparent" },
  tabActive: { borderBottomColor: colors.primary },
  tabText: { fontSize: 15, fontWeight: "600", color: colors.textMuted },
  tabTextActive: { color: colors.primary },
  count: { minWidth: 22, height: 22, borderRadius: 11, backgroundColor: colors.primaryTint, alignItems: "center", justifyContent: "center", paddingHorizontal: 5 },
  countText: { color: colors.onPrimary, fontSize: 12, fontWeight: "700" },
  card: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: colors.background, borderRadius: radius.md, padding: 12 },
  iconBox: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" },
  name: { fontSize: 16, fontWeight: "700", color: colors.text },
  plate: { fontSize: 18, fontWeight: "800", color: colors.text, letterSpacing: 1 },
  meta: { fontSize: 13, color: colors.textMuted },
  warn: { fontSize: 13, color: colors.warning, fontWeight: "700" },
  instructions: { fontSize: 13, color: colors.text, fontStyle: "italic" },
  response: { fontSize: 14, fontWeight: "700", marginTop: 2 },
  section: { fontSize: 13, fontWeight: "700", color: colors.textMuted, textTransform: "uppercase" },
  action: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: colors.primary, paddingHorizontal: 12, paddingVertical: 10, borderRadius: radius.sm },
  actionExit: { backgroundColor: colors.primarySoft },
  actionText: { color: colors.onPrimary, fontWeight: "700", fontSize: 14 }
});
