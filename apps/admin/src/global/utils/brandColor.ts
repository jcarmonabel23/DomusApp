/**
 * @project DomusApp - Admin
 * @file src/global/utils/brandColor.ts
 * @description Mismo cálculo que la app móvil (apps/mobile/src/theme/brand.ts): si el texto blanco no se lee
 *              sobre el color de marca (contraste WCAG AA < 4.5), la app lo oscurece lo justo. Aquí se usa
 *              para avisar al administrador y mostrar el color que verán los residentes.
 */

type Rgb = [number, number, number];

function parseHex(hex: string | null | undefined): Rgb | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex?.trim() ?? "");
  if (!m) return null;
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join("") : m[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as Rgb;
}

const toHex = (c: Rgb) => `#${c.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("")}`;
const mix = (c: Rgb, o: Rgb, t: number): Rgb => c.map((v, i) => v + (o[i] - v) * t) as Rgb;

function luminance([r, g, b]: Rgb): number {
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

const contrastWithWhite = (c: Rgb) => 1.05 / (luminance(c) + 0.05);

export interface BrandCheck {
  /** Contraste del texto blanco sobre el color elegido */
  contrast: number;
  /** Color que usará la app (igual al elegido si ya cumple) */
  applied: string;
  adjusted: boolean;
}

export function checkBrandColor(hex: string | null | undefined): BrandCheck | null {
  const rgb = parseHex(hex);
  if (!rgb) return null;
  let out = rgb;
  for (let i = 0; i < 40 && contrastWithWhite(out) < 4.5; i++) out = mix(out, [0, 0, 0], 0.05);
  return { contrast: contrastWithWhite(rgb), applied: toHex(out), adjusted: out !== rgb };
}
