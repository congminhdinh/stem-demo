import { MAX_CM, MIN_CM, NO_ECHO_CM, US_PER_CM } from '../../hardware/drivers/hcsr04';
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
// Distances follow the UNO contract (U-27, §6.6; hcsr04.ts): an echo of w µs is w / 58 cm, the helper reads 2..400 cm,
// and no echo is 400. A sensor hears from max(minCm, 2) to min(maxCm, 400): nearer is that near end (the contract
// clamps to 2 and a 0 µs pulse would mean "no echo"), farther is no echo.

/** The kit's ultrasonic module spec (kit.modules[].spec, R3.3), in degrees and centimetres. */
export type UltrasonicSpec = {
  /** Half the opening angle of the beam, 0 ≤ coneHalfDeg < 90. */
  readonly coneHalfDeg: number;
  /** Nearest and farthest distance it measures. */
  readonly minCm: number;
  readonly maxCm: number;
};

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
 * What the ultrasonic sensor at `pose` hears now.
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
    ray.dir = rotateVector(rotation, direction);
    const hit = world.castRay(ray, maxToi, true, undefined, undefined, undefined, undefined, echoes);
    // Strictly shorter: on a tie the earlier ray in the fixed order wins.
    if (hit !== null && hit.timeOfImpact < nearestToi) {
      nearest = hit.collider;
      nearestToi = hit.timeOfImpact;
    }
  }
  if (nearest === null) return noEcho();

  const cm = Math.min(farCm, Math.max(nearCm, nearestToi * CM_PER_M + offsetCm));
  // `echoes` accepted it, so the lookup names it.
  return { cm, echoUs: cm * US_PER_CM, hit: lookup.infoOf(nearest) as I };
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
