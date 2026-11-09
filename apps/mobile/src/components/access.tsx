/**
 * @project DomusApp - Mobile
 * @file src/components/access.tsx
 * @description Piezas del control de acceso: encabezado con regreso, foto o iniciales, chips, botón flotante,
 *              interruptor con texto, selector de fecha/rango y estado vacío
 */

import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { Image } from "expo-image";
import { router } from "expo-router";
import type { ComponentProps, ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { fileUrl } from "@/lib/api";
import { addDays, fmtDayShort, isoDay, parseDay } from "@/lib/access";
import { Illustration } from "./Illustration";
import { useBrand } from "@/theme/brand";
import { colors, radius } from "@/theme/colors";

type IconName = ComponentProps<typeof MaterialIcons>["name"];

/** Encabezado azul de pantallas secundarias: flecha atrás, título centrado y acción opcional */
export function ScreenHeader({ title, right }: Readonly<{ title: string; right?: ReactNode }>) {
  const insets = useSafeAreaInsets();
  const brand = useBrand();
  return (
    <View style={[styles.header, { paddingTop: insets.top + 8, backgroundColor: brand.primary }]}>
      <Pressable accessibilityRole="button" accessibilityLabel="Regresar" hitSlop={12} onPress={() => router.back()} style={styles.headerSide}>
        <MaterialIcons name="arrow-back" size={28} color={colors.onPrimary} />
      </Pressable>
      <Text style={styles.headerTitle} numberOfLines={1} accessibilityRole="header" maxFontSizeMultiplier={1.4}>
        {title}
      </Text>
      <View style={styles.headerSide}>{right}</View>
    </View>
  );
}

const initialsOf = (names: string) =>
  names
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");

/** Foto (URL firmada relativa) o iniciales */
export function PersonPhoto({ uri, names, size = 64 }: Readonly<{ uri?: string | null; names: string; size?: number }>) {
  const src = uri?.startsWith("/") ? fileUrl(uri) : uri;
  const brand = useBrand();
  return (
    <View
      style={[styles.photo, { width: size, height: size, borderRadius: size / 2, backgroundColor: brand.primarySoft }]}
      accessible
      accessibilityRole="image"
      accessibilityLabel={src ? `Foto de ${names}` : names}
    >
      {src ? (
        <Image source={{ uri: src }} style={{ width: size, height: size }} contentFit="cover" transition={150} />
      ) : (
        <Text style={[styles.photoText, { fontSize: size * 0.36, color: brand.primary }]} maxFontSizeMultiplier={1}>
          {initialsOf(names)}
        </Text>
      )}
    </View>
  );
}

export function Chip({ label, active, onPress, tone }: Readonly<{ label: string; active?: boolean; onPress?: () => void; tone?: "danger" }>) {
  const brand = useBrand();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={[styles.chip, active && { backgroundColor: brand.primary, borderColor: brand.primary }, tone === "danger" && active && { backgroundColor: colors.danger, borderColor: colors.danger }]}
    >
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </Pressable>
  );
}

/** Botón redondo flotante abajo a la derecha (+ / guardar) */
export function Fab({ icon = "add", onPress, label, busy }: Readonly<{ icon?: IconName; onPress: () => void; label: string; busy?: boolean }>) {
  const insets = useSafeAreaInsets();
  const brand = useBrand();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ busy, disabled: busy }}
      disabled={busy}
      onPress={onPress}
      style={({ pressed }) => [styles.fab, { bottom: 20 + insets.bottom * 0.3, backgroundColor: brand.primary }, (pressed || busy) && { opacity: 0.7 }]}
    >
      <MaterialIcons name={busy ? "hourglass-top" : icon} size={30} color={colors.onPrimary} />
    </Pressable>
  );
}

/** Fila con texto y un interruptor (como en "Nuevo Temporal") */
export function SwitchRow({ label, value, onChange }: Readonly<{ label: string; value: boolean; onChange: (v: boolean) => void }>) {
  const brand = useBrand();
  return (
    <Pressable
      style={styles.switchRow}
      onPress={() => onChange(!value)}
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value }}
    >
      <Text style={styles.switchText}>{label}</Text>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ true: brand.primaryTint, false: colors.border }}
        thumbColor={value ? brand.primary : "#f4f4f5"}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      />
    </Pressable>
  );
}

interface EmptyProps {
  icon: IconName;
  title: string;
  text?: string;
  /** Ícono pequeño del distintivo de la ilustración */
  accent?: IconName;
  /** Acción sugerida (p. ej. "Agregar autorizado") */
  action?: { label: string; onPress: () => void };
  /** Versión compacta para secciones dentro de una pantalla */
  compact?: boolean;
}

/** Estado vacío ilustrado: ilustración, título, texto y acción opcional */
export function EmptyState({ icon, title, text, accent, action, compact }: Readonly<EmptyProps>) {
  const brand = useBrand();
  return (
    <View style={[styles.empty, compact && { paddingVertical: 20 }]}>
      <View accessible accessibilityLabel={[title, text].filter(Boolean).join(". ")} style={{ alignItems: "center", gap: 8 }}>
        <Illustration icon={icon} accent={accent} size={compact ? 110 : 150} />
        <Text style={styles.emptyTitle}>{title}</Text>
        {text && <Text style={styles.emptyText}>{text}</Text>}
      </View>
      {action && (
        <Pressable
          accessibilityRole="button"
          onPress={action.onPress}
          style={({ pressed }) => [styles.emptyAction, { borderColor: brand.primary }, pressed && { backgroundColor: brand.primarySoft }]}
        >
          <Text style={[styles.emptyActionText, { color: brand.primary }]}>{action.label}</Text>
        </Pressable>
      )}
    </View>
  );
}

interface DateRangeProps {
  from: string | null;
  to: string | null;
  onChange: (from: string | null, to: string | null) => void;
  /** Días hacia adelante que ofrece (incluye hoy) */
  days?: number;
  /** false = una sola fecha */
  range?: boolean;
}

/**
 * Selector de fecha o rango sin dependencias: tira horizontal de días.
 * Primer toque = desde; segundo toque posterior = hasta; un toque más reinicia.
 */
export function DateStrip({ from, to, onChange, days = 60, range = true }: Readonly<DateRangeProps>) {
  const today = new Date();
  const list = Array.from({ length: days }, (_, i) => isoDay(addDays(today, i)));

  const tap = (d: string) => {
    if (!range || !from || (from && to && from !== to) || d < from) return onChange(d, d);
    if (d === from) return onChange(d, d);
    onChange(from, d);
  };

  const brand = useBrand();
  const inRange = (d: string) => Boolean(from && to && d >= from && d <= to);
  const nights = from && to ? Math.round((parseDay(to).getTime() - parseDay(from).getTime()) / 86_400_000) + 1 : 0;

  return (
    <View style={{ gap: 8 }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingVertical: 2 }}>
        {list.map((d) => {
          const [wd, day, month] = fmtDayShort(d).split(" ");
          const edge = d === from || d === to;
          return (
            <Pressable
              key={d}
              onPress={() => tap(d)}
              accessibilityRole="button"
              accessibilityLabel={fmtDayShort(d)}
              accessibilityState={{ selected: edge || inRange(d) }}
              style={[
                styles.day,
                inRange(d) && { backgroundColor: brand.primarySoft, borderColor: brand.primarySoft },
                edge && { backgroundColor: brand.primary, borderColor: brand.primary }
              ]}
            >
              <Text style={[styles.dayWd, edge && styles.dayTextOn]}>{wd}</Text>
              <Text style={[styles.dayNum, edge && styles.dayTextOn]}>{day}</Text>
              <Text style={[styles.dayWd, edge && styles.dayTextOn]}>{month}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
      <Text style={styles.dateHint} accessibilityLiveRegion="polite">
        {!from
          ? "Toque el día de la visita"
          : from === to
            ? `${fmtDayShort(from)}${range ? " · toque otro día para un rango" : ""}`
            : `Del ${fmtDayShort(from)} al ${fmtDayShort(to!)} (${nights} días)`}
      </Text>
    </View>
  );
}

export function Section({ title, count, children }: Readonly<{ title: string; count?: number; children: ReactNode }>) {
  return (
    <View style={{ gap: 8 }}>
      <Text style={styles.section} accessibilityRole="header">
        {title}
        {count !== undefined ? ` (${count})` : ""}
      </Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { backgroundColor: colors.primary, flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingBottom: 12 },
  headerSide: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  headerTitle: { flex: 1, textAlign: "center", color: colors.onPrimary, fontSize: 21, fontWeight: "600" },
  photo: { backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  photoText: { fontWeight: "700" },
  chip: { minHeight: 40, justifyContent: "center", paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background },
  chipText: { fontSize: 14, color: colors.text, fontWeight: "600" },
  chipTextActive: { color: colors.onPrimary },
  fab: {
    position: "absolute",
    right: 20,
    width: 62,
    height: 62,
    borderRadius: 31,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    elevation: 6,
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 }
  },
  switchRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 6 },
  switchText: { flex: 1, fontSize: 15, color: colors.text },
  empty: { alignItems: "center", paddingVertical: 40, paddingHorizontal: 32, gap: 14 },
  emptyAction: { minHeight: 44, justifyContent: "center", paddingHorizontal: 22, borderRadius: radius.pill, borderWidth: 1.5 },
  emptyActionText: { fontSize: 15, fontWeight: "700" },
  emptyTitle: { fontSize: 17, fontWeight: "700", color: colors.text, textAlign: "center" },
  emptyText: { fontSize: 14, color: colors.textMuted, textAlign: "center", lineHeight: 20 },
  day: { width: 56, paddingVertical: 8, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, alignItems: "center" },
  dayWd: { fontSize: 11, color: colors.textMuted, textTransform: "capitalize" },
  dayNum: { fontSize: 18, fontWeight: "700", color: colors.text },
  dayTextOn: { color: colors.onPrimary },
  dateHint: { fontSize: 13, color: colors.textMuted },
  section: { fontSize: 13, fontWeight: "700", color: colors.textMuted, textTransform: "uppercase", marginTop: 8 }
});
