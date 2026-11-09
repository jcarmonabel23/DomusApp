/**
 * @project DomusApp - Mobile
 * @file src/components/PendingVisits.tsx
 * @description Visitas no anunciadas que esperan en la caseta: el residente las deja pasar o las rechaza
 */

import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";
import { Button } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { LOG_KIND_LABEL, fmtTime, type AccessLog } from "@/lib/access";
import { colors, radius } from "@/theme/colors";

export function PendingVisits({ visits, onChange }: Readonly<{ visits: AccessLog[]; onChange: () => void }>) {
  const [busy, setBusy] = useState<string | null>(null);

  const respond = async (v: AccessLog, approve: boolean) => {
    setBusy(v.id + approve);
    try {
      await api(`/resident/visits/${v.id}/respond`, { method: "POST", body: { approve } });
    } catch (err) {
      Alert.alert("No se pudo responder", err instanceof ApiError ? err.message : "Intente de nuevo");
    } finally {
      setBusy(null);
      onChange();
    }
  };

  if (visits.length === 0) return null;

  return (
    <View style={{ gap: 10, marginHorizontal: 16, marginTop: 16 }}>
      {visits.map((v) => (
        <View key={v.id} style={styles.card}>
          <View style={styles.head}>
            <MaterialIcons name="doorbell" size={28} color={colors.warning} />
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>{v.names} está en la caseta</Text>
              <Text style={styles.meta}>
                {[LOG_KIND_LABEL[v.kind] ?? v.kind, v.plate && `Placa ${v.plate}`, `Filial ${v.unitCode}`, `desde las ${fmtTime(v.createdAt)}`]
                  .filter(Boolean)
                  .join(" · ")}
              </Text>
              {v.notes && <Text style={styles.notes}>{v.notes}</Text>}
            </View>
          </View>
          <View style={{ flexDirection: "row", gap: 10 }}>
            <View style={{ flex: 1 }}>
              <Button title="Rechazar" variant="danger" onPress={() => respond(v, false)} loading={busy === `${v.id}false`} disabled={Boolean(busy)} />
            </View>
            <View style={{ flex: 1 }}>
              <Button title="Dejar pasar" onPress={() => respond(v, true)} loading={busy === `${v.id}true`} disabled={Boolean(busy)} />
            </View>
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: "#fff7e6", borderRadius: radius.md, borderWidth: 1, borderColor: colors.warning, padding: 14, gap: 12 },
  head: { flexDirection: "row", gap: 12 },
  title: { fontSize: 16, fontWeight: "700", color: colors.text },
  meta: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
  notes: { fontSize: 13, color: colors.text, marginTop: 4, fontStyle: "italic" }
});
