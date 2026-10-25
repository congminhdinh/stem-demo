import type { ArenaSpan, CameraPose } from './camera';
import { arenaToThree, type Vec3Tuple } from './scene-math';

// The 3D view's camera poses since N18 R4.7, which make the scene read as 3D: "Tự do" opens low (26° above the floor) behind and to the
// side of the robot's start, looking over it to the zones the lesson sends it to, so the robot is near and large and the arena recedes
// in front of it to its far walls, fitted into the part of the view the HUD (top left), the camera buttons (top right) and the
// bottom strip leave free (VIEW_SAFE_RECT, in normalised device coordinates). "Theo xe" rides low and close behind the robot and looks a
// little ahead of it. Plain numbers in three's frame (m, +Y up, arena y along −Z), tested exactly.

/**
 * Where the view's controls do not cover the scene (NDC, −1..1): an L, the HUD's corner (top left, `hud`) cut out of the rectangle,
 * the camera buttons' strip kept clear along the top, the run's messages along the bottom.
 */
export type SafeRect = { left: number; right: number; bottom: number; top: number; hud: { right: number; bottom: number } };
export const VIEW_SAFE_RECT: SafeRect = { left: -0.93, right: 0.93, bottom: -0.84, top: 0.84, hud: { right: -0.08, bottom: 0.5 } };

/** The highest a point may be on the screen at `x` (NDC): under the HUD on its left, under the buttons elsewhere. */
export const safeTop = (x: number, rect: SafeRect = VIEW_SAFE_RECT) => (x <= rect.hud.right ? rect.hud.bottom : rect.top);

const FREE_ELEVATION = (26 * Math.PI) / 180;
/** How far the free view turns to the left of the line from the start to the goals: the robot shows its side and the goals sit right
 * of the middle, away from the HUD in the top left corner. */
const FREE_TURN = (14 * Math.PI) / 180;
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
 * The camera that sees every one of `points` from the unit direction `toCamera`, as close as it can while their projection fits in the
 * free part of the view (`rect`, an L): the distance by bisection, then the target slid along the screen to share out the room left on
 * each side, a few rounds (a slide changes the perspective a little); a last bisection at the final target.
 */
export function framePoints(points: readonly Vec3Tuple[], toCamera: Vec3Tuple, fovDeg: number, aspect: number, rect: SafeRect = VIEW_SAFE_RECT): CameraPose {
  const { right, up } = axesOf(toCamera);
  const tanV = Math.tan((fovDeg * Math.PI) / 360);
  const tanH = tanV * aspect;
  let target: Vec3Tuple = [0, 1, 2].map((i) => points.reduce((sum, p) => sum + p[i]!, 0) / points.length) as unknown as Vec3Tuple;
  const poseAt = (distance: number, at: Vec3Tuple): CameraPose => ({ position: [at[0] + toCamera[0] * distance, at[1] + toCamera[1] * distance, at[2] + toCamera[2] * distance], target: at });
  /** The room left on each side of the free area at `pose` (negative where a point is outside), or null when a point is behind. */
  const room = (pose: CameraPose) => {
    let [left, rightRoom, bottom, top] = [Infinity, Infinity, Infinity, Infinity];
    for (const point of points) {
      const relative: Vec3Tuple = [point[0] - pose.position[0], point[1] - pose.position[1], point[2] - pose.position[2]];
      if (dot(relative, [-toCamera[0], -toCamera[1], -toCamera[2]]) <= 1e-6) return null;
      const [x, y] = projectToScreen(point, pose, fovDeg, aspect);
      left = Math.min(left, x - rect.left);
      rightRoom = Math.min(rightRoom, rect.right - x);
      bottom = Math.min(bottom, y - rect.bottom);
      top = Math.min(top, safeTop(x, rect) - y);
    }
    return { left, right: rightRoom, bottom, top };
  };
  const fits = (distance: number, at: Vec3Tuple) => {
    const r = room(poseAt(distance, at));
    return r !== null && r.left >= 0 && r.right >= 0 && r.bottom >= 0 && r.top >= 0;
  };
  /** The least distance that fits, by bisection; grows the bracket until it fits. */
  const nearest = (at: Vec3Tuple, from: number) => {
    let [near, far] = [0.01, from];
    for (let i = 0; i < 40 && !fits(far, at); i++) far *= 1.5;
    for (let i = 0; i < 40; i++) {
      const middle = (near + far) / 2;
      if (fits(middle, at)) far = middle;
      else near = middle;
    }
    return far;
  };
  /** The slide that shares out the room each way, at `distance` (the extents measured as if nothing were cut off). */
  const slideTowardsMiddle = (distance: number, at: Vec3Tuple): Vec3Tuple => {
    const pose = poseAt(distance, at);
    const projected = points.map((point) => projectToScreen(point, pose, fovDeg, aspect));
    const roomX = [Math.min(...projected.map(([x]) => x - rect.left)), Math.min(...projected.map(([x]) => rect.right - x))];
    const roomY = [Math.min(...projected.map(([, y]) => y - rect.bottom)), Math.min(...projected.map(([x, y]) => safeTop(x, rect) - y))];
    const dx = ((roomX[0]! - roomX[1]!) / 2) * tanH * distance;
    const dy = ((roomY[0]! - roomY[1]!) / 2) * tanV * distance;
    return [at[0] + right[0] * dx + up[0] * dy, at[1] + right[1] * dx + up[1] * dy, at[2] + right[2] * dx + up[2] * dy];
  };
  let distance = nearest(target, 1);
  for (let round = 0; round < 10; round++) {
    target = slideTowardsMiddle(distance, target);
    distance = nearest(target, distance * 1.2);
  }
  return poseAt(distance, target);
}

/** The robot's start and the zones the lesson sends it to (targets, checkpoints): the free view looks from one over to the other. */
export type FreeViewScene = { start: { xCm: number; yCm: number; yawDeg: number }; goals: readonly (readonly (readonly [number, number])[])[] };

/**
 * The free view's horizontal forward direction (three's x, z, unit): from the robot's start towards the middle of the zones the lesson
 * sends it to (along its heading when there are none), turned a little to the left.
 */
export function freeViewForward(scene: FreeViewScene): [number, number] {
  const { start } = scene;
  const points = scene.goals.flat();
  const heading =
    points.length > 0
      ? Math.atan2(points.reduce((sum, [, y]) => sum + y, 0) / points.length - start.yCm, points.reduce((sum, [x]) => sum + x, 0) / points.length - start.xCm)
      : (start.yawDeg * Math.PI) / 180;
  const yaw = heading + FREE_TURN;
  // Arena (cos, sin) → three (x, −z).
  return [Math.cos(yaw), -Math.sin(yaw)];
}

/** How much of the floor round the robot's start the free view keeps in sight (m, each way). */
const START_MARGIN_M = 0.16;

/**
 * "Tự do": low behind the robot's start, looking over it to where the lesson sends it. What it frames: the floor round the start (the
 * robot large near the bottom of the view), every goal zone, and the two corners of the arena farthest along the view, so the arena
 * recedes from the robot to its far walls; the near corners may fall out of the view (orbit and zoom reach them).
 */
export function freeViewPose(span: ArenaSpan, scene: FreeViewScene, fovDeg: number, aspect: number, rect: SafeRect = VIEW_SAFE_RECT): CameraPose {
  const [fx, fz] = freeViewForward(scene);
  const toCamera: Vec3Tuple = [-fx * Math.cos(FREE_ELEVATION), Math.sin(FREE_ELEVATION), -fz * Math.cos(FREE_ELEVATION)];
  const origin = arenaToThree(scene.start.xCm, scene.start.yCm, 0);
  const corners: Vec3Tuple[] = [];
  for (const x of [0, span.widthM * 100]) for (const y of [0, span.depthM * 100]) corners.push(arenaToThree(x, y, 0));
  const far = corners.map((corner) => ({ corner, along: (corner[0] - origin[0]) * fx + (corner[2] - origin[2]) * fz })).sort((a, b) => b.along - a.along).slice(0, 2).map(({ corner }) => corner);
  const around: Vec3Tuple[] = [];
  for (const dx of [-1, 1]) for (const dz of [-1, 1]) around.push([origin[0] + dx * START_MARGIN_M, 0, origin[2] + dz * START_MARGIN_M]);
  around.push([origin[0], 0.08, origin[2]]);
  const goals = scene.goals.flat().map(([x, y]) => arenaToThree(x, y, 0));
  return framePoints([...far, ...around, ...goals], toCamera, fovDeg, aspect, rect);
}

/** "Theo xe": low and close behind the robot at `robot` (three's frame) facing `yawRad` (arena yaw), looking a little ahead of it. */
export function chaseViewPose(robot: Vec3Tuple, yawRad: number): CameraPose {
  const [cx, cz] = [Math.cos(yawRad), -Math.sin(yawRad)];
  return {
    position: [robot[0] - cx * CHASE_BACK_M, robot[1] + CHASE_UP_M, robot[2] - cz * CHASE_BACK_M],
    target: [robot[0] + cx * CHASE_AHEAD_M, robot[1] + CHASE_LOOK_UP_M, robot[2] + cz * CHASE_AHEAD_M],
  };
}

/** A wall as the camera sees it: its centre line on the floor (three's x, z, m), how high it stands, and half its thickness. */
export type SightWall = { from: readonly [number, number]; to: readonly [number, number]; top: number; half: number };

/** The scenario's walls for `clearSight`. */
export function sightWalls(walls: readonly { fromCm: readonly [number, number]; toCm: readonly [number, number]; heightCm: number; thicknessCm: number }[]): SightWall[] {
  return walls.map((wall) => ({ from: [wall.fromCm[0] / 100, 0 - wall.fromCm[1] / 100], to: [wall.toCm[0] / 100, 0 - wall.toCm[1] / 100], top: wall.heightCm / 100, half: wall.thicknessCm / 200 }));
}

/** Where (0..1 from a to b) the floor segment a→b crosses the wall's centre line widened by its half thickness, or null. */
function crossing(a: readonly [number, number], b: readonly [number, number], wall: SightWall): number | null {
  const [ax, az] = a;
  const [bx, bz] = b;
  const [cx, cz] = wall.from;
  const [dx, dz] = wall.to;
  const length = Math.hypot(dx - cx, dz - cz) || 1;
  // The wall's normal; the two sides of its thickness are lines `half` either way of the centre line.
  const [nx, nz] = [-(dz - cz) / length, (dx - cx) / length];
  let best: number | null = null;
  for (const side of [-1, 0, 1]) {
    const [ox, oz] = [cx + nx * side * wall.half, cz + nz * side * wall.half];
    const [ex, ez] = [dx - cx, dz - cz];
    const denominator = (bx - ax) * ez - (bz - az) * ex;
    if (Math.abs(denominator) < 1e-12) continue;
    const t = ((ox - ax) * ez - (oz - az) * ex) / denominator;
    const u = ((ox - ax) * (bz - az) - (oz - az) * (bx - ax)) / denominator;
    if (t > 0 && t < 1 && u >= -wall.half / length && u <= 1 + wall.half / length) best = best === null ? t : Math.min(best, t);
  }
  return best;
}

/**
 * The camera of `pose` raised, if it must be, so that its line of sight to the target passes over every wall between them (with
 * `margin` to spare): a chase camera behind a robot that drives along a wall looks over the wall instead of into it.
 */
export function clearSight(pose: CameraPose, walls: readonly SightWall[], margin = 0.02): CameraPose {
  const target: [number, number] = [pose.target[0], pose.target[2]];
  const camera: [number, number] = [pose.position[0], pose.position[2]];
  let height = pose.position[1];
  for (const wall of walls) {
    const t = crossing(target, camera, wall);
    if (t === null) continue;
    // The sight line's height where it crosses: target.y + (camera.y − target.y) · t ≥ top + margin.
    height = Math.max(height, pose.target[1] + (wall.top + margin - pose.target[1]) / t);
  }
  return height === pose.position[1] ? pose : { position: [pose.position[0], height, pose.position[2]], target: pose.target };
}
