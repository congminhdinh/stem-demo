import { describe, expect, it } from 'vitest';
import { yolobitContract } from '../../compat/yolobit-contract';
import { percentToNative } from '../conversions';
import type { ComponentInput } from '../simulate-circuit';
import { createLightIO, LIGHT_LEVEL_INITIAL, LIGHT_LEVEL_MAX, LIGHT_LEVEL_MIN } from './light';

// The onboard light sensor (contract §6, C-15): light_level() is an int from 0 (darkest) to 100 (brightest). The
// control is a slider of 0-100 %, and the scale of the board is the same 0..100, so the reading is the percentage.

const level = (input: ComponentInput | undefined) => createLightIO(() => input).lightLevel();

describe('the range of light_level()', () => {
  it('is 0 to 100, as the tooltip and the contract state', () => {
    expect(LIGHT_LEVEL_MIN).toBe(0);
    expect(LIGHT_LEVEL_MAX).toBe(100);
    expect(yolobitContract.constructs.find((construct) => construct.id === 'C-15')?.restrictions.join(' ')).toContain('0..100');
  });

  it('starts inside it, before the learner touches the slider', () => {
    expect(Number.isInteger(LIGHT_LEVEL_INITIAL)).toBe(true);
    expect(LIGHT_LEVEL_INITIAL).toBeGreaterThanOrEqual(LIGHT_LEVEL_MIN);
    expect(LIGHT_LEVEL_INITIAL).toBeLessThanOrEqual(LIGHT_LEVEL_MAX);
  });
});

describe('createLightIO (the light capability)', () => {
  it('reads the initial level when the slider was never touched', () => {
    expect(level(undefined)).toBe(LIGHT_LEVEL_INITIAL);
  });

  it('reads the initial level when the input is not a slider', () => {
    for (const input of [{ kind: 'hold', closed: true }, { kind: 'tilt', x: 90, y: 90 }, { kind: 'gesture' }] as const) {
      expect(level(input), input.kind).toBe(LIGHT_LEVEL_INITIAL);
    }
  });

  it('passes every integer from 0 to 100 through unchanged', () => {
    for (let value = 0; value <= 100; value++) {
      expect(level({ kind: 'slider', value }), String(value)).toBe(value);
    }
  });

  it('is the percentToNative(value, 100) of the frozen conversions, which does the clamp and the rounding', () => {
    for (const value of [-1000, -1, 0, 1, 49, 50, 99, 100, 101, 1000, 49.4, 49.5, 0.49, 99.5]) {
      expect(level({ kind: 'slider', value }), String(value)).toBe(percentToNative(value, 100));
    }
  });

  it('clamps at 0 and 100', () => {
    for (const value of [-1, -50, -1000, Number.NEGATIVE_INFINITY]) {
      expect(level({ kind: 'slider', value }), String(value)).toBe(0);
    }
    for (const value of [101, 150, 1000, Number.POSITIVE_INFINITY]) {
      expect(level({ kind: 'slider', value }), String(value)).toBe(100);
    }
  });

  it('only ever gives a whole number from 0 to 100, whatever the slider holds', () => {
    for (let value = -20; value <= 120; value += 0.25) {
      const reading = level({ kind: 'slider', value });
      expect(Number.isInteger(reading), String(value)).toBe(true);
      expect(reading, String(value)).toBeGreaterThanOrEqual(0);
      expect(reading, String(value)).toBeLessThanOrEqual(100);
    }
  });

  it('reads the input at every call, so a move of the slider is seen at the next read', () => {
    let input: ComponentInput | undefined;
    const light = createLightIO(() => input);
    expect(light.lightLevel()).toBe(LIGHT_LEVEL_INITIAL);
    input = { kind: 'slider', value: 7 };
    expect(light.lightLevel()).toBe(7);
    input = { kind: 'slider', value: 93 };
    expect(light.lightLevel()).toBe(93);
    input = undefined;
    expect(light.lightLevel()).toBe(LIGHT_LEVEL_INITIAL);
  });
});
