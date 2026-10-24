import { describe, expect, it } from 'vitest';
import { parseArena } from './arena-schema';
import lineLoop from './fixtures/line-loop.json';
import { colorReflectance, createGroundPaint, LINE_SAMPLE_COUNT } from './ground-paint';

/** White 100 × 100 cm ground with a 2 cm line along y = 50 from x = 10 to x = 90. */
const straightLine = createGroundPaint(
  parseArena({ ground: { sizeCm: [100, 100], color: '#ffffff' }, paint: { lines: [{ pointsCm: [[10, 50], [90, 50]], widthCm: 2 }] } }),
);

describe('groundReflectanceAt', () => {
  it('reflectance 0 on centre of 2 cm line, 1 on blank, ~0.5 at edge', () => {
    expect(straightLine.groundReflectanceAt(50, 50, 0.5)).toBe(0);
    expect(straightLine.groundReflectanceAt(50, 20, 0.5)).toBe(1);
    expect(straightLine.groundReflectanceAt(50, 51, 0.5)).toBeCloseTo(0.5, 2);
    expect(straightLine.groundReflectanceAt(50, 49, 0.5)).toBeCloseTo(0.5, 2);
  });

  it('samples one point when the radius is 0', () => {
    expect(straightLine.groundReflectanceAt(50, 51, 0)).toBe(0);
    expect(straightLine.groundReflectanceAt(50, 51.001, 0)).toBe(1);
    expect(straightLine.groundReflectanceAt(91, 50, 0)).toBe(0); // round end: 1 cm past the last point
    expect(straightLine.groundReflectanceAt(91.01, 50, 0)).toBe(1);
  });

  it('averages over the sensor spot: half of a diagonal edge, and a narrow line under a wide spot', () => {
    const diagonal = createGroundPaint(
      parseArena({ ground: { sizeCm: [100, 100], color: '#ffffff' }, paint: { lines: [{ pointsCm: [[10, 10], [90, 90]], widthCm: 2 }] } }),
    );
    const edge = Math.SQRT1_2; // 1 cm from the centre line, across the diagonal
    expect(diagonal.groundReflectanceAt(50 + edge, 50 - edge, 0.5)).toBeCloseTo(0.5, 2);
    // A 3 cm spot centred on the 2 cm line covers 41.6 % line by area: reflectance 0.584.
    expect(Math.abs(straightLine.groundReflectanceAt(50, 50, 3) - 0.584)).toBeLessThan(0.02);
  });

  it('reads a zone as its colour, under the lines, and the later of two zones on top', () => {
    const paint = createGroundPaint(
      parseArena({
        ground: { sizeCm: [100, 100], color: '#ffffff' },
        paint: {
          lines: [{ pointsCm: [[0, 50], [100, 50]], widthCm: 2 }],
          zones: [
            { id: 'grey', kind: 'area', polygonCm: [[20, 20], [80, 20], [80, 80], [20, 80]], color: '#808080' },
            { id: 'mat', kind: 'target', polygonCm: [[60, 60], [90, 60], [90, 90], [60, 90]], color: '#000000', reflectance: 0.25 },
          ],
        },
      }),
    );
    expect(paint.groundReflectanceAt(30, 30, 0.5)).toBe(128 / 255);
    expect(paint.groundReflectanceAt(70, 70, 0.5)).toBe(0.25);
    expect(paint.groundReflectanceAt(85, 85, 0.5)).toBe(0.25);
    expect(paint.groundReflectanceAt(30, 50, 0.5)).toBe(0);
  });

  it('follows a closed loop, corners included', () => {
    const loop = createGroundPaint(parseArena(lineLoop));
    expect(loop.groundReflectanceAt(25, 25, 0.5)).toBe(0);
    expect(loop.groundReflectanceAt(125, 50, 0.5)).toBe(0);
    expect(loop.groundReflectanceAt(75, 50, 0.5)).toBe(1);
    expect(loop.groundReflectanceAt(130, 80, 0.5)).toBe(colorReflectance('#ffd966'));
  });

  it('sees nothing (0) off the ground, and half of it across the border', () => {
    expect(straightLine.groundReflectanceAt(-5, 20, 0.5)).toBe(0);
    expect(straightLine.groundReflectanceAt(50, 120, 0)).toBe(0);
    expect(straightLine.groundReflectanceAt(0, 20, 0.5)).toBeCloseTo(0.5, 2);
  });

  it('uses the ground’s own reflectance over its colour', () => {
    const shaded = createGroundPaint(parseArena({ ground: { sizeCm: [100, 100], color: '#ffffff', reflectance: 0.8 } }));
    expect(shaded.groundReflectanceAt(50, 50, 1)).toBe(0.8);
  });

  it('refuses a negative or missing radius', () => {
    expect(() => straightLine.groundReflectanceAt(50, 50, -1)).toThrow(RangeError);
    expect(() => straightLine.groundReflectanceAt(50, 50, Number.NaN)).toThrow(RangeError);
  });

  it('samples a fixed, symmetric pattern', () => {
    expect(LINE_SAMPLE_COUNT).toBe(208);
  });
});

describe('colorReflectance', () => {
  it('is the Rec. 709 luma of the sRGB colour, exact at black and white', () => {
    expect(colorReflectance('#ffffff')).toBe(1);
    expect(colorReflectance('#000000')).toBe(0);
    expect(colorReflectance('#808080')).toBe(128 / 255);
    expect(colorReflectance('#ff0000')).toBe(0.2126);
    expect(colorReflectance('#00FF00')).toBe(0.7152);
  });
});
