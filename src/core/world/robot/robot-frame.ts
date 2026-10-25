import type { RobotPointCm } from '../../hardware/kit';
import { cmToM, rotateVector, type Quat, type Vec3 } from '../units';

// The robot frame of a kit and the chassis body's local frame (N18 R3.3).
//
// A kit places its modules in the robot frame (kit.ts, `KitModule.mount`): origin on the floor under the centre of the
// chassis body, x forward, y left, z up, in cm. The chassis rigid body's local frame has the same origin in metres, with
// Rapier's axes (ADR 0001 §2): +X forward, +Y up, +Z right. So kit (x, y, z) is local (x, z, −y), and a kit yaw (about z,
// towards +y) is a rotation about local +Y by the same angle (units.ts `yawToQuaternion`).

export const IDENTITY_ROTATION: Quat = { x: 0, y: 0, z: 0, w: 1 };

/** A point of the robot frame (cm) in the chassis body's local frame (m). `0 -` keeps y = 0 at +0. */
export function robotPointToLocal([x, y, z]: RobotPointCm): Vec3 {
  return { x: cmToM(x), y: cmToM(z), z: 0 - cmToM(y) };
}

/** The rotation a ⊗ b: b first, then a. */
export function multiplyQuaternions(a: Quat, b: Quat): Quat {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  };
}

/** The inverse of a unit quaternion. */
export function conjugate(q: Quat): Quat {
  return { x: 0 - q.x, y: 0 - q.y, z: 0 - q.z, w: q.w };
}

/** Where a point of a body's local frame is in the world, the body being at `position` turned by `rotation`. */
export function localToWorld(position: Vec3, rotation: Quat, local: Vec3): Vec3 {
  const turned = rotateVector(rotation, local);
  return { x: position.x + turned.x, y: position.y + turned.y, z: position.z + turned.z };
}
