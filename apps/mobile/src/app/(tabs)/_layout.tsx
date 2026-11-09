/**
 * @project DomusApp - Mobile
 * @file src/app/(tabs)/_layout.tsx
 * @description Pestañas del Propietario / Inquilino, con la barra inferior de las capturas de referencia:
 *              solo íconos y la pestaña activa resaltada en una píldora celeste.
 */

import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import type { ComponentProps } from "react";
import { StyleSheet, View } from "react-native";
import { Tabs } from "expo-router/tabs";
import { AppHeader } from "@/components/AppHeader";
import { useBrand } from "@/theme/brand";
import { colors } from "@/theme/colors";

type IconName = ComponentProps<typeof MaterialIcons>["name"];

const TABS: { name: string; title: string; icon: IconName }[] = [
  { name: "index", title: "Inicio", icon: "home" },
  { name: "authorized", title: "Autorizados", icon: "people" },
  { name: "dashboard", title: "Mi dashboard", icon: "dashboard" },
  { name: "bookings", title: "Reservaciones", icon: "event" },
  { name: "condo", title: "Mi Condominio", icon: "apartment" }
];

function TabIcon({ icon, focused }: Readonly<{ icon: IconName; focused: boolean }>) {
  const brand = useBrand();
  return (
    <View style={[styles.pill, focused && { backgroundColor: brand.primarySoft }]}>
      <MaterialIcons name={icon} size={28} color={focused ? brand.primary : brand.primaryTint} />
    </View>
  );
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarShowLabel: false,
        tabBarStyle: styles.bar,
        tabBarItemStyle: styles.item
      }}
    >
      {TABS.map(({ name, title, icon }) => (
        <Tabs.Screen
          key={name}
          name={name}
          options={{
            title,
            header: () => <AppHeader title={title} />,
            tabBarAccessibilityLabel: title,
            tabBarIcon: ({ focused }) => <TabIcon icon={icon} focused={focused} />
          }}
        />
      ))}
    </Tabs>
  );
}

const styles = StyleSheet.create({
  bar: { height: 84, paddingTop: 10, borderTopColor: colors.border, backgroundColor: colors.background },
  item: { justifyContent: "center" },
  pill: { width: 72, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" }
});
