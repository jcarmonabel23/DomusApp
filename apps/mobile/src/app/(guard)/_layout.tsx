/**
 * @project DomusApp - Mobile
 * @file src/app/(guard)/_layout.tsx
 * @description Interfaz del Guarda: pestañas (caseta, alertas, mensajes), registro de visitas y la alarma de
 *              pánico, que se monta aquí para sonar en cualquier pantalla de la caseta
 */

import { Stack } from "expo-router/stack";
import { View } from "react-native";
import { AlarmOverlay } from "@/components/AlarmOverlay";
import { ScreenHeader } from "@/components/access";

export default function GuardLayout() {
  return (
    <View style={{ flex: 1 }}>
      <Stack>
        <Stack.Screen name="(home)" options={{ headerShown: false }} />
        <Stack.Screen name="visit" options={{ header: () => <ScreenHeader title="Visita no anunciada" /> }} />
      </Stack>
      <AlarmOverlay />
    </View>
  );
}
