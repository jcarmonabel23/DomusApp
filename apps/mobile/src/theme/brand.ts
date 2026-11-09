/**
 * @project DomusApp - Mobile
 * @file src/theme/brand.ts
 * @description Identidad del condominio activo: deriva la paleta de la app del color de marca que el
 *              administrador eligió en el panel (Configuración / Condominios).
 *
 * - Accesibilidad: el texto blanco sobre el color principal debe cumplir WCAG AA (4.5:1). Si el color
 *   elegido es muy claro (amarillo, celeste…), se oscurece lo justo hasta cumplir, sin cambiar el tono.
 * - Sin color o con un valor inválido, se usa el azul de DomusApp.
 * - Las pantallas sin sesión (login, OTP) siempre usan el azul de DomusApp.
 */

import { useSession } from "@/lib/session";
import { colors } from "./colors";

export interface Brand {
  /** Fondo de encabezados, botones, FAB y elementos activos (texto blanco encima, contraste ≥ 4.5) */
  primary: string;
  /** Presionado / énfasis */
  primaryDark: string;
  /** Fondo suave (píldora de la pestaña activa, chips, iniciales) */
  primarySoft: string;
  /** Íconos de pestañas inactivas y bordes de acento */
  primaryTint: string;
  onPrimary: string;
}

type Rgb = [number, number, number];

function parseHex(hex: string | null | undefined): Rgb | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex?.trim() ?? "");
  if (!m) return null;
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join("") : m[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as Rgb;
}

const toHex = (c: Rgb) => `#${c.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("")}`;

/** Mezcla con otro color: t = 0 → c, t = 1 → other */
const mix = (c: Rgb, other: Rgb, t: number): Rgb => c.map((v, i) => v + (other[i] - v) * t) as Rgb;

const WHITE: Rgb = [255, 255, 255];
const BLACK: Rgb = [0, 0, 0];

function luminance([r, g, b]: Rgb): number {
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** Contraste WCAG entre dos colores (1 a 21) */
export function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Oscurece en pasos pequeños hasta que el texto blanco cumpla AA */
function readableOnWhiteText(c: Rgb): Rgb {
  let out = c;
  for (let i = 0; i < 40 && contrast(out, WHITE) < 4.5; i++) out = mix(out, BLACK, 0.05);
  return out;
}

const DEFAULT: Brand = {
  primary: colors.primary,
  primaryDark: colors.primaryDark,
  primarySoft: colors.primarySoft,
  primaryTint: colors.primaryTint,
  onPrimary: colors.onPrimary
};

const cache = new Map<string, Brand>();

export function brandFrom(hex: string | null | undefined): Brand {
  const rgb = parseHex(hex);
  if (!rgb) return DEFAULT;
  const key = toHex(rgb);
  const hit = cache.get(key);
  if (hit) return hit;
  const primary = readableOnWhiteText(rgb);
  const brand: Brand = {
    primary: toHex(primary),
    primaryDark: toHex(mix(primary, BLACK, 0.18)),
    primarySoft: toHex(mix(primary, WHITE, 0.88)),
    primaryTint: toHex(mix(primary, WHITE, 0.4)),
    onPrimary: colors.onPrimary
  };
  cache.set(key, brand);
  return brand;
}

/** Paleta del condominio activo; cambia sola al cambiar de condominio */
export function useBrand(): Brand {
  const hex = useSession((s) => s.session?.condominium?.brandColor ?? null);
  return brandFrom(hex);
}
