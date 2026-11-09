/**
 * @project DomusApp - Mobile
 * @file src/components/Illustration.tsx
 * @description Ilustración de los estados vacíos, hecha con vistas e íconos (sin imágenes ni SVG):
 *              un círculo suave con burbujas decorativas, una tarjeta blanca con el ícono principal y un
 *              distintivo con un ícono de acento. Toma el color de marca del condominio.
 *              Es decorativa: los lectores de pantalla la ignoran (el texto del estado vacío la describe).
 */

import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import type { ComponentProps } from "react";
import { StyleSheet, View } from "react-native";
import { useBrand } from "@/theme/brand";
import { colors } from "@/theme/colors";

type IconName = ComponentProps<typeof MaterialIcons>["name"];

interface Props {
  icon: IconName;
  /** Ícono pequeño del distintivo (p. ej. "add", "check", "schedule") */
  accent?: IconName;
  /** Lado del cuadro, en puntos */
  size?: number;
}

export function Illustration({ icon, accent, size = 150 }: Readonly<Props>) {
  const brand = useBrand();
  const u = size / 150; // todas las medidas se escalan desde un diseño de 150 pt
  const dot = (d: number, top: number, left: number, color: string, ring = false) => (
    <View
      style={{
        position: "absolute",
        width: d * u,
        height: d * u,
        borderRadius: (d * u) / 2,
        top: top * u,
        left: left * u,
        ...(ring ? { borderWidth: 2 * u, borderColor: color } : { backgroundColor: color })
      }}
    />
  );

  return (
    <View style={{ width: size, height: size }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {dot(124, 13, 13, brand.primarySoft)}
      {dot(18, 6, 118, brand.primaryTint)}
      {dot(10, 128, 14, colors.cardYellow)}
      {dot(14, 22, 8, brand.primaryTint, true)}
      {dot(8, 112, 132, colors.cardSalmon)}
      <View
        style={[
          styles.card,
          { width: 78 * u, height: 78 * u, borderRadius: 22 * u, top: 36 * u, left: 36 * u }
        ]}
      >
        <MaterialIcons name={icon} size={46 * u} color={brand.primary} />
      </View>
      {accent && (
        <View
          style={[
            styles.badge,
            { width: 38 * u, height: 38 * u, borderRadius: 19 * u, top: 92 * u, left: 98 * u, backgroundColor: brand.primary, borderWidth: 3 * u }
          ]}
        >
          <MaterialIcons name={accent} size={20 * u} color={brand.onPrimary} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    position: "absolute",
    backgroundColor: colors.background,
    alignItems: "center",
    justifyContent: "center",
    elevation: 4,
    shadowColor: "#1f2328",
    shadowOpacity: 0.12,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 }
  },
  badge: { position: "absolute", alignItems: "center", justifyContent: "center", borderColor: colors.background }
});
