import { describe, expect, it } from 'vitest';
import { contrastRatio } from '../src/ui/a11y/contrast';
import { markMask, maskAgreement, simulateColor, simulateImage, type Pixels } from '../e2e/color-vision';

// N19 E8: the colour-vision simulation and the mark masks the gallery's colour-blind check uses (e2e/color-vision.ts).

const hex = (rgb: readonly number[]) => `#${rgb.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
const rgbOf = (colour: string): [number, number, number] => [1, 3, 5].map((at) => Number.parseInt(colour.slice(at, at + 2), 16)) as [number, number, number];

/** A 48 × 48 RGB picture of `fill` with the ink where `ink(x, y)` says. */
function picture(fill: string, inkColour: string, ink: (x: number, y: number) => boolean): Pixels {
  const [f, k] = [rgbOf(fill), rgbOf(inkColour)];
  const data = new Uint8Array(48 * 48 * 3);
  for (let y = 0; y < 48; y++) for (let x = 0; x < 48; x++) data.set(ink(x, y) ? k : f, (y * 48 + x) * 3);
  return { width: 48, height: 48, channels: 3, data };
}
const stripes = (...[, y]: [number, number]) => y % 12 < 3;
const grid = (x: number, y: number) => y % 14 < 3 || x % 14 < 3;
const dots = (x: number, y: number) => {
  const row = Math.round(y / 13);
  const shift = row % 2 === 0 ? 0 : 6.5;
  const column = Math.round((x - shift) / 13);
  return Math.hypot(x - (column * 13 + shift), y - row * 13) < 3.6;
};
const sampleAll = (image: Pixels) => markMask(image, 24, (i, j) => [i * 2 + 0.5, j * 2 + 0.5]);

describe('Machado et al. 2009, severity 1.0, on linear RGB', () => {
  it('turns the primaries as the matrices say and keeps white and black', () => {
    expect(simulateColor([255, 0, 0], 'deuteranopia')).toEqual([163, 144, 0]);
    expect(simulateColor([0, 255, 0], 'deuteranopia')).toEqual([239, 214, 58]);
    expect(simulateColor([0, 0, 255], 'deuteranopia')).toEqual([0, 61, 251]);
    expect(simulateColor([255, 0, 0], 'protanopia')).toEqual([109, 95, 0]);
    expect(simulateColor([0, 255, 0], 'protanopia')).toEqual([255, 229, 0]);
    expect(simulateColor([0, 0, 255], 'protanopia')).toEqual([0, 89, 255]);
    for (const vision of ['protanopia', 'deuteranopia'] as const) {
      expect(simulateColor([255, 255, 255], vision)).toEqual([255, 255, 255]);
      expect(simulateColor([0, 0, 0], vision)).toEqual([0, 0, 0]);
    }
  });

  it('makes the palette red and green all but one colour for a deuteranope: hue alone does not tell the cubes apart', () => {
    const [red, green] = [simulateColor(rgbOf('#d32f2f'), 'deuteranopia'), simulateColor(rgbOf('#388e3c'), 'deuteranopia')];
    expect(red).toEqual([139, 124, 40]);
    expect(green).toEqual([134, 122, 66]);
    expect(contrastRatio(hex(red), hex(green))).toBeLessThan(1.05);
    expect(contrastRatio('#d32f2f', '#388e3c')).toBeGreaterThan(1);
  });

  it('simulates a picture pixel by pixel, keeping its alpha', () => {
    const image: Pixels = { width: 2, height: 1, channels: 4, data: Uint8Array.from([255, 0, 0, 200, 0, 0, 255, 255]) };
    expect([...simulateImage(image, 'deuteranopia').data]).toEqual([163, 144, 0, 200, 0, 61, 251, 255]);
  });
});

describe('mark masks', () => {
  it('finds the ink of a mark whatever its colours, lighter or darker than its fill', () => {
    const dark = sampleAll(picture('#d32f2f', '#5c1414', stripes));
    const light = sampleAll(picture('#1976d2', '#b8d6f5', stripes));
    expect([...dark.cells]).toEqual([...light.cells]);
    // Rows 0.5 and 2.5 of every 12 (2.5 is half ink, half fill, which the threshold gives the ink): a third.
    expect(dark.inkShare).toBeCloseTo(1 / 3, 9);
    expect(dark.contrast).toBeGreaterThan(1.5);
    // A face with no mark: its two classes are one colour.
    expect(sampleAll(picture('#d32f2f', '#5c1414', () => false)).contrast).toBe(1);
  });

  it('matches a mark’s own picture, whichever class the threshold took for the ink, and not another mark’s', () => {
    const cellsOf = (ink: (x: number, y: number) => boolean) => Uint8Array.from({ length: 24 * 24 }, (_, k) => (ink((k % 24) * 2 + 0.5, Math.floor(k / 24) * 2 + 0.5) ? 1 : 0));
    const [a, b, c] = [sampleAll(picture('#d32f2f', '#5c1414', stripes)), sampleAll(picture('#388e3c', '#143d18', grid)), sampleAll(picture('#1976d2', '#0b3561', dots))];
    expect(maskAgreement(a, cellsOf(stripes))).toBeGreaterThan(0.95);
    expect(maskAgreement(b, cellsOf(grid))).toBeGreaterThan(0.95);
    expect(maskAgreement(c, cellsOf(dots))).toBeGreaterThan(0.95);
    // Inverted (the gaps taken for the ink): the same agreement.
    expect(maskAgreement(a, cellsOf((x, y) => !stripes(x, y)))).toBe(maskAgreement(a, cellsOf(stripes)));
    for (const [mask, others] of [[a, [grid, dots]], [b, [stripes, dots]], [c, [stripes, grid]]] as const) {
      for (const other of others) expect(maskAgreement(mask, cellsOf(other))).toBeLessThan(0.8);
    }
  });
});
