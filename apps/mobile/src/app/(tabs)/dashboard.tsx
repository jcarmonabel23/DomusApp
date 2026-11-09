/**
 * @project DomusApp - Mobile
 * @file src/app/(tabs)/dashboard.tsx
 * @description Mi dashboard: casos, últimas visitas, proveedores y mensajería (se llena por fases)
 */

import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState, type ComponentProps } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { api } from "@/lib/api";
import { fmtDateTime, type AccessLog } from "@/lib/access";
import type { Thread } from "@/lib/alerts";
import { useRealtime } from "@/lib/realtime";
import { colors, radius } from "@/theme/colors";

type Card = {
  title: string;
  text: string;
  icon: ComponentProps<typeof MaterialIcons>["name"];
  bg: string;
  fg: string;
  tall?: boolean;
  onPress?: () => void;
  badge?: number;
};

const LEFT: Card[] = [
  { title: "Casos", text: "Dale seguimiento a tus casos aquí", icon: "support-agent", bg: colors.cardYellow, fg: "#5b4a1a", tall: true },
  { title: "Nuevos proveedores", text: "Fase 7", icon: "storefront", bg: colors.cardLavender, fg: "#3f4566" }
];
const VISITS: Omit<Card, "text"> = { title: "Mis últimas visitas", icon: "history", bg: colors.cardNavy, fg: "#e8ebf7" };


/** Tarjeta de visitas: las tres más recientes o el ícono si aún no hay */
function VisitsCard({ visits }: Readonly<{ visits: AccessLog[] | null }>) {
  const c = VISITS;
  return (
    <Pressable
      onPress={() => router.push("/visits")}
      accessibilityRole="button"
      style={({ pressed }) => [styles.card, { backgroundColor: c.bg, minHeight: 200 }, pressed && { opacity: 0.85 }]}
    >
      <Text style={[styles.cardTitle, { color: c.fg }]}>{c.title}</Text>
      {visits && visits.length > 0 ? (
        <View style={{ alignSelf: "stretch", gap: 8 }}>
          {visits.slice(0, 3).map((v) => (
            <View key={v.id}>
              <Text style={[styles.visitName, { color: c.fg }]} numberOfLines={1}>
                {v.names}
              </Text>
              <Text style={[styles.visitTime, { color: c.fg }]}>{fmtDateTime(v.entryAt ?? v.createdAt)}</Text>
            </View>
          ))}
        </View>
      ) : (
        <MaterialIcons name={c.icon} size={72} color={c.fg} style={{ opacity: 0.8 }} />
      )}
      <Text style={[styles.cardText, { color: c.fg }]}>{visits && visits.length > 0 ? "Ver todas" : "Sin visitas aún"}</Text>
    </Pressable>
  );
}

function DashCard({ card }: Readonly<{ card: Card }>) {
  return (
    <Pressable
      disabled={!card.onPress}
      onPress={card.onPress}
      accessibilityRole={card.onPress ? "button" : undefined}
      style={({ pressed }) => [styles.card, { backgroundColor: card.bg, minHeight: card.tall ? 300 : 200 }, pressed && { opacity: 0.85 }]}
    >
      {Boolean(card.badge) && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{card.badge}</Text>
        </View>
      )}
      <Text style={[styles.cardTitle, { color: card.fg }]}>{card.title}</Text>
      <MaterialIcons name={card.icon} size={72} color={card.fg} style={{ opacity: 0.8 }} />
      <Text style={[styles.cardText, { color: card.fg }]}>{card.text}</Text>
    </Pressable>
  );
}

export default function DashboardScreen() {
  const [visits, setVisits] = useState<AccessLog[] | null>(null);
  const [threads, setThreads] = useState<Thread[]>([]);

  const loadThreads = useCallback(() => {
    api<Thread[]>("/messages/threads")
      .then(setThreads)
      .catch(() => undefined);
  }, []);

  useFocusEffect(
    useCallback(() => {
      api<{ recent: AccessLog[] }>("/resident/visits?limit=3")
        .then((r) => setVisits(r.recent))
        .catch(() => setVisits([]));
      loadThreads();
    }, [loadThreads])
  );
  useRealtime("message:new", loadThreads);

  const unreadMessages = threads.reduce((n, t) => n + t.unread, 0);
  const messaging: Card = {
    title: "Mensajería",
    text: unreadMessages > 0 ? `${unreadMessages} mensaje(s) nuevo(s) de la caseta` : "Escríbale a la caseta",
    icon: "markunread-mailbox",
    bg: colors.cardSalmon,
    fg: "#5a2a1a",
    tall: true,
    badge: unreadMessages,
    // Con una sola filial se abre directo su conversación
    onPress: () =>
      threads.length === 1 ? router.push({ pathname: "/chat", params: { unitId: threads[0].unitId } }) : router.push("/threads")
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.columns}>
      <View style={styles.col}>
        {LEFT.map((c) => (
          <DashCard key={c.title} card={c} />
        ))}
      </View>
      <View style={styles.col}>
        <VisitsCard visits={visits} />
        <DashCard card={messaging} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  columns: { flexDirection: "row", padding: 10, gap: 10 },
  col: { flex: 1, gap: 10 },
  card: { borderRadius: radius.md, padding: 16, alignItems: "center", justifyContent: "space-between" },
  cardTitle: { fontSize: 20, fontWeight: "600", textAlign: "center" },
  cardText: { fontSize: 16, textAlign: "center" },
  visitName: { fontSize: 14, fontWeight: "700" },
  visitTime: { fontSize: 12, opacity: 0.8 },
  badge: {
    position: "absolute",
    top: 10,
    right: 10,
    minWidth: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.danger,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6
  },
  badgeText: { color: colors.onPrimary, fontWeight: "800" }
});
