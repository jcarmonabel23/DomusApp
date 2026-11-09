/**
 * @project DomusApp - Mobile
 * @file src/components/AlarmOverlay.tsx
 * @description Alarma de la caseta: mientras haya una alerta que ningún guarda ha tomado, ocupa la pantalla
 *              completa, suena la sirena en bucle y vibra. "Voy en camino" la toma (y la apaga para todos);
 *              la alerta sigue abierta en la pestaña Alertas hasta marcarla atendida.
 */

import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { setAudioModeAsync, useAudioPlayer } from "expo-audio";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { AccessibilityInfo, Alert, Linking, Modal, Pressable, ScrollView, StyleSheet, Text, Vibration, View } from "react-native";
import { ApiError } from "@/lib/api";
import { fmtTime } from "@/lib/access";
import { alertMeta, type AlertItem } from "@/lib/alerts";
import { ackAlert, applyAlert, loadGuardAlerts, useGuardAlerts } from "@/lib/guardAlerts";
import { useRealtime } from "@/lib/realtime";
import { colors, radius } from "@/theme/colors";

const SIREN = require("../../assets/sounds/alarm.wav");

export function AlarmOverlay() {
  const { open } = useGuardAlerts();
  const ringing = open.filter((a) => a.status === "active");
  const player = useAudioPlayer(SIREN);
  const [busy, setBusy] = useState<string | null>(null);

  // Datos: carga inicial, socket y respaldo cada 30 s (por si el socket se cayó sin avisar)
  useEffect(() => {
    void setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: true, interruptionMode: "doNotMix" }).catch(() => undefined);
    void loadGuardAlerts();
    const t = setInterval(() => void loadGuardAlerts(), 30_000);
    return () => clearInterval(t);
  }, []);
  useRealtime<AlertItem>("alert:new", applyAlert);
  useRealtime<AlertItem>("alert:update", applyAlert);
  useRealtime("connected", () => void loadGuardAlerts());
  useRealtime("resumed", () => void loadGuardAlerts());

  // Lector de pantalla: anuncia cada alerta nueva (la sirena no le dice qué ni dónde)
  const newest = ringing[ringing.length - 1];
  useEffect(() => {
    if (newest) AccessibilityInfo.announceForAccessibility(`Alerta de pánico: ${alertMeta(newest.kind).label}${newest.unitCode ? `, filial ${newest.unitCode}` : ""}`);
  }, [newest?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sirena y vibración mientras haya alertas sin tomar
  useEffect(() => {
    if (ringing.length > 0) {
      player.loop = true;
      player.volume = 1;
      player.play();
      Vibration.vibrate([0, 800, 400, 800], true);
    } else {
      player.pause();
      void player.seekTo(0);
      Vibration.cancel();
    }
    return () => Vibration.cancel();
  }, [ringing.length, player]);

  const take = async (a: AlertItem) => {
    setBusy(a.id);
    try {
      await ackAlert(a.id);
      router.push("/alerts");
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) void loadGuardAlerts();
      else Alert.alert("No se pudo tomar la alerta", err instanceof ApiError ? err.message : "Intente de nuevo");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal visible={ringing.length > 0} animationType="fade" onRequestClose={() => undefined} statusBarTranslucent>
      <View style={styles.screen}>
        <MaterialIcons name="notifications-active" size={72} color={colors.onPrimary} />
        <Text style={styles.heading} accessibilityRole="header">{ringing.length === 1 ? "ALERTA DE PÁNICO" : `${ringing.length} ALERTAS DE PÁNICO`}</Text>
        <ScrollView style={{ alignSelf: "stretch" }} contentContainerStyle={{ gap: 12, paddingBottom: 12 }}>
          {ringing.map((a) => {
            const meta = alertMeta(a.kind);
            const phone = a.phones[0];
            return (
              <View key={a.id} style={styles.card}>
                <View style={styles.row}>
                  <MaterialIcons name={meta.icon} size={40} color={meta.color} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.kind}>{meta.label}</Text>
                    <Text style={styles.unit}>{a.unitCode ? `Filial ${a.unitCode}${a.unitTower ? ` · ${a.unitTower}` : ""}` : "Sin filial"}</Text>
                    <Text style={styles.meta}>
                      {a.raisedByName ?? "—"} · {fmtTime(a.raisedAt)}
                    </Text>
                  </View>
                </View>
                {a.notes && <Text style={styles.notes}>“{a.notes}”</Text>}
                <View style={{ flexDirection: "row", gap: 10 }}>
                  {phone && (
                    <Pressable
                      style={[styles.btn, styles.call]}
                      onPress={() => void Linking.openURL(`tel:${phone.phone.replace(/[^\d+]/g, "")}`)}
                      accessibilityRole="button"
                      accessibilityLabel={`Llamar a ${phone.names}`}
                    >
                      <MaterialIcons name="call" size={22} color={colors.success} />
                      <Text style={[styles.btnText, { color: colors.success }]}>Llamar</Text>
                    </Pressable>
                  )}
                  <Pressable
                    style={[styles.btn, styles.go, busy === a.id && { opacity: 0.6 }]}
                    disabled={busy === a.id}
                    onPress={() => void take(a)}
                    accessibilityRole="button"
                    accessibilityLabel={`Voy en camino a ${a.unitCode ?? "la alerta"}`}
                  >
                    <MaterialIcons name="directions-run" size={24} color={colors.onPrimary} />
                    <Text style={styles.btnText}>{busy === a.id ? "…" : "Voy en camino"}</Text>
                  </Pressable>
                </View>
              </View>
            );
          })}
        </ScrollView>
        <Text style={styles.foot}>La sirena se apaga cuando un guarda toma la alerta.</Text>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#b71c1c", alignItems: "center", paddingTop: 60, paddingHorizontal: 16, paddingBottom: 24, gap: 12 },
  heading: { color: colors.onPrimary, fontSize: 26, fontWeight: "900", letterSpacing: 1, textAlign: "center" },
  card: { backgroundColor: colors.background, borderRadius: radius.lg, padding: 16, gap: 12 },
  row: { flexDirection: "row", gap: 12, alignItems: "center" },
  kind: { fontSize: 22, fontWeight: "800", color: colors.text },
  unit: { fontSize: 18, fontWeight: "700", color: colors.text },
  meta: { fontSize: 14, color: colors.textMuted },
  notes: { fontSize: 16, color: colors.text, fontStyle: "italic" },
  btn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 14, borderRadius: radius.sm },
  call: { flex: 1, backgroundColor: "#e8f8f0" },
  go: { flex: 2, backgroundColor: colors.danger },
  btnText: { color: colors.onPrimary, fontSize: 17, fontWeight: "800" },
  foot: { color: "#ffe0e0", fontSize: 13, textAlign: "center" }
});
