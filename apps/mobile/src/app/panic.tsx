/**
 * @project DomusApp - Mobile
 * @file src/app/panic.tsx
 * @description Botón de pánico: el residente elige el tipo de emergencia y la envía a la caseta
 *
 * Dos toques: tipo → "Enviar alerta". Llega a todos los guardas al instante con sonido y sigue activa
 * hasta que un guarda la marca como atendida. Un doble envío no duplica la alerta.
 */

import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, Vibration, View } from "react-native";
import { Chip, ScreenHeader } from "@/components/access";
import { Notice } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { unitLabel, type ResidentUnit } from "@/lib/access";
import { ALERT_KINDS, type AlertKind } from "@/lib/alerts";
import { colors, radius } from "@/theme/colors";

export default function PanicScreen() {
  const [kind, setKind] = useState<AlertKind | null>(null);
  const [notes, setNotes] = useState("");
  const [units, setUnits] = useState<ResidentUnit[]>([]);
  const [unitId, setUnitId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ units: ResidentUnit[] }>("/resident/home")
      .then((h) => {
        setUnits(h.units);
        setUnitId(h.units[0]?.id ?? null);
      })
      .catch(() => undefined);
  }, []);

  const send = async () => {
    if (!kind || sending) return;
    setSending(true);
    setError(null);
    try {
      const r = await api<{ id: string; duplicate: boolean }>("/resident/alerts", {
        method: "POST",
        body: { kind, unitId, notes: notes.trim() || null }
      });
      Vibration.vibrate(400);
      if (r.duplicate) Alert.alert("Ya tiene una alerta activa", "La caseta ya la recibió. Verá en Inicio cuando un guarda vaya en camino.");
      router.back();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo enviar. Si es urgente, llame al 911.");
    } finally {
      setSending(false);
    }
  };

  const selected = ALERT_KINDS.find((k) => k.kind === kind);

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.background }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScreenHeader title="Botón de pánico" />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.lead}>¿Qué está pasando?</Text>
        <View style={styles.grid}>
          {ALERT_KINDS.map((k) => {
            const on = kind === k.kind;
            return (
              <Pressable
                key={k.kind}
                onPress={() => setKind(k.kind)}
                style={[styles.tile, { borderColor: k.color }, on && { backgroundColor: k.color }]}
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
                accessibilityLabel={k.label}
              >
                <MaterialIcons name={k.icon} size={34} color={on ? colors.onPrimary : k.color} />
                <Text style={[styles.tileText, on && { color: colors.onPrimary }]}>{k.label}</Text>
              </Pressable>
            );
          })}
        </View>

        {units.length > 1 && (
          <View style={styles.wrap}>
            {units.map((u) => (
              <Chip key={u.id} label={unitLabel(u)} active={unitId === u.id} onPress={() => setUnitId(u.id)} />
            ))}
          </View>
        )}

        <TextInput
          value={notes}
          onChangeText={setNotes}
          placeholder="Detalle opcional (dónde, cuántas personas…)"
          placeholderTextColor={colors.textMuted}
          style={styles.input}
          maxLength={500}
          multiline
        />

        {error && <Notice text={error} />}

        <Pressable
          onPress={send}
          disabled={!kind || sending}
          style={({ pressed }) => [styles.send, (!kind || sending) && { opacity: 0.45 }, pressed && { opacity: 0.8 }]}
          accessibilityRole="button"
          accessibilityLabel="Enviar alerta a la caseta"
        >
          <MaterialIcons name="notifications-active" size={32} color={colors.onPrimary} />
          <Text style={styles.sendText}>{sending ? "Enviando…" : selected ? `Enviar alerta de ${selected.label.toLowerCase()}` : "Elija el tipo de emergencia"}</Text>
        </Pressable>
        <Text style={styles.hint}>Llega a todos los guardas de turno con sonido. Ante peligro inmediato, llame también al 911.</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 14, paddingBottom: 40 },
  lead: { fontSize: 20, fontWeight: "700", color: colors.text },
  grid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: 10 },
  tile: { width: "48.5%", borderWidth: 2, borderRadius: radius.md, paddingVertical: 16, alignItems: "center", gap: 6 },
  tileText: { fontSize: 15, fontWeight: "700", color: colors.text, textAlign: "center" },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: 12, fontSize: 15, color: colors.text, minHeight: 64, textAlignVertical: "top" },
  send: { backgroundColor: colors.danger, borderRadius: radius.md, paddingVertical: 20, paddingHorizontal: 16, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 12 },
  sendText: { color: colors.onPrimary, fontSize: 18, fontWeight: "800", flexShrink: 1, textAlign: "center" },
  hint: { fontSize: 13, color: colors.textMuted, textAlign: "center" }
});
