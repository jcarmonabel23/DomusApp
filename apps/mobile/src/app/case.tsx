/**
 * @project DomusApp - Mobile
 * @file src/app/case.tsx
 * @description Detalle de un caso: estado, descripción, fotos y adjuntos, seguimiento con la administración,
 *              responder, agregar fotos y, cuando está resuelto, confirmar (con calificación) o reabrir
 */

import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { ScreenHeader } from "@/components/access";
import { Button, Notice } from "@/components/ui";
import { api, ApiError, fileUrl, uploadImage } from "@/lib/api";
import { fmtDateTime, unitLabel } from "@/lib/access";
import { CASE_CATEGORY, CASE_STATUS, openFile, type CaseDetail } from "@/lib/community";
import { useRealtime } from "@/lib/realtime";
import { useBrand } from "@/theme/brand";
import { colors, radius } from "@/theme/colors";

type Mode = "reply" | "confirm" | "reopen";

export default function CaseScreen() {
  const brand = useBrand();
  const { id, created } = useLocalSearchParams<{ id: string; created?: string }>();
  const [c, setC] = useState<CaseDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [rating, setRating] = useState(0);
  const [mode, setMode] = useState<Mode>("reply");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setC(await api<CaseDetail>(`/resident/cases/${id}`));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo cargar el caso");
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);
  useRealtime<{ id: string }>("cases:update", (d) => {
    if (d?.id === id) void load();
  });

  const post = async (path: string, body: unknown, ok?: string) => {
    setBusy(true);
    try {
      setC(await api<CaseDetail>(`/resident/cases/${id}/${path}`, { method: "POST", body }));
      setText("");
      setRating(0);
      setMode("reply");
      if (ok) Alert.alert(ok);
    } catch (err) {
      Alert.alert("No se pudo enviar", err instanceof ApiError ? err.message : "Intente de nuevo");
    } finally {
      setBusy(false);
    }
  };

  const addPhoto = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.7 });
    if (res.canceled || !res.assets[0]) return;
    setBusy(true);
    try {
      setC(await uploadImage<CaseDetail>(`/resident/cases/${id}/files`, res.assets[0], "POST"));
    } catch (err) {
      Alert.alert("No se pudo subir la foto", err instanceof ApiError ? err.message : "Intente de nuevo");
    } finally {
      setBusy(false);
    }
  };

  if (!c) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.surface }}>
        <ScreenHeader title="Caso" />
        <View style={{ padding: 16 }}>{error ? <Notice text={error} /> : <ActivityIndicator color={brand.primary} />}</View>
      </View>
    );
  }

  const cat = CASE_CATEGORY[c.category];
  const st = CASE_STATUS[c.status];
  const finished = c.status === "closed" || c.status === "rejected";

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <ScreenHeader title={`${cat.label} ${c.code}`} />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {created === "1" && <Notice tone="info" text="¡Gracias! La administración recibió su caso y le avisaremos cada vez que haya una respuesta." />}

          <View style={styles.card}>
            <View style={styles.row}>
              <View style={[styles.badge, { backgroundColor: st.bg }]}>
                <Text style={[styles.badgeText, { color: st.fg }]}>{st.label}</Text>
              </View>
              <Text style={styles.meta}>{fmtDateTime(c.createdAt)}</Text>
            </View>
            <Text style={styles.title}>{c.title}</Text>
            <Text style={styles.body}>{c.description}</Text>
            <Text style={styles.meta}>
              {[c.location, c.isAnonymous ? "Denuncia anónima" : c.unitCode ? `Filial ${unitLabel(c)}` : null, !c.mine && c.reportedByName ? `Reportó ${c.reportedByName}` : null]
                .filter(Boolean)
                .join(" · ")}
            </Text>
            {c.files.length > 0 && (
              <View style={styles.files}>
                {c.files.map((f, i) =>
                  f.kind === "image" && f.preview ? (
                    <Pressable key={f.id} onPress={() => openFile(f)} accessibilityRole="imagebutton" accessibilityLabel={`Ver foto ${i + 1}`}>
                      <Image source={{ uri: fileUrl(f.preview) }} style={styles.photo} contentFit="cover" />
                    </Pressable>
                  ) : (
                    <Pressable key={f.id} onPress={() => openFile(f)} accessibilityRole="button" accessibilityLabel={`Abrir ${f.name ?? "documento"}`} style={[styles.photo, styles.pdf]}>
                      <MaterialIcons name="picture-as-pdf" size={28} color={colors.danger} />
                      <Text style={styles.pdfText} numberOfLines={1}>
                        PDF
                      </Text>
                    </Pressable>
                  )
                )}
              </View>
            )}
            {c.rating && (
              <Text style={styles.meta}>
                Su calificación: {"★".repeat(c.rating)}
                {"☆".repeat(5 - c.rating)}
              </Text>
            )}
          </View>

          <Text style={styles.section}>Seguimiento</Text>
          {c.updates.length === 0 && <Text style={styles.meta}>La administración aún no responde. Le avisaremos por notificación.</Text>}
          {c.updates.map((u) => {
            const staff = u.side === "staff";
            return (
              <View key={u.id} style={[styles.bubble, staff ? styles.staff : [styles.resident, { backgroundColor: brand.primarySoft }]]}>
                <Text style={styles.author}>{staff ? (u.authorName ?? "Administración") : u.authorName ?? "Usted"}</Text>
                {u.statusTo && (
                  <View style={[styles.badge, { backgroundColor: CASE_STATUS[u.statusTo].bg, alignSelf: "flex-start" }]}>
                    <Text style={[styles.badgeText, { color: CASE_STATUS[u.statusTo].fg }]}>{CASE_STATUS[u.statusTo].label}</Text>
                  </View>
                )}
                {u.body && <Text style={styles.body}>{u.body}</Text>}
                <Text style={styles.time}>{fmtDateTime(u.createdAt)}</Text>
              </View>
            );
          })}

          {c.status === "resolved" && mode === "reply" && (
            <View style={[styles.card, { backgroundColor: "#dff7ec" }]}>
              <Text style={styles.title}>¿Quedó resuelto?</Text>
              <Text style={styles.meta}>La administración marcó el caso como resuelto. Confírmelo o díganos si el problema sigue.</Text>
              <Button title="Sí, confirmar y calificar" onPress={() => setMode("confirm")} />
              <Button title="No, sigue el problema" variant="ghost" onPress={() => setMode("reopen")} />
            </View>
          )}

          {mode === "confirm" && (
            <View style={styles.card}>
              <Text style={styles.title}>Califique la atención</Text>
              <View style={styles.stars} accessibilityRole="adjustable" accessibilityLabel={`Calificación: ${rating} de 5`}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <Pressable key={n} onPress={() => setRating(n)} hitSlop={6} accessibilityRole="button" accessibilityLabel={`${n} estrella(s)`}>
                    <MaterialIcons name={n <= rating ? "star" : "star-border"} size={40} color="#f5a623" />
                  </Pressable>
                ))}
              </View>
              <TextInput style={styles.input} placeholder="Comentario (opcional)" placeholderTextColor={colors.textMuted} value={text} onChangeText={setText} maxLength={300} multiline />
              <Button title="Confirmar solución" loading={busy} disabled={rating === 0} onPress={() => post("close", { rating, comment: text.trim() || null }, "¡Gracias por su calificación!")} />
              <Button title="Volver" variant="ghost" onPress={() => setMode("reply")} />
            </View>
          )}

          {mode === "reopen" && (
            <View style={styles.card}>
              <Text style={styles.title}>¿Qué sigue pasando?</Text>
              <TextInput style={styles.input} placeholder="Cuéntele a la administración" placeholderTextColor={colors.textMuted} value={text} onChangeText={setText} maxLength={2000} multiline autoFocus />
              <Button title="Reabrir el caso" variant="danger" loading={busy} disabled={text.trim().length < 5} onPress={() => post("reopen", { body: text.trim() })} />
              <Button title="Volver" variant="ghost" onPress={() => setMode("reply")} />
            </View>
          )}
        </ScrollView>

        {!finished && mode === "reply" && (
          <View style={styles.composer}>
            <Pressable onPress={addPhoto} disabled={busy} accessibilityRole="button" accessibilityLabel="Agregar foto" hitSlop={8} style={styles.iconBtn}>
              <MaterialIcons name="add-photo-alternate" size={26} color={brand.primary} />
            </Pressable>
            <TextInput
              style={styles.composerInput}
              placeholder="Escriba a la administración…"
              placeholderTextColor={colors.textMuted}
              value={text}
              onChangeText={setText}
              maxLength={2000}
              multiline
              accessibilityLabel="Mensaje para la administración"
            />
            <Pressable
              onPress={() => post("comments", { body: text.trim() })}
              disabled={busy || text.trim().length < 2}
              accessibilityRole="button"
              accessibilityLabel="Enviar"
              style={[styles.send, { backgroundColor: brand.primary, opacity: busy || text.trim().length < 2 ? 0.4 : 1 }]}
            >
              {busy ? <ActivityIndicator color={colors.onPrimary} /> : <MaterialIcons name="send" size={22} color={colors.onPrimary} />}
            </Pressable>
          </View>
        )}
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 12, paddingBottom: 32 },
  card: { backgroundColor: colors.background, borderRadius: radius.md, padding: 14, gap: 8 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { fontSize: 18, fontWeight: "700", color: colors.text },
  body: { fontSize: 15, color: colors.text, lineHeight: 21 },
  meta: { fontSize: 13, color: colors.textMuted },
  section: { fontSize: 16, fontWeight: "700", color: colors.text, marginTop: 4 },
  badge: { borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 3 },
  badgeText: { fontSize: 12, fontWeight: "700" },
  files: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  photo: { width: 84, height: 84, borderRadius: radius.sm },
  pdf: { backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" },
  pdfText: { fontSize: 11, color: colors.textMuted },
  bubble: { borderRadius: radius.md, padding: 12, gap: 4, maxWidth: "88%" },
  staff: { backgroundColor: colors.background, alignSelf: "flex-start" },
  resident: { alignSelf: "flex-end" },
  author: { fontSize: 13, fontWeight: "700", color: colors.text },
  time: { fontSize: 11, color: colors.textMuted, alignSelf: "flex-end" },
  stars: { flexDirection: "row", justifyContent: "center", gap: 4 },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: 10, minHeight: 80, fontSize: 15, color: colors.text, textAlignVertical: "top" },
  composer: { flexDirection: "row", alignItems: "flex-end", gap: 8, padding: 10, backgroundColor: colors.background, borderTopWidth: 1, borderTopColor: colors.border },
  iconBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  composerInput: { flex: 1, maxHeight: 120, minHeight: 44, borderRadius: 22, backgroundColor: colors.surface, paddingHorizontal: 16, paddingVertical: 10, fontSize: 15, color: colors.text },
  send: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" }
});
