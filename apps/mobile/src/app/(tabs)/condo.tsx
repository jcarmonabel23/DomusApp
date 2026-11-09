/**
 * @project DomusApp - Mobile
 * @file src/app/(tabs)/condo.tsx
 * @description Mi Condominio: perfil, comunicados, documentos, cuentas bancarias, asambleas, acuerdos y mi cuenta
 */

import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { router, type Href } from "expo-router";
import type { ComponentProps } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { AccountCard } from "@/components/AccountCard";
import { fileUrl } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useBrand } from "@/theme/brand";
import { colors, radius } from "@/theme/colors";

const ITEMS: { title: string; icon: ComponentProps<typeof MaterialIcons>["name"]; phase: number; href?: Href }[] = [
  { title: "Comunicados", icon: "campaign", phase: 3, href: "/announcements" },
  { title: "Documentos", icon: "folder-shared", phase: 7 },
  { title: "Seguimiento a acuerdos", icon: "handshake", phase: 7 },
  { title: "Cuentas bancarias", icon: "account-balance", phase: 5 },
  { title: "Asambleas", icon: "groups", phase: 7 }
];

export default function CondoScreen() {
  const condo = useSession((s) => s.session?.condominium);
  const brand = useBrand();
  const logo = condo?.logo?.square;
  const profileLabel = condo ? `${condo.name}, ${condo.country.name}, ${condo.currency.code}` : "Mi condominio";
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={[styles.profile, { backgroundColor: brand.primarySoft }]} accessible accessibilityLabel={profileLabel}>
        <View style={[styles.logo, { borderColor: brand.primary }]}>
          {logo ? (
            <Image source={{ uri: fileUrl(logo) }} style={{ width: 92, height: 92 }} contentFit="contain" />
          ) : (
            <MaterialIcons name="home-work" size={52} color={brand.primary} />
          )}
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.profileLabel}>Perfil</Text>
          <Text style={styles.profileName}>{condo?.name ?? "Mi condominio"}</Text>
          <Text style={styles.profileMeta}>{condo ? `${condo.country.name} · ${condo.currency.code}` : ""}</Text>
        </View>
      </View>
      <View style={styles.grid}>
        {ITEMS.map((it) => (
          <Pressable
            key={it.title}
            style={({ pressed }) => [styles.tile, !it.href && { opacity: 0.6 }, pressed && { opacity: 0.8 }]}
            disabled={!it.href}
            onPress={() => it.href && router.push(it.href)}
            accessibilityRole="button"
            accessibilityLabel={it.href ? it.title : `${it.title}, disponible en la fase ${it.phase}`}
            accessibilityState={{ disabled: !it.href }}
          >
            <Text style={styles.tileTitle}>{it.title}</Text>
            <MaterialIcons name={it.icon} size={64} color={brand.primary} />
            <Text style={styles.tileText}>{it.href ? "Ver" : `Fase ${it.phase}`}</Text>
          </Pressable>
        ))}
      </View>
      <AccountCard />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: 12, gap: 12 },
  profile: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: 20,
    flexDirection: "row",
    alignItems: "center",
    gap: 20
  },
  logo: {
    width: 110,
    height: 110,
    borderRadius: 55,
    borderWidth: 2,
    overflow: "hidden",
    backgroundColor: colors.background,
    alignItems: "center",
    justifyContent: "center"
  },
  profileLabel: { fontSize: 15, color: colors.textMuted },
  profileName: { fontSize: 20, color: colors.text, fontWeight: "700", flexShrink: 1 },
  profileMeta: { fontSize: 14, color: colors.textMuted, marginTop: 4 },
  grid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: 12 },
  tile: {
    width: "48.5%",
    minHeight: 220,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: 16,
    alignItems: "center",
    justifyContent: "space-between"
  },
  tileTitle: { fontSize: 20, fontWeight: "600", color: colors.text, textAlign: "center" },
  tileText: { fontSize: 15, color: colors.textMuted }
});
