import { describe, expect, it } from 'vitest';
import { cameraLimits, chasePose, fitPointsDistance, overviewPose, topPose } from './camera';

// N18 R4.2: the camera's three views (R4.3 refines them): the overview a lab opens on, "Theo xe" behind the robot, "Nhìn từ trên"
// straight down on the whole arena; and the limits of the free orbit.

const span = { widthM: 1.6, depthM: 0.8 };
const centre = [0.8, 0, -0.4] as const;

describe('the camera of the 3D view (N18 R4.2)', () => {
  it('opens on the whole arena from the learner’s side, above and a little to the left, looking at its middle', () => {
    const pose = overviewPose(span, 40, 1.5);
    expect(pose.target).toEqual(centre);
    const [dx, dy, dz] = [pose.position[0] - centre[0], pose.position[1], pose.position[2] - centre[2]];
    expect(dz).toBeGreaterThan(0);
    expect(dx).toBeLessThan(0);
    expect(Math.atan2(dy, Math.hypot(dx, dz))).toBeCloseTo((52 * Math.PI) / 180, 12);
    expect(Math.atan2(-dx, dz)).toBeCloseTo((14 * Math.PI) / 180, 12);
    // Closer than the bounding sphere needs: the arena seen at an angle is shorter than its diagonal.
    expect(Math.hypot(dx, dy, dz)).toBeLessThan(0.894427191 / Math.sin(Math.PI / 9));
  });

  it('fits points by their projection: the least distance at which they are all inside the share of the screen given', () => {
    // A 2 m wide flat segment seen head on (from +Z) by a 90° camera at 1:1 with the whole screen: its ends touch the edges at 1 m.
    expect(fitPointsDistance([[-1, 0, 0], [1, 0, 0]], [0, 0, 0], [0, 0, 1], 90, 1, 1)).toBeCloseTo(1, 9);
    // Half the screen: twice as far. Twice as wide a screen: half as far.
    expect(fitPointsDistance([[-1, 0, 0], [1, 0, 0]], [0, 0, 0], [0, 0, 1], 90, 1, 0.5)).toBeCloseTo(2, 9);
    expect(fitPointsDistance([[-1, 0, 0], [1, 0, 0]], [0, 0, 0], [0, 0, 1], 90, 2, 1)).toBeCloseTo(0.5, 9);
  });

  it('looks straight down on the whole arena from above its middle, the arena’s far side up the screen', () => {
    const pose = topPose(span, 40, 1.5);
    expect(pose.target).toEqual(centre);
    expect(pose.position[0]).toBe(0.8);
    // The height that fits the 0.8 m depth in 40° (vertical) and the 1.6 m width in the horizontal field, the larger, plus 8 %.
    const horizontal = 2 * Math.atan(Math.tan(Math.PI / 9) * 1.5);
    const height = Math.max(0.4 / Math.tan(Math.PI / 9), 0.8 / Math.tan(horizontal / 2)) * 1.08;
    expect(pose.position[1]).toBeCloseTo(height, 12);
    expect(pose.position[2] - centre[2]).toBeGreaterThan(0);
    expect(pose.position[2] - centre[2]).toBeLessThan(1e-3);
  });

  it('follows from behind the robot and above it, looking at it, whichever way it faces', () => {
    const facingX = chasePose([0.5, 0, -0.4], 0);
    expect(facingX.target).toEqual([0.5, 0.03, -0.4]);
    expect(facingX.position[0]).toBeCloseTo(0.5 - 0.46, 12);
    expect(facingX.position[1]).toBeCloseTo(0.03 + 0.3, 12);
    expect(facingX.position[2]).toBeCloseTo(-0.4, 12);
    // Facing arena +y (three's −Z), the camera is behind it on +Z.
    const facingY = chasePose([0.5, 0, -0.4], Math.PI / 2);
    expect(facingY.position[0]).toBeCloseTo(0.5, 12);
    expect(facingY.position[2]).toBeCloseTo(-0.4 + 0.46, 12);
  });

  it('keeps the orbit above the floor, between a close look at the robot and three times the overview, around the arena', () => {
    const limits = cameraLimits(span, 40, 1.5);
    expect(limits.minDistance).toBe(0.12);
    expect(limits.maxDistance).toBeCloseTo((0.894427191 / Math.sin(Math.PI / 9)) * 3, 6);
    expect(limits.maxPolarAngle).toBe(Math.PI * 0.47);
    expect(limits.cursor).toEqual(centre);
    expect(limits.maxTargetRadius).toBeCloseTo(0.894427191 + 0.1, 9);
  });
});
