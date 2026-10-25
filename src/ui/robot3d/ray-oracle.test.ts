import { describe, expect, it } from 'vitest';
import type { Pose } from '../../core/world/snapshot';
import { coneDirections, ultrasonicEndsCm } from './__fixtures__/ray-oracle';

// N18 R4.3 fix round 1: the oracle of the 3D sensor overlay's geometry (__fixtures__/ray-oracle.ts) against numbers worked out by hand:
// where the five rays of an ultrasonic cone end for a known reading. tests/robot-sensor-overlay-oracle.test.ts holds its directions
// against core's own (core/world/sensors/ultrasonic.ts), through the frame change from Rapier's to the arena's.

const pose = (xCm: number, yCm: number, yawDeg: number): Pose => {
  const half = (yawDeg * Math.PI) / 360;
  return { xCm, yCm, zCm: 0, yawDeg, rotation: { x: 0, y: 0, z: Math.sin(half), w: Math.cos(half) } };
};
const mount = { posCm: [7.5, 0, 4] as const, yawDeg: 0 };
const close = (actual: readonly number[], expected: readonly number[], digits = 9) => {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((value, i) => expect(value).toBeCloseTo(expected[i]!, digits));
};

describe('the cone of an ultrasonic sensor (core/world/sensors/ultrasonic.ts: five rays)', () => {
  it('is the axis, then the edges left, right, up and down at the half angle, as unit vectors (forward +x, left +y, up +z)', () => {
    const half = 15;
    const [c, s] = [Math.cos((half * Math.PI) / 180), Math.sin((half * Math.PI) / 180)];
    const directions = coneDirections(half);
    expect(directions).toHaveLength(5);
    close(directions[0]!, [1, 0, 0]);
    close(directions[1]!, [c, s, 0]);
    close(directions[2]!, [c, -s, 0]);
    close(directions[3]!, [c, 0, s]);
    close(directions[4]!, [c, 0, -s]);
    for (const direction of directions) expect(Math.hypot(...direction)).toBeCloseTo(1, 12);
  });
});

describe('where the oracle puts the rays for a known reading', () => {
  it('puts the axis end at the reading ahead of the mount: robot at (50, 40) facing +y, sensor 7.5 cm ahead and 4 cm up, 23.4 cm heard', () => {
    const { origin, ends } = ultrasonicEndsCm(pose(50, 40, 90), mount, 15, 23.4);
    close(origin, [50, 47.5, 4]);
    close(ends[0]!, [50, 70.9, 4]);
  });

  it('puts the four edges on the cone: each at the reading from the mount, the half angle from the axis', () => {
    const half = 15;
    const [c, s] = [Math.cos((half * Math.PI) / 180), Math.sin((half * Math.PI) / 180)];
    const { ends } = ultrasonicEndsCm(pose(50, 40, 0), mount, half, 100);
    // Facing +x: left is +y, right is −y, up is +z.
    close(ends[1]!, [57.5 + 100 * c, 40 + 100 * s, 4]);
    close(ends[2]!, [57.5 + 100 * c, 40 - 100 * s, 4]);
    close(ends[3]!, [57.5 + 100 * c, 40, 4 + 100 * s]);
    close(ends[4]!, [57.5 + 100 * c, 40, 4 - 100 * s]);
    for (const end of ends) expect(Math.hypot(end[0] - 57.5, end[1] - 40, end[2] - 4)).toBeCloseTo(100, 9);
  });

  it('turns with the mount’s own yaw: a sensor looking 90° left of the robot facing +x looks along +y', () => {
    const { ends } = ultrasonicEndsCm(pose(10, 20, 0), { posCm: [0, 5, 4], yawDeg: 90 }, 15, 30);
    close(ends[0]!, [10, 55, 4]);
  });

  it('follows the robot’s whole rotation, tilt included: nose up by 10° lifts the axis end', () => {
    const tilt = (10 * Math.PI) / 360;
    const tipped: Pose = { xCm: 0, yCm: 0, zCm: 0, yawDeg: 0, rotation: { x: 0, y: -Math.sin(tilt), z: 0, w: Math.cos(tilt) } };
    const { ends } = ultrasonicEndsCm(tipped, { posCm: [0, 0, 0], yawDeg: 0 }, 15, 100);
    const rise = Math.sin((10 * Math.PI) / 180);
    close(ends[0]!, [100 * Math.cos((10 * Math.PI) / 180), 0, 100 * rise], 9);
  });
});

