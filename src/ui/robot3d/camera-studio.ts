import type { ArenaSpan, CameraPose } from './camera';
import { arenaToThree, type Vec3Tuple } from './scene-math';

// The 3D view's camera poses since N18 R4.7, which make the scene read as 3D: "Tự do" opens low (26° above the floor) behind and to the
// side of the robot's start, looking along its heading turned towards the arena's middle, so the robot is near and large and the arena
// recedes in front of it to its far walls, fitted into the part of the view the HUD (top left), the camera buttons (top right) and the
// bottom strip leave free (VIEW_SAFE_RECT, in normalised device coordinates). "Theo xe" rides low and close behind the robot and looks a
// little ahead of it. Plain numbers in three's frame (m, +Y up, arena y along −Z), tested exactly.

/** Where the view's controls do not cover the scene (NDC, −1..1): the HUD takes the top fifth, the bottom keeps the run's messages. */
export const VIEW_SAFE_RECT = { left: -0.93, right: 0.93, bottom: -0.84, top: 0.56 } as const;

const FREE_ELEVATION = (26 * Math.PI) / 180;
/** How far the free view turns from the robot's heading, towards the arena's middle: enough to see the robot's side. */
const FREE_TURN = (16 * Math.PI) / 180;
/** The chase: this far behind, this high, looking at a point this far ahead of the robot and this high. */
const CHASE_BACK_M = 0.34;
const CHASE_UP_M = 0.15;
const CHASE_AHEAD_M = 0.1;
const CHASE_LOOK_UP_M = 0.03;

type Axes = { forward: Vec3Tuple; right: Vec3Tuple; up: Vec3Tuple };

function axesOf(toCamera: Vec3Tuple): Axes {
  const forward: Vec3Tuple = [-toCamera[0], -toCamera[1], -toCamera[2]];
  const across = Math.hypot(forward[0], forward[2]) || 1;
  const right: Vec3Tuple = [-forward[2] / across, 0, forward[0] / across];
  const up: Vec3Tuple = [right[1] * forward[2] - right[2] * forward[1], right[2] * forward[0] - right[0] * forward[2], right[0] * forward[1] - right[1] * forward[0]];
  return { forward, right, up };
}

const dot = (a: Vec3Tuple, b: Vec3Tuple) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Where `point` falls on the screen of a camera at `pose` (NDC x, y; a field of `fovDeg` high, `aspect` wide). */
export function projectToScreen(point: Vec3Tuple, pose: CameraPose, fovDeg: number, aspect: number): [number, number] {
  const toCamera: Vec3Tuple = [pose.position[0] - pose.target[0], pose.position[1] - pose.target[1], pose.position[2] - pose.target[2]];
  const length = Math.hypot(...toCamera);
  const { forward, right, up } = axesOf([toCamera[0] / length, toCamera[1] / length, toCamera[2] / length]);
  const relative: Vec3Tuple = [point[0] - pose.position[0], point[1] - pose.position[1], point[2] - pose.position[2]];
  const depth = dot(relative, forward);
  const tanV = Math.tan((fovDeg * Math.PI) / 360);
  return [dot(relative, right) / depth / (tanV * aspect), dot(relative, up) / depth / tanV];
}

/**
 * The camera that sees every one of `points` from the unit direction `toCamera`, as close as it can while their projection fits in
 * `rect`: the distance by bisection on the projected extents, then the target slid along the screen so the extents sit in the rect's
 * middle, a few rounds (a slide changes the perspective a little).
 */
export function framePoints(points: readonly Vec3Tuple[], toCamera: Vec3Tuple, fovDeg: number, aspect: number, rect = VIEW_SAFE_RECT): CameraPose {
  const { right, up } = axesOf(toCamera);
  const tanV = Math.tan((fovDeg * Math.PI) / 360);
  const tanH = tanV * aspect;
  let target: Vec3Tuple = [0, 1, 2].map((i) => points.reduce((sum, p) => sum + p[i]!, 0) / points.length) as unknown as Vec3Tuple;
  const poseAt = (distance: number, at: Vec3Tuple): CameraPose => ({ position: [at[0] + toCamera[0] * distance, at[1] + toCamera[1] * distance, at[2] + toCamera[2] * distance], target: at });
  const extents = (pose: CameraPose) => {
    const projected = points.map((point) => projectToScreen(point, pose, fovDeg, aspect));
    const behind = points.some((point) => dot([point[0] - pose.position[0], point[1] - pose.position[1], point[2] - pose.position[2]], [-toCamera[0], -toCamera[1], -toCamera[2]]) <= 1e-6);
    const xs = projected.map(([x]) => x);
    const ys = projected.map(([, y]) => y);
    return { behind, minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
  };
  const fits = (distance: number, at: Vec3Tuple) => {
    const e = extents(poseAt(distance, at));
    return !e.behind && e.maxX - e.minX <= rect.right - rect.left && e.maxY - e.minY <= rect.top - rect.bottom;
  };
  let distance = 1;
  for (let round = 0; round < 8; round++) {
    let [near, far] = [0.01, 1];
    while (!fits(far, target)) far *= 2;
    for (let i = 0; i < 40; i++) {
      const middle = (near + far) / 2;
      if (fits(middle, target)) far = middle;
      else near = middle;
    }
    distance = far;
    const e = extents(poseAt(distance, target));
    const shiftX = ((e.minX + e.maxX) / 2 - (rect.left + rect.right) / 2) * tanH * distance;
    const shiftY = ((e.minY + e.maxY) / 2 - (rect.bottom + rect.top) / 2) * tanV * distance;
    target = [target[0] + right[0] * shiftX + up[0] * shiftY, target[1] + right[1] * shiftX + up[1] * shiftY, target[2] + right[2] * shiftX + up[2] * shiftY];
  }
  // A last bisection at the final target, so every point is inside the rect.
  let [near, far] = [0.01, distance * 1.5];
  while (!fits(far, target)) far *= 1.5;
  for (let i = 0; i < 40; i++) {
    const middle = (near + far) / 2;
    if (fits(middle, target)) far = middle;
    else near = middle;
  }
  const pose = poseAt(far, target);
  const e = extents(pose);
  // Any remaining overhang of an edge (the slide's last round) is taken up by sliding once more at the final distance.
  const dx = Math.max(0, rect.left - e.minX) - Math.max(0, e.maxX - rect.right);
  const dy = Math.max(0, rect.bottom - e.minY) - Math.max(0, e.maxY - rect.top);
  if (dx !== 0 || dy !== 0) {
    const slide: Vec3Tuple = [-(right[0] * dx * tanH + up[0] * dy * tanV) * far, -(right[1] * dx * tanH + up[1] * dy * tanV) * far, -(right[2] * dx * tanH + up[2] * dy * tanV) * far];
    return { position: [pose.position[0] + slide[0], pose.position[1] + slide[1], pose.position[2] + slide[2]], target: [target[0] + slide[0], target[1] + slide[1], target[2] + slide[2]] };
  }
  return pose;
}

/** The free view's horizontal forward direction (three's x, z, unit): the start's heading turned towards the arena's middle. */
export function freeViewForward(span: ArenaSpan, start: { xCm: number; yCm: number; yawDeg: number }): [number, number] {
  const heading = (start.yawDeg * Math.PI) / 180;
  const toMiddle = Math.atan2(span.depthM * 50 - start.yCm, span.widthM * 50 - start.xCm);
  const towards = Math.atan2(Math.sin(toMiddle - heading), Math.cos(toMiddle - heading));
  const yaw = heading + (towards >= 0 ? FREE_TURN : -FREE_TURN);
  // Arena (cos, sin) → three (x, −z).
  return [Math.cos(yaw), -Math.sin(yaw)];
}

/** How much of the floor round the robot's start the free view keeps in sight (m, each way). */
const START_MARGIN_M = 0.16;

/**
 * "Tự do": low behind the robot's start and to its side. What it frames: the floor round the start (the robot large near the bottom
 * of the view) and the two corners of the arena farthest along the view, so the arena recedes from the robot to its far walls; the
 * near corners may fall out of the view (orbit and zoom reach them).
 */
export function freeViewPose(span: ArenaSpan, start: { xCm: number; yCm: number; yawDeg: number }, fovDeg: number, aspect: number): CameraPose {
  const [fx, fz] = freeViewForward(span, start);
  const toCamera: Vec3Tuple = [-fx * Math.cos(FREE_ELEVATION), Math.sin(FREE_ELEVATION), -fz * Math.cos(FREE_ELEVATION)];
  const origin = arenaToThree(start.xCm, start.yCm, 0);
  const corners: Vec3Tuple[] = [];
  for (const x of [0, span.widthM * 100]) for (const y of [0, span.depthM * 100]) corners.push(arenaToThree(x, y, 0));
  const far = corners.map((corner) => ({ corner, along: (corner[0] - origin[0]) * fx + (corner[2] - origin[2]) * fz })).sort((a, b) => b.along - a.along).slice(0, 2).map(({ corner }) => corner);
  const around: Vec3Tuple[] = [];
  for (const dx of [-1, 1]) for (const dz of [-1, 1]) around.push([origin[0] + dx * START_MARGIN_M, 0, origin[2] + dz * START_MARGIN_M]);
  around.push([origin[0], 0.08, origin[2]]);
  return framePoints([...far, ...around], toCamera, fovDeg, aspect);
}

/** "Theo xe": low and close behind the robot at `robot` (three's frame) facing `yawRad` (arena yaw), looking a little ahead of it. */
export function chaseViewPose(robot: Vec3Tuple, yawRad: number): CameraPose {
  const [cx, cz] = [Math.cos(yawRad), -Math.sin(yawRad)];
  return {
    position: [robot[0] - cx * CHASE_BACK_M, robot[1] + CHASE_UP_M, robot[2] - cz * CHASE_BACK_M],
    target: [robot[0] + cx * CHASE_AHEAD_M, robot[1] + CHASE_LOOK_UP_M, robot[2] + cz * CHASE_AHEAD_M],
  };
}
