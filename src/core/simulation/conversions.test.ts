import { describe, expect, it } from 'vitest';
import * as conversions from './conversions';
import { ANALOG_NATIVE_MAX, percentToNative, percentToRaw, rawToPercent } from './conversions';

// The conversion table of plan §11.3 (C-Q6 = Option A: the native analog scale is 0..4095).

describe('percentToRaw = percentToNative(p, 4095) = floor(clamp(p, 0, 100) x 4095 / 100 + 0.5)', () => {
  it('is 4095 at the top', () => {
    expect(ANALOG_NATIVE_MAX).toBe(4095);
  });

  it.each([
    [0, 0],
    [1, 41],
    [10, 410],
    [25, 1024],
    [33, 1351],
    [50, 2048],
    [75, 3071],
    [99, 4054],
    [100, 4095],
  ])('%s %% reads %s', (percent, raw) => {
    expect(percentToRaw(percent)).toBe(raw);
  });

  it('clamps outside 0..100', () => {
    expect(percentToRaw(-1)).toBe(0);
    expect(percentToRaw(-1000)).toBe(0);
    expect(percentToRaw(101)).toBe(4095);
    expect(percentToRaw(1e9)).toBe(4095);
    expect(percentToRaw(Infinity)).toBe(4095);
  });

  it('rounds half up: half a step goes up', () => {
    expect(percentToNative(50, 1)).toBe(1);
    expect(percentToNative(49, 1)).toBe(0);
    expect(percentToNative(0.5, 200)).toBe(1);
  });

  it('is monotonic over the whole scale and never leaves 0..4095', () => {
    let previous = -1;
    for (let percent = 0; percent <= 100; percent += 1) {
      const raw = percentToRaw(percent);
      expect(raw).toBeGreaterThanOrEqual(previous);
      expect(raw).toBeLessThanOrEqual(4095);
      previous = raw;
    }
  });

  it('refuses what is not a number, rather than guessing', () => {
    expect(() => percentToRaw(NaN)).toThrow(RangeError);
  });
});

describe('percentToNative(p, N): N comes from the contract', () => {
  it.each([
    [0, 100, 0],
    [37, 100, 37],
    [50, 255, 128],
    [100, 255, 255],
    [50, 4095, 2048],
    [100, 180, 180],
    [50, 180, 90],
  ])('%s %% of %s is %s', (percent, nativeMax, expected) => {
    expect(percentToNative(percent, nativeMax)).toBe(expected);
  });

  it('wants a positive integer for N', () => {
    for (const bad of [0, -1, 1.5, NaN, Infinity]) {
      expect(() => percentToNative(10, bad)).toThrow(RangeError);
    }
  });
});

describe('rawToPercent(r) = floor(r x 100 / 4095 + 0.5), for display', () => {
  it.each([
    [0, 0],
    [1, 0],
    [20, 0],
    [21, 1],
    [41, 1],
    [1024, 25],
    [2047, 50],
    [2048, 50],
    [4094, 100],
    [4095, 100],
  ])('%s reads %s %%', (raw, percent) => {
    expect(rawToPercent(raw)).toBe(percent);
  });

  it('clamps outside 0..4095', () => {
    expect(rawToPercent(-5)).toBe(0);
    expect(rawToPercent(100000)).toBe(100);
    expect(() => rawToPercent(NaN)).toThrow(RangeError);
  });

  it('brings every whole percentage back: rawToPercent(percentToRaw(p)) = p for p in 0..100', () => {
    for (let percent = 0; percent <= 100; percent += 1) {
      expect(rawToPercent(percentToRaw(percent)), String(percent)).toBe(percent);
    }
  });
});

describe('what is NOT converted (PWM and analog write are EXCLUDED, contract C-26)', () => {
  it('has no 0..1023 scale and no duty function', () => {
    expect(Object.keys(conversions).sort()).toEqual(['ANALOG_NATIVE_MAX', 'percentToNative', 'percentToRaw', 'rawToPercent']);
  });
});
