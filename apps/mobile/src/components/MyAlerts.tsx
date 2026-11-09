/**
 * @project DomusApp - Mobile
 * @file src/components/MyAlerts.tsx
 * @description Alertas abiertas de la cuenta o sus filiales, con su estado en vivo (enviada → en camino → atendida)
 */

import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useCallback, useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { api } from "@/lib/api";
import { fmtTime } from "@/lib/access";
import { ALERT_STATUS, alertMeta, type AlertItem } from "@/lib/alerts";
import { useRealtime } from "@/lib/realtime";
import { colors, radius } from "@/theme/colors";

export function MyAlerts({ refreshKey }: Readonly<{ refreshKey?: number }>) {
  const [open, setOpen] = useState<AlertItem[]>([]);
  const [closed, setClosed] = useState<AlertItem | null>(null);

  const load = useCallback(async () => {
    const r = await api<{ open: AlertItem[]; recent: AlertItem[] }>("/resident/alerts").catch(() => null);
    if (r) setOpen(r.open);
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  useRealtime<AlertItem>("alert:update", (a) => {
    if (a.status === "attended") {
      setOpen((list) => list.filter((x) => x.id !== a.id));
      setClosed(a);
    } else {
      setOpen((list) => (list.some((x) => x.id === a.id) ? list.map((x) => (x.id === a.id ? a : x)) : [a, ...list]));
    }
  });
  useRealtime("resumed", () => void load());

  if (open.length === 0 && !closed) return null;

  return (
    <View style={{ gap: 10, marginHorizontal: 16, marginTop: 16 }}>
      {open.map((a) => {
        const meta = alertMeta(a.kind);
        const st = ALERT_STATUS[a.status];
        return (
          <View key={a.id} style={[styles.card, { borderColor: st.color }]} accessible accessibilityLiveRegion="polite">
            <MaterialIcons name={meta.icon} size={32} color={meta.color} />
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>
                Alerta de {meta.label.toLowerCase()}
                {a.unitCode ? ` · ${a.unitCode}` : ""}
              </Text>
              <Text style={[styles.status, { color: st.color }]}>{st.label}</Text>
              <Text style={styles.meta}>
                {a.status === "acknowledged" && a.acknowledgedByName
                  ? `${a.acknowledgedByName} la tomó a las ${fmtTime(a.acknowledgedAt)}`
                  : `Enviada a las ${fmtTime(a.raisedAt)} por ${a.raisedByName ?? "su filial"}`}
              </Text>
            </View>
          </View>
        );
      })}
      {closed && (
        <View style={[styles.card, { borderColor: colors.success }]}>
          <MaterialIcons name="check-circle" size={32} color={colors.success} />
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Alerta de {alertMeta(closed.kind).label.toLowerCase()} atendida</Text>
            {closed.resolution && <Text style={styles.meta}>{closed.resolution}</Text>}
            <Text style={styles.dismiss} onPress={() => setClosed(null)} accessibilityRole="button">
              Entendido
            </Text>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: "row", gap: 12, alignItems: "flex-start", borderWidth: 2, borderRadius: radius.md, padding: 14, backgroundColor: colors.background },
  title: { fontSize: 16, fontWeight: "700", color: colors.text },
  status: { fontSize: 15, fontWeight: "800", marginTop: 2 },
  meta: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
  dismiss: { color: colors.primary, fontWeight: "700", marginTop: 4, paddingVertical: 10 }
});
