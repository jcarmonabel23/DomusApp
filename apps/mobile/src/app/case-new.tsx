/**
 * @project DomusApp - Mobile
 * @file src/app/case-new.tsx
 * @description Reportar un caso: tipo, asunto, descripción, lugar, filial, fotos y (solo denuncias) anonimato
 */

import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Chip, ScreenHeader, SwitchRow } from "@/components/access";
import { Button, Field, Notice } from "@/components/ui";
import { api, ApiError, uploadImage } from "@/lib/api";
import { unitLabel, type ResidentUnit } from "@/lib/access";
import { CASE_CATEGORY, type CaseCategory, type CaseDetail } from "@/lib/community";
import { useBrand } from "@/theme/brand";
import { colors, radius } from "@/theme/colors";

const MAX_PHOTOS = 4;

export default function NewCaseScreen() {
  const brand = useBrand();
  const [category, setCategory] = useState<CaseCategory | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [units, setUnits] = useState<ResidentUnit[]>([]);
  const [unitId, setUnitId] = useState<string | null>(null);
  const [anonymous, setAnonymous] = useState(false);
  const [photos, setPhotos] = useState<ImagePicker.ImagePickerAsset[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ units: ResidentUnit[] }>("/resident/home")
      .then((h) => {
        setUnits(h.units);
        setUnitId((u) => u ?? h.units[0]?.id ?? null);
      })
      .catch(() => undefined);
  }, []);

  const addPhoto = async (source: "camera" | "library") => {
    const perm = source === "camera" ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("Permiso necesario", source === "camera" ? "Permita el uso de la cámara para tomar la foto." : "Permita el acceso a sus fotos.");
      return;
    }
    const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ["images"], quality: 0.7 };
    const res = source === "camera" ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
    if (!res.canceled && res.assets[0]) setPhotos((p) => [...p, res.assets[0]].slice(0, MAX_PHOTOS));
  };

  const valid = Boolean(category && title.trim().length >= 4 && description.trim().length >= 10);

  const submit = async () => {
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      const c = await api<CaseDetail>("/resident/cases", {
        method: "POST",
        body: { category, title: title.trim(), description: description.trim(), location: location.trim() || null, unitId: anonymous ? null : unitId, anonymous }
      });
      let failed = 0;
      for (const p of photos) await uploadImage(`/resident/cases/${c.id}/files`, p, "POST").catch(() => (failed += 1));
      if (failed) Alert.alert("Caso enviado", `No se pudieron subir ${failed} foto(s). Puede agregarlas desde el caso.`);
      router.replace({ pathname: "/case", params: { id: c.id, created: "1" } });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo enviar el caso");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScreenHeader title="Reportar un caso" />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={styles.label}>¿Qué quiere reportar?</Text>
          <View style={styles.grid}>
            {(Object.keys(CASE_CATEGORY) as CaseCategory[]).map((k) => {
              const c = CASE_CATEGORY[k];
              const active = category === k;
              return (
                <Pressable
                  key={k}
                  onPress={() => {
                    setCategory(k);
                    if (k !== "report") setAnonymous(false);
                  }}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={`${c.label}: ${c.hint}`}
                  style={[styles.cat, { borderColor: active ? brand.primary : colors.border, backgroundColor: active ? brand.primarySoft : colors.background }]}
                >
                  <View style={[styles.catIcon, { backgroundColor: c.bg }]}>
                    <MaterialIcons name={c.icon} size={24} color={c.fg} />
                  </View>
                  <Text style={styles.catTitle}>{c.label}</Text>
                  <Text style={styles.catHint}>{c.hint}</Text>
                </Pressable>
              );
            })}
          </View>

          <Field label="Asunto" value={title} onChangeText={setTitle} maxLength={120} placeholder="Ej.: fuga de agua en el pasillo" />
          <Field
            label="Descripción"
            value={description}
            onChangeText={setDescription}
            maxLength={4000}
            multiline
            numberOfLines={5}
            style={{ minHeight: 120, textAlignVertical: "top" }}
            placeholder="Cuéntenos qué pasa, desde cuándo y cualquier detalle útil"
          />
          <Field label="Lugar (opcional)" value={location} onChangeText={setLocation} maxLength={120} placeholder="Torre, piso, área común…" />

          {category === "report" && (
            <View style={styles.anon}>
              <SwitchRow label="Enviar como denuncia anónima" value={anonymous} onChange={setAnonymous} />
              <Text style={styles.hint}>La administración no verá su nombre ni su filial. Usted podrá seguir el caso en la app.</Text>
            </View>
          )}

          {!anonymous && units.length > 1 && (
            <View style={{ gap: 8 }}>
              <Text style={styles.label}>Filial</Text>
              <View style={styles.chips}>
                {units.map((u) => (
                  <Chip key={u.id} label={unitLabel(u)} active={unitId === u.id} onPress={() => setUnitId(u.id)} />
                ))}
              </View>
            </View>
          )}

          <View style={{ gap: 8 }}>
            <Text style={styles.label}>Fotos (opcional, hasta {MAX_PHOTOS})</Text>
            <View style={styles.chips}>
              {photos.map((p, i) => (
                <View key={p.uri}>
                  <Image source={{ uri: p.uri }} style={styles.photo} contentFit="cover" accessibilityLabel={`Foto ${i + 1}`} />
                  <Pressable
                    onPress={() => setPhotos((x) => x.filter((_, j) => j !== i))}
                    accessibilityRole="button"
                    accessibilityLabel={`Quitar foto ${i + 1}`}
                    hitSlop={8}
                    style={styles.remove}
                  >
                    <MaterialIcons name="close" size={16} color={colors.onPrimary} />
                  </Pressable>
                </View>
              ))}
              {photos.length < MAX_PHOTOS && (
                <>
                  <Pressable onPress={() => addPhoto("camera")} accessibilityRole="button" accessibilityLabel="Tomar foto" style={[styles.photo, styles.add]}>
                    <MaterialIcons name="photo-camera" size={28} color={brand.primary} />
                  </Pressable>
                  <Pressable onPress={() => addPhoto("library")} accessibilityRole="button" accessibilityLabel="Elegir de la galería" style={[styles.photo, styles.add]}>
                    <MaterialIcons name="photo-library" size={28} color={brand.primary} />
                  </Pressable>
                </>
              )}
            </View>
          </View>

          {error && <Notice text={error} />}
          <Button title="Enviar caso" onPress={submit} loading={busy} disabled={!valid} />
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 16, paddingBottom: 48 },
  label: { fontSize: 15, fontWeight: "700", color: colors.text },
  hint: { fontSize: 13, color: colors.textMuted },
  grid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: 10 },
  cat: { width: "48.5%", borderWidth: 1.5, borderRadius: radius.md, padding: 12, gap: 6 },
  catIcon: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  catTitle: { fontSize: 15, fontWeight: "700", color: colors.text },
  catHint: { fontSize: 12, color: colors.textMuted },
  anon: { backgroundColor: "#f3e5f9", borderRadius: radius.md, padding: 12, gap: 4 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  photo: { width: 76, height: 76, borderRadius: radius.sm },
  add: { borderWidth: 1.5, borderStyle: "dashed", borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  remove: { position: "absolute", top: -6, right: -6, width: 24, height: 24, borderRadius: 12, backgroundColor: colors.danger, alignItems: "center", justifyContent: "center" }
});
