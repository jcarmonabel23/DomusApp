/**
 * @project DomusApp - Admin
 * @file src/global/assets/theme/colors.ts
 * @description Paleta y configuración base del tema Mantine
 *
 * @overview
 * Misma base que FabriHub (Montserrat, defaultRadius md) con la paleta azul de DomusApp,
 * el mismo azul de la app móvil. Los tonos se exponen a Tailwind como `brand-*` en index.css.
 */

export const themeColors = {
  domus: [
    "#e7f2fd",
    "#cfe3fa",
    "#9fc6f3",
    "#6ba7ec",
    "#418de6",
    "#287ee3",
    "#1876e2",
    "#1572d3",
    "#0b5fb3",
    "#004f99"
  ] as const
};

export const themeBase = {
  fontFamily: "Montserrat, sans-serif",
  colors: themeColors,
  primaryColor: "domus" as const,
  primaryShade: 7 as const,
  defaultRadius: "md" as const
};
