/**
 * @project DomusApp - Mobile
 * @file src/app/chat.tsx
 * @description Conversación de una filial con la caseta (la usan el residente y el guarda)
 *
 * Parámetro: unitId. Los mensajes nuevos llegan por el socket; al abrir se marca como leído.
 */

import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Linking, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { EmptyState, ScreenHeader } from "@/components/access";
import { Notice } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { fmtDateTime, unitLabel, type Phone } from "@/lib/access";
import type { ChatMessage } from "@/lib/alerts";
import { useRealtime } from "@/lib/realtime";
import { colors, radius } from "@/theme/colors";

interface Thread {
  unit: { id: string; code: string; tower: string | null; phones?: Phone[] };
  side: "guard" | "resident";
  messages: ChatMessage[];
}

export default function ChatScreen() {
  const { unitId } = useLocalSearchParams<{ unitId: string }>();
  const insets = useSafeAreaInsets();
  const [thread, setThread] = useState<Thread | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const list = useRef<FlatList<ChatMessage>>(null);

  const load = useCallback(async () => {
    try {
      setThread(await api<Thread>(`/messages/threads/${unitId}`));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo cargar la conversación");
    }
  }, [unitId]);

  useEffect(() => {
    void load();
  }, [load]);

  useRealtime<ChatMessage>("message:new", (m) => {
    if (m.unitId !== unitId) return;
    setThread((t) => (t && !t.messages.some((x) => x.id === m.id) ? { ...t, messages: [...t.messages, m] } : t));
    // Estoy mirando la conversación: queda leída
    void api(`/messages/threads/${unitId}/read`, { method: "POST", body: {} }).catch(() => undefined);
  });
  useRealtime("resumed", () => void load());

  const send = async () => {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      const m = await api<ChatMessage>(`/messages/threads/${unitId}`, { method: "POST", body: { body } });
      setText("");
      setThread((t) => (t && !t.messages.some((x) => x.id === m.id) ? { ...t, messages: [...t.messages, m] } : t));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo enviar");
    } finally {
      setSending(false);
    }
  };

  const title = !thread ? "Mensajes" : thread.side === "guard" ? `Filial ${unitLabel(thread.unit)}` : "Caseta";
  const phone = thread?.unit.phones?.[0];

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.surface }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScreenHeader
        title={title}
        right={
          phone ? (
            <Pressable onPress={() => void Linking.openURL(`tel:${phone.phone.replace(/[^\d+]/g, "")}`)} hitSlop={10} accessibilityRole="button" accessibilityLabel={`Llamar a ${phone.names}`}>
              <MaterialIcons name="call" size={26} color={colors.onPrimary} />
            </Pressable>
          ) : undefined
        }
      />
      {error && (
        <View style={{ padding: 12 }}>
          <Notice text={error} />
        </View>
      )}
      {!thread && !error ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={colors.primary} />
      ) : (
        <FlatList
          ref={list}
          data={thread?.messages ?? []}
          keyExtractor={(m) => m.id}
          contentContainerStyle={{ padding: 12, gap: 6 }}
          onContentSizeChange={() => list.current?.scrollToEnd({ animated: false })}
          renderItem={({ item: m }) => {
            const mine = m.side === thread?.side;
            return (
              <View style={[styles.bubble, mine ? styles.mine : styles.theirs]}>
                {!mine && <Text style={styles.sender}>{m.side === "guard" ? `Caseta · ${m.senderName ?? ""}` : (m.senderName ?? "Filial")}</Text>}
                <Text style={[styles.text, mine && { color: colors.onPrimary }]}>{m.body}</Text>
                <Text style={[styles.time, mine && { color: "#dbeafe" }]}>{fmtDateTime(m.createdAt)}</Text>
              </View>
            );
          }}
          ListEmptyComponent={
            <EmptyState
              compact
              icon="forum"
              accent="edit"
              title="Aún no hay mensajes"
              text={thread?.side === "guard" ? "Escriba a la filial: le llega a todas sus cuentas." : "Escriba a la caseta: cualquier guarda de turno le responde."}
            />
          }
        />
      )}
      <View style={[styles.composer, { paddingBottom: 10 + insets.bottom }]}>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder="Escriba un mensaje"
          placeholderTextColor={colors.textMuted}
          style={styles.input}
          multiline
          maxLength={2000}
        />
        <Pressable onPress={send} disabled={!text.trim() || sending} style={[styles.send, (!text.trim() || sending) && { opacity: 0.5 }]}
          accessibilityRole="button"
          accessibilityLabel="Enviar mensaje"
          accessibilityState={{ disabled: !text.trim() || sending, busy: sending }}
        >
          <MaterialIcons name="send" size={22} color={colors.onPrimary} />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  bubble: { maxWidth: "82%", borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 8 },
  mine: { alignSelf: "flex-end", backgroundColor: colors.primary, borderBottomRightRadius: 4 },
  theirs: { alignSelf: "flex-start", backgroundColor: colors.background, borderBottomLeftRadius: 4 },
  sender: { fontSize: 12, fontWeight: "700", color: colors.primary, marginBottom: 2 },
  text: { fontSize: 15, color: colors.text },
  time: { fontSize: 11, color: colors.textMuted, marginTop: 4, alignSelf: "flex-end" },
  composer: { flexDirection: "row", alignItems: "flex-end", gap: 8, paddingHorizontal: 12, paddingTop: 10, backgroundColor: colors.background, borderTopWidth: 1, borderTopColor: colors.border },
  input: { flex: 1, maxHeight: 120, borderWidth: 1, borderColor: colors.border, borderRadius: 22, paddingHorizontal: 16, paddingVertical: 10, fontSize: 16, color: colors.text },
  send: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" }
});
