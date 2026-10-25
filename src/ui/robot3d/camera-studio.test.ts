import { describe, expect, it } from 'vitest';
import { scenarioCatalog } from '../../samples/robot-scenarios';
import { CHASE_AHEAD_M, CHASE_BACK_M, CHASE_INSIDE_M, CHASE_UP_M, chaseViewPose, clearSight, FREE_ELEVATION_DEG, freeViewForward, keepOutOfProps, MIN_ROBOT_PX, freeViewPose, projectToScreen, robotScreenWidth, safeBottom, safeTop, sightWalls, VIEW_SAFE_RECT, type FreeViewScene, type SafeRect } from './camera-studio';

// N18 R4.7: the 3D view's camera reads as 3D: "Tự do" opens 34° above the floor behind and beside the robot's start, the arena
// receding in front of it, the start, the route and the goals inside the part of the view the HUD, the buttons and the view tools leave
// free, the robot never a dot; "Theo xe" rides behind the robot, looking ahead of it, always inside the arena's walls.

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
    it(`frames a ${w * 100} × ${d * 100} cm arena from 34° up, behind the start: the floor round the robot and the far corners in the free part of the view`, () => {
      const start = { xCm: 30, yCm: (d * 100) / 2, yawDeg: 0 };
      const pose = freeViewPose({ widthM: w, depthM: d }, { start, goals: [] }, fov, aspect);
      const [dx, dy, dz] = [pose.position[0] - pose.target[0], pose.position[1] - pose.target[1], pose.position[2] - pose.target[2]];
      expect(FREE_ELEVATION_DEG).toBe(34);
      expect(Math.atan2(dy, Math.hypot(dx, dz))).toBeCloseTo((FREE_ELEVATION_DEG * Math.PI) / 180, 9);
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

/** A scenario's free view scene, as the view builds it. */
const sceneOf = (key: string): FreeViewScene => {
  const scenario = scenarioCatalog.get(key)!;
  const zones = scenario.arena.paint.zones;
  return {
    start: scenario.start,
    goals: zones.filter((zone) => zone.kind === 'target' || zone.kind === 'checkpoint').map((zone) => zone.polygonCm),
    startZone: zones.find((zone) => zone.kind === 'start')?.polygonCm,
    route: scenario.arena.paint.lines.flatMap((line) => line.pointsCm),
  };
};
const spanOf = (key: string) => {
  const [w, d] = scenarioCatalog.get(key)!.arena.ground.sizeCm;
  return { widthM: w / 100, depthM: d / 100 };
};
const inside = (point: readonly [number, number], rect: SafeRect) => {
  const [x, y] = point;
  return x >= rect.left - 1e-6 && x <= rect.right + 1e-6 && y >= safeBottom(x, rect) - 1e-6 && y <= safeTop(x, rect) + 1e-6;
};

describe('the free view of a pilot lesson (N18 R4.7 fix round 1)', () => {
  // The lesson frame at 1100 px (the view 660 × 497) and the page at 760 px (760 × 415), the view tools' strip at the bottom left.
  const views = [
    { width: 660, height: 497 },
    { width: 760, height: 415 },
  ];
  const rectFor = (width: number, height: number, hudBottom: number): SafeRect => ({ ...VIEW_SAFE_RECT, hud: { right: -1 + (2 * 308) / width, bottom: hudBottom }, tools: { right: -1 + (2 * 68) / width, top: -1 + (2 * 160) / height } });

  it('frames the start zone and the tape’s route within 80 cm of the start clear of the HUD and of the view tools, and the whole route on the screen at 1100 (rb-line-follow)', () => {
    const scene = sceneOf('rb-line-follow');
    const near = (scene.route ?? []).flatMap((point, i, all) => {
      const next = all[i + 1];
      if (!next) return [point];
      return Array.from({ length: 10 }, (_, k): [number, number] => [point[0] + ((next[0] - point[0]) * k) / 10, point[1] + ((next[1] - point[1]) * k) / 10]);
    }).filter(([x, y]) => Math.hypot(x - scene.start.xCm, y - scene.start.yCm) <= 80);
    for (const { width, height } of views) {
      const rect = rectFor(width, height, 0.27);
      const pose = freeViewPose(spanOf('rb-line-follow'), scene, fov, width / height, rect, (2 * MIN_ROBOT_PX) / width);
      for (const [x, y] of [...near, ...scene.startZone!]) expect(inside(projectToScreen([x / 100, 0, -y / 100], pose, fov, width / height), rect)).toBe(true);
      if (width !== 660) continue;
      // The far end may lie under a tall HUD's lower part (the learner can fold it), never off the screen.
      for (const [x, y] of scene.route!) for (const v of projectToScreen([x / 100, 0, -y / 100], pose, fov, width / height)) expect(Math.abs(v)).toBeLessThanOrEqual(1);
    }
  });

  it('keeps the robot and the floor round its start out of the view tools’ corner', () => {
    const scene = sceneOf('rb-mini-mission');
    const rect = rectFor(660, 497, 0.24);
    const pose = freeViewPose(spanOf('rb-mini-mission'), scene, fov, 660 / 497, rect);
    for (const dx of [-0.16, 0.16]) {
      for (const dz of [-0.16, 0.16]) {
        const [x, y] = projectToScreen([0.4 + dx, 0, -0.3 + dz], pose, fov, 660 / 497);
        expect(y).toBeGreaterThanOrEqual(safeBottom(x, rect) - 1e-6);
      }
    }
  });

  it('never shows the robot narrower than asked: a tall HUD at 760 px lets the far corners, then the route, then the far goals go (rb-mini-mission)', () => {
    const scene = sceneOf('rb-mini-mission');
    const rect = rectFor(760, 415, -0.11);
    const aspect = 760 / 415;
    const wide = freeViewPose(spanOf('rb-mini-mission'), scene, fov, aspect, rect);
    const min = (2 * MIN_ROBOT_PX) / 760;
    expect(robotScreenWidth(wide, scene.start, fov, aspect)).toBeLessThan(min);
    const pose = freeViewPose(spanOf('rb-mini-mission'), scene, fov, aspect, rect, min);
    expect(robotScreenWidth(pose, scene.start, fov, aspect)).toBeGreaterThanOrEqual(min);
    // The start and its zone stay in the free part of the view, and the first checkpoint too.
    for (const [x, y] of [...scene.startZone!, ...scene.goals[0]!]) expect(inside(projectToScreen([x / 100, 0, -y / 100], pose, fov, aspect), rect)).toBe(true);
  });

  it('frames every pilot lesson at 1100 and 760 px with the robot at least MIN_ROBOT_PX (60 px) wide', () => {
    expect(MIN_ROBOT_PX).toBe(60);
    for (const scenario of scenarioCatalog.scenarios) {
      const key = scenario.key;
      for (const { width, height } of views) {
        const aspect = width / height;
        const pose = freeViewPose(spanOf(key), sceneOf(key), fov, aspect, rectFor(width, height, 0.1), (2 * MIN_ROBOT_PX) / width);
        expect((robotScreenWidth(pose, scenario.start, fov, aspect) * width) / 2).toBeGreaterThanOrEqual(MIN_ROBOT_PX - 1e-6);
      }
    }
  });
});

describe('the chase view (N18 R4.7)', () => {
  it('rides 50 cm behind the robot and 25 cm up, looking 25 cm ahead of it, whichever way it faces', () => {
    expect([CHASE_BACK_M, CHASE_UP_M, CHASE_AHEAD_M]).toEqual([0.5, 0.25, 0.25]);
    const facingX = chaseViewPose([0.5, 0, -0.4], 0);
    expect(facingX.target[0]).toBeCloseTo(0.5 + CHASE_AHEAD_M, 9);
    expect(facingX.position[0]).toBeLessThan(0.5);
    const [dx, dy, dz] = [facingX.position[0] - 0.5, facingX.position[1], facingX.position[2] + 0.4];
    expect(Math.hypot(dx, dz)).toBeCloseTo(CHASE_BACK_M, 9);
    expect(dy).toBeCloseTo(CHASE_UP_M, 9);
    const facingY = chaseViewPose([0.5, 0, -0.4], Math.PI / 2);
    expect(facingY.position[0]).toBeCloseTo(0.5, 9);
    expect(facingY.position[2]).toBeCloseTo(-0.4 + CHASE_BACK_M, 9);
  });
});

describe('the chase view over the walls (N18 R4.7)', () => {
  const walls = sightWalls([{ fromCm: [0, 1], toCm: [160, 1], heightCm: 10, thicknessCm: 2 }]);

  it('leaves a camera whose sight of the robot crosses no wall where it is', () => {
    const pose = { position: [0.5, 0.15, -0.6] as const, target: [0.8, 0.03, -0.6] as const };
    expect(clearSight(pose, walls)).toBe(pose);
  });

  it('pulls a camera outside the near wall in to 3 cm inside its face, as far from the robot as it was, looking back at the robot as much', () => {
    // The robot 20 cm inside the wall at y = 1 cm (three z −0.01, its inner face at −0.02), the chase camera 50 cm behind it, outside.
    const robot = [0.5, 0.03, -0.2] as const;
    const pose = { position: [0.5, 0.28, 0.3] as const, target: [0.5, 0.03, -0.45] as const };
    const kept = clearSight(pose, walls, robot);
    expect(kept.position[0]).toBeCloseTo(0.5, 9);
    expect(kept.position[2]).toBeCloseTo(-0.02 - CHASE_INSIDE_M, 9);
    const across = 0.2 - 0.02 - CHASE_INSIDE_M;
    expect(Math.hypot(across, kept.position[1] - robot[1])).toBeCloseTo(Math.hypot(0.5, 0.25), 9);
    // It came in to 0.15 / 0.5 of the way: the point it looks at is that share of the way ahead of the robot.
    expect(kept.target[2]).toBeCloseTo(-0.2 - 0.25 * (across / 0.5), 9);
    expect(kept.target[1]).toBe(pose.target[1]);
  });

  it('never leaves a wall between the robot and the camera, nor the camera within 3 cm of a wall’s face, wherever the robot drives', () => {
    for (const key of ['rb-line-follow', 'rb-mini-mission', 'rb-stop-at-wall']) {
      const scenario = scenarioCatalog.get(key)!;
      const arenaWalls = sightWalls(scenario.arena.walls);
      const [w, d] = scenario.arena.ground.sizeCm;
      for (let x = 12; x <= w - 12; x += 9) {
        for (let y = 12; y <= d - 12; y += 9) {
          // Not inside a wall's band (a robot cannot stand there).
          if (arenaWalls.some((wall) => distanceToWall([x / 100, -y / 100], wall) < wall.half + 0.09)) continue;
          for (let yaw = 0; yaw < 360; yaw += 45) {
            const robot = [x / 100, 0.03, -y / 100] as const;
            const kept = clearSight(chaseViewPose([x / 100, 0, -y / 100], (yaw * Math.PI) / 180), arenaWalls, robot);
            for (const wall of arenaWalls) {
              expect(distanceToWall([kept.position[0], kept.position[2]], wall)).toBeGreaterThanOrEqual(wall.half + CHASE_INSIDE_M - 1e-9);
              expect(segmentsCross([robot[0], robot[2]], [kept.position[0], kept.position[2]], wall.from, wall.to)).toBe(false);
            }
          }
        }
      }
    }
  });
});

/** How far a floor point (three's x, z) is from a wall's centre line. */
function distanceToWall(point: readonly [number, number], wall: { from: readonly [number, number]; to: readonly [number, number] }): number {
  const [ax, az] = wall.from;
  const [bx, bz] = wall.to;
  const length2 = (bx - ax) ** 2 + (bz - az) ** 2;
  const t = Math.max(0, Math.min(1, ((point[0] - ax) * (bx - ax) + (point[1] - az) * (bz - az)) / length2));
  return Math.hypot(point[0] - (ax + (bx - ax) * t), point[1] - (az + (bz - az) * t));
}

function segmentsCross(a: readonly [number, number], b: readonly [number, number], c: readonly [number, number], d: readonly [number, number]): boolean {
  const side = (p: readonly [number, number], q: readonly [number, number], r: readonly [number, number]) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  return side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0;
}

describe('the chase camera and the arena’s props (N18 R4.7 fix round 2, N3)', () => {
  // rb-servo-gate's gate: 6 × 60 × 12 cm at (143, 50) cm, along arena y (three z); a gantry beam over (118, 50), 25–35 cm up.
  const gate = { centre: [1.43, -0.5] as const, half: [0.03, 0.3] as const, yawRad: 0, bottom: 0, top: 0.12 };
  const beam = { centre: [1.18, -0.5] as const, half: [0.02, 0.62] as const, yawRad: 0, bottom: 0.25, top: 0.35 };

  it('lifts a camera orbited low into a prop on the floor over its top, 3 cm to spare', () => {
    expect(keepOutOfProps([1.43, 0.06, -0.4], [gate])).toEqual([1.43, 0.12 + CHASE_INSIDE_M, -0.4]);
    // Within 3 cm of its face counts: the near plane would cut into it.
    expect(keepOutOfProps([1.43 - 0.03 - 0.02, 0.06, -0.4], [gate])[1]).toBeCloseTo(0.15, 9);
  });

  it('moves a camera in a hanging prop to the nearer side of it, over or under', () => {
    expect(keepOutOfProps([1.18, 0.27, -0.5], [beam])[1]).toBeCloseTo(0.25 - CHASE_INSIDE_M, 9);
    expect(keepOutOfProps([1.18, 0.34, -0.5], [beam])[1]).toBeCloseTo(0.35 + CHASE_INSIDE_M, 9);
  });

  it('leaves a camera clear of every prop where it is, and reads a turned prop in its own frame', () => {
    const position = [1.2, 0.06, -0.4] as const;
    expect(keepOutOfProps(position, [gate, beam])).toBe(position);
    // The gate turned 90°: now 60 cm along three x, 6 cm along z.
    const turned = { ...gate, yawRad: Math.PI / 2 };
    expect(keepOutOfProps([1.43 + 0.25, 0.06, -0.5], [turned])[1]).toBeCloseTo(0.15, 9);
    expect(keepOutOfProps([1.43, 0.06, -0.5 + 0.25], [turned])[1]).toBe(0.06);
  });
});
