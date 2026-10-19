import type { MotionIO } from '../../capabilities/io';
import type { GestureName } from '../../constructs/ybc.input';
import type { ComponentInput } from '../simulate-circuit';

// The onboard accelerometer (contract C-17, C-18, N17 B2). What the board reads is the virtual environment's: the learner tilts
// the board with a pad (x and y, the z that keeps the board's weight) and shakes it with a button. The rules below are the
// simulator's, written down (plan N17 B2); how the real board orients its axes and decides a gesture is UNVERIFIED (contract §24):
//
// - every axis is whole mg in −2048..2048; lying flat, face up, is (0, 0, −1024);
// - a tilt is x or y beyond ±400 mg: x below −400 is tilted left, above 400 tilted right, then y below −400 logo up, above 400
//   logo down (x has the first say, as on the micro:bit); otherwise z decides face up (below −400) or face down (above 400);
// - shake is the gesture for 1 s after the "Lắc" button, whatever the tilt; the tilt is still there afterwards.

/** The range of a reading, in mg (the domain of C-17). */
export const ACCELERATION_LIMIT_MG = 2048;
/** The pull of gravity in mg: what the board weighs on its three axes together. */
export const GRAVITY_MG = 1024;
/** Beyond this, on x or y, the board is tilted (and on z, face up or down). */
export const TILT_THRESHOLD_MG = 400;
/** How long a shake lasts: `is_gesture("shake")` is true for this long after the button. */
export const SHAKE_MS = 1000;

export type Acceleration = { x: number; y: number; z: number };

/** Lying flat, face up: where every run starts. */
export const flatAcceleration: Readonly<Acceleration> = Object.freeze({ x: 0, y: 0, z: -GRAVITY_MG });

/** A whole number of mg inside the range; `+ 0` turns a rounded −0 into 0. */
const whole = (value: number) => Math.round(Math.min(ACCELERATION_LIMIT_MG, Math.max(-ACCELERATION_LIMIT_MG, value))) + 0;

/**
 * The three axes the board reads for a tilt input: x and y as given; z as given, or, without one, the rest of the board's weight
 * face up (−√(1024² − x² − y²), 0 when nothing is left). Anything but a tilt of finite numbers is lying flat.
 */
export function accelerationOf(input: ComponentInput | undefined): Acceleration {
  if (input?.kind !== 'tilt' || !Number.isFinite(input.x) || !Number.isFinite(input.y) || (input.z !== undefined && !Number.isFinite(input.z))) {
    return { ...flatAcceleration };
  }
  const x = whole(input.x);
  const y = whole(input.y);
  if (input.z !== undefined) {
    return { x, y, z: whole(input.z) };
  }
  const rest = GRAVITY_MG * GRAVITY_MG - x * x - y * y;
  return { x, y, z: rest <= 0 ? 0 : -Math.round(Math.sqrt(rest)) };
}

export type TiltGesture = Exclude<GestureName, 'shake'>;

/** The gesture the board makes for these readings (never shake: that is the button's), or null when none is beyond 400 mg. */
export function gestureOf({ x, y, z }: Acceleration): TiltGesture | null {
  if (x < -TILT_THRESHOLD_MG) {
    return 'tilt_left';
  }
  if (x > TILT_THRESHOLD_MG) {
    return 'tilt_right';
  }
  if (y < -TILT_THRESHOLD_MG) {
    return 'logo_up';
  }
  if (y > TILT_THRESHOLD_MG) {
    return 'logo_down';
  }
  if (z < -TILT_THRESHOLD_MG) {
    return 'face_up';
  }
  if (z > TILT_THRESHOLD_MG) {
    return 'face_down';
  }
  return null;
}

/**
 * The motion capability. `input` is the latest tilt of the run, `sinceEvent` how many ms ago the latest shake of the run was
 * (undefined: none). Both are read at every call, so a move of the pad or a shake is seen at the next read.
 */
export function createMotionIO(read: { input(): ComponentInput | undefined; sinceEvent(): number | undefined }): MotionIO {
  return {
    acceleration: (axis) => accelerationOf(read.input())[axis],
    gesture() {
      const since = read.sinceEvent();
      return since !== undefined && since >= 0 && since < SHAKE_MS ? 'shake' : gestureOf(accelerationOf(read.input()));
    },
  };
}
