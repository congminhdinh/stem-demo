import type { RobotPointCm } from '../../../core/hardware/kit';
import type { Pose } from '../../../core/world/snapshot';

// TEST-ONLY (N18 R4.3 fix round 1): the oracle of the 3D sensor overlay's geometry: where the five rays of an ultrasonic cone end, from
// the readout and the robot's pose, worked out on its own from the cone's definition. The overlay draws its beam from other numbers (a unit
// cone scaled by the reading, moved with the robot's group), so a test that reads the drawn vertices against this oracle checks the
// drawing. tests/robot-sensor-overlay-oracle.test.ts holds the oracle itself against core's own ray directions.

export type Vec3Cm = readonly [number, number, number];

const RAD = Math.PI / 180;

/**
 * The five rays of an ultrasonic cone in the sensor's frame (forward +x, left +y, up +z, as the kit's mounts): the axis, then the cone's
 * edge to the left, to the right, up and down at `coneHalfDeg`. The very rays of core/world/sensors/ultrasonic.ts (there in Rapier's
 * frame, forward +X, up +Y, left −Z), as unit vectors.
 */
export function coneDirections(coneHalfDeg: number): readonly Vec3Cm[] {
  const [c, s] = [Math.cos(coneHalfDeg * RAD), Math.sin(coneHalfDeg * RAD)];
  return [
    [1, 0, 0],
    [c, s, 0],
    [c, -s, 0],
    [c, 0, s],
    [c, 0, -s],
  ];
}

/** A vector turned by the unit quaternion `q`. */
function rotated(q: Pose['rotation'], [x, y, z]: Vec3Cm): Vec3Cm {
  // t = 2 (q.xyz × v); v' = v + w t + q.xyz × t
  const tx = 2 * (q.y * z - q.z * y);
  const ty = 2 * (q.z * x - q.x * z);
  const tz = 2 * (q.x * y - q.y * x);
  return [x + q.w * tx + (q.y * tz - q.z * ty), y + q.w * ty + (q.z * tx - q.x * tz), z + q.w * tz + (q.x * ty - q.y * tx)];
}

export type UltrasonicEnds = {
  /** The sensor on the arena (cm, z up from the floor). */
  origin: Vec3Cm;
  /** Where the rays end, `lengthCm` from the sensor along each of `coneDirections`: the axis first, then left, right, up, down. */
  ends: readonly Vec3Cm[];
};

/**
 * Where the rays of an ultrasonic sensor at `mount` (the kit's: its place in the robot frame and its yaw) end on the arena, for a
 * robot at `robot` and a reading of `lengthCm`. The robot's whole rotation counts (tilt included), as in the world.
 */
export function ultrasonicEndsCm(robot: Pose, mount: { readonly posCm: RobotPointCm; readonly yawDeg: number }, coneHalfDeg: number, lengthCm: number): UltrasonicEnds {
  const [c, s] = [Math.cos(mount.yawDeg * RAD), Math.sin(mount.yawDeg * RAD)];
  const world = (point: Vec3Cm): Vec3Cm => {
    const [x, y, z] = rotated(robot.rotation, point);
    return [robot.xCm + x, robot.yCm + y, robot.zCm + z];
  };
  const [mx, my, mz] = mount.posCm;
  return {
    origin: world([mx, my, mz]),
    ends: coneDirections(coneHalfDeg).map(([x, y, z]) => world([mx + lengthCm * (x * c - y * s), my + lengthCm * (x * s + y * c), mz + lengthCm * z])),
  };
}

