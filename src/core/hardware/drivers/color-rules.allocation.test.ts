import { GCProfiler, getHeapStatistics } from 'node:v8';
import { describe, expect, it } from 'vitest';
import { fullGc } from '../../program/__fixtures__/allocation';
import type { Rgbc } from '../devices/tcs34725';
import { classifyColor, COLOR_RULES, COLOR_UNKNOWN } from './color-rules';

// N19 E5: the 3D view's colour overlay classifies the sensor's counts in its frame callback (when they change: a new window, about every
// 53 ms), so classifyColor makes no object (N18 P2: no garbage per frame). It was written with an object for the shares and a `for…of`
// that destructured each rule, about 1.5 KB a call (measured). Its answers are the same: the reference below is that code, as it was
// (A3, plan §4.3), and the two are held together over every boundary of COLOR_RULES and 20 000 readings of a seeded walk.

/** classifyColor as A3 wrote it: the reference. */
function reference(reading: Rgbc): number {
  const floorDiv = (a: number, b: number) => {
    let q = Math.floor(a / b);
    while (q * b > a) q -= 1;
    while ((q + 1) * b <= a) q += 1;
    return q;
  };
  const sum = reading.r + reading.g + reading.b;
  const share = sum === 0 ? { r: 0, g: 0, b: 0 } : { r: floorDiv(reading.r * 1000, sum), g: floorDiv(reading.g * 1000, sum), b: floorDiv(reading.b * 1000, sum) };
  const inside = (value: number, min: number, max: number) => value >= min && value <= max;
  for (const [colour, cMin, cMax, rMin, rMax, gMin, gMax, bMin, bMax] of COLOR_RULES) {
    if (inside(reading.c, cMin, cMax) && inside(share.r, rMin, rMax) && inside(share.g, gMin, gMax) && inside(share.b, bMin, bMax)) return colour;
  }
  return COLOR_UNKNOWN;
}

describe('classifyColor makes no garbage and answers as before (N19 E5)', () => {
  it('gives the reference’s answer at every boundary of the rules and over a seeded walk of 20 000 readings', () => {
    const cs = [0, 1, 299, 300, 301, 3999, 4000, 4001, 11_999, 12_000, 12_001, 30_000, 65_535];
    const shares = [0, 1, 229, 230, 231, 299, 300, 301, 329, 330, 331, 379, 380, 381, 419, 420, 421, 499, 500, 501, 700, 999, 1000];
    let checked = 0;
    for (const c of cs) {
      for (const r of shares) {
        for (const g of shares) {
          if (r + g > 1000) continue;
          // r g b as counts with these shares of 10 000 (and the rest blue), and the same scaled by 7 (a share one count off its boundary).
          for (const scale of [10, 70]) {
            const reading = { c, r: r * scale, g: g * scale, b: (1000 - r - g) * scale };
            expect(classifyColor(reading), JSON.stringify(reading)).toBe(reference(reading));
            checked += 1;
          }
        }
      }
    }
    let seed = 12_345;
    const next = (max: number) => {
      seed = (Math.imul(seed, 1_103_515_245) + 12_345) >>> 0;
      return seed % (max + 1);
    };
    for (let i = 0; i < 20_000; i++) {
      const reading = { c: next(65_535), r: next(65_535), g: next(65_535 >> (i % 4)), b: next(65_535 >> (i % 3)) };
      expect(classifyColor(reading)).toBe(reference(reading));
    }
    expect(checked).toBeGreaterThan(5000);
    expect(classifyColor({ c: 0, r: 0, g: 0, b: 0 })).toBe(COLOR_UNKNOWN);
  });

  const gc = fullGc();
  it.skipIf(!gc)('allocates nothing a call (at most 8 bytes, over 20 000 calls of changing readings)', () => {
    const readings: Rgbc[] = Array.from({ length: 97 }, (_, i) => ({ c: 300 + i * 600, r: 1000 + ((i * 37) % 13) * 900, g: 800 + ((i * 53) % 11) * 700, b: 600 + ((i * 71) % 7) * 1100 }));
    let sink = 0;
    for (let i = 0; i < 2000; i++) sink += classifyColor(readings[i % readings.length]!);
    gc!();
    const profiler = new GCProfiler();
    const before = getHeapStatistics().used_heap_size;
    profiler.start();
    for (let i = 0; i < 20_000; i++) sink += classifyColor(readings[i % readings.length]!);
    const { statistics } = profiler.stop();
    const after = getHeapStatistics().used_heap_size;
    const bytes = (after - before + statistics.reduce((freed, collection) => freed + collection.beforeGC.heapStatistics.usedHeapSize - collection.afterGC.heapStatistics.usedHeapSize, 0)) / 20_000;
    expect(sink).toBeGreaterThan(0);
    expect(bytes).toBeLessThanOrEqual(8);
  });
});
