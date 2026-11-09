/**
 * @project DomusApp - Mobile
 * @file src/app/vehicles.tsx
 * @description Mis vehículos: el guarda reconoce la placa y registra el ingreso del residente con un toque
 */

import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useCallback, useEffect, useState } from "react";
import { Alert, KeyboardAvoidingView, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { Chip, EmptyState, Fab, ScreenHeader } from "@/components/access";
import { Button, Field, Notice } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { VEHICLE_KIND, normalizePlate, unitLabel, type ResidentUnit, type Vehicle } from "@/lib/access";
import { colors, radius } from "@/theme/colors";

const ICON: Record<string, "directions-car" | "two-wheeler" | "local-shipping" | "pedal-bike" | "commute"> = {
  car: "directions-car",
  motorcycle: "two-wheeler",
  truck: "local-shipping",
  bicycle: "pedal-bike",
  other: "commute"
};

const blank = { plate: "", kind: "car", brand: "", model: "", color: "" };

export default function VehiclesScreen() {
  const [rows, setRows] = useState<Vehicle[] | null>(null);
  const [units, setUnits] = useState<ResidentUnit[]>([]);
  const [unitId, setUnitId] = useState<string | null>(null);
  const [form, setForm] = useState<typeof blank | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [list, home] = await Promise.all([api<Vehicle[]>("/resident/vehicles"), api<{ units: ResidentUnit[] }>("/resident/home")]);
      setRows(list);
      setUnits(home.units);
      setUnitId((u) => u ?? home.units[0]?.id ?? null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo cargar");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (!form || !unitId) return;
    const plate = normalizePlate(form.plate);
    if (plate.length < 2) return setError("Escriba la placa (solo letras y números)");
    setSaving(true);
    setError(null);
    try {
      await api("/resident/vehicles", {
        method: "POST",
        body: { unitId, plate, kind: form.kind, brand: form.brand.trim() || null, model: form.model.trim() || null, color: form.color.trim() || null }
      });
      setForm(null);
      void load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo guardar");
    } finally {
      setSaving(false);
    }
  };

  const remove = (v: Vehicle) =>
    Alert.alert("Eliminar vehículo", `La caseta dejará de reconocer la placa ${v.plate}.`, [
      { text: "Cancelar", style: "cancel" },
      {
        text: "Eliminar",
        style: "destructive",
        onPress: async () => {
          try {
            await api(`/resident/vehicles/${v.id}`, { method: "DELETE" });
            void load();
          } catch (err) {
            Alert.alert("No se pudo eliminar", err instanceof ApiError ? err.message : "Intente de nuevo");
          }
        }
      }
    ]);

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.surface }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScreenHeader title="Mis vehículos" />
      <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />} keyboardShouldPersistTaps="handled">
        {form && (
          <View style={styles.form}>
            <Text style={styles.formTitle}>Nuevo vehículo</Text>
            {units.length > 1 && (
              <View style={styles.wrap}>
                {units.map((u) => (
                  <Chip key={u.id} label={unitLabel(u)} active={unitId === u.id} onPress={() => setUnitId(u.id)} />
                ))}
              </View>
            )}
            <Field label="Placa" value={form.plate} onChangeText={(v) => setForm({ ...form, plate: v.toUpperCase() })} autoCapitalize="characters" maxLength={20} />
            <View style={styles.wrap}>
              {Object.entries(VEHICLE_KIND).map(([k, label]) => (
                <Chip key={k} label={label} active={form.kind === k} onPress={() => setForm({ ...form, kind: k })} />
              ))}
            </View>
            <View style={{ flexDirection: "row", gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Field label="Marca" value={form.brand} onChangeText={(v) => setForm({ ...form, brand: v })} maxLength={40} />
              </View>
              <View style={{ flex: 1 }}>
                <Field label="Modelo" value={form.model} onChangeText={(v) => setForm({ ...form, model: v })} maxLength={40} />
              </View>
            </View>
            <Field label="Color" value={form.color} onChangeText={(v) => setForm({ ...form, color: v })} maxLength={30} />
            {error && <Notice text={error} />}
            <Button title="Guardar vehículo" onPress={save} loading={saving} />
            <Button title="Cancelar" variant="ghost" onPress={() => setForm(null)} />
          </View>
        )}

        {!form && error && <Notice text={error} />}

        {rows?.map((v) => (
          <View key={v.id} style={styles.card}>
            <View style={styles.icon}>
              <MaterialIcons name={ICON[v.kind] ?? "commute"} size={28} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.plate}>{v.plate}</Text>
              <Text style={styles.meta}>
                {[[v.brand, v.model].filter(Boolean).join(" ") || VEHICLE_KIND[v.kind], v.color].filter(Boolean).join(" · ")}
              </Text>
              {units.length > 1 && <Text style={styles.meta}>{unitLabel(v)}</Text>}
            </View>
            <Pressable hitSlop={10} onPress={() => remove(v)} accessibilityRole="button" accessibilityLabel={`Eliminar ${v.plate}`}>
              <MaterialIcons name="delete-outline" size={24} color={colors.textMuted} />
            </Pressable>
          </View>
        ))}

        {rows?.length === 0 && !form && <EmptyState
            icon="directions-car"
            accent="add"
            title="Sin vehículos registrados"
            text="Registre sus placas para que la caseta lo reconozca al llegar."
            action={units.length > 0 ? { label: "Registrar vehículo", onPress: () => setForm({ ...blank }) } : undefined}
          />}
      </ScrollView>
      {!form && units.length > 0 && <Fab label="Nuevo vehículo" onPress={() => setForm({ ...blank })} />}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 12, gap: 10, paddingBottom: 110 },
  form: { backgroundColor: colors.background, borderRadius: radius.md, padding: 16, gap: 12 },
  formTitle: { fontSize: 18, fontWeight: "700", color: colors.text },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  card: { flexDirection: "row", alignItems: "center", gap: 14, backgroundColor: colors.background, borderRadius: radius.md, padding: 14 },
  icon: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" },
  plate: { fontSize: 18, fontWeight: "800", color: colors.text, letterSpacing: 1 },
  meta: { fontSize: 13, color: colors.textMuted }
});
