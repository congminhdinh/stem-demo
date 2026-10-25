import type { GroundPaint } from '../arena/ground-paint';
import { worldToArena, type Vec3 } from '../units';
import { isFiniteVector } from './collider-lookup';

// A reflective (infrared) line sensor in the world (N18 R3.4): it looks straight down from where it is and reads the
// floor paint under its spot (arena/ground-paint.ts), the mean reflectance over a disc of `spotRadiusCm`. It only sees
// the painted floor (plane y = 0), never the top of a box, and ignores its own tilt.
//
// Lifted more than LIFTED_HEIGHT_CM (3 cm) above the floor it reads "no reflection", which this world defines as blank
// floor: reflectance 1, never dark (controller ruling for R3.4). A program that follows a line thus sees a robot that
// is picked up or tipped over as having lost the line, not as sitting on one. A position that is not finite reads the
// same. Note the contrast with the floor's edge: within 3 cm of the floor plane but beyond the ground, ground-paint.ts
// reads 0 (nothing below sends light back, as a real sensor over an edge reads dark), and so does this sensor.
//
// The pin carries one signal (contract U-28, U-29: `line.dark` is digitalRead and `line.raw` analogRead of the same
// PIN), so its digital level and its ADC value agree. For an active-high sensor (the kit's `activeLow: false`, the
// reference kit) dark is HIGH and a high ADC value; for an active-low one, LOW and a low value. The model is ideal: the
// output spans the whole ADC range, ADC = signal · 1024 / Vref truncated to 0..1023 (DS-01), with signal = 1 −
// reflectance (active-high) or reflectance (active-low). `level` is what the line-digital driver's digitalRead must see.

/** The kit's line-sensor spec (kit.modules[].spec, R3.3). Its `heightCm` is not needed: the height comes from the pose. */
export type LineSensorSpec = {
  /** Radius of the floor spot it averages, in cm (0: a single point). */
  readonly spotRadiusCm: number;
  /** The floor reflectance (0 black … 1 white) below which it reads dark. */
  readonly darkBelow: number;
};

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
/** What a lifted sensor reads: blank floor (see the header). */
export const LIFTED_REFLECTANCE = 1;
/** The UNO's 10-bit ADC (uno-r3.board.json adcMax). */
export const LINE_ADC_MAX = 1023;
const ADC_STEPS = LINE_ADC_MAX + 1;

/**
 * What the line sensor at `positionWorld` (world frame, m) reads now. Throws a RangeError for a spot radius that is
 * not 0 or more (ground-paint.ts) when it reads the floor.
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
