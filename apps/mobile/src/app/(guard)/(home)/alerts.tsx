/**
 * @project DomusApp - Mobile
 * @file src/app/(guard)/(home)/alerts.tsx
 * @description Alertas de la caseta: abiertas (tomar / cerrar con resolución) y atendidas en las últimas 24 h
 */

import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useState } from "react";
import { Alert, Linking, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { EmptyState, Section } from "@/components/access";
import { Button, Notice } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { fmtTime } from "@/lib/access";
import { ALERT_STATUS, alertMeta, fmtDuration, type AlertItem } from "@/lib/alerts";
import { ackAlert, attendAlert, loadGuardAlerts, useGuardAlerts } from "@/lib/guardAlerts";
import { colors, radius } from "@/theme/colors";

export default function GuardAlertsScreen() {
  const { open, recent, loaded, error } = useGuardAlerts();
  const [refreshing, setRefreshing] = useState(false);
  const [closing, setClosing] = useState<AlertItem | null>(null);
  const [resolution, setResolution] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = async () => {
    setRefreshing(true);
    await loadGuardAlerts();
    setRefreshing(false);
  };

  const run = async (id: string, fn: () => Promise<void>) => {
    setBusy(id);
    try {
      await fn();
      return true;
    } catch (err) {
      Alert.alert("No se pudo registrar", err instanceof ApiError ? err.message : "Intente de nuevo");
      void loadGuardAlerts();
      return false;
    } finally {
      setBusy(null);
    }
  };

  const close = async () => {
    if (!closing || resolution.trim().length < 3) return;
    if (await run(closing.id, () => attendAlert(closing.id, resolution.trim()))) {
      setClosing(null);
      setResolution("");
    }
  };

  const renderOpen = (a: AlertItem) => {
    const meta = alertMeta(a.kind);
    const st = ALERT_STATUS[a.status];
    const phone = a.phones[0];
    return (
      <View key={a.id} style={[styles.card, { borderLeftColor: st.color }]} accessibilityLiveRegion="polite">
        <View style={styles.row}>
          <MaterialIcons name={meta.icon} size={34} color={meta.color} />
          <View style={{ flex: 1 }}>
            <Text style={styles.kind}>
              {meta.label}
              {a.unitCode ? ` · ${a.unitCode}` : ""}
            </Text>
            <Text style={[styles.status, { color: st.color }]}>
              {a.status === "acknowledged" ? `${a.acknowledgedByName ?? "Un guarda"} va en camino` : "Nadie la ha tomado"}
            </Text>
            <Text style={styles.meta}>
              {a.raisedByName ?? "—"} · {fmtTime(a.raisedAt)}
            </Text>
            {a.notes && <Text style={styles.notes}>“{a.notes}”</Text>}
          </View>
        </View>
        <View style={styles.actions}>
          {phone && (
            <Pressable
              style={[styles.btn, styles.light]}
              onPress={() => void Linking.openURL(`tel:${phone.phone.replace(/[^\d+]/g, "")}`)}
              accessibilityRole="button"
              accessibilityLabel={`Llamar a ${phone.names}`}
            >
              <MaterialIcons name="call" size={18} color={colors.success} />
              <Text style={[styles.btnText, { color: colors.success }]}>Llamar</Text>
            </Pressable>
          )}
          {a.status === "active" && (
            <Pressable
              style={[styles.btn, { backgroundColor: colors.danger }]}
              disabled={busy === a.id}
              onPress={() => void run(a.id, () => ackAlert(a.id))}
              accessibilityRole="button"
              accessibilityLabel={`Voy en camino a ${a.unitCode ?? "la alerta"}`}
              accessibilityState={{ busy: busy === a.id }}
            >
              <MaterialIcons name="directions-run" size={18} color={colors.onPrimary} />
              <Text style={styles.btnText}>Voy en camino</Text>
            </Pressable>
          )}
          <Pressable
            style={[styles.btn, { backgroundColor: colors.success }]}
            onPress={() => setClosing(a)}
            accessibilityRole="button"
            accessibilityLabel={`Marcar atendida la alerta de ${meta.label.toLowerCase()}`}
          >
            <MaterialIcons name="check" size={18} color={colors.onPrimary} />
            <Text style={styles.btnText}>Atendida</Text>
          </Pressable>
        </View>
      </View>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <ScrollView contentContainerStyle={{ padding: 12, gap: 10, paddingBottom: 40 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}>
        {error && <Notice text={error} />}
        <Section title="Abiertas" count={open.length}>
          {open.length === 0 && loaded ? <EmptyState compact icon="verified-user" accent="check" title="Sin alertas abiertas" text="Cuando una filial active el botón de pánico, sonará la sirena." /> : open.map(renderOpen)}
        </Section>
        {recent.length > 0 && (
          <Section title="Atendidas (24 h)" count={recent.length}>
            {recent.map((a) => {
              const meta = alertMeta(a.kind);
              return (
                <View key={a.id} style={[styles.card, { borderLeftColor: colors.success }]}>
                  <View style={styles.row}>
                    <MaterialIcons name={meta.icon} size={26} color={colors.textMuted} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.doneTitle}>
                        {meta.label}
                        {a.unitCode ? ` · ${a.unitCode}` : ""} · {fmtTime(a.raisedAt)}
                      </Text>
                      <Text style={styles.meta}>
                        Respuesta {fmtDuration(a.ackSeconds)} · cierre {fmtDuration(a.attendSeconds)} · {a.attendedByName ?? "—"}
                      </Text>
                      {a.resolution && <Text style={styles.resolution}>{a.resolution}</Text>}
                    </View>
                  </View>
                </View>
              );
            })}
          </Section>
        )}
      </ScrollView>

      <Modal visible={Boolean(closing)} transparent animationType="slide" onRequestClose={() => setClosing(null)}>
        <Pressable style={styles.backdrop} onPress={() => setClosing(null)} accessibilityRole="button" accessibilityLabel="Cerrar" />
        <View style={styles.sheet}>
          <Text style={styles.sheetTitle}>Cerrar alerta{closing ? ` de ${alertMeta(closing.kind).label.toLowerCase()}` : ""}</Text>
          <Text style={styles.meta}>Escriba qué se hizo. La filial lo recibe y queda en el historial.</Text>
          <TextInput
            value={resolution}
            onChangeText={setResolution}
            placeholder="Ej.: Ronda en el patio, sin novedad. Se habló con el propietario."
            placeholderTextColor={colors.textMuted}
            style={styles.input}
            multiline
            maxLength={1000}
            autoFocus
          />
          <Button title="Marcar atendida" onPress={close} loading={busy === closing?.id} disabled={resolution.trim().length < 3} />
          <Button title="Cancelar" variant="ghost" onPress={() => setClosing(null)} />
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.background, borderRadius: radius.md, padding: 14, gap: 10, borderLeftWidth: 5 },
  row: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  kind: { fontSize: 18, fontWeight: "800", color: colors.text },
  status: { fontSize: 14, fontWeight: "700", marginTop: 2 },
  meta: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
  notes: { fontSize: 14, color: colors.text, fontStyle: "italic", marginTop: 4 },
  actions: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  btn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 10, minHeight: 44, borderRadius: radius.sm },
  light: { backgroundColor: "#e8f8f0" },
  btnText: { color: colors.onPrimary, fontWeight: "700", fontSize: 14 },
  doneTitle: { fontSize: 15, fontWeight: "700", color: colors.text },
  resolution: { fontSize: 13, color: colors.text, marginTop: 4 },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)" },
  sheet: { backgroundColor: colors.background, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: 20, paddingBottom: 32, gap: 12 },
  sheetTitle: { fontSize: 19, fontWeight: "700", color: colors.text },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: 12, fontSize: 16, color: colors.text, minHeight: 96, textAlignVertical: "top" }
});
