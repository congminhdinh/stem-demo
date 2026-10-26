import type { IrObstacleSpec } from '../../hardware/kit';
import { colorReflectance } from '../arena/ground-paint';
import { getRapier, type Collider, type PhysicsWorld } from '../rapier';
import { CM_PER_M } from '../units';
import { forwardRay, type ColliderLookup, type SensorPose } from './collider-lookup';
import type { SensedBody } from './sensed-bodies';

// The IR obstacle sensor between the gripper's jaws (N19 B3, plan §4.4, §4.1; driver ir-digital, contract U-37), as N18's sensors are: a
// pure measure over a pose in the world. One ray from the sensor along its forward axis, `rangeCm` long (ref-uno-gripper@0: 2 cm,
// PLACEHOLDER). It meets the first body the lookup names and the caller does not leave out (`exclude`: on the gripper car, the carriage it
// sits in and the boom's cross bar at its hinge, world.ts), and sees it when that body's colour sends back at least `minReflectance` of the infrared (0.15): its luma, as the floor's paint
// (ground-paint.ts `colorReflectance`). So a black foam cube (#212121, 0.129) is not seen, as a real IR module misses it, and it hides what
// is behind it. That includes the held object, and the robot's own fingers if they were ever in the ray: with nothing between the jaws they
// never are, at any claw or lift angle (world.gripper-sensors.test.ts). A collider the lookup does not name (the chassis) is not there for it.
//
// The pin carries what the module's comparator outputs: LOW while it sees something for an active-low module (the kit's `activeLow`, the
// ir-digital driver's default), HIGH otherwise; `level` is what the driver's digitalRead must see.

export type IrOptions = {
  /** Colliders the ray passes through though the lookup names them (the carriage the sensor sits in, and the boom at its hinge). */
  readonly exclude?: (collider: Collider) => boolean;
  /** The kit port's `activeLow` (ir-digital): seeing is LOW. Default true, as the driver's. */
  readonly activeLow?: boolean;
};

export type IrReading<I extends SensedBody = SensedBody> = {
  /** It sees something: the first body within range reflects at least `minReflectance`. */
  readonly detected: boolean;
  /** The pin's digital level: 0 while it sees, for an active-low module. */
  readonly level: 0 | 1;
  /** The first body the ray met within range, seen or not (a black one is met and not seen); null when it met none. */
  readonly hit: I | null;
};

/**
 * What the IR at `pose` sees now. `spec` is the kit module's (kit.ts `IrObstacleSpec`, checked by loadKit). The scene queries must be up to
 * date (rapier.ts `refreshQueries`). A pose that is not finite, or a rotation of length 0, sees nothing.
 */
export function measureIr<I extends SensedBody>(world: PhysicsWorld, lookup: ColliderLookup<I>, pose: SensorPose, spec: IrObstacleSpec, options: IrOptions = {}): IrReading<I> {
  const activeLow = options.activeLow !== false;
  const nothing: IrReading<I> = { detected: false, level: activeLow ? 1 : 0, hit: null };
  const axis = forwardRay(pose);
  if (axis === null) return nothing;
  const exclude = options.exclude;
  const meets = (collider: Collider) => lookup.infoOf(collider) !== undefined && !(exclude !== undefined && exclude(collider));
  const hit = world.castRay(new (getRapier().Ray)(axis.origin, axis.dir), spec.rangeCm / CM_PER_M, true, undefined, undefined, undefined, undefined, meets);
  if (hit === null) return nothing;
  // `meets` accepted it, so the lookup names it.
  const body = lookup.infoOf(hit.collider) as I;
  const detected = colorReflectance(body.color) >= spec.minReflectance;
  return { detected, level: detected === activeLow ? 0 : 1, hit: body };
}
