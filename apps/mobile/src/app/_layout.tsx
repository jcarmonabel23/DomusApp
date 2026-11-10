/**
 * @project DomusApp - Mobile
 * @file src/app/_layout.tsx
 * @description Raíz: restaura la sesión y decide la interfaz según la sesión y el rol
 *
 *   sin sesión → login / otp · contraseña temporal → change-password
 *   Propietario / Inquilino / Administrador → (tabs) · Guarda → (guard)
 */

import { DefaultTheme, ThemeProvider } from "expo-router";
import { Stack } from "expo-router/stack";
import { StatusBar } from "expo-status-bar";
import { useEffect, useMemo } from "react";
import { listenNotificationTaps, presentLocal, setupNotifications, type AppNotification } from "@/lib/notifications";
import { startRealtime, useRealtime } from "@/lib/realtime";
import { ActivityIndicator, View } from "react-native";
import { restoreSession } from "@/lib/auth";
import { useSession } from "@/lib/session";
import { useBrand } from "@/theme/brand";
import { colors } from "@/theme/colors";

/** Tiempo real, permiso de notificaciones/push y toques en notificaciones, mientras hay sesión lista */
function SessionServices({ ready }: Readonly<{ ready: boolean }>) {
  useEffect(() => startRealtime(), []);
  useEffect(() => listenNotificationTaps(), []);
  useEffect(() => {
    if (ready) void setupNotifications();
  }, [ready]);
  // Con la app abierta, cada aviso también aparece como banner del sistema (con sonido)
  useRealtime<{ notification: AppNotification }>("notification", ({ notification }) => presentLocal(notification));
  return null;
}

export default function RootLayout() {
  const status = useSession((s) => s.status);
  const mustChange = useSession((s) => Boolean(s.session?.user.mustChangePassword));
  const role = useSession((s) => s.session?.condominium?.role ?? null);
  const brand = useBrand();
  const theme = useMemo(
    () => ({ ...DefaultTheme, colors: { ...DefaultTheme.colors, primary: brand.primary, background: colors.background } }),
    [brand.primary]
  );

  useEffect(() => {
    void restoreSession();
  }, []);

  if (status === "booting") {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.primary }}>
        <ActivityIndicator color={colors.onPrimary} size="large" />
      </View>
    );
  }

  const signedIn = status === "authenticated";
  const ready = signedIn && !mustChange;

  return (
    <ThemeProvider value={theme}>
      <StatusBar style="light" />
      <SessionServices ready={ready} />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Protected guard={!signedIn}>
          <Stack.Screen name="login" />
          <Stack.Screen name="otp" />
        </Stack.Protected>
        <Stack.Protected guard={signedIn && mustChange}>
          <Stack.Screen name="change-password" />
        </Stack.Protected>
        <Stack.Protected guard={ready && role === "guard"}>
          <Stack.Screen name="(guard)" />
        </Stack.Protected>
        <Stack.Protected guard={ready && role !== "guard"}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="authorization" />
          <Stack.Screen name="vehicles" />
          <Stack.Screen name="visits" />
          <Stack.Screen name="panic" options={{ presentation: "modal" }} />
          <Stack.Screen name="threads" />
          <Stack.Screen name="finance" />
          <Stack.Screen name="finance-pay" />
          <Stack.Screen name="amenity" />
          <Stack.Screen name="my-bookings" />
          <Stack.Screen name="cases" />
          <Stack.Screen name="case-new" />
          <Stack.Screen name="case" />
          <Stack.Screen name="documents" />
          <Stack.Screen name="assemblies" />
          <Stack.Screen name="assembly" />
          <Stack.Screen name="agreements" />
          <Stack.Screen name="suppliers" />
        </Stack.Protected>
        <Stack.Protected guard={ready}>
          <Stack.Screen name="chat" />
          <Stack.Screen name="notifications" />
          <Stack.Screen name="announcements" />
        </Stack.Protected>
      </Stack>
    </ThemeProvider>
  );
}
