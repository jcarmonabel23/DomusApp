/**
 * @project DomusApp - Mobile
 * @file src/app/authorization.tsx
 * @description Nuevo / editar autorizado: foto, nombre, cédula, placa, "llamar a la casa", "eliminar una vez
 *              utilizado", fecha o rango, días y horario (empleados) e indicaciones para el oficial
 *
 * Parámetros: kind (temporary | permanent | employee) y, para editar, id.
 */

import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import * as ImagePicker from "expo-image-picker";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Chip, DateStrip, Fab, PersonPhoto, ScreenHeader, SwitchRow } from "@/components/access";
import { Field, Notice } from "@/components/ui";
import { api, ApiError, uploadImage } from "@/lib/api";
import { KIND_TITLE, WEEKDAY_SHORT, isoDay, normalizePlate, unitLabel, type AuthKind, type Authorization, type ResidentUnit } from "@/lib/access";
import { useSession } from "@/lib/session";
import { colors, radius } from "@/theme/colors";

type Picked = ImagePicker.ImagePickerAsset | null;

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** "7:5" → "07:05"; deja pasar lo que se está escribiendo */
const tidyTime = (v: string) => v.replace(/[^\d:]/g, "").slice(0, 5);

export default function AuthorizationScreen() {
  const params = useLocalSearchParams<{ kind?: AuthKind; id?: string }>();
  const kind: AuthKind = params.kind === "permanent" || params.kind === "employee" ? params.kind : "temporary";
  const editingId = params.id ?? null;
  const idLabel = useSession((s) => s.session?.condominium?.country.personIdLabel ?? "Cédula");

  const [units, setUnits] = useState<ResidentUnit[] | null>(null);
  const [unitId, setUnitId] = useState<string | null>(null);
  const [names, setNames] = useState("");
  const [idNumber, setIdNumber] = useState("");
  const [plate, setPlate] = useState("");
  const [occupation, setOccupation] = useState("");
  const [callToConfirm, setCallToConfirm] = useState(false);
  const [deleteAfterUse, setDeleteAfterUse] = useState(false);
  const [from, setFrom] = useState<string | null>(kind === "temporary" ? isoDay(new Date()) : null);
  const [to, setTo] = useState<string | null>(kind === "temporary" ? isoDay(new Date()) : null);
  const [weekdays, setWeekdays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [timeFrom, setTimeFrom] = useState("07:00");
  const [timeTo, setTimeTo] = useState("18:00");
  const [instructions, setInstructions] = useState("");
  const [currentPhoto, setCurrentPhoto] = useState<string | null>(null);
  const [photo, setPhoto] = useState<Picked>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const home = await api<{ units: ResidentUnit[] }>("/resident/home");
        setUnits(home.units);
        if (!editingId) setUnitId(home.units[0]?.id ?? null);
        if (editingId) {
          const list = await api<Authorization[]>(`/resident/authorizations?kind=${kind}`);
          const a = list.find((x) => x.id === editingId);
          if (!a) throw new ApiError(404, "NOT_FOUND", "El autorizado ya no existe");
          setUnitId(a.unitId);
          setNames(a.names);
          setIdNumber(a.idNumber ?? "");
          setPlate(a.plate ?? "");
          setOccupation(a.occupation ?? "");
          setCallToConfirm(a.callToConfirm);
          setDeleteAfterUse(a.deleteAfterUse);
          setFrom(a.validFrom);
          setTo(a.validTo);
          if (a.weekdays) setWeekdays(a.weekdays);
          if (a.timeFrom) setTimeFrom(a.timeFrom);
          if (a.timeTo) setTimeTo(a.timeTo);
          setInstructions(a.instructions ?? "");
          setCurrentPhoto(a.photo?.medium ?? null);
        }
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "No se pudo cargar");
        setUnits((u) => u ?? []);
      }
    })();
  }, [editingId, kind]);

  const pickFrom = async (source: "camera" | "library") => {
    const perm = source === "camera" ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("Permiso requerido", source === "camera" ? "Active el acceso a la cámara en los ajustes del teléfono." : "Active el acceso a las fotos en los ajustes del teléfono.");
      return;
    }
    const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ["images"], allowsEditing: true, aspect: [1, 1], quality: 0.7 };
    const res = source === "camera" ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
    if (!res.canceled && res.assets[0]) setPhoto(res.assets[0]);
  };

  const choosePhoto = () =>
    Alert.alert("Foto del autorizado", undefined, [
      { text: "Tomar foto", onPress: () => void pickFrom("camera") },
      { text: "Elegir de la galería", onPress: () => void pickFrom("library") },
      { text: "Cancelar", style: "cancel" }
    ]);

  const toggleDay = (d: number) => setWeekdays((w) => (w.includes(d) ? w.filter((x) => x !== d) : [...w, d].sort()));

  const problem = (): string | null => {
    if (!unitId) return "No tiene una filial asignada";
    if (names.trim().length < 2) return "Escriba el nombre del autorizado";
    if (plate && normalizePlate(plate).length < 2) return "La placa no es válida";
    if (kind === "temporary" && !from) return "Elija la fecha de la autorización";
    if (kind === "employee") {
      if (weekdays.length === 0) return "Elija al menos un día de trabajo";
      if (!HHMM.test(timeFrom) || !HHMM.test(timeTo)) return "Escriba el horario como 07:00 y 18:00";
      if (timeFrom >= timeTo) return "La hora de salida debe ser después de la de entrada";
    }
    return null;
  };

  const save = async () => {
    const p = problem();
    if (p) return setError(p);
    setError(null);
    setSaving(true);
    const body = {
      unitId,
      kind,
      names: names.trim(),
      idNumber: idNumber.trim() || null,
      plate: plate ? normalizePlate(plate) : null,
      occupation: kind === "employee" ? occupation.trim() || null : null,
      validFrom: kind === "temporary" ? from : null,
      validTo: kind === "temporary" ? to : null,
      weekdays: kind === "employee" ? weekdays : null,
      timeFrom: kind === "employee" ? timeFrom : null,
      timeTo: kind === "employee" ? timeTo : null,
      callToConfirm,
      deleteAfterUse: kind === "temporary" && deleteAfterUse,
      instructions: instructions.trim() || null
    };
    try {
      let id = editingId;
      if (id) await api(`/resident/authorizations/${id}`, { method: "PUT", body });
      else id = (await api<{ id: string }>("/resident/authorizations", { method: "POST", body })).id;
      if (photo) {
        try {
          await uploadImage(`/resident/authorizations/${id}/photo`, photo);
        } catch (err) {
          // El autorizado ya quedó guardado: se avisa sin perder lo demás
          Alert.alert("Autorizado guardado sin foto", err instanceof ApiError ? err.message : "No se pudo subir la foto");
        }
      }
      router.back();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo guardar");
    } finally {
      setSaving(false);
    }
  };

  const title = `${editingId ? "Editar" : "Nuevo"} ${KIND_TITLE[kind]}`;

  if (!units) {
    return (
      <View style={{ flex: 1 }}>
        <ScreenHeader title={title} />
        <ActivityIndicator style={{ marginTop: 40 }} color={colors.primary} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.background }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScreenHeader title={title} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Pressable style={styles.photoBox} onPress={choosePhoto} accessibilityRole="button" accessibilityLabel="Foto del autorizado">
          <PersonPhoto uri={photo?.uri ?? currentPhoto} names={names || "?"} size={120} />
          <View style={styles.camera}>
            <MaterialIcons name="photo-camera" size={22} color={colors.onPrimary} />
          </View>
        </Pressable>

        {units.length > 1 && (
          <View style={{ gap: 6 }}>
            <Text style={styles.label}>Filial</Text>
            <View style={styles.wrap}>
              {units.map((u) => (
                <Chip key={u.id} label={unitLabel(u)} active={unitId === u.id} onPress={() => setUnitId(u.id)} />
              ))}
            </View>
          </View>
        )}

        <Field label="Nombre" value={names} onChangeText={setNames} placeholder="Nombre y apellidos" autoCapitalize="words" maxLength={120} />
        <Field label={idLabel} value={idNumber} onChangeText={setIdNumber} placeholder="Opcional" maxLength={30} />
        <Field label="Placa" value={plate} onChangeText={(v) => setPlate(v.toUpperCase())} placeholder="Opcional" autoCapitalize="characters" maxLength={20} />
        {kind === "employee" && <Field label="Ocupación" value={occupation} onChangeText={setOccupation} placeholder="Niñera, jardinero, chofer…" maxLength={60} />}

        <SwitchRow label="Quiero que me llamen a la casa a confirmar el ingreso" value={callToConfirm} onChange={setCallToConfirm} />
        {kind === "temporary" && <SwitchRow label="¿Eliminar autorizado una vez utilizado?" value={deleteAfterUse} onChange={setDeleteAfterUse} />}

        {kind === "temporary" && (
          <View style={{ gap: 6 }}>
            <Text style={styles.label}>Fecha de la autorización</Text>
            <DateStrip
              from={from}
              to={to}
              onChange={(f, t) => {
                setFrom(f);
                setTo(t);
              }}
            />
          </View>
        )}

        {kind === "employee" && (
          <>
            <View style={{ gap: 6 }}>
              <Text style={styles.label}>Días de trabajo</Text>
              <View style={styles.wrap}>
                {WEEKDAY_SHORT.map((d, i) => (
                  <Chip key={d} label={d} active={weekdays.includes(i + 1)} onPress={() => toggleDay(i + 1)} />
                ))}
              </View>
            </View>
            <View style={{ flexDirection: "row", gap: 12 }}>
              <View style={{ flex: 1 }}>
                <Field label="Entra desde" value={timeFrom} onChangeText={(v) => setTimeFrom(tidyTime(v))} keyboardType="numbers-and-punctuation" placeholder="07:00" />
              </View>
              <View style={{ flex: 1 }}>
                <Field label="Hasta" value={timeTo} onChangeText={(v) => setTimeTo(tidyTime(v))} keyboardType="numbers-and-punctuation" placeholder="18:00" />
              </View>
            </View>
          </>
        )}

        <Field
          label="Agrega extra indicaciones para el oficial"
          value={instructions}
          onChangeText={setInstructions}
          placeholder="Ej.: viene en taxi, dejar pasar solo hasta el lobby…"
          multiline
          maxLength={500}
          style={styles.textarea}
        />

        {error && <Notice text={error} />}
      </ScrollView>
      <Fab icon="save" label="Guardar" onPress={save} busy={saving} />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, gap: 16, paddingBottom: 120 },
  photoBox: { alignSelf: "center", marginBottom: 4 },
  camera: {
    position: "absolute",
    right: 0,
    bottom: 0,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 3,
    borderColor: colors.background
  },
  label: { fontSize: 14, fontWeight: "600", color: colors.text },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  textarea: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: colors.text,
    minHeight: 96,
    textAlignVertical: "top"
  }
});
