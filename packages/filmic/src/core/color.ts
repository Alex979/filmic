/** A color as "#rrggbb" (or "#rgb"). */
export type Hex = string;

/** "#rrggbb" -> [r, g, b] in 0..1, still sRGB-encoded. */
export function hexToRgb(hex: Hex): [number, number, number] {
  let h = hex.replace("#", "");
  if (h.length === 3) h = [...h].map((c) => c + c).join("");
  const n = parseInt(h, 16);
  return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/**
 * sRGB-encoded 0..1 -> linear light. Colors are blended in linear light: mixing
 * two sRGB values directly gives muddy, too-dark midpoints.
 */
export const srgbToLinear = (c: number) =>
  c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;

export function hexToLinear(hex: Hex): [number, number, number] {
  const [r, g, b] = hexToRgb(hex);
  return [srgbToLinear(r), srgbToLinear(g), srgbToLinear(b)];
}
