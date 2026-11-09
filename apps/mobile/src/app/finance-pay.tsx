/**
 * @project DomusApp - Mobile
 * @file src/app/finance-pay.tsx
 * @description Pagar: reporte de transferencia / depósito con foto del comprobante, o pago en línea con tarjeta
 *
 * - Manual: queda "En revisión" hasta que la administración lo aprueba contra el banco.
 * - En línea: la tarjeta va directo a la pasarela (la app y la API no la guardan). El resultado llega
 *   por webhook a la API; la app lo espera por el socket (finance:update) y, de respaldo, consultando.
 */

import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import * as ImagePicker from "expo-image-picker";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Chip, ScreenHeader } from "@/components/access";
import { Button, Field, Notice } from "@/components/ui";
import { api, ApiError, uploadImage } from "@/lib/api";
import { isoDay, addDays } from "@/lib/access";
import { METHOD_LABEL, fmtDate, formatMoney, parseAmount, type FinanceHome, type Payment } from "@/lib/finance";
import { useRealtime } from "@/lib/realtime";
import { useBrand } from "@/theme/brand";
import { colors, radius } from "@/theme/colors";

type Result = { tone: "ok" | "wait" | "error"; title: string; text: string };

const TEST_CARDS = [
  { number: "4242 4242 4242 4242", label: "Aprobada" },
  { number: "4000 0000 0000 0002", label: "Rechazada" },
  { number: "4000 0000 0000 9995", label: "Fondos insuficientes" }
];

/** "4242424242424242" → "4242 4242 4242 4242" */
const groupCard = (v: string) => v.replace(/\D/g, "").slice(0, 19).replace(/(\d{4})(?=\d)/g, "$1 ");
/** "1228" → "12/28" */
const formatExpiry = (v: string) => {
  const d = v.replace(/\D/g, "").slice(0, 4);
  return d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d;
};

export default function PayScreen() {
  const params = useLocalSearchParams<{ mode?: string; unitId?: string; amount?: string }>();
  const online = params.mode === "online";
  const brand = useBrand();
  const [home, setHome] = useState<FinanceHome | null>(null);
  const [amountText, setAmountText] = useState(params.amount ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  // Manual
  const [method, setMethod] = useState<"transfer" | "deposit">("transfer");
  const [paidOn, setPaidOn] = useState(isoDay(new Date()));
  const [bankId, setBankId] = useState<string | null>(null);
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [photo, setPhoto] = useState<ImagePicker.ImagePickerAsset | null>(null);

  // En línea
  const [card, setCard] = useState({ number: "", expiry: "", cvc: "", holder: "" });
  const waiting = useRef<string | null>(null);

  useEffect(() => {
    api<FinanceHome>("/resident/finance")
      .then((h) => {
        setHome(h);
        setBankId((b) => b ?? h.bankAccounts[0]?.id ?? null);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "No se pudo cargar"));
  }, []);

  const currency = home?.currency ?? { symbol: "", decimals: 2, code: "" };
  const amount = parseAmount(amountText);
  const unit = home?.units.find((u) => u.unitId === params.unitId);

  /** Resultado del pago en línea: aprobado / rechazado (o sigue procesando) */
  const settle = (p: Payment) => {
    if (p.status === "pending") return false;
    waiting.current = null;
    setBusy(false);
    setResult(
      p.status === "approved"
        ? { tone: "ok", title: "¡Pago aprobado!", text: `Se aplicaron ${formatMoney(p.amount, currency)} a su estado de cuenta con la tarjeta ${p.cardBrand ?? ""} •••• ${p.cardLast4 ?? ""}.` }
        : { tone: "error", title: "Pago rechazado", text: p.reviewNotes ?? "La pasarela no aprobó el cargo. No se cobró nada." }
    );
    return true;
  };

  useRealtime<{ paymentId?: string }>("finance:update", (d) => {
    if (waiting.current && d.paymentId === waiting.current) {
      api<Payment>(`/resident/finance/payments/${waiting.current}`).then(settle).catch(() => undefined);
    }
  });

  // Respaldo por si el socket no está conectado: consulta cada 2 s hasta 40 s
  useEffect(() => {
    if (!busy || !online) return;
    let tries = 0;
    const t = setInterval(() => {
      const id = waiting.current;
      if (!id) return;
      tries += 1;
      api<Payment>(`/resident/finance/payments/${id}`)
        .then((p) => {
          if (!settle(p) && tries >= 20) {
            clearInterval(t);
            waiting.current = null;
            setBusy(false);
            setResult({ tone: "wait", title: "Procesando", text: "La pasarela aún no responde. Verá el resultado en su estado de cuenta y en las notificaciones." });
          }
        })
        .catch(() => undefined);
    }, 2000);
    return () => clearInterval(t);
  }, [busy, online]);

  const pickFrom = async (source: "camera" | "library") => {
    const perm = source === "camera" ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("Permiso requerido", source === "camera" ? "Active el acceso a la cámara en los ajustes del teléfono." : "Active el acceso a las fotos en los ajustes del teléfono.");
      return;
    }
    const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ["images"], quality: 0.7 };
    const res = source === "camera" ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
    if (!res.canceled && res.assets[0]) setPhoto(res.assets[0]);
  };

  const choosePhoto = () =>
    Alert.alert("Foto del comprobante", undefined, [
      { text: "Tomar foto", onPress: () => void pickFrom("camera") },
      { text: "Elegir de la galería", onPress: () => void pickFrom("library") },
      { text: "Cancelar", style: "cancel" }
    ]);

  const submitManual = async () => {
    if (amount <= 0) return setError("Escriba el monto que pagó");
    if (reference.trim().length < 3) return setError("Escriba el número de referencia o comprobante");
    setBusy(true);
    setError(null);
    try {
      const p = await api<Payment>("/resident/finance/payments", {
        method: "POST",
        body: { unitId: params.unitId, method, amount, paidOn, reference: reference.trim(), bankAccountId: bankId, notes: notes.trim() || null }
      });
      let photoFailed = false;
      if (photo) await uploadImage(`/resident/finance/payments/${p.id}/receipt`, photo).catch(() => (photoFailed = true));
      setResult({
        tone: "wait",
        title: "Pago reportado",
        text: `La administración revisará su ${METHOD_LABEL[method].toLowerCase()} de ${formatMoney(amount, currency)} y le avisará cuando se aplique.${
          photoFailed ? " No se pudo subir la foto del comprobante; la referencia es suficiente para revisarlo." : ""
        }`
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo reportar el pago");
    } finally {
      setBusy(false);
    }
  };

  const submitOnline = async () => {
    if (amount <= 0) return setError("Escriba el monto a pagar");
    const [mm, yy] = card.expiry.split("/");
    if (!mm || !yy || yy.length !== 2) return setError("Escriba el vencimiento como MM/AA");
    if (card.holder.trim().length < 3) return setError("Escriba el nombre del titular");
    setBusy(true);
    setError(null);
    try {
      const intent = await api<{ paymentId: string }>("/resident/finance/online", { method: "POST", body: { unitId: params.unitId, amount } });
      waiting.current = intent.paymentId;
      await api(`/resident/finance/online/${intent.paymentId}/confirm`, {
        method: "POST",
        timeoutMs: 20_000,
        body: { number: card.number.replace(/\s/g, ""), expMonth: Number(mm), expYear: 2000 + Number(yy), cvc: card.cvc, holder: card.holder.trim() }
      });
      // Sigue "busy": el resultado llega por el socket o la consulta de respaldo
    } catch (err) {
      waiting.current = null;
      setBusy(false);
      setError(err instanceof ApiError ? err.message : "No se pudo procesar el pago");
    }
  };

  if (result) {
    const tone = result.tone === "ok" ? "#13795b" : result.tone === "error" ? colors.danger : "#8a5a00";
    return (
      <View style={{ flex: 1, backgroundColor: colors.surface }}>
        <ScreenHeader title={online ? "Pago con tarjeta" : "Reportar pago"} />
        <View style={styles.result} accessibilityLiveRegion="polite">
          <MaterialIcons name={result.tone === "ok" ? "check-circle" : result.tone === "error" ? "cancel" : "schedule"} size={96} color={tone} />
          <Text style={[styles.resultTitle, { color: tone }]} accessibilityRole="header">
            {result.title}
          </Text>
          <Text style={styles.resultText}>{result.text}</Text>
          <View style={{ alignSelf: "stretch", gap: 8 }}>
            <Button title="Ver estado de cuenta" onPress={() => router.back()} />
            {result.tone === "error" && <Button title="Intentar de nuevo" variant="ghost" onPress={() => setResult(null)} />}
          </View>
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.surface }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScreenHeader title={online ? "Pago con tarjeta" : "Reportar pago"} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {unit && (
          <Text style={styles.lead}>
            Filial {unit.unitTower ? `${unit.unitTower}-` : ""}
            {unit.unitCode} · saldo {formatMoney(unit.balance, currency)}
          </Text>
        )}

        <Field
          label={online ? "Monto a pagar" : "Monto pagado"}
          value={amountText}
          onChangeText={setAmountText}
          keyboardType="decimal-pad"
          placeholder={`${currency.symbol}0`}
        />
        {amount > 0 && <Text style={styles.hint}>{formatMoney(amount, currency)}</Text>}

        {online ? (
          <>
            <View style={[styles.box, { borderColor: brand.primaryTint }]}>
              <Text style={styles.boxTitle}>Pasarela de prueba</Text>
              <Text style={styles.hint}>No se cobra dinero real. Toque una tarjeta para usarla (cualquier vencimiento futuro y CVC):</Text>
              {TEST_CARDS.map((c) => (
                <Pressable
                  key={c.number}
                  accessibilityRole="button"
                  accessibilityLabel={`Usar tarjeta de prueba ${c.label}`}
                  onPress={() => setCard({ number: c.number, expiry: "12/30", cvc: "123", holder: card.holder || "Titular de prueba" })}
                  style={styles.testCard}
                >
                  <Text style={styles.mono}>{c.number}</Text>
                  <Text style={styles.hint}>{c.label}</Text>
                </Pressable>
              ))}
            </View>
            <Field label="Número de tarjeta" value={card.number} onChangeText={(v) => setCard({ ...card, number: groupCard(v) })} keyboardType="number-pad" autoComplete="cc-number" maxLength={23} />
            <View style={{ flexDirection: "row", gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Field label="Vence (MM/AA)" value={card.expiry} onChangeText={(v) => setCard({ ...card, expiry: formatExpiry(v) })} keyboardType="number-pad" autoComplete="cc-exp" maxLength={5} />
              </View>
              <View style={{ flex: 1 }}>
                <Field label="CVC" value={card.cvc} onChangeText={(v) => setCard({ ...card, cvc: v.replace(/\D/g, "").slice(0, 4) })} keyboardType="number-pad" secureTextEntry autoComplete="cc-csc" maxLength={4} />
              </View>
            </View>
            <Field label="Nombre del titular" value={card.holder} onChangeText={(v) => setCard({ ...card, holder: v })} autoCapitalize="words" autoComplete="name" maxLength={80} />
            <View style={styles.secure}>
              <MaterialIcons name="lock" size={16} color={colors.textMuted} />
              <Text style={styles.hint}>Los datos de la tarjeta van directo a la pasarela; DomusApp solo guarda la marca y los últimos 4 dígitos.</Text>
            </View>
            {error && <Notice text={error} />}
            {busy ? (
              <View style={styles.processing} accessibilityLiveRegion="polite">
                <ActivityIndicator color={brand.primary} />
                <Text style={styles.hint}>Procesando el pago con la pasarela…</Text>
              </View>
            ) : (
              <Button title={amount > 0 ? `Pagar ${formatMoney(amount, currency)}` : "Pagar"} onPress={submitOnline} disabled={!home} />
            )}
          </>
        ) : (
          <>
            <View style={styles.wrap}>
              {(["transfer", "deposit"] as const).map((m) => (
                <Chip key={m} label={METHOD_LABEL[m]} active={method === m} onPress={() => setMethod(m)} />
              ))}
            </View>

            <Text style={styles.label}>Fecha del pago</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {Array.from({ length: 15 }, (_, i) => isoDay(addDays(new Date(), -i))).map((d, i) => (
                <Chip key={d} label={i === 0 ? "Hoy" : i === 1 ? "Ayer" : fmtDate(d).replace(/ \d{4}$/, "")} active={paidOn === d} onPress={() => setPaidOn(d)} />
              ))}
            </ScrollView>

            {home && home.bankAccounts.length > 0 && (
              <>
                <Text style={styles.label}>Cuenta a la que pagó</Text>
                {home.bankAccounts.map((b) => {
                  const active = bankId === b.id;
                  return (
                    <Pressable
                      key={b.id}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: active }}
                      onPress={() => setBankId(b.id)}
                      style={[styles.bank, active && { borderColor: brand.primary, backgroundColor: brand.primarySoft }]}
                    >
                      <MaterialIcons name={active ? "radio-button-checked" : "radio-button-unchecked"} size={22} color={active ? brand.primary : colors.textMuted} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.bankName}>
                          {b.bank} · {b.kind === "checking" ? "Corriente" : "Ahorros"} {b.currencyCode}
                        </Text>
                        <Text style={styles.mono} selectable>
                          {b.number}
                        </Text>
                        {b.iban && (
                          <Text style={styles.mono} selectable>
                            {b.iban}
                          </Text>
                        )}
                        <Text style={styles.hint}>
                          {b.holder}
                          {b.notes ? ` · ${b.notes}` : ""}
                        </Text>
                      </View>
                    </Pressable>
                  );
                })}
              </>
            )}

            <Field label="Número de referencia o comprobante" value={reference} onChangeText={setReference} autoCapitalize="characters" maxLength={60} />
            <Field label="Notas (opcional)" value={notes} onChangeText={setNotes} maxLength={500} multiline />

            <Pressable accessibilityRole="button" accessibilityLabel={photo ? "Cambiar foto del comprobante" : "Adjuntar foto del comprobante"} onPress={choosePhoto} style={[styles.photo, { borderColor: brand.primaryTint }]}>
              {photo ? (
                <Image source={{ uri: photo.uri }} style={styles.photoImg} resizeMode="cover" />
              ) : (
                <>
                  <MaterialIcons name="add-a-photo" size={32} color={brand.primary} />
                  <Text style={[styles.hint, { color: brand.primary }]}>Foto del comprobante (recomendada)</Text>
                </>
              )}
            </Pressable>

            {error && <Notice text={error} />}
            <Button title="Reportar pago" onPress={submitManual} loading={busy} disabled={!home} />
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 12, paddingBottom: 40 },
  lead: { fontSize: 15, color: colors.text, fontWeight: "600" },
  label: { fontSize: 14, color: colors.text, fontWeight: "600" },
  hint: { fontSize: 13, color: colors.textMuted, flexShrink: 1 },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  box: { borderWidth: 1, borderStyle: "dashed", borderRadius: radius.md, padding: 12, gap: 6, backgroundColor: colors.background },
  boxTitle: { fontSize: 14, fontWeight: "700", color: colors.text },
  testCard: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", minHeight: 44, paddingVertical: 6 },
  mono: { fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", fontSize: 14, color: colors.text },
  secure: { flexDirection: "row", gap: 6, alignItems: "flex-start" },
  processing: { flexDirection: "row", gap: 10, alignItems: "center", justifyContent: "center", minHeight: 52 },
  bank: { flexDirection: "row", gap: 10, padding: 12, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.background },
  bankName: { fontSize: 15, fontWeight: "700", color: colors.text },
  photo: { minHeight: 140, borderWidth: 1.5, borderStyle: "dashed", borderRadius: radius.md, alignItems: "center", justifyContent: "center", gap: 6, overflow: "hidden", backgroundColor: colors.background },
  photoImg: { width: "100%", height: 220 },
  result: { flex: 1, padding: 24, alignItems: "center", justifyContent: "center", gap: 14 },
  resultTitle: { fontSize: 24, fontWeight: "800", textAlign: "center" },
  resultText: { fontSize: 16, color: colors.text, textAlign: "center" }
});
