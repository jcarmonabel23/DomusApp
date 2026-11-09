/**
 * @project DomusApp - Mobile
 * @file src/components/ui.tsx
 * @description Piezas de interfaz comunes: campo de texto, botón, aviso y pantalla de autenticación
 */

import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import type { ReactNode } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useBrand } from "@/theme/brand";
import { colors, radius } from "@/theme/colors";

export function Field({ label, ...props }: Readonly<TextInputProps & { label: string }>) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={styles.label} importantForAccessibility="no" accessibilityElementsHidden>
        {label}
      </Text>
      <TextInput placeholderTextColor={colors.textMuted} style={styles.input} accessibilityLabel={label} {...props} />
    </View>
  );
}

interface ButtonProps {
  title: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  variant?: "primary" | "ghost" | "danger";
}

export function Button({ title, onPress, loading, disabled, variant = "primary" }: Readonly<ButtonProps>) {
  const off = disabled || loading;
  const brand = useBrand();
  const tone = variant === "danger" ? colors.danger : brand.primary;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: Boolean(off), busy: Boolean(loading) }}
      disabled={off}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: variant === "ghost" ? "transparent" : tone },
        off && { opacity: 0.5 },
        pressed && { opacity: 0.8 }
      ]}
    >
      {loading ? (
        <ActivityIndicator color={variant === "ghost" ? brand.primary : colors.onPrimary} />
      ) : (
        <Text style={[styles.buttonText, variant === "ghost" && { color: brand.primary }]}>{title}</Text>
      )}
    </Pressable>
  );
}

export function Notice({ text, tone = "error" }: Readonly<{ text: string; tone?: "error" | "info" }>) {
  const brand = useBrand();
  return (
    <View
      style={[styles.notice, tone === "info" && { backgroundColor: brand.primarySoft }]}
      accessible
      accessibilityRole={tone === "error" ? "alert" : "text"}
      accessibilityLiveRegion={tone === "error" ? "assertive" : "polite"}
    >
      <MaterialIcons name={tone === "error" ? "error-outline" : "info-outline"} size={20} color={tone === "error" ? colors.danger : brand.primary} />
      <Text style={styles.noticeText}>{text}</Text>
    </View>
  );
}

/** Fondo azul con logo y tarjeta blanca (login, OTP, cambio de contraseña) */
export function AuthScreen({ title, subtitle, children }: Readonly<{ title: string; subtitle?: string; children: ReactNode }>) {
  const insets = useSafeAreaInsets();
  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.primary }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={[styles.authContent, { paddingTop: insets.top + 40 }]} keyboardShouldPersistTaps="handled">
        <View style={styles.brand}>
          <View style={styles.logo}>
            <MaterialIcons name="home-work" size={40} color={colors.primary} />
          </View>
          <Text style={styles.brandText} accessibilityRole="header">
            Domus<Text style={{ fontWeight: "800" }}>App</Text>
          </Text>
        </View>
        <View style={styles.card}>
          <Text style={styles.title} accessibilityRole="header">
            {title}
          </Text>
          {subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
          <View style={{ gap: 16, marginTop: 8 }}>{children}</View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 14, fontWeight: "600", color: colors.text },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: colors.text,
    backgroundColor: colors.background
  },
  button: { minHeight: 48, borderRadius: radius.sm, paddingVertical: 14, alignItems: "center", justifyContent: "center" },
  buttonText: { color: colors.onPrimary, fontSize: 16, fontWeight: "700" },
  notice: { flexDirection: "row", gap: 8, backgroundColor: colors.dangerSoft, borderRadius: radius.sm, padding: 12, alignItems: "center" },
  noticeText: { flex: 1, color: colors.text, fontSize: 14 },
  authContent: { flexGrow: 1, paddingHorizontal: 20, paddingBottom: 40 },
  brand: { alignItems: "center", marginBottom: 28, gap: 10 },
  logo: { width: 76, height: 76, borderRadius: 38, backgroundColor: colors.background, alignItems: "center", justifyContent: "center" },
  brandText: { color: colors.onPrimary, fontSize: 28, fontWeight: "500" },
  card: { backgroundColor: colors.background, borderRadius: radius.lg, padding: 22 },
  title: { fontSize: 22, fontWeight: "700", color: colors.text },
  subtitle: { fontSize: 14, color: colors.textMuted, marginTop: 6, lineHeight: 20 }
});
