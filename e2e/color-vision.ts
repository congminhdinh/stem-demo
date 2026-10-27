// N19 E8: what a learner with a red-green colour-vision deficiency sees of a screenshot, and whether the marks of the palette's colours
// (red striped across, green a grid, blue large dots: body-marks.ts) still tell three objects apart when their hues no longer do. Used by
// e2e/robot-lab-gripper-look.spec.ts (on the 2D map of lesson 10) and by the gallery's shot script (spikes/n19-e8/gallery.mjs, through
// Node's type stripping: no imports here). Plain numbers on RGBA or RGB pixel arrays; tested in tests/color-vision.test.ts.
//
// The simulation is Machado, Oliveira and Fernandes (2009), "A physiologically-based model for simulation of color vision deficiency",
// IEEE TVCG 15(6), the matrices of severity 1.0 (dichromacy) for protanopia and deuteranopia, applied to linear RGB: each sRGB channel
// decoded (IEC 61966-2-1), the 3 × 3 matrix applied, the result clamped to 0..1 and encoded again.

export type ColorVision = 'protanopia' | 'deuteranopia';

/** Machado et al. 2009, severity 1.0, rows R', G', B' of linear RGB. */
export const MACHADO_2009: Readonly<Record<ColorVision, readonly (readonly [number, number, number])[]>> = Object.freeze({
  protanopia: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deuteranopia: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
});

const toLinear = (channel: number) => {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const toByte = (linear: number) => {
  const c = Math.min(1, Math.max(0, linear));
  return Math.round((c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055) * 255);
};
/** sRGB byte → linear, for all 256 values. */
const LINEAR = Array.from({ length: 256 }, (_, i) => toLinear(i));

/** One sRGB colour (bytes) as `vision` sees it (bytes). */
export function simulateColor(rgb: readonly [number, number, number], vision: ColorVision): [number, number, number] {
  const m = MACHADO_2009[vision];
  const [r, g, b] = [LINEAR[rgb[0]]!, LINEAR[rgb[1]]!, LINEAR[rgb[2]]!];
  return [toByte(m[0]![0] * r + m[0]![1] * g + m[0]![2] * b), toByte(m[1]![0] * r + m[1]![1] * g + m[1]![2] * b), toByte(m[2]![0] * r + m[2]![1] * g + m[2]![2] * b)];
}

/** A picture's pixels: `channels` bytes a pixel (3 RGB or 4 RGBA), rows top to bottom. */
export type Pixels = { width: number; height: number; channels: number; data: Uint8Array | Uint8ClampedArray };

/** A copy of `image` as `vision` sees it (alpha, if any, kept). */
export function simulateImage(image: Pixels, vision: ColorVision): Pixels {
  const out = new Uint8Array(image.data.length);
  const cache = new Map<number, [number, number, number]>();
  for (let at = 0; at < image.data.length; at += image.channels) {
    const key = (image.data[at]! << 16) | (image.data[at + 1]! << 8) | image.data[at + 2]!;
    let seen = cache.get(key);
    if (seen === undefined) {
      seen = simulateColor([image.data[at]!, image.data[at + 1]!, image.data[at + 2]!], vision);
      cache.set(key, seen);
    }
    [out[at], out[at + 1], out[at + 2]] = seen;
    for (let c = 3; c < image.channels; c++) out[at + c] = image.data[at + c]!;
  }
  return { width: image.width, height: image.height, channels: image.channels, data: out };
}

/** The relative luminance (WCAG) of the pixel at (x, y), sampled bilinearly. */
function luminanceAt(image: Pixels, x: number, y: number): number {
  const x0 = Math.max(0, Math.min(image.width - 2, Math.floor(x)));
  const y0 = Math.max(0, Math.min(image.height - 2, Math.floor(y)));
  const [fx, fy] = [Math.min(1, Math.max(0, x - x0)), Math.min(1, Math.max(0, y - y0))];
  const lum = (px: number, py: number) => {
    const at = (py * image.width + px) * image.channels;
    return 0.2126 * LINEAR[image.data[at]!]! + 0.7152 * LINEAR[image.data[at + 1]!]! + 0.0722 * LINEAR[image.data[at + 2]!]!;
  };
  const top = lum(x0, y0) * (1 - fx) + lum(x0 + 1, y0) * fx;
  const bottom = lum(x0, y0 + 1) * (1 - fx) + lum(x0 + 1, y0 + 1) * fx;
  return top * (1 - fy) + bottom * fy;
}

/** Otsu's threshold of `values` (the one that best splits them in two classes), over 64 bins between their least and greatest. */
function otsu(values: readonly number[]): number {
  const [low, high] = [Math.min(...values), Math.max(...values)];
  if (high - low < 1e-9) return high;
  const bins = new Array<number>(64).fill(0);
  for (const value of values) bins[Math.min(63, Math.floor(((value - low) / (high - low)) * 64))]! += 1;
  const total = values.length;
  const sum = bins.reduce((acc, count, i) => acc + count * i, 0);
  let [best, bestAt, weight, partial] = [-1, 0, 0, 0];
  for (let i = 0; i < 64; i++) {
    weight += bins[i]!;
    if (weight === 0 || weight === total) continue;
    partial += bins[i]! * i;
    const [meanLow, meanHigh] = [partial / weight, (sum - partial) / (total - weight)];
    const between = weight * (total - weight) * (meanLow - meanHigh) ** 2;
    if (between > best) [best, bestAt] = [between, i];
  }
  return low + ((bestAt + 1) / 64) * (high - low);
}

/** A mark's mask: `size` × `size` cells, 1 where the mark's ink is; and the share of them that are. */
export type MarkMask = { size: number; cells: Uint8Array; inkShare: number; contrast: number };

/**
 * The mask of the mark inside a square of a picture: `size` × `size` samples at the points `at(i, j)` gives (pixels, i across, j down,
 * both 0..size−1), each the luminance there, split in two by Otsu's threshold; the ink is the smaller class (a mark is thin lines or dots
 * on its fill). `contrast` is the ratio of the two classes' mean luminances (WCAG's, +0.05 each): a mark that is not there at all has one
 * near 1 and a mask of noise.
 */
export function markMask(image: Pixels, size: number, at: (i: number, j: number) => readonly [number, number]): MarkMask {
  const values: number[] = [];
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) values.push(luminanceAt(image, ...at(i, j)));
  const threshold = otsu(values);
  const above = values.filter((value) => value > threshold);
  const below = values.filter((value) => value <= threshold);
  const inkAbove = above.length <= below.length;
  const cells = Uint8Array.from(values, (value) => ((value > threshold) === inkAbove ? 1 : 0));
  const mean = (list: number[]) => (list.length === 0 ? 0 : list.reduce((a, b) => a + b, 0) / list.length);
  // A face of one colour has one class: no ink, and a contrast of 1.
  if (above.length === 0 || below.length === 0) return { size, cells: new Uint8Array(size * size), inkShare: 0, contrast: 1 };
  const [light, dark] = [mean(above), mean(below)];
  return { size, cells, inkShare: cells.reduce((a, b) => a + b, 0) / cells.length, contrast: (light + 0.05) / (dark + 0.05) };
}

/**
 * How well `mask` matches a mark's own picture `template` (1 where the mark's ink is, at the same cells): the share of cells that agree,
 * or that disagree when that is more (the threshold may have taken the fill for the ink: a mark whose lines are as wide as its gaps reads
 * either way). 1 for the mark itself; about a half for a mask unrelated to it.
 */
export function maskAgreement(mask: MarkMask, template: Uint8Array): number {
  if (template.length !== mask.cells.length) throw new RangeError(`A template of ${template.length} cells for a mask of ${mask.cells.length}`);
  let same = 0;
  for (let k = 0; k < template.length; k++) if (template[k] === mask.cells[k]) same += 1;
  return Math.max(same, template.length - same) / template.length;
}
