import { MAX_CM, MIN_CM, NO_ECHO_CM, US_PER_CM } from '../../hardware/drivers/hcsr04';
import type { UltrasonicSpec } from '../../hardware/kit';
import { cos, sin } from '../dmath';
import { getRapier, type Collider, type PhysicsWorld } from '../rapier';
import type { WorldRng } from '../rng';
import { CM_PER_M, degToRad, rotateVector, type Quat, type Vec3 } from '../units';
import { isFiniteVector, type ColliderLookup, type SensedCollider, type SensorPose } from './collider-lookup';

// The HC-SR04 ultrasonic ranger in the world (N18 R3.4): what distance it hears from a pose, and the echo width the
// virtual UNO's pulseIn will see (R3.6, `attachPulseSource`).
//
// The beam is five rays in fixed directions: the sensor's axis and the four edges of its cone (left, right, up, down at
// `coneHalfDeg`). The reading is the shortest hit of the five, the slant distance to the nearest surface that echoes,
// as the first echo is what a real sensor times. Only colliders the lookup names with `ultrasonic: true` echo: never
// the floor, never a collider the lookup does not know (the robot's own), never what `exclude` refuses.
//
// A surface met too steeply sends the sound away instead of back, as a real HC-SR04 misses a wall it meets at a grazing
// angle: a ray whose first echoing surface has its normal more than ULTRASONIC_MAX_INCIDENCE_DEG (60°) from the ray
// hears nothing, and that surface still hides what is behind it. The angle is each ray's own, so with a ±15° cone a wall
// turned up to 75° from the axis is still heard by the edge ray nearer its normal. A ray that starts inside a collider
// (time of impact 0, no normal) hears it, at the near end of the range.
//
// Distances follow the UNO contract (U-27, §6.6; hcsr04.ts): an echo of w µs is w / 58 cm, the helper reads 2..400 cm,
// and no echo is 400. A sensor hears from max(minCm, 2) to min(maxCm, 400): nearer is that near end (the contract
// clamps to 2 and a 0 µs pulse would mean "no echo"), farther is no echo.

/** Uniform noise on an echo's distance: one draw in [−amplitudeCm, amplitudeCm) per measure. */
export type UltrasonicNoise = { readonly rng: WorldRng; readonly amplitudeCm: number };

export type UltrasonicOptions = {
  /** Colliders the beam passes through even when the lookup says they echo (e.g. `robot.ownsCollider`). */
  readonly exclude?: (collider: Collider) => boolean;
  /** Seeded noise; none by default. */
  readonly noise?: UltrasonicNoise;
};

export type UltrasonicReading<I extends SensedCollider = SensedCollider> = {
  /** The distance heard, in cm: within the sensor's range, or NO_ECHO_CM (400). Not rounded: the driver truncates. */
  readonly cm: number;
  /** The width of the echo pulse, µs: cm · 58, so `echoToCm` gives whole cm; NO_ECHO_US (0) when there is no echo. */
  readonly echoUs: number;
  /** What the nearest echo came from; null without an echo. */
  readonly hit: I | null;
};

export const ULTRASONIC_RAY_COUNT = 5;
/** The steepest incidence, between a ray and the normal of the surface it meets, that still echoes back. */
export const ULTRASONIC_MAX_INCIDENCE_DEG = 60;
/** cos(ULTRASONIC_MAX_INCIDENCE_DEG), exactly: the cutoff compares cosines, from dot products, so no acos is needed. */
const MIN_INCIDENCE_COS = 0.5;
/** The echo width of "no echo": pulseIn sees no pulse, so the helper returns 400 (contract §6.6). */
export const NO_ECHO_US = 0;

const directionsByCone = new Map<number, readonly Vec3[]>();

/**
 * The five ray directions of a cone, in the sensor's frame (forward +X, up +Y, left −Z): the axis, then the cone's edge
 * to the left, right, up and down. Unit vectors, from dmath's cos and sin; computed once per cone and frozen.
 */
export function ultrasonicRayDirections(coneHalfDeg: number): readonly Vec3[] {
  let directions = directionsByCone.get(coneHalfDeg);
  if (directions === undefined) {
    if (!(coneHalfDeg >= 0 && coneHalfDeg < 90)) {
      throw new RangeError(`An ultrasonic cone's half angle is 0 or more and under 90°, not ${coneHalfDeg}.`);
    }
    const c = cos(degToRad(coneHalfDeg));
    const s = sin(degToRad(coneHalfDeg));
    const rays: Vec3[] = [
      { x: 1, y: 0, z: 0 },
      { x: c, y: 0, z: 0 - s },
      { x: c, y: 0, z: s },
      { x: c, y: s, z: 0 },
      { x: c, y: 0 - s, z: 0 },
    ];
    directions = Object.freeze(rays.map((ray) => Object.freeze(ray)));
    directionsByCone.set(coneHalfDeg, directions);
  }
  return directions;
}

/**
 * What the ultrasonic sensor at `pose` hears now. `spec` is the kit module's (kit.ts `UltrasonicSpec`, checked by loadKit).
 *
 * - The scene queries must be up to date (rapier.ts, `refreshQueries`): the world reads what the last step or refresh saw.
 * - A pose that is not finite, or a rotation of length 0, hears no echo (Rapier would report a hit at 0 for a NaN ray).
 *   A rotation that is not of unit length is normalised.
 * - With `noise`, every call takes exactly one draw, echo or not, so the stream does not depend on what the beam meets.
 * - Throws a RangeError for a spec with an empty range or a bad cone, or a negative noise amplitude.
 */
export function measureUltrasonic<I extends SensedCollider>(
  world: PhysicsWorld,
  lookup: ColliderLookup<I>,
  pose: SensorPose,
  spec: UltrasonicSpec,
  options: UltrasonicOptions = {},
): UltrasonicReading<I> {
  const directions = ultrasonicRayDirections(spec.coneHalfDeg);
  const nearCm = Math.max(spec.minCm, MIN_CM);
  const farCm = Math.min(spec.maxCm, MAX_CM);
  if (!(nearCm <= farCm)) {
    throw new RangeError(`An ultrasonic sensor measures within ${MIN_CM}..${MAX_CM} cm, from minCm to maxCm, not ${spec.minCm}..${spec.maxCm}.`);
  }
  let offsetCm = 0;
  const noise = options.noise;
  if (noise !== undefined) {
    if (!(noise.amplitudeCm >= 0 && Number.isFinite(noise.amplitudeCm))) {
      throw new RangeError(`An ultrasonic noise amplitude is a finite number of cm, 0 or more, not ${noise.amplitudeCm}.`);
    }
    offsetCm = noise.rng.uniform(0 - noise.amplitudeCm, noise.amplitudeCm);
  }

  const rotation = unitRotation(pose.rotation);
  if (rotation === null || !isFiniteVector(pose.position)) return noEcho();

  const exclude = options.exclude;
  const echoes = (collider: Collider) => lookup.infoOf(collider)?.ultrasonic === true && !(exclude !== undefined && exclude(collider));
  const ray = new (getRapier().Ray)(pose.position, directions[0]!);
  const maxToi = farCm / CM_PER_M;
  let nearest: Collider | null = null;
  let nearestToi = Number.POSITIVE_INFINITY;
  for (const direction of directions) {
    const dir = rotateVector(rotation, direction);
    ray.dir = dir;
    const hit = world.castRayAndGetNormal(ray, maxToi, true, undefined, undefined, undefined, undefined, echoes);
    // Strictly shorter: on a tie the earlier ray in the fixed order wins.
    if (hit !== null && hit.timeOfImpact < nearestToi && echoesBack(dir, hit.timeOfImpact, hit.normal)) {
      nearest = hit.collider;
      nearestToi = hit.timeOfImpact;
    }
  }
  if (nearest === null) return noEcho();

  const cm = Math.min(farCm, Math.max(nearCm, nearestToi * CM_PER_M + offsetCm));
  // `echoes` accepted it, so the lookup names it.
  return { cm, echoUs: cm * US_PER_CM, hit: lookup.infoOf(nearest) as I };
}

/**
 * Whether a ray along the unit `dir` that meets a surface with outward `normal` gets its echo back: the incidence, the
 * angle between the ray reversed and the normal, is at most ULTRASONIC_MAX_INCIDENCE_DEG. Rapier's normal is a float32
 * unit vector, so it is normalised first. A ray that starts inside the collider (toi 0) has no normal and hears it.
 */
function echoesBack(dir: Vec3, toi: number, normal: Vec3): boolean {
  if (toi === 0) return true;
  const facing = 0 - (dir.x * normal.x + dir.y * normal.y + dir.z * normal.z);
  const length = Math.sqrt(normal.x * normal.x + normal.y * normal.y + normal.z * normal.z);
  return facing >= MIN_INCIDENCE_COS * length;
}

function noEcho(): UltrasonicReading<never> {
  return { cm: NO_ECHO_CM, echoUs: NO_ECHO_US, hit: null };
}

/** q of unit length, or null when it is not finite or has length 0. */
function unitRotation(q: Quat): Quat | null {
  const norm2 = q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w;
  if (!(norm2 > 0 && Number.isFinite(norm2))) return null;
  const inverse = 1 / Math.sqrt(norm2);
  return { x: q.x * inverse, y: q.y * inverse, z: q.z * inverse, w: q.w * inverse };
}
