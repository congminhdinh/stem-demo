import { atan2, cos, sin } from './dmath';

// Units and frames of the robot world (N18 R3.1).
//
// Authored data (arena, kit, scenario) is in centimetres, grams and degrees. The physics world is SI:
// metres, kilograms, seconds, radians. Conversions happen once, when something is built.
//
// The arena is a plane seen from above: x to the right, y away from the viewer, origin at the ground's
// lower-left corner, yaw in degrees counter-clockwise from +x. The world is Rapier's, +Y up. The arena
// plane is the floor y = 0 with arena x along world +X and arena y along world −Z, so that both frames
// are right-handed and a positive yaw (counter-clockwise from above) is a positive rotation about +Y.
// A body's forward axis is its local +X (ADR 0001 §2).

export type Vec3 = { x: number; y: number; z: number };
export type Quat = { x: number; y: number; z: number; w: number };
/** A point of the arena: on the plane in centimetres, plus its height above the floor. */
export type ArenaPoint = { xCm: number; yCm: number; heightCm: number };

export const CM_PER_M = 100;
const G_PER_KG = 1000;

export function cmToM(cm: number): number {
  return cm / CM_PER_M;
}

export function mToCm(m: number): number {
  return m * CM_PER_M;
}

export function gToKg(g: number): number {
  return g / G_PER_KG;
}

/** Degrees to radians; exact at the multiples of 45° that authors use (`degToRad(90) === Math.PI / 2`). */
export function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function radToDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

/** An arena point (cm) as a world position (m). `0 -` keeps the origin at +0, never −0. */
export function arenaToWorld(xCm: number, yCm: number, heightCm = 0): Vec3 {
  return { x: cmToM(xCm), y: cmToM(heightCm), z: 0 - cmToM(yCm) };
}

export function worldToArena(p: Vec3): ArenaPoint {
  return { xCm: mToCm(p.x), yCm: 0 - mToCm(p.z), heightCm: mToCm(p.y) };
}

/** The rotation by an arena yaw (rad, counter-clockwise from above): about +Y, built with dmath. */
export function yawToQuaternion(yawRad: number): Quat {
  const half = yawRad / 2;
  return { x: 0, y: sin(half), z: 0, w: cos(half) };
}

/** v rotated by the unit quaternion q, with products and sums only (ADR 0001 §4.6). */
export function rotateVector(q: Quat, v: Vec3): Vec3 {
  // v' = v + 2w(u × v) + 2u × (u × v), u = (q.x, q.y, q.z)
  const tx = 2 * (q.y * v.z - q.z * v.y);
  const ty = 2 * (q.z * v.x - q.x * v.z);
  const tz = 2 * (q.x * v.y - q.y * v.x);
  return {
    x: v.x + q.w * tx + (q.y * tz - q.z * ty),
    y: v.y + q.w * ty + (q.z * tx - q.x * tz),
    z: v.z + q.w * tz + (q.x * ty - q.y * tx),
  };
}

/** The arena yaw (rad, in (−π, π]) of a body's forward axis, from its world rotation. */
export function yawOfQuaternion(q: Quat): number {
  const forward = rotateVector(q, { x: 1, y: 0, z: 0 });
  return atan2(0 - forward.z, forward.x);
}
