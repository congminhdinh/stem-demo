import type { ArenaSpan, CameraPose } from './camera';
import { arenaToThree, type Vec3Tuple } from './scene-math';

// The 3D view's camera poses since N18 R4.7, which make the scene read as 3D: "Tự do" opens 34° above the floor behind and to the side
// of the robot's start, looking over it to the zones the lesson sends it to, so the robot is near and large and the arena recedes in
// front of it, fitted into the part of the view the HUD (top left), the camera buttons (top right), the view tools (bottom left, R4.8)
// and the bottom strip leave free (VIEW_SAFE_RECT, in normalised device coordinates), and never so far that the robot is a dot.
// "Theo xe" rides behind the robot and looks ahead of it, always inside the arena's walls. Plain numbers in three's frame (m, +Y up,
// arena y along −Z), tested exactly.

/**
 * Where the view's controls do not cover the scene (NDC, −1..1): the rectangle with the HUD's corner (top left, `hud`) cut out of it,
 * and the view tools' corner (bottom left, `tools`) when they are there; the camera buttons' strip kept clear along the top, the run's
 * messages along the bottom.
 */
export type SafeRect = { left: number; right: number; bottom: number; top: number; hud: { right: number; bottom: number }; tools?: { right: number; top: number } | undefined };
export const VIEW_SAFE_RECT: SafeRect = { left: -0.93, right: 0.93, bottom: -0.84, top: 0.84, hud: { right: -0.08, bottom: 0.5 } };

/** The highest a point may be on the screen at `x` (NDC): under the HUD on its left, under the buttons elsewhere. */
export const safeTop = (x: number, rect: SafeRect = VIEW_SAFE_RECT) => (x <= rect.hud.right ? rect.hud.bottom : rect.top);
/** The lowest a point may be on the screen at `x` (NDC): over the view tools on their left, over the bottom strip elsewhere. */
export const safeBottom = (x: number, rect: SafeRect = VIEW_SAFE_RECT) => (rect.tools && x <= rect.tools.right ? rect.tools.top : rect.bottom);

/** How high the free view looks down on the floor (N18 R4.7 review: 30–40°, so the zones' tags and the mat read). */
export const FREE_ELEVATION_DEG = 34;
const FREE_ELEVATION = (FREE_ELEVATION_DEG * Math.PI) / 180;
/** How far the free view turns to the left of the line from the start to the goals: the robot shows its side and the goals sit right
 * of the middle, away from the HUD in the top left corner. */
const FREE_TURN = (14 * Math.PI) / 180;
/** The chase: this far behind, this high, looking at a point this far ahead of the robot and this high. */
export const CHASE_BACK_M = 0.5;
export const CHASE_UP_M = 0.25;
export const CHASE_AHEAD_M = 0.25;
const CHASE_LOOK_UP_M = 0.03;
/** How high the zones' tags float over the mat (m, parts/ZoneTags.tsx): the free view frames their lines' tops too. */
export const ZONE_TAG_M = 0.13;
/** How low a tall HUD's corner may cut into what the free view frames before the robot would be too small (NDC). */
const RELAXED_HUD_BOTTOM = 0.45;
/** The room a zone's tag takes over its line's top, as the free view frames it (m). */
const TAG_ROOM_M = { up: 0.09, across: 0.12 };
/** The chase camera stays this far inside every wall's face (m). */
export const CHASE_INSIDE_M = 0.03;

type Axes = { forward: Vec3Tuple; right: Vec3Tuple; up: Vec3Tuple };

function axesOf(toCamera: Vec3Tuple): Axes {
  const forward: Vec3Tuple = [-toCamera[0], -toCamera[1], -toCamera[2]];
  const across = Math.hypot(forward[0], forward[2]) || 1;
  const right: Vec3Tuple = [-forward[2] / across, 0, forward[0] / across];
  const up: Vec3Tuple = [right[1] * forward[2] - right[2] * forward[1], right[2] * forward[0] - right[0] * forward[2], right[0] * forward[1] - right[1] * forward[0]];
  return { forward, right, up };
}

const dot = (a: Vec3Tuple, b: Vec3Tuple) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (v: Vec3Tuple): Vec3Tuple => {
  const length = Math.hypot(...v) || 1;
  return [v[0] / length, v[1] / length, v[2] / length];
};

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
      bottom = Math.min(bottom, y - safeBottom(x, rect));
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
    const roomY = [Math.min(...projected.map(([x, y]) => y - safeBottom(x, rect))), Math.min(...projected.map(([x, y]) => safeTop(x, rect) - y))];
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

/**
 * What the free view frames: the robot's start, the zones the lesson sends it to (targets, checkpoints), the start zone and the route
 * of its tape (each optional), in arena cm.
 */
export type FreeViewScene = {
  start: { xCm: number; yCm: number; yawDeg: number };
  goals: readonly (readonly (readonly [number, number])[])[];
  startZone?: readonly (readonly [number, number])[] | undefined;
  route?: readonly (readonly [number, number])[] | undefined;
};

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
/** The span across the robot whose size on the screen `robotScreenWidth` measures (m): about its width with the wheels. */
export const ROBOT_SPAN_M = 0.16;

/** How wide (NDC) the robot at its start shows from `pose`: a `ROBOT_SPAN_M` span across the view, 4 cm over the floor. */
export function robotScreenWidth(pose: CameraPose, start: FreeViewScene['start'], fovDeg: number, aspect: number): number {
  const origin = arenaToThree(start.xCm, start.yCm, 4);
  const { right } = axesOf(unit([pose.position[0] - pose.target[0], pose.position[1] - pose.target[1], pose.position[2] - pose.target[2]]));
  const half = ROBOT_SPAN_M / 2;
  const [a] = projectToScreen([origin[0] - right[0] * half, origin[1], origin[2] - right[2] * half], pose, fovDeg, aspect);
  const [b] = projectToScreen([origin[0] + right[0] * half, origin[1], origin[2] + right[2] * half], pose, fovDeg, aspect);
  return Math.abs(b - a);
}

/**
 * "Tự do": 34° up behind the robot's start, looking over it to where the lesson sends it. What it frames, in the part of the view the
 * controls leave (`rect`): the floor round the start (the robot large near the bottom of the view), the start zone, every goal zone,
 * the tape's route, the zones' tags, and the two corners of the arena farthest along the view, so the arena recedes from the robot to
 * its far walls. When that leaves the robot narrower than `minRobot` (NDC; a small view, a tall HUD), the far corners are let go first,
 * then the tags' room (a tag may then reach under the HUD), then a tall HUD's lower part (the arena's far side may lie under it), then
 * the route, then the goals farthest from the start, one by one (orbit and zoom reach them); the start and its zone always stay.
 */
export function freeViewPose(span: ArenaSpan, scene: FreeViewScene, fovDeg: number, aspect: number, rect: SafeRect = VIEW_SAFE_RECT, minRobot = 0): CameraPose {
  const [fx, fz] = freeViewForward(scene);
  const toCamera: Vec3Tuple = [-fx * Math.cos(FREE_ELEVATION), Math.sin(FREE_ELEVATION), -fz * Math.cos(FREE_ELEVATION)];
  const origin = arenaToThree(scene.start.xCm, scene.start.yCm, 0);
  const corners: Vec3Tuple[] = [];
  for (const x of [0, span.widthM * 100]) for (const y of [0, span.depthM * 100]) corners.push(arenaToThree(x, y, 0));
  const far = corners.map((corner) => ({ corner, along: (corner[0] - origin[0]) * fx + (corner[2] - origin[2]) * fz })).sort((a, b) => b.along - a.along).slice(0, 2).map(({ corner }) => corner);
  const floor = ([x, y]: readonly [number, number]) => arenaToThree(x, y, 0);
  const around: Vec3Tuple[] = [];
  for (const dx of [-1, 1]) for (const dz of [-1, 1]) around.push([origin[0] + dx * START_MARGIN_M, 0, origin[2] + dz * START_MARGIN_M]);
  around.push([origin[0], 0.08, origin[2]]);
  const kept = [...around, ...(scene.startZone ?? []).map(floor)];
  const route = (scene.route ?? []).map(floor);
  // The goals, nearest to the start first, each with its tag over its middle: the room its pill takes over the line's top (about
  // TAG_ROOM_M up and either way across the view, at the distances the view frames from).
  const [rx, rz] = [-fz, fx];
  const tagRoom = (zone: readonly (readonly [number, number])[]): Vec3Tuple[] => {
    const xs = zone.map(([x]) => x);
    const ys = zone.map(([, y]) => y);
    const [cx, , cz] = arenaToThree((Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2, 0);
    const top = ZONE_TAG_M + TAG_ROOM_M.up;
    return [-1, 1].map((side): Vec3Tuple => [cx + rx * side * TAG_ROOM_M.across, top, cz + rz * side * TAG_ROOM_M.across]);
  };
  const goals = [...scene.goals]
    .map((zone) => ({ points: zone.map(floor), tags: tagRoom(zone), away: Math.min(...zone.map(([x, y]) => Math.hypot(x - scene.start.xCm, y - scene.start.yCm))) }))
    .sort((a, b) => a.away - b.away);
  const floors = goals.flatMap(({ points }) => points);
  const tags = goals.flatMap(({ tags: room }) => room);
  // What to frame, most first; each in the view's free part, then with a HUD that reaches low held back to RELAXED_HUD_BOTTOM (the
  // far part of the arena may then lie under the HUD, which the learner can fold).
  const relaxed: SafeRect = { ...rect, hud: { right: rect.hud.right, bottom: Math.max(rect.hud.bottom, RELAXED_HUD_BOTTOM) } };
  const choices: [Vec3Tuple[], SafeRect][] = [
    [[...far, ...kept, ...route, ...floors, ...tags], rect],
    [[...kept, ...route, ...floors, ...tags], rect],
    [[...kept, ...route, ...floors], rect],
    [[...kept, ...route, ...floors], relaxed],
    [[...kept, ...floors], relaxed],
  ];
  for (let count = goals.length - 1; count >= 0; count--) choices.push([[...kept, ...goals.slice(0, count).flatMap(({ points }) => points)], relaxed]);
  let pose: CameraPose | null = null;
  for (const [points, room] of choices) {
    pose = framePoints(points, toCamera, fovDeg, aspect, room);
    if (robotScreenWidth(pose, scene.start, fovDeg, aspect) >= minRobot) return pose;
  }
  return pose!;
}

/** "Theo xe": behind the robot at `robot` (three's frame) facing `yawRad` (arena yaw), looking ahead of it. */
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

/**
 * Where (0..1 from a to b) the floor segment a→b enters the wall's footprint widened by `reach` on every side (a rectangle round its
 * centre line, `half + reach` either way of it and `half + reach` past each end), or null when it does not. Liang–Barsky clipping in
 * the wall's own frame (u along it from `from`, v across).
 */
function entry(a: readonly [number, number], b: readonly [number, number], wall: SightWall, reach: number): number | null {
  const [cx, cz] = wall.from;
  const length = Math.hypot(wall.to[0] - cx, wall.to[1] - cz) || 1;
  const [ux, uz] = [(wall.to[0] - cx) / length, (wall.to[1] - cz) / length];
  const local = ([x, z]: readonly [number, number]) => [(x - cx) * ux + (z - cz) * uz, -(x - cx) * uz + (z - cz) * ux] as const;
  const [au, av] = local(a);
  const [bu, bv] = local(b);
  const grow = wall.half + reach;
  let [enter, exit] = [0, 1];
  for (const [p, q] of [
    [-(bu - au), au + grow],
    [bu - au, length + grow - au],
    [-(bv - av), av + grow],
    [bv - av, grow - av],
  ] as const) {
    if (Math.abs(p) < 1e-12) {
      if (q < 0) return null;
      continue;
    }
    const t = q / p;
    if (p < 0) enter = Math.max(enter, t);
    else exit = Math.min(exit, t);
    if (enter > exit) return null;
  }
  return enter < 1 ? enter : null;
}

/**
 * The chase camera of `pose` kept inside the arena: where the floor's line from the robot (`subject`, three's frame) to the camera
 * meets a wall, or comes within `inside` of its face, the camera is pulled in along that line to there, so no wall ever stands between
 * them and none fills the view; it rises to stay as far from the robot as it was (it looks down on it from above, closer in), and the
 * point it looks at comes back towards the robot as much as the camera came in, so the robot stays in the middle of the view.
 */
export function clearSight(pose: CameraPose, walls: readonly SightWall[], subject: Vec3Tuple = pose.target, inside = CHASE_INSIDE_M): CameraPose {
  const from: [number, number] = [subject[0], subject[2]];
  const camera: [number, number] = [pose.position[0], pose.position[2]];
  let share = 1;
  for (const wall of walls) {
    const t = entry(from, camera, wall, inside);
    if (t !== null) share = Math.min(share, t);
  }
  if (share === 1) return pose;
  const [x, z] = [from[0] + (camera[0] - from[0]) * share, from[1] + (camera[1] - from[1]) * share];
  const reach = Math.hypot(pose.position[0] - subject[0], pose.position[1] - subject[1], pose.position[2] - subject[2]);
  const across = Math.hypot(x - subject[0], z - subject[2]);
  const y = subject[1] + Math.max(pose.position[1] - subject[1], Math.sqrt(Math.max(0, reach * reach - across * across)));
  const back = (i: 0 | 1 | 2) => subject[i] + (pose.target[i] - subject[i]) * share;
  return { position: [x, y, z], target: [back(0), pose.target[1], back(2)] };
}
