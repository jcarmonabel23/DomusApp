/**
 * @project DomusApp - Mobile
 * @file src/components/ComingSoon.tsx
 * @description Estado vacío de una sección que se construye en una fase posterior (estilo "No tienes casos")
 */

import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import type { ComponentProps } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useBrand } from "@/theme/brand";
import { colors } from "@/theme/colors";
import { Illustration } from "./Illustration";

interface Props {
  icon: ComponentProps<typeof MaterialIcons>["name"];
  title: string;
  description: string;
  phase: number;
}

export function ComingSoon({ icon, title, description, phase }: Readonly<Props>) {
  const brand = useBrand();
  return (
    <View style={styles.wrap} accessible accessibilityLabel={`${title}. ${description}. Disponible en la fase ${phase}.`}>
      <Illustration icon={icon} accent="schedule" size={170} />
      <Text style={[styles.title, { color: brand.primary }]}>{title}</Text>
      <Text style={styles.description}>{description}</Text>
      <View style={[styles.pill, { backgroundColor: brand.primarySoft }]}>
        <Text style={[styles.pillText, { color: brand.primary }]}>Disponible en la fase {phase}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 6, backgroundColor: colors.background },
  title: { fontSize: 24, fontWeight: "600", textAlign: "center", marginTop: 18 },
  description: { fontSize: 16, color: colors.text, textAlign: "center", lineHeight: 22 },
  pill: { marginTop: 22, borderRadius: 999, paddingVertical: 12, paddingHorizontal: 26 },
  pillText: { fontSize: 15, fontWeight: "700", letterSpacing: 0.5 }
});
