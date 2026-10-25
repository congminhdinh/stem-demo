import { describe, expect, it } from 'vitest';
import type { ProgramClock } from '../../capabilities/services';
import { unoR3Board } from '../../hardware/catalog';
import { drivers } from '../../hardware/drivers';
import type { KitPort } from '../../hardware/kit';
import { createVirtualUno } from '../../hardware/virtual-uno';
import { parseArena } from '../arena/arena-schema';
import { createGroundPaint } from '../arena/ground-paint';
import { arenaToWorld } from '../units';
import { LIFTED_HEIGHT_CM, LIFTED_REFLECTANCE, LINE_ADC_MAX, measureLine, type LineSensorSpec } from './line';

/** The reference kit's line sensors (ref-uno-rover@0): 1 cm above the floor, a 0.3 cm spot, dark below 0.5. */
const SPEC: LineSensorSpec = { spotRadiusCm: 0.3, darkBelow: 0.5 };

/**
 * White 100 × 100 cm floor, a 2 cm tape along y = 50 from x = 10 to 90, a grey mat (0.5) and a dark mat (0.25) away
 * from it.
 */
const paint = createGroundPaint(
  parseArena({
    ground: { sizeCm: [100, 100], color: '#ffffff' },
    paint: {
      lines: [{ pointsCm: [[10, 50], [90, 50]], widthCm: 2 }],
      zones: [
        { id: 'grey', kind: 'area', polygonCm: [[10, 70], [30, 70], [30, 90], [10, 90]], color: '#808080', reflectance: 0.5 },
        { id: 'dark', kind: 'area', polygonCm: [[60, 70], [80, 70], [80, 90], [60, 90]], color: '#404040', reflectance: 0.25 },
      ],
    },
  }),
);

const at = (xCm: number, yCm: number, heightCm = 1) => arenaToWorld(xCm, yCm, heightCm);

describe('measureLine', () => {
  it('centre of a 2 cm tape reads dark', () => {
    expect(measureLine(paint, at(50, 50), SPEC)).toEqual({ reflectance: 0, dark: true, raw: 1023, level: 1 });
  });

  it('blank floor reads not dark', () => {
    expect(measureLine(paint, at(50, 20), SPEC)).toEqual({ reflectance: 1, dark: false, raw: 0, level: 0 });
  });

  it('the tape’s edge reads about 0.5, half the ADC scale', () => {
    for (const yCm of [49, 51]) {
      const edge = measureLine(paint, at(50, yCm), SPEC);
      expect(edge.reflectance).toBeCloseTo(0.5, 2);
      expect(edge.raw).toBe(Math.min(LINE_ADC_MAX, Math.floor((1 - edge.reflectance) * 1024)));
      expect(Math.abs(edge.raw - 512)).toBeLessThanOrEqual(21);
      expect(edge.dark).toBe(edge.reflectance < 0.5);
    }
  });

  it('reads dark strictly below darkBelow', () => {
    expect(measureLine(paint, at(20, 80), SPEC)).toEqual({ reflectance: 0.5, dark: false, raw: 512, level: 0 });
    expect(measureLine(paint, at(70, 80), SPEC)).toEqual({ reflectance: 0.25, dark: true, raw: 768, level: 1 });
    expect(measureLine(paint, at(20, 80), { ...SPEC, darkBelow: 0.6 }).dark).toBe(true);
  });

  it('lifted more than 3 cm off the floor reads no reflection: blank, not dark', () => {
    expect(LIFTED_HEIGHT_CM).toBe(3);
    expect(LIFTED_REFLECTANCE).toBe(1);
    expect(measureLine(paint, at(50, 50, 3.5), SPEC)).toEqual({ reflectance: 1, dark: false, raw: 0, level: 0 });
    expect(measureLine(paint, at(50, 50, 30), SPEC).dark).toBe(false);
    // At 3 cm exactly it still sees the tape.
    expect(measureLine(paint, at(50, 50, 3), SPEC).dark).toBe(true);
  });

  it('beyond the edge of the floor there is nothing to reflect: 0, dark (ground-paint.ts)', () => {
    expect(measureLine(paint, at(-5, 20), SPEC)).toEqual({ reflectance: 0, dark: true, raw: 1023, level: 1 });
    expect(measureLine(paint, at(105, 20, -2), SPEC).dark).toBe(true);
  });

  it('reads a position that is not finite as lifted, never NaN', () => {
    const lifted = { reflectance: 1, dark: false, raw: 0, level: 0 };
    expect(measureLine(paint, { ...at(50, 50), x: Number.NaN }, SPEC)).toEqual(lifted);
    expect(measureLine(paint, { ...at(50, 50), y: Number.NEGATIVE_INFINITY }, SPEC)).toEqual(lifted);
    expect(measureLine(paint, { ...at(50, 50), z: Number.POSITIVE_INFINITY }, SPEC)).toEqual(lifted);
  });

  it('refuses a spot radius that is not 0 or more', () => {
    expect(() => measureLine(paint, at(50, 50), { ...SPEC, spotRadiusCm: -1 })).toThrow(RangeError);
  });

  it('raw direction: the pin is one signal, high on dark for an active-high sensor and low on dark for an active-low one', () => {
    expect(LINE_ADC_MAX).toBe(unoR3Board.adcMax);
    expect(measureLine(paint, at(50, 50), SPEC, { activeLow: true })).toEqual({ reflectance: 0, dark: true, raw: 0, level: 0 });
    expect(measureLine(paint, at(50, 20), SPEC, { activeLow: true })).toEqual({ reflectance: 1, dark: false, raw: 1023, level: 1 });
    expect(measureLine(paint, at(70, 80), SPEC, { activeLow: true })).toEqual({ reflectance: 0.25, dark: true, raw: 256, level: 0 });
    // Lifted, an active-low sensor reads blank too: HIGH.
    expect(measureLine(paint, at(50, 50, 10), SPEC, { activeLow: true }).level).toBe(1);
  });

  it('fed to the virtual UNO, the line-digital driver reads the same dark and raw, for both polarities', () => {
    let us = 0;
    const clock: ProgramClock = { now: () => us / 1000, charge: (by) => void (us += by) };
    const uno = createVirtualUno(unoR3Board, clock);
    const port = (activeLow: boolean): KitPort => ({ id: 'LN1', driver: 'line-digital', pins: { PIN: 'A0' }, params: { activeLow } });
    const ops = drivers['line-digital'].ops;
    for (const activeLow of [false, true]) {
      for (const [xCm, yCm] of [
        [50, 50],
        [50, 20],
        [50, 51],
        [70, 80],
      ] as const) {
        const reading = measureLine(paint, at(xCm, yCm), SPEC, { activeLow });
        uno.attachDigitalSource('A0', () => reading.level);
        uno.attachAnalogSource('A0', () => reading.raw);
        expect(ops['line.dark']!.sim(uno.io, port(activeLow), [])).toBe(reading.dark);
        expect(ops['line.raw']!.sim(uno.io, port(activeLow), [])).toBe(reading.raw);
      }
    }
  });
});
