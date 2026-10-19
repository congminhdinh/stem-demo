import { describe, expect, it } from 'vitest';
import type { ComponentInput } from '../simulate-circuit';
import { createTemperatureIO, TEMPERATURE_INITIAL, TEMPERATURE_MAX, TEMPERATURE_MIN, temperatureOf } from './temperature';

// The onboard temperature sensor (contract C-16, N17 B2): the program reads whole degrees Celsius. The control is a slider of
// −10..50 °C in steps of 1, and a run starts at 25 °C before the learner moves it (plan N17, Global Constraints).

const reading = (input: ComponentInput | undefined) => createTemperatureIO(() => input).temperature();

describe('the range of temperature()', () => {
  it('is −10..50 °C, starting at 25 °C', () => {
    expect([TEMPERATURE_MIN, TEMPERATURE_MAX, TEMPERATURE_INITIAL]).toEqual([-10, 50, 25]);
  });
});

describe('createTemperatureIO (the temperature capability)', () => {
  it('reads 25 °C when the slider was never touched, or when the input is not a slider', () => {
    expect(reading(undefined)).toBe(25);
    for (const input of [{ kind: 'hold', closed: true }, { kind: 'tilt', x: 0, y: 0 }, { kind: 'gesture' }] as const) {
      expect(reading(input), input.kind).toBe(25);
    }
  });

  it('passes every whole degree from −10 to 50 through unchanged', () => {
    for (let value = -10; value <= 50; value++) {
      expect(reading({ kind: 'slider', value }), String(value)).toBe(value);
    }
  });

  it('clamps at −10 and 50, and rounds to a whole degree', () => {
    expect(reading({ kind: 'slider', value: -11 })).toBe(-10);
    expect(reading({ kind: 'slider', value: -1000 })).toBe(-10);
    expect(reading({ kind: 'slider', value: 51 })).toBe(50);
    expect(reading({ kind: 'slider', value: Number.POSITIVE_INFINITY })).toBe(50);
    expect(reading({ kind: 'slider', value: Number.NEGATIVE_INFINITY })).toBe(-10);
    expect(reading({ kind: 'slider', value: 20.4 })).toBe(20);
    expect(reading({ kind: 'slider', value: 20.6 })).toBe(21);
    expect(reading({ kind: 'slider', value: Number.NaN })).toBe(25);
  });

  it('only ever gives a whole number from −10 to 50, whatever the slider holds', () => {
    for (let value = -40; value <= 80; value += 0.25) {
      const degrees = temperatureOf({ kind: 'slider', value });
      expect(Number.isInteger(degrees), String(value)).toBe(true);
      expect(degrees).toBeGreaterThanOrEqual(-10);
      expect(degrees).toBeLessThanOrEqual(50);
    }
  });

  it('reads the input at every call, so a move of the slider is seen at the next read', () => {
    let input: ComponentInput | undefined;
    const sensor = createTemperatureIO(() => input);
    expect(sensor.temperature()).toBe(25);
    input = { kind: 'slider', value: 30 };
    expect(sensor.temperature()).toBe(30);
    input = { kind: 'slider', value: -5 };
    expect(sensor.temperature()).toBe(-5);
    input = undefined;
    expect(sensor.temperature()).toBe(25);
  });
});
