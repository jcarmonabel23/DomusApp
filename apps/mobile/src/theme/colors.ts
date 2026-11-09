/**
 * @project DomusApp - Mobile
 * @file src/theme/colors.ts
 * @description Paleta de la app (misma familia azul del panel administrativo)
 */

export const colors = {
  primary: "#1572d3",
  primaryDark: "#0b5fb3",
  primaryBright: "#1e88e5",
  primarySoft: "#e7f2fd",
  primaryTint: "#6ba7ec",

  background: "#ffffff",
  surface: "#f2f3f5",
  border: "#e1e4e8",
  text: "#1f2328",
  textMuted: "#6b7280",
  onPrimary: "#ffffff",

  success: "#2ecc87",
  warning: "#f5a623",
  danger: "#e5484d",
  dangerSoft: "#fde2e4",
  info: "#7aa7c7",

  // Tarjetas del tablero (como en las capturas de referencia)
  cardYellow: "#f1c453",
  cardNavy: "#2f3a68",
  cardLavender: "#dcdfeb",
  cardSalmon: "#f6a98d"
} as const;

export const radius = { sm: 8, md: 14, lg: 20, pill: 999 } as const;
export const spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 } as const;
