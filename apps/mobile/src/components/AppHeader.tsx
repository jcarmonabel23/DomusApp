/**
 * @project DomusApp - Mobile
 * @file src/components/AppHeader.tsx
 * @description Encabezado azul de las pestañas: logo del condominio, título centrado y campana con contador
 */

import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { Image } from "expo-image";
import { router } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { fileUrl } from "@/lib/api";
import { useUnread } from "@/lib/realtime";
import { useSession } from "@/lib/session";
import { useBrand } from "@/theme/brand";
import { colors } from "@/theme/colors";

interface Props {
  title: string;
}

export function AppHeader({ title }: Readonly<Props>) {
  const badge = useUnread();
  const brand = useBrand();
  const insets = useSafeAreaInsets();
  const logo = useSession((s) => s.session?.condominium?.logo?.square ?? null);
  return (
    <View style={[styles.bar, { paddingTop: insets.top + 8, backgroundColor: brand.primary }]}>
      <View style={styles.logo}>
        {logo ? (
          <Image source={{ uri: fileUrl(logo) }} style={styles.logoImg} contentFit="contain" accessibilityLabel="Logo del condominio" />
        ) : (
          <MaterialIcons name="home-work" size={26} color={brand.primary} accessibilityElementsHidden importantForAccessibility="no" />
        )}
      </View>
      <Text style={styles.title} numberOfLines={1} accessibilityRole="header" maxFontSizeMultiplier={1.4}>
        {title}
      </Text>
      <Pressable
        style={styles.side}
        onPress={() => router.push("/notifications")}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={badge > 0 ? `Notificaciones, ${badge} sin leer` : "Notificaciones"}
      >
        <MaterialIcons name="notifications" size={30} color={colors.onPrimary} />
        {badge > 0 && (
          <View style={styles.badge}>
            <Text style={styles.badgeText} maxFontSizeMultiplier={1.2}>
              {badge > 99 ? "99+" : badge}
            </Text>
          </View>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: colors.primary,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingBottom: 12
  },
  logo: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.background,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden"
  },
  logoImg: { width: 36, height: 36 },
  title: { flex: 1, textAlign: "center", color: colors.onPrimary, fontSize: 22, fontWeight: "600" },
  side: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  badge: {
    position: "absolute",
    top: 0,
    right: -2,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.danger,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4
  },
  badgeText: { color: colors.onPrimary, fontSize: 11, fontWeight: "700" }
});
