/**
 * @project DomusApp - Mobile
 * @file src/app/(guard)/(home)/_layout.tsx
 * @description Pestañas del Guarda: Caseta (accesos), Alertas (pánico) y Mensajes (filiales)
 */

import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { Tabs } from "expo-router/tabs";
import type { ComponentProps } from "react";
import { StyleSheet, Text, View } from "react-native";
import { AppHeader } from "@/components/AppHeader";
import { useGuardAlerts } from "@/lib/guardAlerts";
import { useBrand } from "@/theme/brand";
import { colors } from "@/theme/colors";

type IconName = ComponentProps<typeof MaterialIcons>["name"];

function TabIcon({ icon, focused, badge }: Readonly<{ icon: IconName; focused: boolean; badge?: number }>) {
  const brand = useBrand();
  return (
    <View style={[styles.pill, focused && { backgroundColor: brand.primarySoft }]}>
      <MaterialIcons name={icon} size={28} color={focused ? brand.primary : brand.primaryTint} />
      {Boolean(badge) && (
        <View style={styles.badge} accessibilityElementsHidden importantForAccessibility="no">
          <Text style={styles.badgeText}>{badge}</Text>
        </View>
      )}
    </View>
  );
}

export default function GuardTabsLayout() {
  const openAlerts = useGuardAlerts().open.length;
  const brand = useBrand();
  const tabs: { name: string; title: string; icon: IconName; badge?: number }[] = [
    { name: "index", title: "Caseta", icon: "security" },
    { name: "alerts", title: "Alertas", icon: "notifications-active", badge: openAlerts },
    { name: "messages", title: "Mensajes", icon: "chat" }
  ];
  return (
    <Tabs screenOptions={{ tabBarShowLabel: true, tabBarStyle: styles.bar, tabBarActiveTintColor: brand.primary, tabBarInactiveTintColor: colors.textMuted, tabBarLabelStyle: styles.label }}>
      {tabs.map(({ name, title, icon, badge }) => (
        <Tabs.Screen
          key={name}
          name={name}
          options={{
            title,
            header: () => <AppHeader title={title} />,
            tabBarAccessibilityLabel: badge ? `${title}, ${badge} abiertas` : title,
            tabBarIcon: ({ focused }) => <TabIcon icon={icon} focused={focused} badge={badge} />
          }}
        />
      ))}
    </Tabs>
  );
}

const styles = StyleSheet.create({
  bar: { height: 88, paddingTop: 8, borderTopColor: colors.border, backgroundColor: colors.background },
  label: { fontSize: 12, fontWeight: "600" },
  pill: { width: 64, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  badge: {
    position: "absolute",
    top: -4,
    right: 6,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.danger,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4
  },
  badgeText: { color: colors.onPrimary, fontSize: 11, fontWeight: "700" }
});
