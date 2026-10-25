import type { Kit, RobotPointCm } from '../../core/hardware/kit';
import type { Scenario } from '../../core/scenario/scenario';
import type { Arena, ArenaWall } from '../../core/world/arena/arena-schema';
import type { Pose, RobotSnapshot, SnapshotObject, SnapshotQuat } from '../../core/world/snapshot';
import { CM_PER_M, degToRad } from '../../core/world/units';

// The arithmetic of the robot lab's 3D view (N18 R4.2). The view draws what the physics simulates, so it uses the physics' frame
// (core/world/units.ts, snapshot.ts): the arena plane is the floor y = 0 with arena x along +X and arena y along −Z, heights along +Y,
// in metres. A pose of a snapshot is in the arena frame (cm, x right, y away, z up), so a position is (x, z, −y) / 100 and a quaternion
// (x, z, −y, w). The robot's own frame (kit mounts: x forward, y left, z up, cm) maps the same way, so a part drawn at its mount sits
// where the physics put it. Nothing here imports three: these are plain numbers, tested exactly, and the components copy them.

export type Vec3Tuple = readonly [number, number, number];
export type QuatTuple = readonly [number, number, number, number];

const m = (cm: number) => cm / CM_PER_M;

/** An arena point (cm; z up from the floor) as a three.js position (m; +Y up). `0 -` keeps a 0 at +0. */
export function arenaToThree(xCm: number, yCm: number, zCm: number): Vec3Tuple {
  return [m(xCm), m(zCm), 0 - m(yCm)];
}

/** N18 R4.8: a three.js position (m; +Y up) as an arena point (cm; z up from the floor): `arenaToThree` undone. */
export function threeToArena(x: number, y: number, z: number): Vec3Tuple {
  return [x * CM_PER_M, 0 - z * CM_PER_M, y * CM_PER_M];
}

/** A point of the robot frame (a kit mount, cm: x forward, y left, z up) in the robot group's three.js frame (m). */
export function robotPointToThree([x, y, z]: RobotPointCm): Vec3Tuple {
  return arenaToThree(x, y, z);
}

/** A quaternion of the arena frame (a snapshot's `rotation`) as three.js's. */
export function quatToThree(q: SnapshotQuat): QuatTuple {
  return [q.x, q.z, 0 - q.y, q.w];
}

/** The three.js quaternion of a turn by `yawDeg` counter-clockwise seen from above: a turn about +Y. */
export function yawQuat(yawDeg: number): QuatTuple {
  const half = degToRad(yawDeg) / 2;
  return [0, Math.sin(half), 0, Math.cos(half)];
}

type Settable3 = { set(x: number, y: number, z: number): unknown };
type Settable4 = { set(x: number, y: number, z: number, w: number): unknown };

/** Puts `target` at `pose`, writing into its own vectors: nothing is made, so a frame callback can call it on every frame. */
export function writePose(target: { position: Settable3; quaternion: Settable4 }, pose: Pose): void {
  target.position.set(m(pose.xCm), m(pose.zCm), 0 - m(pose.yCm));
  const q = pose.rotation;
  target.quaternion.set(q.x, q.z, 0 - q.y, q.w);
}

/** How far a wheel's mesh turns about its local Z for `wheelRad` of rolling forward (positive rolling forward is a turn about −Z). */
export const wheelSpin = (wheelRad: number): number => 0 - wheelRad;

/** The yaw (rad, about the robot's up axis) of a servo arm at `servoDeg`: angle 0 points along the mount's yaw, growing counter-clockwise. */
export const servoArmYawRad = (mountYawDeg: number, servoDeg: number): number => degToRad(mountYawDeg + servoDeg);

/** A box's centre, its size along three's X, Y, Z (m) and its turn about +Y. */
export type BoxPlacement = { position: Vec3Tuple; size: Vec3Tuple; yawRad: number };

/** A wall as the arena builds it: a box on its centre line from → to, square ends thicknessCm / 2 past both points. */
export function wallBox(wall: ArenaWall): BoxPlacement {
  const [x0, y0] = wall.fromCm;
  const [x1, y1] = wall.toCm;
  const length = Math.hypot(x1 - x0, y1 - y0) + wall.thicknessCm;
  return {
    position: arenaToThree((x0 + x1) / 2, (y0 + y1) / 2, wall.heightCm / 2),
    size: [m(length), m(wall.heightCm), m(wall.thicknessCm)],
    yawRad: Math.atan2(y1 - y0, x1 - x0),
  };
}

/** A box standing on the floor: `sizeCm` is [along x, along y, height] before its yaw turns it. */
export function boxBody(box: { centerCm: readonly [number, number]; sizeCm: readonly [number, number, number]; yawDeg: number }): BoxPlacement {
  const [x, y] = box.centerCm;
  const [sx, sy, height] = box.sizeCm;
  return { position: arenaToThree(x, y, height / 2), size: [m(sx), m(height), m(sy)], yawRad: degToRad(box.yawDeg) };
}

/** An upright cylinder standing on the floor. */
export function cylinderBody(cylinder: { centerCm: readonly [number, number]; radiusCm: number; heightCm: number }): { position: Vec3Tuple; radiusM: number; heightM: number } {
  const [x, y] = cylinder.centerCm;
  return { position: arenaToThree(x, y, cylinder.heightCm / 2), radiusM: m(cylinder.radiusCm), heightM: m(cylinder.heightCm) };
}

/**
 * The ids of the arena's moving bodies, in the order of a snapshot's `objects`: the dynamic boxes, the dynamic cylinders, then the objects
 * to push. An unnamed box or cylinder is called by its index in its list, as the arena builder names it (`#box-1`, `#cylinder-0`).
 */
export function dynamicBodyIds(arena: Pick<Arena, 'boxes' | 'cylinders' | 'objects'>): string[] {
  return [
    ...arena.boxes.flatMap((box, i) => (box.body === 'dynamic' ? [box.id ?? `#box-${i}`] : [])),
    ...arena.cylinders.flatMap((cylinder, i) => (cylinder.body === 'dynamic' ? [cylinder.id ?? `#cylinder-${i}`] : [])),
    ...arena.objects.map((object) => object.id),
  ];
}

/** The distance at which a camera with a vertical field of `fovDeg` and `aspect` (width / height) sees the whole arena's bounding sphere. */
export function fitCameraDistance(span: { widthM: number; depthM: number }, fovDeg: number, aspect: number): number {
  const radius = Math.hypot(span.widthM, span.depthM) / 2;
  const vertical = degToRad(fovDeg);
  const horizontal = 2 * Math.atan(Math.tan(vertical / 2) * aspect);
  return radius / Math.sin(Math.min(vertical, horizontal) / 2);
}

/** A pose of the arena frame on the floor plane, turned by `yawDeg` (a turn about the arena's z). */
function floorPose(xCm: number, yCm: number, zCm: number, yawDeg: number): Pose {
  const half = degToRad(yawDeg) / 2;
  return { xCm, yCm, zCm, yawDeg, rotation: { x: 0, y: 0, z: Math.sin(half), w: Math.cos(half) } };
}

/**
 * What the view shows before a run (and after Reset): the scenario's start, as a snapshot of t = 0 (variant 0 is the exact start). The
 * robot stands on the floor at the start pose with every servo at its rest angle and every LED off; the moving bodies stand where the
 * arena puts them. The physics settles both by about 0.1 mm before its own t = 0, which the eye does not see. Frozen, like a snapshot.
 */
export function idleSnapshot(scenario: Pick<Scenario, 'start' | 'arena'>, kit: Kit): RobotSnapshot {
  const { start, arena } = scenario;
  const servoDeg: Record<string, number> = {};
  const leds: Record<string, boolean> = {};
  for (const module of kit.modules) {
    if (module.kind === 'servo') servoDeg[module.role] = Number(module.spec.restDeg ?? 0);
    if (module.kind === 'led') leds[module.role] = false;
  }
  const objects: SnapshotObject[] = [];
  arena.boxes.forEach((box, i) => {
    if (box.body === 'dynamic') objects.push({ id: box.id ?? `#box-${i}`, kind: 'box', pose: floorPose(box.centerCm[0], box.centerCm[1], box.sizeCm[2] / 2, box.yawDeg) });
  });
  arena.cylinders.forEach((cylinder, i) => {
    if (cylinder.body === 'dynamic') objects.push({ id: cylinder.id ?? `#cylinder-${i}`, kind: 'cylinder', pose: floorPose(cylinder.centerCm[0], cylinder.centerCm[1], cylinder.heightCm / 2, 0) });
  });
  for (const object of arena.objects) {
    const height = object.shape === 'box' ? object.sizeCm[2] : object.heightCm;
    objects.push({ id: object.id, kind: 'object', pose: floorPose(object.centerCm[0], object.centerCm[1], height / 2, object.shape === 'box' ? object.yawDeg : 0) });
  }
  return deepFreeze({
    t: 0,
    robot: { ...floorPose(start.xCm, start.yCm, 0, start.yawDeg), wheelRad: [0, 0] as const, servoDeg },
    objects,
    sensors: [],
    pins: [],
    leds,
    activeBlockId: null,
    status: 'idle',
    outOfArena: false,
    score: { points: 0, maxScore: null, goals: [] },
  });
}

/**
 * Below these a change is not seen, even from close up (the follow view's 0.46 m, where a pixel is about 0.7 mm): 0.1 mm of a body,
 * 1e-5 of a quaternion (about 0.001°), 1 mrad of a wheel (0.03 mm at its rim), 0.05° of a servo arm (0.05 mm at the tip of 5.5 cm). A
 * robot at rest still jitters by less than these (measured over 1 s at rest, N18 R4.2 fix round 1: the servo arm by up to 3e-5° every
 * 0.1 s, which a threshold of 0.001° crossed about every second), so the view draws nothing for it; slow motion adds up against the
 * picture last drawn and is drawn once it can be seen.
 */
const SAME_CM = 0.01;
const SAME_QUAT = 1e-5;
const SAME_RAD = 1e-3;
const SAME_DEG = 0.05;

function samePose(a: Pose, b: Pose): boolean {
  return (
    Math.abs(a.xCm - b.xCm) < SAME_CM &&
    Math.abs(a.yCm - b.yCm) < SAME_CM &&
    Math.abs(a.zCm - b.zCm) < SAME_CM &&
    Math.abs(a.rotation.x - b.rotation.x) < SAME_QUAT &&
    Math.abs(a.rotation.y - b.rotation.y) < SAME_QUAT &&
    Math.abs(a.rotation.z - b.rotation.z) < SAME_QUAT &&
    Math.abs(a.rotation.w - b.rotation.w) < SAME_QUAT
  );
}

/**
 * Whether two worlds show the robot and the objects in the same place, to within a pixel (SAME_CM, SAME_QUAT, SAME_RAD, SAME_DEG): the
 * poses of the robot and the objects, the wheels and the servos. N18 P2: what casts the shadows (moved here from `sameView`, its first
 * half): the key light's shadow map is drawn again only when these change.
 */
export function sameCasters(a: RobotSnapshot | null, b: RobotSnapshot | null): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  const [ra, rb] = [a.robot, b.robot];
  if (!samePose(ra, rb) || Math.abs(ra.wheelRad[0] - rb.wheelRad[0]) >= SAME_RAD || Math.abs(ra.wheelRad[1] - rb.wheelRad[1]) >= SAME_RAD) return false;
  for (const role of Object.keys(ra.servoDeg)) {
    if (!(Math.abs((ra.servoDeg[role] ?? 0) - (rb.servoDeg[role] ?? 0)) < SAME_DEG)) return false;
  }
  return a.objects.length === b.objects.length && a.objects.every((object, i) => samePose(object.pose, b.objects[i]!.pose));
}

/**
 * Whether two worlds draw the same picture: the poses of the robot and the objects, the wheels, the servos, the LEDs, what each line
 * sensor sees and the board's pins (the buzzer's tone, the button's level). The time and the score are the HUD's, not the picture's.
 * The 3D view asks for a frame only when the picture changes, so a robot at rest costs no drawing.
 */
export function sameView(a: RobotSnapshot | null, b: RobotSnapshot | null): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (!sameCasters(a, b)) return false;
  for (const role of Object.keys(a.leds)) {
    if (a.leds[role] !== b.leds[role]) return false;
  }
  if (a.sensors.length !== b.sensors.length) return false;
  for (let i = 0; i < a.sensors.length; i++) {
    const [sa, sb] = [a.sensors[i]!, b.sensors[i]!];
    if (sa.kind === 'line-sensor' && (sb.kind !== 'line-sensor' || sa.dark !== sb.dark)) return false;
  }
  if (a.pins.length !== b.pins.length) return false;
  for (let i = 0; i < a.pins.length; i++) {
    if (a.pins[i]!.level !== b.pins[i]!.level || a.pins[i]!.toneHz !== b.pins[i]!.toneHz) return false;
  }
  return true;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const item of Object.values(value)) deepFreeze(item);
  }
  return value;
}
