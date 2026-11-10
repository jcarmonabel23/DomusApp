/**
 * @project DomusApp - Mobile
 * @file src/components/AccountCard.tsx
 * @description Cuenta del usuario: condominio activo, cambio de condominio, política de privacidad, versión y cierre de sesión
 */

import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useState } from "react";
import { ActivityIndicator, Alert, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { ApiError } from "@/lib/api";
import { signOut, switchCondominium } from "@/lib/auth";
import { API_URL, APP_VERSION } from "@/lib/config";
import { useSession } from "@/lib/session";
import { useBrand } from "@/theme/brand";
import { colors, radius } from "@/theme/colors";

const ROLE: Record<string, string> = { admin: "Administrador", owner: "Propietario", tenant: "Inquilino", guard: "Guarda" };

export function AccountCard() {
  const session = useSession((s) => s.session);
  const [switching, setSwitching] = useState<string | null>(null);
  const brand = useBrand();
  if (!session) return null;
  const current = session.condominium;

  const pick = async (id: string) => {
    setSwitching(id);
    try {
      await switchCondominium(id);
    } catch (err) {
      Alert.alert("No se pudo cambiar", err instanceof ApiError ? err.message : "Intente de nuevo");
    } finally {
      setSwitching(null);
    }
  };

  const confirmSignOut = () =>
    Alert.alert("Cerrar sesión", "¿Desea salir de DomusApp en este teléfono?", [
      { text: "Cancelar", style: "cancel" },
      { text: "Salir", style: "destructive", onPress: () => void signOut() }
    ]);

  return (
    <View style={styles.card}>
      <Text style={styles.name}>{session.user.names}</Text>
      <Text style={styles.muted}>{session.user.email}</Text>

      {session.condominiums.length > 1 && (
        <View style={{ marginTop: 14, gap: 8 }}>
          <Text style={styles.section}>Mis condominios</Text>
          {session.condominiums.map((c) => {
            const active = c.id === current?.id;
            return (
              <Pressable
                key={c.id}
                disabled={active || Boolean(switching)}
                onPress={() => pick(c.id)}
                style={[styles.condo, active && { borderWidth: 1, borderColor: brand.primaryTint }]}
                accessibilityRole="radio"
                accessibilityLabel={`${c.name}, ${ROLE[c.role] ?? c.role}`}
                accessibilityState={{ checked: active, busy: switching === c.id }}
              >
                <MaterialIcons name={active ? "radio-button-checked" : "radio-button-unchecked"} size={20} color={brand.primary} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.condoName}>{c.name}</Text>
                  <Text style={styles.muted}>{ROLE[c.role] ?? c.role}</Text>
                </View>
                {switching === c.id && <ActivityIndicator color={brand.primary} />}
              </Pressable>
            );
          })}
        </View>
      )}

      <Pressable onPress={() => void Linking.openURL(`${API_URL}/privacidad`)} style={styles.link} accessibilityRole="link" hitSlop={8}>
        <MaterialIcons name="privacy-tip" size={20} color={colors.textMuted} />
        <Text style={styles.linkText}>Política de privacidad y eliminación de cuenta</Text>
      </Pressable>

      <Pressable onPress={confirmSignOut} style={styles.logout} accessibilityRole="button" hitSlop={8}>
        <MaterialIcons name="logout" size={20} color={colors.danger} />
        <Text style={styles.logoutText}>Cerrar sesión</Text>
      </Pressable>
      <Text style={[styles.muted, { marginTop: 8 }]}>DomusApp {APP_VERSION}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: radius.md, padding: 16 },
  name: { fontSize: 17, fontWeight: "700", color: colors.text },
  muted: { fontSize: 13, color: colors.textMuted },
  section: { fontSize: 13, fontWeight: "700", color: colors.textMuted, textTransform: "uppercase" },
  condo: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: radius.sm, backgroundColor: colors.background },
  condoName: { fontSize: 15, fontWeight: "600", color: colors.text },
  link: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 16, minHeight: 44 },
  linkText: { color: colors.text, fontSize: 15, flexShrink: 1 },
  logout: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 16, alignSelf: "flex-start", minHeight: 44 },
  logoutText: { color: colors.danger, fontWeight: "700", fontSize: 15 }
});
