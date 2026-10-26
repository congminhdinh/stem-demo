import type { Collider } from '../rapier';
import { rotateVector, type Quat, type Vec3 } from '../units';

// What the robot's sensors share (N18 R3.4): how they learn what a collider is, and where a sensor sits.

/**
 * What a sensor needs to know of a collider it meets: the arena's `ArenaColliderInfo` (build-arena.ts), or anything
 * with these fields, such as a lookup that also names the robot's own parts.
 */
export type SensedCollider = {
  readonly id: string;
  readonly tags: readonly string[];
  /** Whether an ultrasonic ray echoes off it. */
  readonly ultrasonic: boolean;
};

/**
 * Names the colliders a sensor may meet. A `BuiltArena` is one; R3.5 may wrap it to add the robot's parts. A collider
 * it does not name (undefined) is invisible to every sensor: no echo, no contact.
 */
export type ColliderLookup<I extends SensedCollider = SensedCollider> = {
  infoOf(collider: Collider): I | undefined;
};

/**
 * Where a sensor is and where it faces, in the world (SI, +Y up, units.ts): the rotation turns the sensor's own frame,
 * which looks along its local +X with local +Y up, the way a body's forward axis is its local +X. R3.5 composes it from
 * the chassis pose and the module's mount.
 */
export type SensorPose = { readonly position: Vec3; readonly rotation: Quat };

/** Whether every coordinate of a vector is a finite number. */
export function isFiniteVector(v: Vec3): boolean {
  return Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
}

/** Whether a position and a rotation are made of finite numbers only. */
export function isFinitePose(position: Vec3, rotation: Quat): boolean {
  return isFiniteVector(position) && Number.isFinite(rotation.x) && Number.isFinite(rotation.y) && Number.isFinite(rotation.z) && Number.isFinite(rotation.w);
}

/**
 * N19 B3: a sensor's ray, from its position along its forward axis (local +X): the unit direction, the rotation normalised first. Null
 * for a pose that is not finite or a rotation of length 0 (Rapier would report a hit at 0 for a NaN ray), which sees nothing.
 */
export function forwardRay(pose: SensorPose): { readonly origin: Vec3; readonly dir: Vec3 } | null {
  const q = pose.rotation;
  const norm2 = q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w;
  if (!(norm2 > 0 && Number.isFinite(norm2)) || !isFiniteVector(pose.position)) return null;
  const inverse = 1 / Math.sqrt(norm2);
  const unit: Quat = { x: q.x * inverse, y: q.y * inverse, z: q.z * inverse, w: q.w * inverse };
  return { origin: pose.position, dir: rotateVector(unit, { x: 1, y: 0, z: 0 }) };
}
