/**
 * @project DomusApp - Mobile
 * @file src/app/assembly.tsx
 * @description Detalle de una asamblea: fecha, lugar o enlace, agenda, resultado (asistencia y quórum), acta y acuerdos
 */

import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Linking, ScrollView, StyleSheet, Text, View } from "react-native";
import { ScreenHeader } from "@/components/access";
import { Button, Notice } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { dayText } from "@/lib/bookings";
import { AGREEMENT_STATUS, ASSEMBLY_KIND, fmtDay, openFile, type Agreement, type Assembly } from "@/lib/community";
import { useBrand } from "@/theme/brand";
import { colors, radius } from "@/theme/colors";
import { ASSEMBLY_STATUS } from "./assemblies";

export function AgreementCard({ g, showAssembly }: Readonly<{ g: Agreement; showAssembly?: boolean }>) {
  const st = AGREEMENT_STATUS[g.status];
  return (
    <View style={styles.agreement}>
      {showAssembly && (
        <Text style={styles.meta}>
          {g.assemblyTitle} · {fmtDay(g.assemblyDate)}
        </Text>
      )}
      <Text style={styles.agTitle}>
        {g.number}. {g.title}
      </Text>
      {g.description && <Text style={styles.body}>{g.description}</Text>}
      <View style={styles.row}>
        <View style={[styles.badge, { backgroundColor: st.bg }]}>
          <Text style={[styles.badgeText, { color: st.fg }]}>{st.label}</Text>
        </View>
        {g.dueOn && (
          <Text style={[styles.meta, g.overdue && { color: colors.danger, fontWeight: "700" }]}>
            {g.overdue ? "Venció" : "Para"} el {fmtDay(g.dueOn)}
          </Text>
        )}
      </View>
      {(g.responsible || g.supplierName) && <Text style={styles.meta}>Responsable: {[g.responsible, g.supplierName].filter(Boolean).join(" · ")}</Text>}
      {g.progressNotes && <Text style={styles.progress}>Avance: {g.progressNotes}</Text>}
    </View>
  );
}

export default function AssemblyScreen() {
  const brand = useBrand();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [a, setA] = useState<(Assembly & { agreements: Agreement[] }) | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Assembly & { agreements: Agreement[] }>(`/resident/assemblies/${id}`)
      .then(setA)
      .catch((err) => setError(err instanceof ApiError ? err.message : "No se pudo cargar la asamblea"));
  }, [id]);

  if (!a) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.surface }}>
        <ScreenHeader title="Asamblea" />
        <View style={{ padding: 16 }}>{error ? <Notice text={error} /> : <ActivityIndicator color={brand.primary} />}</View>
      </View>
    );
  }

  const st = ASSEMBLY_STATUS[a.status];
  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <ScreenHeader title="Asamblea" />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.card}>
          <View style={[styles.badge, { backgroundColor: st.bg, alignSelf: "flex-start" }]}>
            <Text style={[styles.badgeText, { color: st.fg }]}>{st.label}</Text>
          </View>
          <Text style={styles.title}>{a.title}</Text>
          <Info icon="event" text={`${dayText(a.date)} · ${a.time} · ${ASSEMBLY_KIND[a.kind]}`} />
          {a.location && <Info icon="place" text={a.location} />}
          {a.status === "cancelled" && <Notice text={`Cancelada: ${a.cancelReason ?? ""}`} />}
          {a.meetingUrl && a.status === "scheduled" && <Button title="Unirse a la videollamada" variant="ghost" onPress={() => void Linking.openURL(a.meetingUrl!)} />}
        </View>

        {a.status === "held" && (
          <View style={styles.card}>
            <Text style={styles.section}>Resultado</Text>
            {a.attendanceUnits !== null && (
              <Info icon="groups" text={`Asistieron ${a.attendanceUnits} de ${a.totalUnits} filiales${a.quorumReached ? " · hubo quórum" : a.quorumReached === false ? " · sin quórum" : ""}`} />
            )}
            {a.summary && <Text style={styles.body}>{a.summary}</Text>}
          </View>
        )}

        {a.agenda && (
          <View style={styles.card}>
            <Text style={styles.section}>Agenda</Text>
            <Text style={styles.body}>{a.agenda}</Text>
          </View>
        )}

        {a.minutes && <Button title={a.minutes.kind === "pdf" ? "Descargar el acta (PDF)" : "Ver el acta"} onPress={() => void openFile(a.minutes)} />}

        {a.agreements.length > 0 && (
          <>
            <Text style={[styles.section, { marginTop: 4 }]}>Acuerdos</Text>
            {a.agreements.map((g) => (
              <AgreementCard key={g.id} g={g} />
            ))}
          </>
        )}
      </ScrollView>
    </View>
  );
}

function Info({ icon, text }: Readonly<{ icon: "event" | "place" | "groups"; text: string }>) {
  return (
    <View style={styles.info}>
      <MaterialIcons name={icon} size={18} color={colors.textMuted} />
      <Text style={[styles.body, { flex: 1 }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 12, paddingBottom: 40 },
  card: { backgroundColor: colors.background, borderRadius: radius.md, padding: 14, gap: 8 },
  title: { fontSize: 20, fontWeight: "800", color: colors.text },
  section: { fontSize: 16, fontWeight: "700", color: colors.text },
  body: { fontSize: 15, color: colors.text, lineHeight: 21 },
  meta: { fontSize: 13, color: colors.textMuted },
  info: { flexDirection: "row", alignItems: "center", gap: 8 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" },
  badge: { borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 3 },
  badgeText: { fontSize: 12, fontWeight: "700" },
  agreement: { backgroundColor: colors.background, borderRadius: radius.md, padding: 14, gap: 6 },
  agTitle: { fontSize: 16, fontWeight: "700", color: colors.text },
  progress: { fontSize: 14, color: colors.text, fontStyle: "italic" }
});
