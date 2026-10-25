// WCAG 2.2 contrast arithmetic (N18 R8): the relative luminance of a colour and the contrast ratio of two (success criteria 1.4.3 text,
// 1.4.11 non-text), for the robot lab's colour audit (robot-contrast.test.ts) and the colours it derives at run time (zone-pattern.ts).
// A colour is [r, g, b, a], r g b in 0..255 and a in 0..1. Formulas: https://www.w3.org/TR/WCAG22/#dfn-relative-luminance and
// #dfn-contrast-ratio.

export type Rgba = readonly [r: number, g: number, b: number, a: number];

const NUMBER = String.raw`(\d+(?:\.\d+)?)`;
const functional = new RegExp(String.raw`^rgba?\(\s*${NUMBER}\s*[,\s]\s*${NUMBER}\s*[,\s]\s*${NUMBER}\s*(?:[,/]\s*${NUMBER}\s*)?\)$`);

/** Reads `#rgb`, `#rrggbb`, `#rrggbbaa`, `rgb(r, g, b)`, `rgba(r, g, b, a)` and the space form `rgb(r g b / a)`. Anything else throws. */
export function parseColor(value: string): Rgba {
  const text = value.trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(text);
  if (hex) {
    const digits = hex[1]!.length === 3 ? [...hex[1]!].map((digit) => digit + digit).join('') : hex[1]!;
    const channel = (at: number) => Number.parseInt(digits.slice(at, at + 2), 16);
    return [channel(0), channel(2), channel(4), digits.length === 8 ? channel(6) / 255 : 1];
  }
  const rgb = functional.exec(text);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3]), rgb[4] === undefined ? 1 : Number(rgb[4])];
  throw new RangeError(`Cannot read the colour "${value}": use #rgb, #rrggbb, #rrggbbaa, rgb() or rgba().`);
}

/** `top` laid over `under` (which must be opaque) by alpha. */
export function composite(top: Rgba, under: Rgba): Rgba {
  if (under[3] !== 1) throw new RangeError('A colour can only be composited over an opaque one.');
  const [r, g, b, a] = top;
  return [r * a + under[0] * (1 - a), g * a + under[1] * (1 - a), b * a + under[2] * (1 - a), 1];
}

const linear = (channel: number) => {
  const value = channel / 255;
  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
};

/** WCAG's relative luminance, 0 (black) to 1 (white), of the colour's r g b (its alpha is not looked at). */
export function relativeLuminance([r, g, b]: Rgba): number {
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

const asColor = (value: string | Rgba): Rgba => (typeof value === 'string' ? parseColor(value) : value);

/**
 * The contrast ratio of two opaque colours, 1 to 21, the same either way round. A translucent colour has no ratio of its own (it takes the
 * colour of what is under it): composite it over the worst thing that can be under it first.
 */
export function contrastRatio(a: string | Rgba, b: string | Rgba): number {
  const [first, second] = [asColor(a), asColor(b)];
  if (first[3] !== 1 || second[3] !== 1) throw new RangeError('The contrast of a translucent colour depends on what is under it: composite it first.');
  const [light, dark] = [relativeLuminance(first), relativeLuminance(second)].sort((x, y) => y - x);
  return (light! + 0.05) / (dark! + 0.05);
}
