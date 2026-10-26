import type { Rgbc } from '../../hardware/devices/tcs34725';
import type { ColorSensorSpec } from '../../hardware/kit';
import { rgbOf } from '../arena/body-colors';
import { getRapier, type Collider, type PhysicsWorld } from '../rapier';
import { CM_PER_M } from '../units';
import { forwardRay, type ColliderLookup, type SensorPose } from './collider-lookup';
import type { SensedBody } from './sensed-bodies';

// The TCS34725 colour sensor on the gripper's carriage (N19 B3, plan §4.4, §4.1; D-G7): the light on its four photodiodes, as a pure
// measure over a pose in the world. The register model (hardware/devices/tcs34725.ts) integrates it over its windows; the run session keeps
// it tick by tick for that (run/light-history.ts).
//
// One ray from the sensor along its forward axis, `rangeCm` long (ref-uno-gripper@0: 4 cm), to the first body the lookup names and the
// caller does not leave out (on the gripper car: the carriage it sits in, and the floor: the sensor looks ahead, never at the mat). The
// light of each channel k (red, green, blue), per ms at 1× gain:
//
//     white_k · refl_k / (1 + (d / halfLightCm)²) + ambientPerMs,      refl_k = the body's sRGB component / 255,
//
// d the distance to the body in cm (whole µm, as the ultrasonic's); with nothing in range, the ambient alone. The clear channel is R + G + B.
// The G0.2 spike scripted the same mapping at d = 0 (spikes/avr8js/gripper-light.ts). The model wants counts per second at 1× gain in whole
// numbers: floor(1000 × that). Only + × / and floor, so every engine gives the same counts. The numbers are PLACEHOLDER data (kit.ts
// `ColorSensorSpec`) until a real sensor is measured (VG/L3).
//
// No noise. If noise is ever added, it takes a random stream of its own from the seed, never the ultrasonic's, so a kit with a colour
// sensor does not change what the ultrasonic reads.

export type ColorOptions = {
  /** Colliders the ray passes through though the lookup names them (the carriage, the boom at its hinge, the floor). */
  readonly exclude?: (collider: Collider) => boolean;
};

export type ColorReading<I extends SensedBody = SensedBody> = {
  /** The first body the ray met within range, or null. */
  readonly hit: I | null;
  /** How far it is, cm, snapped to whole µm; null without one. */
  readonly distanceCm: number | null;
  /** The light on the photodiodes, counts per second at 1× gain, whole numbers (`colorLight`). */
  readonly light: Rgbc;
};

/** Distances are snapped to whole micrometres, as the ultrasonic's (Rapier's time of impact is float32). */
const SNAP_PER_CM = 1e4;
const MS_PER_S = 1000;

/** The light of `seen` (a body's colour at a distance, cm), or the ambient alone (null), in counts per second at 1× gain (see the header). */
export function colorLight(spec: ColorSensorSpec, seen: { readonly color: string; readonly distanceCm: number } | null): Rgbc {
  const ambient = Math.floor(spec.ambientPerMs * MS_PER_S);
  if (seen === null) {
    return { c: 3 * ambient, r: ambient, g: ambient, b: ambient };
  }
  const rgb = rgbOf(seen.color);
  const ratio = seen.distanceCm / spec.halfLightCm;
  const falloff = 1 + ratio * ratio;
  const channel = (whitePerMs: number, component: number) => Math.floor(((whitePerMs * (component / 255)) / falloff + spec.ambientPerMs) * MS_PER_S);
  const r = channel(spec.whiteRPerMs, rgb.r);
  const g = channel(spec.whiteGPerMs, rgb.g);
  const b = channel(spec.whiteBPerMs, rgb.b);
  return { c: r + g + b, r, g, b };
}

/**
 * What the colour sensor at `pose` sees now. `spec` is the kit module's (kit.ts `ColorSensorSpec`, checked by loadKit). The scene queries
 * must be up to date (rapier.ts `refreshQueries`). A pose that is not finite, or a rotation of length 0, sees the ambient alone.
 */
export function measureColor<I extends SensedBody>(world: PhysicsWorld, lookup: ColliderLookup<I>, pose: SensorPose, spec: ColorSensorSpec, options: ColorOptions = {}): ColorReading<I> {
  const nothing: ColorReading<I> = { hit: null, distanceCm: null, light: colorLight(spec, null) };
  const axis = forwardRay(pose);
  if (axis === null) return nothing;
  const exclude = options.exclude;
  const meets = (collider: Collider) => lookup.infoOf(collider) !== undefined && !(exclude !== undefined && exclude(collider));
  const hit = world.castRay(new (getRapier().Ray)(axis.origin, axis.dir), spec.rangeCm / CM_PER_M, true, undefined, undefined, undefined, undefined, meets);
  if (hit === null) return nothing;
  // `meets` accepted it, so the lookup names it.
  const body = lookup.infoOf(hit.collider) as I;
  const distanceCm = Math.round(hit.timeOfImpact * CM_PER_M * SNAP_PER_CM) / SNAP_PER_CM;
  return { hit: body, distanceCm, light: colorLight(spec, { color: body.color, distanceCm }) };
}
