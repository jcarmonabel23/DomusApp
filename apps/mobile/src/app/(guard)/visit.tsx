/**
 * @project DomusApp - Mobile
 * @file src/app/(guard)/visit.tsx
 * @description Visita no anunciada, entrega o servicio: el guarda elige la filial y la registra; la filial recibe
 *              el aviso y puede autorizar o rechazar desde la app (o el guarda confirma por teléfono)
 */

import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { router } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Chip } from "@/components/access";
import { Button, Field, Notice } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { normalizePlate, unitLabel, type Phone } from "@/lib/access";
import { useSession } from "@/lib/session";
import { colors, radius } from "@/theme/colors";

interface GuardUnit {
  id: string;
  code: string;
  tower: string | null;
  phones: Phone[];
}

const KINDS = [
  { value: "unannounced", label: "Visita" },
  { value: "delivery", label: "Entrega" },
  { value: "service", label: "Servicio" }
] as const;

export default function VisitScreen() {
  const idLabel = useSession((s) => s.session?.condominium?.country.personIdLabel ?? "Cédula");
  const [units, setUnits] = useState<GuardUnit[] | null>(null);
  const [filter, setFilter] = useState("");
  const [unit, setUnit] = useState<GuardUnit | null>(null);
  const [kind, setKind] = useState<(typeof KINDS)[number]["value"]>("unannounced");
  const [names, setNames] = useState("");
  const [idNumber, setIdNumber] = useState("");
  const [plate, setPlate] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api<GuardUnit[]>("/guard/units")
      .then(setUnits)
      .catch((err) => {
        setUnits([]);
        setError(err instanceof ApiError ? err.message : "No se pudieron cargar las filiales");
      });
  }, []);

  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase();
    const list = units ?? [];
    return (f ? list.filter((u) => unitLabel(u).toLowerCase().includes(f)) : list).slice(0, 40);
  }, [units, filter]);

  const save = async () => {
    if (!unit) return setError("Elija la filial que visita");
    if (names.trim().length < 2) return setError("Escriba el nombre de la persona");
    setSaving(true);
    setError(null);
    try {
      const r = await api<{ id: string; notified: number }>("/guard/visits", {
        method: "POST",
        body: {
          unitId: unit.id,
          kind,
          names: names.trim(),
          idNumber: idNumber.trim() || null,
          plate: plate ? normalizePlate(plate) || null : null,
          notes: notes.trim() || null
        }
      });
      Alert.alert(
        "Visita registrada",
        r.notified > 0
          ? `Se avisó a ${r.notified === 1 ? "una cuenta" : `${r.notified} cuentas`} de la filial ${unit.code}. Verá su respuesta en "En caseta".`
          : `La filial ${unit.code} no tiene cuentas para avisar en la app: llame para confirmar.`
      );
      router.back();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo registrar");
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.background }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.wrap}>
          {KINDS.map((k) => (
            <Chip key={k.value} label={k.label} active={kind === k.value} onPress={() => setKind(k.value)} />
          ))}
        </View>

        <View style={{ gap: 6 }}>
          <Text style={styles.label}>Filial que visita</Text>
          {unit ? (
            <View style={styles.selected}>
              <MaterialIcons name="apartment" size={24} color={colors.primary} />
              <View style={{ flex: 1 }}>
                <Text style={styles.unitName}>{unitLabel(unit)}</Text>
                {unit.phones.slice(0, 2).map((p) => (
                  <Pressable
                    key={p.phone}
                    onPress={() => void Linking.openURL(`tel:${p.phone.replace(/[^\d+]/g, "")}`)}
                    accessibilityRole="link"
                    accessibilityLabel={`Llamar a ${p.names}, ${p.phone}`}
                  >
                    <Text style={styles.phone}>
                      {p.names} · {p.phone}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <Pressable onPress={() => setUnit(null)} hitSlop={10} accessibilityRole="button" accessibilityLabel="Cambiar filial">
                <Text style={styles.change}>Cambiar</Text>
              </Pressable>
            </View>
          ) : (
            <>
              <TextInput value={filter} onChangeText={setFilter} placeholder="Buscar por código o torre" placeholderTextColor={colors.textMuted} style={styles.input} />
              {!units ? (
                <ActivityIndicator color={colors.primary} />
              ) : (
                <View style={styles.wrap}>
                  {shown.map((u) => (
                    <Chip key={u.id} label={unitLabel(u)} onPress={() => setUnit(u)} />
                  ))}
                  {shown.length === 0 && <Text style={styles.muted}>Sin filiales con ese código</Text>}
                </View>
              )}
            </>
          )}
        </View>

        <Field label="Nombre" value={names} onChangeText={setNames} autoCapitalize="words" maxLength={120} placeholder={kind === "delivery" ? "Repartidor o empresa" : "Nombre y apellidos"} />
        <Field label={idLabel} value={idNumber} onChangeText={setIdNumber} maxLength={30} placeholder="Opcional" />
        <Field label="Placa" value={plate} onChangeText={(v) => setPlate(v.toUpperCase())} autoCapitalize="characters" maxLength={20} placeholder="Opcional" />
        <Field label="Notas" value={notes} onChangeText={setNotes} maxLength={500} placeholder="Motivo de la visita, paquete, empresa…" />

        {error && <Notice text={error} />}
        <Button title="Registrar y avisar a la filial" onPress={save} loading={saving} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, gap: 16, paddingBottom: 40 },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  label: { fontSize: 14, fontWeight: "600", color: colors.text },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 16,
    color: colors.text
  },
  selected: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: radius.md, backgroundColor: colors.primarySoft },
  unitName: { fontSize: 17, fontWeight: "700", color: colors.text },
  phone: { fontSize: 13, color: colors.primary, marginTop: 2 },
  change: { color: colors.primary, fontWeight: "700" },
  muted: { color: colors.textMuted }
});
