import { describe, expect, it } from 'vitest';
import { gestureNames } from '../../constructs/ybc.input';
import type { ComponentInput } from '../simulate-circuit';
import {
  ACCELERATION_LIMIT_MG,
  accelerationOf,
  createMotionIO,
  flatAcceleration,
  GRAVITY_MG,
  gestureOf,
  SHAKE_MS,
  TILT_THRESHOLD_MG,
} from './accelerometer';

// The onboard accelerometer (contract C-17, C-18, N17 B2). The control is a tilt pad (x and y, ±1024 mg, the z that keeps the
// board's weight at about 1024 mg) and a "Lắc" button. The readings are whole mg in −2048..2048; a run starts lying flat, face up:
// (0, 0, −1024). A tilt is x or y beyond ±400 mg; shake is true for 1 s after the button.

const tilt = (x: number, y: number, z?: number): ComponentInput => (z === undefined ? { kind: 'tilt', x, y } : { kind: 'tilt', x, y, z });

describe('the constants of the simulator', () => {
  it('are the plan’s: ±2048 mg, gravity 1024 mg, a tilt beyond ±400 mg, a shake of 1 s, lying flat face up', () => {
    expect([ACCELERATION_LIMIT_MG, GRAVITY_MG, TILT_THRESHOLD_MG, SHAKE_MS]).toEqual([2048, 1024, 400, 1000]);
    expect(flatAcceleration).toEqual({ x: 0, y: 0, z: -1024 });
  });
});

describe('accelerationOf (what the three axes read)', () => {
  it('is flat, face up, when the pad was never touched or the input is not a tilt', () => {
    expect(accelerationOf(undefined)).toEqual({ x: 0, y: 0, z: -1024 });
    for (const input of [{ kind: 'hold', closed: true }, { kind: 'slider', value: 30 }, { kind: 'gesture' }] as const) {
      expect(accelerationOf(input), input.kind).toEqual({ x: 0, y: 0, z: -1024 });
    }
  });

  it('takes x and y from the pad and gives z the rest of the board’s weight, face up', () => {
    expect(accelerationOf(tilt(0, 0))).toEqual({ x: 0, y: 0, z: -1024 });
    expect(accelerationOf(tilt(-1024, 0))).toEqual({ x: -1024, y: 0, z: 0 });
    expect(accelerationOf(tilt(0, 512))).toEqual({ x: 0, y: 512, z: -887 });
    expect(accelerationOf(tilt(600, -600))).toEqual({ x: 600, y: -600, z: -573 });
    // In a corner of the pad there is no weight left for z: it is 0, never a NaN.
    expect(accelerationOf(tilt(1024, 1024))).toEqual({ x: 1024, y: 1024, z: 0 });
  });

  it('takes z as given (face down is a positive z), clamped like x and y', () => {
    expect(accelerationOf(tilt(0, 0, 1024))).toEqual({ x: 0, y: 0, z: 1024 });
    expect(accelerationOf(tilt(0, 0, 5000))).toEqual({ x: 0, y: 0, z: 2048 });
  });

  it('keeps every axis a whole number of mg inside −2048..2048', () => {
    expect(accelerationOf(tilt(3000, -3000))).toEqual({ x: 2048, y: -2048, z: 0 });
    expect(accelerationOf(tilt(10.4, -10.6))).toEqual({ x: 10, y: -11, z: -1024 });
    for (const value of [-5000, -2049, -1, 0.5, 1023.5, 2049, 9999]) {
      const reading = accelerationOf(tilt(value, value));
      for (const axis of ['x', 'y', 'z'] as const) {
        expect(Number.isInteger(reading[axis]), `${value} ${axis}`).toBe(true);
        expect(Math.abs(reading[axis])).toBeLessThanOrEqual(2048);
      }
    }
  });

  it('reads a tilt that is not made of numbers as flat (a forged input never breaks a run)', () => {
    expect(accelerationOf({ kind: 'tilt', x: Number.NaN, y: 0 })).toEqual({ x: 0, y: 0, z: -1024 });
    expect(accelerationOf({ kind: 'tilt', x: 0, y: Number.POSITIVE_INFINITY })).toEqual({ x: 0, y: 0, z: -1024 });
  });
});

describe('gestureOf (the gesture the tilt pad makes)', () => {
  it('is face up lying flat, and face down turned over', () => {
    expect(gestureOf(flatAcceleration)).toBe('face_up');
    expect(gestureOf(accelerationOf(tilt(0, 0, 1024)))).toBe('face_down');
  });

  it('is a tilt to the left or right beyond ±400 mg on x, and not at 400', () => {
    expect(gestureOf(accelerationOf(tilt(-401, 0)))).toBe('tilt_left');
    expect(gestureOf(accelerationOf(tilt(-1024, 0)))).toBe('tilt_left');
    expect(gestureOf(accelerationOf(tilt(401, 0)))).toBe('tilt_right');
    expect(gestureOf(accelerationOf(tilt(-400, 0)))).toBe('face_up');
    expect(gestureOf(accelerationOf(tilt(400, 0)))).toBe('face_up');
  });

  it('is logo up below −400 mg on y and logo down above 400 mg', () => {
    expect(gestureOf(accelerationOf(tilt(0, -401)))).toBe('logo_up');
    expect(gestureOf(accelerationOf(tilt(0, 401)))).toBe('logo_down');
    expect(gestureOf(accelerationOf(tilt(0, 400)))).toBe('face_up');
  });

  it('gives x the first say when both axes tilt, as the micro:bit does', () => {
    expect(gestureOf(accelerationOf(tilt(-600, 600)))).toBe('tilt_left');
    expect(gestureOf(accelerationOf(tilt(600, -600)))).toBe('tilt_right');
  });

  it('is no gesture when nothing is beyond 400 mg (only a scripted z of 0 gets there)', () => {
    expect(gestureOf({ x: 100, y: -100, z: 0 })).toBeNull();
  });

  it('names only gestures of the block’s list', () => {
    for (let x = -1024; x <= 1024; x += 128) {
      for (let y = -1024; y <= 1024; y += 128) {
        for (const z of [undefined, 1024]) {
          const gesture = gestureOf(accelerationOf(tilt(x, y, z)));
          expect(gesture === null || gestureNames.includes(gesture), `${x} ${y} ${z}`).toBe(true);
          expect(gesture).not.toBe('shake');
        }
      }
    }
  });
});

describe('createMotionIO (the motion capability)', () => {
  const motion = (input: ComponentInput | undefined, sinceEvent?: number) => createMotionIO({ input: () => input, sinceEvent: () => sinceEvent });

  it('reads each axis from the pad, flat face up by default', () => {
    expect(['x', 'y', 'z'].map((axis) => motion(undefined).acceleration(axis as 'x'))).toEqual([0, 0, -1024]);
    expect(['x', 'y', 'z'].map((axis) => motion(tilt(-700, 300)).acceleration(axis as 'x'))).toEqual([-700, 300, -685]);
  });

  it('says shake for 1 s after the button, and the tilt’s gesture before and after', () => {
    expect(motion(tilt(-700, 0), undefined).gesture?.()).toBe('tilt_left');
    expect(motion(tilt(-700, 0), 0).gesture?.()).toBe('shake');
    expect(motion(tilt(-700, 0), 999).gesture?.()).toBe('shake');
    expect(motion(tilt(-700, 0), 1000).gesture?.()).toBe('tilt_left');
    expect(motion(undefined, 5000).gesture?.()).toBe('face_up');
  });

  it('reads the input and the time of the shake at every call', () => {
    let given: ComponentInput | undefined;
    let since: number | undefined;
    const sensor = createMotionIO({ input: () => given, sinceEvent: () => since });
    expect(sensor.gesture?.()).toBe('face_up');
    given = tilt(0, -800);
    expect([sensor.acceleration('y'), sensor.gesture?.()]).toEqual([-800, 'logo_up']);
    since = 10;
    expect(sensor.gesture?.()).toBe('shake');
    since = 1500;
    expect(sensor.gesture?.()).toBe('logo_up');
    given = undefined;
    expect(sensor.gesture?.()).toBe('face_up');
  });
});
