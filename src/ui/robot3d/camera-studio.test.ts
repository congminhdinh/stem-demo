import { describe, expect, it } from 'vitest';
import { chaseViewPose, freeViewPose, projectToScreen, VIEW_SAFE_RECT } from './camera-studio';

// N18 R4.7: the 3D view's camera reads as 3D: "Tự do" opens low (30° above the floor) behind and beside the robot's start, the
// arena receding in front of it, every corner of the floor inside the part of the view the HUD and the buttons leave free; "Theo xe"
// rides low and close behind the robot, looking a little ahead of it.

const fov = 40;
const aspect = 660 / 497;
const corners = (w: number, d: number) => [
  [0, 0, 0],
  [w, 0, 0],
  [0, 0, -d],
  [w, 0, -d],
] as const;

describe('the free view (N18 R4.7)', () => {
  for (const [w, d] of [
    [1.6, 0.8],
    [1.7, 1.4],
    [1, 1],
    [2, 2],
    [1.3, 1.3],
  ] as const) {
    it(`frames a ${w * 100} × ${d * 100} cm arena from 26° up, behind the start: the floor round the robot and the far corners in the free part of the view`, () => {
      const start = { xCm: 30, yCm: (d * 100) / 2, yawDeg: 0 };
      const pose = freeViewPose({ widthM: w, depthM: d }, start, fov, aspect);
      const [dx, dy, dz] = [pose.position[0] - pose.target[0], pose.position[1] - pose.target[1], pose.position[2] - pose.target[2]];
      expect(Math.atan2(dy, Math.hypot(dx, dz))).toBeCloseTo((26 * Math.PI) / 180, 9);
      // Behind the robot (it faces +x): the camera is on the −x side of the target.
      expect(dx).toBeLessThan(0);
      const robot = [start.xCm / 100, 0, -start.yCm / 100] as const;
      const around = [-0.16, 0.16].flatMap((ex) => [-0.16, 0.16].map((ez) => [robot[0] + ex, 0, robot[2] + ez] as const));
      // The far corners: the two with the largest x (the view looks roughly along +x).
      const far = [...corners(w, d)].sort((a, b) => b[0] - a[0]).slice(0, 2);
      for (const corner of [...far, ...around]) {
        const [x, y] = projectToScreen(corner, pose, fov, aspect);
        expect(x).toBeGreaterThanOrEqual(VIEW_SAFE_RECT.left - 1e-6);
        expect(x).toBeLessThanOrEqual(VIEW_SAFE_RECT.right + 1e-6);
        expect(y).toBeGreaterThanOrEqual(VIEW_SAFE_RECT.bottom - 1e-6);
        expect(y).toBeLessThanOrEqual(VIEW_SAFE_RECT.top + 1e-6);
      }
      // Tight: some corner touches the free rectangle's edge.
      const touches = [...far, ...around].some((corner) => {
        const [x, y] = projectToScreen(corner, pose, fov, aspect);
        return [x - VIEW_SAFE_RECT.left, VIEW_SAFE_RECT.right - x, y - VIEW_SAFE_RECT.bottom, VIEW_SAFE_RECT.top - y].some((gap) => gap < 0.02);
      });
      expect(touches).toBe(true);
    });
  }

  it('turns the view towards the arena’s middle when the robot starts beside it', () => {
    const span = { widthM: 1.7, depthM: 1.4 };
    const low = freeViewPose(span, { xCm: 50, yCm: 30, yawDeg: 0 }, fov, aspect);
    const high = freeViewPose(span, { xCm: 50, yCm: 110, yawDeg: 0 }, fov, aspect);
    // Looking from the start towards the middle: from the near side (low y) the camera sits on +z, from the far side on −z.
    expect(low.position[2] - low.target[2]).toBeGreaterThan(0);
    expect(high.position[2] - high.target[2]).toBeLessThan(0);
  });
});

describe('the chase view (N18 R4.7)', () => {
  it('rides low and close behind the robot, looking a little ahead of it, whichever way it faces', () => {
    const facingX = chaseViewPose([0.5, 0, -0.4], 0);
    expect(facingX.target[0]).toBeGreaterThan(0.5);
    expect(facingX.position[0]).toBeLessThan(0.5);
    const [dx, dy, dz] = [facingX.position[0] - 0.5, facingX.position[1], facingX.position[2] + 0.4];
    expect(Math.hypot(dx, dz)).toBeCloseTo(0.34, 9);
    expect(dy).toBeCloseTo(0.15, 9);
    const facingY = chaseViewPose([0.5, 0, -0.4], Math.PI / 2);
    expect(facingY.position[0]).toBeCloseTo(0.5, 9);
    expect(facingY.position[2]).toBeCloseTo(-0.4 + 0.34, 9);
  });
});
