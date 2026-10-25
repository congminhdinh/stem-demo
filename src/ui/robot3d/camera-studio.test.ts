import { describe, expect, it } from 'vitest';
import { chaseViewPose, clearSight, freeViewForward, freeViewPose, projectToScreen, safeTop, sightWalls, VIEW_SAFE_RECT } from './camera-studio';

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
      const pose = freeViewPose({ widthM: w, depthM: d }, { start, goals: [] }, fov, aspect);
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
        // Under the HUD on the left, under the camera buttons elsewhere.
        expect(y).toBeLessThanOrEqual(safeTop(x) + 1e-6);
      }
      // Tight: some corner touches the free rectangle's edge.
      const touches = [...far, ...around].some((corner) => {
        const [x, y] = projectToScreen(corner, pose, fov, aspect);
        return [x - VIEW_SAFE_RECT.left, VIEW_SAFE_RECT.right - x, y - VIEW_SAFE_RECT.bottom, safeTop(x) - y].some((gap) => gap < 0.02);
      });
      expect(touches).toBe(true);
    });
  }

  it('looks 14° to the left of the line from the start to the goals, so the goals sit right of the middle, away from the HUD', () => {
    const ahead = freeViewForward({ start: { xCm: 40, yCm: 50, yawDeg: 0 }, goals: [[[108, 20], [128, 20], [128, 80], [108, 80]]] });
    // Arena +x turned 14° counter-clockwise: three's (cos 14°, −sin 14°).
    expect(ahead[0]).toBeCloseTo(Math.cos((14 * Math.PI) / 180), 12);
    expect(ahead[1]).toBeCloseTo(-Math.sin((14 * Math.PI) / 180), 12);
    // No goal: along the start's heading.
    const heading = freeViewForward({ start: { xCm: 40, yCm: 50, yawDeg: 90 }, goals: [] });
    expect(heading[0]).toBeCloseTo(Math.cos((104 * Math.PI) / 180), 12);
    expect(heading[1]).toBeCloseTo(-Math.sin((104 * Math.PI) / 180), 12);
  });

  it('looks over the robot to where the lesson sends it, and keeps that zone in the free part of the view', () => {
    // rb-line-follow: the garage is behind the start and to its left (arena +y): the camera stands on the near side (+z) looking −z.
    const span = { widthM: 1.7, depthM: 1.4 };
    const garage = [[8, 98], [45, 98], [45, 122], [8, 122]] as const;
    const pose = freeViewPose(span, { start: { xCm: 50, yCm: 30, yawDeg: 0 }, goals: [garage] }, fov, aspect);
    expect(pose.position[2] - pose.target[2]).toBeGreaterThan(0);
    expect(Math.abs(pose.position[2] - pose.target[2])).toBeGreaterThan(Math.abs(pose.position[0] - pose.target[0]));
    for (const [x, y] of garage) {
      const [sx, sy] = projectToScreen([x / 100, 0, -y / 100], pose, fov, aspect);
      expect(Math.abs(sx)).toBeLessThanOrEqual(VIEW_SAFE_RECT.right + 1e-6);
      expect(sy).toBeLessThanOrEqual(safeTop(sx) + 1e-6);
    }
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

describe('the chase view over the walls (N18 R4.7)', () => {
  const walls = sightWalls([{ fromCm: [0, 1], toCm: [160, 1], heightCm: 10, thicknessCm: 2 }]);

  it('leaves a camera whose sight of the robot crosses no wall where it is', () => {
    const pose = { position: [0.5, 0.15, -0.6] as const, target: [0.8, 0.03, -0.6] as const };
    expect(clearSight(pose, walls)).toBe(pose);
  });

  it('raises a camera outside the near wall until it looks over it, the wall’s top and 2 cm under its sight line', () => {
    // The robot 20 cm inside the wall at y = 1 cm (three z −0.01), the camera 34 cm behind it, outside the arena.
    const pose = { position: [0.5, 0.15, 0.14] as const, target: [0.5, 0.03, -0.2] as const };
    const raised = clearSight(pose, walls);
    expect(raised.target).toEqual(pose.target);
    // Where the sight crosses the wall's inner face (z = −0.02): t = (0.2 − 0.02) / 0.34 of the way to the camera.
    const t = (0.2 - 0.02) / 0.34;
    expect(raised.position[1]).toBeCloseTo(0.03 + (0.1 + 0.02 - 0.03) / t, 9);
    const atWall = raised.target[1] + (raised.position[1] - raised.target[1]) * t;
    expect(atWall).toBeCloseTo(0.12, 9);
  });
});
