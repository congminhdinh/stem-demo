import { describe, expect, it } from 'vitest';
import { scenarioCatalog } from '../../samples/robot-scenarios';
import { cases as freeViewCases } from './__fixtures__/free-view-cases';
import freeViewGolden from './__fixtures__/free-view-golden.json';
import { CHASE_AHEAD_M, CHASE_BACK_M, CHASE_INSIDE_M, CHASE_UP_M, chaseViewPose, clearSight, FREE_ELEVATION_DEG, framePointsInBox, freeViewForward, keepOutOfProps, keptFreeViewPose, MIN_ROBOT_PX, freeViewPose, projectToScreen, freeViewSceneOf, robotScreenWidth, safeBottom, safeTop, sightWalls, VIEW_SAFE_RECT, type FreeViewScene, type SafeRect, type ScreenBox } from './camera-studio';
import type { Vec3Tuple } from './scene-math';

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

describe('the free view’s poses (N18 P2)', () => {
  it('frames every pilot lesson exactly as R4.7 did: at 660 × 497 and 760 × 560, with no HUD and its bottom edge at 0.5, 0.35, 0.2 and 0.05, with and without the view tools’ corner', () => {
    const poses = freeViewCases().map(({ key, span, scene, fov: field, aspect: wide, rect, minRobot }) => ({ key, pose: freeViewPose(span, scene, field, wide, rect, minRobot) }));
    expect(poses).toHaveLength(140);
    expect(poses).toEqual(freeViewGolden);
  });

  it('keeps the pose of a scene for each view and safe rect it was framed for: a HUD that toggles between heights frames once per height', () => {
    // No HUD (the default rect) and the HUD's bottom at 0.35.
    const [first, , second] = freeViewCases().filter(({ key }) => key.startsWith('rb-mini-mission 660x497') && key.endsWith('tools no'));
    const pose = keptFreeViewPose(first!.span, first!.scene, fov, first!.aspect, first!.rect, first!.minRobot);
    expect(pose).toEqual(freeViewPose(first!.span, first!.scene, fov, first!.aspect, first!.rect, first!.minRobot));
    const other = keptFreeViewPose(second!.span, second!.scene, fov, second!.aspect, second!.rect, second!.minRobot);
    // The same scene and an equal rect (a new object): the kept pose itself; another rect, another pose.
    expect(keptFreeViewPose(first!.span, first!.scene, fov, first!.aspect, { ...first!.rect }, first!.minRobot)).toBe(pose);
    expect(keptFreeViewPose(second!.span, second!.scene, fov, second!.aspect, second!.rect, second!.minRobot)).toBe(other);
    expect(other).not.toBe(pose);
  });

  it('keeps at most 16 poses a scene, the latest framed: the oldest is framed again', () => {
    const scene = freeViewSceneOf(scenarioCatalog.get('rb-drive-to-zone')!);
    const span = { widthM: 1.6, depthM: 0.8 };
    const rect = (bottom: number): SafeRect => ({ ...VIEW_SAFE_RECT, hud: { right: -0.08, bottom } });
    const poses = Array.from({ length: 17 }, (_, i) => keptFreeViewPose(span, scene, fov, aspect, rect(0.5 - i * 0.01)));
    expect(keptFreeViewPose(span, scene, fov, aspect, rect(0.5 - 16 * 0.01))).toBe(poses[16]);
    expect(keptFreeViewPose(span, scene, fov, aspect, rect(0.5 - 1 * 0.01))).toBe(poses[1]);
    const again = keptFreeViewPose(span, scene, fov, aspect, rect(0.5));
    expect(again).not.toBe(poses[0]);
    expect(again).toEqual(poses[0]);
  });
});

/** How far a pose's camera is from what it looks at (m): the canvas's `data-camera` distance. */
const distanceOf = (pose: { position: readonly number[]; target: readonly number[] }) => Math.hypot(pose.position[0]! - pose.target[0]!, pose.position[1]! - pose.target[1]!, pose.position[2]! - pose.target[2]!);

describe('the free view beside a drive pad over the view’s middle (N19 final fix, G1 M1)', () => {
  // Lái tay in a gripper lesson in a short view: the pad with the gripper's column reaches past the view's middle, where framePoints
  // looks, so no framing of the free part fitted and the camera went 8–10 m away. The views G1 found it in: the lab in the LMS's frame at
  // 1440 × 900 (its toolbar on two rows), 1366 × 768 and 1280 × 720; the HUD's and the pad's corners as the lab measured them with Lái tay
  // on (spikes/n19-ff/teleop-camera.mjs on master 9e4f97b), the pad's held back as CameraRig holds it (right and top at most 0.2).
  const views = [
    { key: 'rb-grip-deliver', width: 613, height: 397, hud: [-0.126, 0.073], pad: [0.044, 0.058] },
    { key: 'rb-grip-sort', width: 613, height: 397, hud: [-0.126, 0.175], pad: [0.044, 0.058] },
    { key: 'rb-grip-pick', width: 569, height: 368, hud: [-0.058, 0.198], pad: [0.125, 0.141] },
    { key: 'rb-grip-deliver', width: 569, height: 368, hud: [-0.058, 0], pad: [0.125, 0.141] },
    { key: 'rb-grip-sort', width: 569, height: 368, hud: [-0.058, 0.11], pad: [0.125, 0.141] },
    { key: 'rb-grip-stack', width: 569, height: 368, hud: [-0.058, 0.11], pad: [0.125, 0.141] },
    { key: 'rb-grip-pick', width: 517, height: 368, hud: [0.036, 0.198], pad: [0.2, 0.141] },
    { key: 'rb-grip-deliver', width: 517, height: 368, hud: [0.036, 0], pad: [0.2, 0.141] },
    { key: 'rb-grip-sort', width: 517, height: 368, hud: [0.036, 0.11], pad: [0.2, 0.141] },
    { key: 'rb-grip-stack', width: 517, height: 368, hud: [0.036, 0.11], pad: [0.2, 0.141] },
  ] as const;
  const framed = ({ key, width, height, hud, pad }: (typeof views)[number]) => {
    const scenario = scenarioCatalog.get(key)!;
    const scene = freeViewSceneOf(scenario);
    const rect: SafeRect = { ...VIEW_SAFE_RECT, hud: { right: hud[0], bottom: hud[1] }, tools: { right: pad[0], top: pad[1] } };
    const min = (2 * MIN_ROBOT_PX) / width;
    const pose = freeViewPose(spanOf(key), scene, fov, width / height, rect, min);
    const open = freeViewPose(spanOf(key), scene, fov, width / height, { ...rect, tools: undefined }, min);
    const px = (shown: typeof pose) => (robotScreenWidth(shown, scene.start, fov, width / height) * width) / 2;
    return { scene, rect, pose, open, robotPx: px(pose), openPx: px(open) };
  };

  it('frames the robot at least MIN_ROBOT_PX wide, no farther than 1.5 × the view without the pad, at 1440 × 900 and 1366 × 768', () => {
    for (const view of views.filter(({ width }) => width !== 517)) {
      const { pose, open, robotPx } = framed(view);
      expect(robotPx).toBeGreaterThanOrEqual(MIN_ROBOT_PX);
      expect(distanceOf(pose)).toBeLessThanOrEqual(1.5 * distanceOf(open));
    }
  });

  it('shows the robot no wider than about the view without the pad does: a framing that would is made again in a smaller part of the free rectangle', () => {
    // rb-grip-sort at 1440: only the start's floor fits beside the pad with the robot 60 px wide, and framed alone it is 114 px; framed
    // again round the middle of the free part it is 70 px, as without the pad (66 px), the arena round it in view.
    for (const view of views.filter(({ width }) => width !== 517)) {
      const { robotPx, openPx } = framed(view);
      expect(robotPx).toBeLessThanOrEqual(1.1 * Math.max(openPx, MIN_ROBOT_PX));
    }
    expect(Number(framed(views[1]).robotPx.toFixed(1))).toBe(70.3);
    expect(Number(framed(views[1]).openPx.toFixed(1))).toBe(66.2);
  });

  it('keeps the robot, the floor round its start and the start zone in the free part of the view, out of the pad’s corner and the HUD’s', () => {
    for (const view of views) {
      const { scene, rect, pose } = framed(view);
      const aspect = view.width / view.height;
      const [x0, y0] = [scene.start.xCm, scene.start.yCm];
      const around = [-16, 16].flatMap((dx) => [-16, 16].map((dy): [number, number] => [x0 + dx, y0 + dy]));
      for (const [x, y] of [...around, ...scene.startZone!]) {
        const [sx, sy] = projectToScreen([x / 100, 0, -y / 100], pose, fov, aspect);
        // On the screen under the buttons and over the bottom strip, right of the pad's corner or over it (its edge counts as out of it),
        // and under the HUD where it is.
        expect([sx >= rect.left - 1e-6 && sx <= rect.right + 1e-6, sy >= rect.bottom - 1e-6 && sy <= safeTop(sx, rect) + 1e-6, sx >= rect.tools!.right - 1e-6 || sy >= rect.tools!.top - 1e-6]).toEqual([true, true, true]);
      }
    }
  });

  it('at 1280 × 720 shows the robot as wide as the free part right of the pad lets it with the start zone (and its tape) framed: 82, 50, 82, 64 px', () => {
    const shown = views.filter(({ width }) => width === 517).map((view) => [view.key, Number(framed(view).robotPx.toFixed(1))]);
    expect(shown).toEqual([
      ['rb-grip-pick', 81.9],
      ['rb-grip-deliver', 49.9],
      ['rb-grip-sort', 81.9],
      ['rb-grip-stack', 63.9],
    ]);
  });
});

describe('the free view beside a drive pad at every HUD height (N19 final fix, minor round m2)', () => {
  // The shrink that brings a robot shown wider than without the pad back to that width is linear in the box, the perspective is not: the
  // robot, nearest the camera, shrinks by more, and fell to 58.3 px (rb-grip-deliver at 613 × 397, the HUD's bottom at 0.19) and 52 px
  // (rb-drive-to-zone with a pad of 0.125 / 0.141, the HUD's bottom at 0.02), under MIN_ROBOT_PX. The shrunk framing is kept only when the
  // robot stays at least as wide as the fallback asks; else the framing before the shrink stands. The reviewer's sweep (final-fix review 1):
  // the HUD's bottom from −0.2 to 0.5 by 0.01, with the pad and the HUD's right edge G1 measured at each size.
  const sizes = [
    { width: 613, height: 397, hudRight: -0.126, pad: [0.044, 0.058] },
    { width: 569, height: 368, hudRight: -0.058, pad: [0.125, 0.141] },
    { width: 517, height: 368, hudRight: 0.036, pad: [0.2, 0.141] },
  ] as const;
  const robotPx = (key: string, width: number, height: number, hud: readonly [number, number], pad: readonly [number, number]) => {
    const scene = freeViewSceneOf(scenarioCatalog.get(key)!);
    const rect: SafeRect = { ...VIEW_SAFE_RECT, hud: { right: hud[0], bottom: hud[1] }, tools: { right: pad[0], top: pad[1] } };
    const pose = freeViewPose(spanOf(key), scene, fov, width / height, rect, (2 * MIN_ROBOT_PX) / width);
    return (robotScreenWidth(pose, scene.start, fov, width / height) * width) / 2;
  };

  it('never shows the robot under MIN_ROBOT_PX where a framing beside the pad can show it so wide: 71 HUD heights, four lessons, three sizes', () => {
    const under: string[] = [];
    for (const key of ['rb-grip-pick', 'rb-grip-deliver', 'rb-grip-sort', 'rb-grip-stack']) {
      for (const { width, height, hudRight, pad } of sizes) {
        // rb-grip-deliver at 517 × 368: no framing beside the pad shows the robot 60 px wide with its tape (50 px, the widest; pinned above).
        if (key === 'rb-grip-deliver' && width === 517) continue;
        for (let step = 0; step <= 70; step++) {
          const bottom = -0.2 + step * 0.01;
          const px = robotPx(key, width, height, [hudRight, bottom], pad);
          if (px < MIN_ROBOT_PX - 1e-6) under.push(`${key} ${width}x${height} hud ${bottom.toFixed(2)}: ${px.toFixed(1)} px`);
        }
      }
    }
    expect(under).toEqual([]);
  });

  it('keeps the robot 60 px wide where the shrink left it at 58.3 px (rb-grip-deliver, 613 × 397) and 52 px (rb-drive-to-zone, a pad it was not measured with)', () => {
    expect(robotPx('rb-grip-deliver', 613, 397, [-0.126, 0.19], [0.044, 0.058])).toBeGreaterThanOrEqual(MIN_ROBOT_PX);
    expect(robotPx('rb-drive-to-zone', 613, 397, [-0.058, 0.02], [0.125, 0.141])).toBeGreaterThanOrEqual(MIN_ROBOT_PX);
  });
});

describe('framePointsInBox (N19 final fix, G1 M1)', () => {
  const points: Vec3Tuple[] = [
    [0.2, 0, -0.3],
    [0.5, 0, -0.3],
    [0.2, 0, -0.6],
    [0.5, 0, -0.6],
    [0.35, 0.08, -0.45],
  ];
  const toCamera: Vec3Tuple = [-0.8 * Math.cos((34 * Math.PI) / 180), Math.sin((34 * Math.PI) / 180), -0.6 * Math.cos((34 * Math.PI) / 180)];
  const box: ScreenBox = { left: 0.2, right: 0.9, bottom: -0.8, top: 0.3 };

  it('shows every point in a box that does not hold the screen’s middle, from the direction asked, touching both edges of one axis', () => {
    const pose = framePointsInBox(points, toCamera, fov, aspect, box);
    const offset = [0, 1, 2].map((i) => pose.position[i]! - pose.target[i]!);
    const length = Math.hypot(...offset);
    offset.forEach((value, i) => expect(value / length).toBeCloseTo(toCamera[i]!, 12));
    const shown = points.map((point) => projectToScreen(point, pose, fov, aspect));
    for (const [x, y] of shown) {
      expect(x).toBeGreaterThanOrEqual(box.left - 1e-9);
      expect(x).toBeLessThanOrEqual(box.right + 1e-9);
      expect(y).toBeGreaterThanOrEqual(box.bottom - 1e-9);
      expect(y).toBeLessThanOrEqual(box.top + 1e-9);
    }
    const xs = shown.map(([x]) => x);
    const ys = shown.map(([, y]) => y);
    const tightX = Math.abs(Math.min(...xs) - box.left) < 1e-9 && Math.abs(Math.max(...xs) - box.right) < 1e-9;
    const tightY = Math.abs(Math.min(...ys) - box.bottom) < 1e-9 && Math.abs(Math.max(...ys) - box.top) < 1e-9;
    expect(tightX !== tightY).toBe(true);
    // Nearer would not fit: 1 % nearer along the line of sight, some point leaves the box.
    const nearer = { position: pose.position.map((value, i) => value - offset[i]! * 0.01) as unknown as Vec3Tuple, target: pose.target };
    expect(points.some((point) => !inside(projectToScreen(point, nearer, fov, aspect), { ...VIEW_SAFE_RECT, ...box, hud: { right: -1, bottom: 1 } }))).toBe(true);
  });

  it('looks at the point of its line of sight as far as the points’ middle', () => {
    const pose = framePointsInBox(points, toCamera, fov, aspect, box);
    const middle = [0, 1, 2].map((i) => points.reduce((sum, point) => sum + point[i]!, 0) / points.length);
    const forward = toCamera.map((value) => -value);
    const depth = (point: readonly number[]) => [0, 1, 2].reduce((sum, i) => sum + (point[i]! - pose.position[i]!) * forward[i]!, 0);
    expect(depth(pose.target)).toBeCloseTo(depth(middle), 12);
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
