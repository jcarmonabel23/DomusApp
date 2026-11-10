/**
 * @project DomusApp - Mobile
 * @file src/app/amenity.tsx
 * @description Reservar un área común: foto, datos y reglamento, elección de día y horario (disponible, reservado,
 *              feriado, no disponible), duración, personas, aceptación del reglamento y confirmación.
 */

import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { Image } from "expo-image";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useState, type ComponentProps } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Chip, DateStrip, ScreenHeader, SwitchRow } from "@/components/access";
import { Button, Field, Notice } from "@/components/ui";
import { api, ApiError, fileUrl } from "@/lib/api";
import { isoDay, unitLabel, type ResidentUnit } from "@/lib/access";
import { SLOT, amenityIcon, dayText, durationText, weekdaysText, type Amenity, type Booking, type DayAvailability, type Slot } from "@/lib/bookings";
import { useMoney } from "@/lib/finance";
import { useRealtime } from "@/lib/realtime";
import { useBrand } from "@/theme/brand";
import { colors, radius } from "@/theme/colors";

/** "10:00" + 90 → "11:30" */
const addMinutes = (time: string, minutes: number) => {
  const [h, m] = time.split(":").map(Number);
  const t = h * 60 + m + minutes;
  return `${String(Math.floor(t / 60) % 24).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
};

export default function AmenityScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const brand = useBrand();
  const money = useMoney();
  const [area, setArea] = useState<Amenity | null>(null);
  const [units, setUnits] = useState<ResidentUnit[]>([]);
  const [unitId, setUnitId] = useState<string | null>(null);
  const [date, setDate] = useState(isoDay(new Date()));
  const [day, setDay] = useState<DayAvailability | null>(null);
  const [loadingDay, setLoadingDay] = useState(false);
  const [start, setStart] = useState<number | null>(null);
  const [blocks, setBlocks] = useState(1);
  const [guests, setGuests] = useState(1);
  const [notes, setNotes] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState<Booking | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const [a, home] = await Promise.all([api<Amenity>(`/resident/bookings/amenities/${id}`), api<{ units: ResidentUnit[] }>("/resident/home")]);
        setArea(a);
        setUnits(home.units);
        setUnitId((u) => u ?? home.units[0]?.id ?? null);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "No se pudo cargar el área");
      }
    })();
  }, [id]);

  const loadDay = useCallback(async () => {
    if (!unitId) return;
    setLoadingDay(true);
    try {
      setDay(await api<DayAvailability>(`/resident/bookings/amenities/${id}/availability?date=${date}&unitId=${unitId}`));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo cargar la disponibilidad");
    } finally {
      setLoadingDay(false);
    }
  }, [id, date, unitId]);

  useEffect(() => {
    setStart(null);
    setBlocks(1);
    void loadDay();
  }, [loadDay]);
  // Si otra filial reserva mientras se elige, el horario se actualiza
  useRealtime<{ amenityId?: string }>("bookings:update", (d) => {
    if (d.amenityId === id) void loadDay();
  });

  const slots = day?.slots ?? [];
  /** Cuántos bloques seguidos libres hay desde `start` (tope: duración máxima) */
  const maxBlocks = useMemo(() => {
    if (start === null || !area) return 0;
    let n = 0;
    while (n < area.maxDurationMinutes / area.slotMinutes && slots[start + n]?.status === "available") n++;
    return n;
  }, [start, slots, area]);
  const capacityLeft = useMemo(() => {
    if (start === null || !area) return area?.capacity ?? 1;
    const lefts = slots.slice(start, start + blocks).map((s) => s.left ?? area.capacity);
    return Math.min(area.capacity, ...lefts);
  }, [start, blocks, slots, area]);
  useEffect(() => setGuests((g) => Math.min(Math.max(1, g), capacityLeft)), [capacityLeft]);

  const pick = (i: number, s: Slot) => {
    if (s.status !== "available") return;
    setError(null);
    if (start === i) {
      setStart(null);
      return;
    }
    // Tocar un horario contiguo después del inicio extiende la duración
    if (start !== null && i > start && i - start < maxBlocks) {
      setBlocks(i - start + 1);
      return;
    }
    setStart(i);
    setBlocks(1);
  };

  const submit = async () => {
    if (!area || start === null || !unitId) return;
    if (area.rules && !accepted) return setError("Debe aceptar el reglamento del área");
    setSaving(true);
    setError(null);
    try {
      const b = await api<Booking>("/resident/bookings", {
        method: "POST",
        body: { amenityId: area.id, unitId, date, time: slots[start].time, minutes: blocks * area.slotMinutes, guests, notes: notes.trim() || null, acceptRules: true }
      });
      setDone(b);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo reservar");
      void loadDay();
    } finally {
      setSaving(false);
    }
  };

  if (done) {
    const ok = done.status === "approved";
    return (
      <View style={{ flex: 1, backgroundColor: colors.surface }}>
        <ScreenHeader title={done.amenityName} />
        <View style={styles.result} accessibilityLiveRegion="polite">
          <MaterialIcons name={ok ? "event-available" : "hourglass-top"} size={96} color={ok ? "#13795b" : "#8a5a00"} />
          <Text style={[styles.resultTitle, { color: ok ? "#13795b" : "#8a5a00" }]} accessibilityRole="header">
            {ok ? "¡Reserva confirmada!" : "Solicitud enviada"}
          </Text>
          <Text style={styles.resultText}>
            {dayText(done.date)} · {done.timeFrom}–{done.timeTo} · {done.guests} persona(s).
            {ok
              ? done.cost > 0
                ? ` Se cargaron ${money(done.cost)} a su estado de cuenta.`
                : ""
              : " La administración la revisará y le avisará."}
          </Text>
          <View style={{ alignSelf: "stretch", gap: 8 }}>
            <Button title="Ver mis reservas" onPress={() => router.replace("/my-bookings")} />
            <Button title="Volver a las áreas" variant="ghost" onPress={() => router.back()} />
          </View>
        </View>
      </View>
    );
  }

  const meta = amenityIcon(area?.icon ?? "other");
  const end = start !== null && area ? addMinutes(slots[start].time, blocks * area.slotMinutes) : null;

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.surface }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScreenHeader title={area?.name ?? "Área común"} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {!area && !error && <ActivityIndicator color={brand.primary} style={{ marginTop: 40 }} />}
        {area && (
          <>
            {area.photo ? (
              <Image source={{ uri: fileUrl(area.photo.cover) }} style={styles.cover} contentFit="cover" accessibilityLabel={`Foto de ${area.name}`} />
            ) : (
              <View style={[styles.cover, { backgroundColor: meta.bg, alignItems: "center", justifyContent: "center" }]}>
                <MaterialIcons name={meta.icon} size={72} color={meta.fg} />
              </View>
            )}
            {area.description && <Text style={styles.description}>{area.description}</Text>}

            <View style={styles.facts}>
              <Fact icon="schedule" text={`${area.openTime}–${area.closeTime} · ${weekdaysText(area.weekdays)}`} />
              <Fact icon="groups" text={area.mode === "shared" ? `Compartida · ${area.capacity} personas a la vez` : `Hasta ${area.capacity} personas`} />
              <Fact icon="timelapse" text={`Hasta ${durationText(area.maxDurationMinutes)} por reserva`} />
              <Fact
                icon="event"
                text={`${area.minAdvanceHours ? `Con ${area.minAdvanceHours} h de anticipación` : "Sin anticipación mínima"} · hasta ${area.maxAdvanceDays} días`}
              />
              <Fact icon="payments" text={area.cost > 0 ? `${money(area.cost)} (se carga a su estado de cuenta)` : "Sin costo"} />
              {area.cost > 0 && <Fact icon="undo" text={`Cancelando con ${area.cancelHours} h de anticipación no se cobra`} />}
              {area.requiresApproval && <Fact icon="verified-user" text="La administración aprueba cada reserva" />}
              {area.blockDelinquent && <Fact icon="account-balance-wallet" text="Requiere estar al día en las cuotas" />}
            </View>

            {area.rules && (
              <View style={styles.rules}>
                <Pressable onPress={() => setShowRules((v) => !v)} accessibilityRole="button" accessibilityState={{ expanded: showRules }} style={styles.rulesHead}>
                  <MaterialIcons name="gavel" size={20} color={brand.primary} />
                  <Text style={[styles.rulesTitle, { color: brand.primary }]}>Reglamento de uso</Text>
                  <MaterialIcons name={showRules ? "expand-less" : "expand-more"} size={24} color={brand.primary} />
                </Pressable>
                {showRules && <Text style={styles.rulesText}>{area.rules}</Text>}
              </View>
            )}

            {units.length > 1 && (
              <View style={styles.wrap}>
                {units.map((u) => (
                  <Chip key={u.id} label={unitLabel(u)} active={unitId === u.id} onPress={() => setUnitId(u.id)} />
                ))}
              </View>
            )}

            <Text style={styles.section} accessibilityRole="header">
              Elija el día
            </Text>
            <DateStrip from={date} to={date} range={false} days={area.maxAdvanceDays + 1} onChange={(d) => d && setDate(d)} />

            <Text style={styles.section} accessibilityRole="header">
              Elija el horario
            </Text>
            {loadingDay && !day ? (
              <ActivityIndicator color={brand.primary} />
            ) : day && !day.open ? (
              <Notice text={day.reason ?? "El área no abre ese día"} tone="info" />
            ) : (
              <>
                {day?.reason && <Notice text={day.reason} tone="info" />}
                <View style={styles.slots}>
                  {slots.map((s, i) => {
                    const selected = start !== null && i >= start && i < start + blocks;
                    const st = SLOT[selected ? "selected" : s.status];
                    return (
                      <Pressable
                        key={s.time}
                        onPress={() => pick(i, s)}
                        disabled={s.status !== "available"}
                        accessibilityRole="button"
                        accessibilityLabel={`${s.time}, ${selected ? "elegido" : SLOT[s.status].label}${s.reason ? `: ${s.reason}` : ""}`}
                        accessibilityState={{ selected, disabled: s.status !== "available" }}
                        style={[styles.slot, { backgroundColor: st.bg, borderColor: st.border }]}
                      >
                        <Text style={[styles.slotTime, { color: st.fg }, (s.status === "past" || s.status === "reserved") && !selected && { textDecorationLine: "line-through" }]}>
                          {s.time}
                        </Text>
                        {s.left !== undefined && s.status === "available" && !selected && <Text style={[styles.slotLeft, { color: st.fg }]}>{s.left} libres</Text>}
                        {s.status === "mine" && <Text style={[styles.slotLeft, { color: st.fg }]}>Suya</Text>}
                      </Pressable>
                    );
                  })}
                </View>
                <View style={styles.legend}>
                  {(["available", "reserved", "mine", "holiday", "unavailable"] as const).map((k) => (
                    <View key={k} style={styles.legendItem}>
                      <View style={[styles.legendDot, { backgroundColor: SLOT[k].bg, borderColor: SLOT[k].fg }]} />
                      <Text style={styles.legendText}>{SLOT[k].label}</Text>
                    </View>
                  ))}
                </View>
              </>
            )}

            {start !== null && (
              <View style={styles.form}>
                <Text style={styles.section}>Duración</Text>
                <View style={styles.wrap}>
                  {Array.from({ length: maxBlocks }, (_, n) => n + 1).map((n) => (
                    <Chip key={n} label={durationText(n * area.slotMinutes)} active={blocks === n} onPress={() => setBlocks(n)} />
                  ))}
                </View>

                <View style={styles.guests}>
                  <Text style={[styles.section, { flex: 1 }]}>Personas</Text>
                  <Pressable
                    onPress={() => setGuests((g) => Math.max(1, g - 1))}
                    accessibilityRole="button"
                    accessibilityLabel="Una persona menos"
                    style={[styles.step, { borderColor: brand.primary }]}
                  >
                    <MaterialIcons name="remove" size={22} color={brand.primary} />
                  </Pressable>
                  <Text style={styles.guestsValue} accessibilityLiveRegion="polite">
                    {guests}
                  </Text>
                  <Pressable
                    onPress={() => setGuests((g) => Math.min(capacityLeft, g + 1))}
                    accessibilityRole="button"
                    accessibilityLabel="Una persona más"
                    style={[styles.step, { borderColor: brand.primary }]}
                  >
                    <MaterialIcons name="add" size={22} color={brand.primary} />
                  </Pressable>
                </View>

                <Field label="Notas para la administración (opcional)" value={notes} onChangeText={setNotes} maxLength={500} multiline />
                {area.rules && <SwitchRow label="He leído y acepto el reglamento de uso" value={accepted} onChange={setAccepted} />}

                <View style={[styles.summary, { borderColor: brand.primaryTint }]}>
                  <Text style={styles.summaryTitle}>
                    {dayText(date)} · {slots[start].time}–{end}
                  </Text>
                  <Text style={styles.summaryText}>
                    {guests} persona(s)
                    {area.cost > 0 ? ` · ${money(area.cost)} ${area.requiresApproval ? "al aprobarse" : "a su estado de cuenta"}` : ""}
                  </Text>
                </View>
              </View>
            )}
          </>
        )}

        {error && <Notice text={error} />}
        {area && start !== null && (
          <Button title={area.requiresApproval ? "Solicitar reserva" : "Reservar"} onPress={submit} loading={saving} disabled={Boolean(area.rules) && !accepted} />
        )}
        {area && start === null && day?.open && (
          <Text style={styles.hint}>Toque un horario disponible. Para reservar más tiempo, toque también los siguientes.</Text>
        )}
        {area && day?.open && date === isoDay(new Date()) && slots.every((s) => s.status !== "available") && (
          <Text style={styles.hint}>Hoy no quedan horarios libres; pruebe otro día.</Text>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Fact({ icon, text }: Readonly<{ icon: ComponentProps<typeof MaterialIcons>["name"]; text: string }>) {
  return (
    <View style={styles.fact}>
      <MaterialIcons name={icon} size={18} color={colors.textMuted} />
      <Text style={styles.factText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 14, paddingBottom: 48 },
  cover: { width: "100%", aspectRatio: 16 / 9, borderRadius: radius.md },
  description: { fontSize: 15, color: colors.text },
  facts: { backgroundColor: colors.background, borderRadius: radius.md, padding: 12, gap: 8 },
  fact: { flexDirection: "row", gap: 10, alignItems: "center" },
  factText: { fontSize: 14, color: colors.text, flex: 1 },
  rules: { backgroundColor: colors.background, borderRadius: radius.md, padding: 12, gap: 8 },
  rulesHead: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 32 },
  rulesTitle: { flex: 1, fontSize: 15, fontWeight: "700" },
  rulesText: { fontSize: 14, color: colors.text, lineHeight: 21 },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  section: { fontSize: 16, fontWeight: "700", color: colors.text },
  slots: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  slot: { width: "23%", minHeight: 52, borderRadius: radius.sm, borderWidth: 1.5, alignItems: "center", justifyContent: "center", paddingVertical: 4 },
  slotTime: { fontSize: 15, fontWeight: "700" },
  slotLeft: { fontSize: 11 },
  legend: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  legendDot: { width: 14, height: 14, borderRadius: 4, borderWidth: 1 },
  legendText: { fontSize: 12, color: colors.textMuted },
  form: { gap: 12 },
  guests: { flexDirection: "row", alignItems: "center", gap: 12 },
  step: { width: 44, height: 44, borderRadius: 22, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  guestsValue: { fontSize: 20, fontWeight: "800", minWidth: 32, textAlign: "center", color: colors.text },
  summary: { borderWidth: 1, borderStyle: "dashed", borderRadius: radius.md, padding: 12, backgroundColor: colors.background, gap: 2 },
  summaryTitle: { fontSize: 16, fontWeight: "700", color: colors.text, textTransform: "capitalize" },
  summaryText: { fontSize: 14, color: colors.textMuted },
  hint: { fontSize: 13, color: colors.textMuted, textAlign: "center" },
  result: { flex: 1, padding: 24, alignItems: "center", justifyContent: "center", gap: 14 },
  resultTitle: { fontSize: 24, fontWeight: "800", textAlign: "center" },
  resultText: { fontSize: 16, color: colors.text, textAlign: "center" }
});
