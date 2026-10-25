import type { LineSensorSpec } from '../../hardware/kit';
import { OFF_GROUND_REFLECTANCE, type GroundPaint } from '../arena/ground-paint';
import { worldToArena, type Vec3 } from '../units';
import { isFiniteVector } from './collider-lookup';

// A reflective (infrared) line sensor in the world (N18 R3.4): it looks straight down from where it is and reads the
// floor paint under its spot (arena/ground-paint.ts), the mean reflectance over a disc of `spotRadiusCm`. It only sees
// the painted floor (plane y = 0), never the top of a box, and ignores its own tilt.
//
// Lifted more than LIFTED_HEIGHT_CM (3 cm) above the floor it gets no reflection: reflectance 0, dark, as a real
// TCRT5000-type module reads when nothing sends its infrared back, and as ground-paint.ts reads beyond the floor's edge
// (OFF_GROUND_REFLECTANCE). So a robot that is picked up, tipped over or driven off the table reads dark on every line
// sensor. A position that is not finite reads the same.
//
// The pin carries one signal (contract U-28, U-29: `line.dark` is digitalRead and `line.raw` analogRead of the same
// PIN), so its digital level and its ADC value agree. For an active-high sensor (the kit's `activeLow: false`, the
// reference kit) dark is HIGH and a high ADC value; for an active-low one, LOW and a low value. The model is ideal: the
// output spans the whole ADC range, ADC = signal · 1024 / Vref truncated to 0..1023 (DS-01), with signal = 1 −
// reflectance (active-high) or reflectance (active-low). `level` is what the line-digital driver's digitalRead must see.

export type LineOptions = {
  /** The kit port's `activeLow` (line-digital): dark is LOW and a low ADC value. Default false. */
  readonly activeLow?: boolean;
};

export type LineReading = {
  /** Mean reflectance under the spot, 0 (black) … 1 (white). */
  readonly reflectance: number;
  /** reflectance < darkBelow. */
  readonly dark: boolean;
  /** The ADC value of the pin, a whole number 0..LINE_ADC_MAX (high on dark unless activeLow). */
  readonly raw: number;
  /** The pin's digital level: 1 on dark unless activeLow. */
  readonly level: 0 | 1;
};

/** Above this height (cm over the floor plane) the sensor gets no reflection. */
export const LIFTED_HEIGHT_CM = 3;
/** What a lifted sensor reads: no reflection, as beyond the floor's edge (see the header). */
export const LIFTED_REFLECTANCE = OFF_GROUND_REFLECTANCE;
/** The UNO's 10-bit ADC (uno-r3.board.json adcMax). */
export const LINE_ADC_MAX = 1023;
const ADC_STEPS = LINE_ADC_MAX + 1;

/**
 * What the line sensor at `positionWorld` (world frame, m) reads now. `spec` is the kit module's (kit.ts
 * `LineSensorSpec`, checked by loadKit); its `heightCm` is the rest height loadKit checks against the mount, and the
 * reading takes the actual height from `positionWorld`. Throws a RangeError for a spot radius that is not 0 or more
 * (ground-paint.ts) when it reads the floor.
 */
export function measureLine(paint: GroundPaint, positionWorld: Vec3, spec: LineSensorSpec, options: LineOptions = {}): LineReading {
  const activeLow = options.activeLow === true;
  const point = isFiniteVector(positionWorld) ? worldToArena(positionWorld) : null;
  const reflectance =
    point === null || point.heightCm > LIFTED_HEIGHT_CM ? LIFTED_REFLECTANCE : paint.groundReflectanceAt(point.xCm, point.yCm, spec.spotRadiusCm);
  const dark = reflectance < spec.darkBelow;
  const signal = activeLow ? reflectance : 1 - reflectance;
  return {
    reflectance,
    dark,
    raw: Math.min(LINE_ADC_MAX, Math.floor(signal * ADC_STEPS)),
    level: dark === activeLow ? 0 : 1,
  };
}
