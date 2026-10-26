import type { Kit, ModuleSpecs } from '../../core/hardware/kit';
import { normalizeYawDeg, type PlacementPose } from '../../core/scenario/placement';
import type { DriveDirection } from '../../core/hardware/drivers';

// The arithmetic of the robot lab's view tools (N18 R4.8), shared by the 3D view (FloorPicker) and the 2D map (TopViewTools): both turn
// the pointer into a point of the arena (cm, x right, y away, yaw counter-clockwise) and hand it here. The ruler ("Thước đo") snaps a point
// near the robot's middle or its sensor bar to it and reads the distance and the angle of the segment to the robot's heading; the move tool
// ("Di chuyển robot") grabs the robot by a press on it and keeps the grabbed point under the pointer; teleop ("Lái tay") takes the arrows,
// W A S D and Space, never a key typed into a field or the block editor. N19 E3: on the gripper car Q and E open and close the claw and R and F
// raise and lower the arm (`gripperKeyOf`). Plain numbers, tested exactly.

export type ArenaPoint = { readonly xCm: number; readonly yCm: number };

/** A ruler point this close to the robot's middle or its sensor bar (cm) snaps to it. */
export const SNAP_CM = 4;

/** Q and E turn the robot by this much (degrees). */
export const TURN_STEP_DEG = 15;

/** A press this far outside the robot's outline (cm) still grabs it: a finger is not a pixel. */
export const GRAB_MARGIN_CM = 1.5;

/** What a ruler point can snap to. */
export type SnapKind = 'robot' | 'sensors';

/** The middle of the kit's line sensors in the robot frame (cm, x forward, y left): its sensor bar; null without line sensors. */
export function sensorBarCm(kit: Kit): readonly [number, number] | null {
  const sensors = kit.modules.filter((module) => module.kind === 'line-sensor');
  if (sensors.length === 0) return null;
  const x = sensors.reduce((sum, module) => sum + module.mount.posCm[0], 0) / sensors.length;
  const y = sensors.reduce((sum, module) => sum + module.mount.posCm[1], 0) / sensors.length;
  return [x, y + 0];
}

/** A point of the robot frame (cm) on the arena, with the robot at `pose`. */
export function robotToArena(pose: PlacementPose, [x, y]: readonly [number, number]): ArenaPoint {
  const yaw = (pose.yawDeg * Math.PI) / 180;
  const [c, s] = [Math.cos(yaw), Math.sin(yaw)];
  return { xCm: pose.xCm + x * c - y * s, yCm: pose.yCm + x * s + y * c };
}

/** What the ruler snaps to with the robot at `pose`: its middle, then its sensor bar when it has one. */
export function rulerTargets(pose: PlacementPose, bar: readonly [number, number] | null): { kind: SnapKind; point: ArenaPoint }[] {
  const targets: { kind: SnapKind; point: ArenaPoint }[] = [{ kind: 'robot', point: { xCm: pose.xCm, yCm: pose.yCm } }];
  if (bar !== null) targets.push({ kind: 'sensors', point: robotToArena(pose, bar) });
  return targets;
}

/** `point`, or the nearest of `targets` within `radiusCm` of it. */
export function snapPoint(point: ArenaPoint, targets: readonly { kind: SnapKind; point: ArenaPoint }[], radiusCm = SNAP_CM): { point: ArenaPoint; snap: SnapKind | null } {
  let best: { kind: SnapKind; point: ArenaPoint } | null = null;
  let bestCm = radiusCm;
  for (const target of targets) {
    const cm = Math.hypot(target.point.xCm - point.xCm, target.point.yCm - point.yCm);
    if (cm <= bestCm) {
      best = target;
      bestCm = cm;
    }
  }
  return best === null ? { point: { xCm: point.xCm, yCm: point.yCm }, snap: null } : { point: { ...best.point }, snap: best.kind };
}

/**
 * What the ruler reads from `a` to `b`: the distance (cm) and the angle of the segment to the robot's heading `headingDeg`, in
 * (-180°, 180°], positive to the left (counter-clockwise, the way a spinLeft turns the robot). A segment of no length reads 0°.
 */
export function measure(a: ArenaPoint, b: ArenaPoint, headingDeg: number): { distanceCm: number; angleDeg: number } {
  const dx = b.xCm - a.xCm;
  const dy = b.yCm - a.yCm;
  const distanceCm = Math.hypot(dx, dy);
  if (distanceCm === 0) return { distanceCm: 0, angleDeg: 0 };
  return { distanceCm, angleDeg: normalizeYawDeg((Math.atan2(dy, dx) * 180) / Math.PI - headingDeg) };
}

/** Whether `point` is on the robot at `pose`: inside the box around its outline (robot frame, cm), grown by `marginCm`. */
export function onRobot(point: ArenaPoint, pose: PlacementPose, outline: readonly (readonly [number, number])[], marginCm = GRAB_MARGIN_CM): boolean {
  const yaw = (pose.yawDeg * Math.PI) / 180;
  const [c, s] = [Math.cos(yaw), Math.sin(yaw)];
  const dx = point.xCm - pose.xCm;
  const dy = point.yCm - pose.yCm;
  // The point in the robot frame: turned back by the yaw.
  const x = dx * c + dy * s;
  const y = -dx * s + dy * c;
  const xs = outline.map((p) => p[0]);
  const ys = outline.map((p) => p[1]);
  return x >= Math.min(...xs) - marginCm && x <= Math.max(...xs) + marginCm && y >= Math.min(...ys) - marginCm && y <= Math.max(...ys) + marginCm;
}

/** The robot dragged from `pose`, grabbed at `grabbed`, to the pointer at `point`: the grabbed point stays under it, the heading stays. */
export function dragPose(pose: PlacementPose, grabbed: ArenaPoint, point: ArenaPoint): PlacementPose {
  return { xCm: pose.xCm + point.xCm - grabbed.xCm, yCm: pose.yCm + point.yCm - grabbed.yCm, yawDeg: pose.yawDeg };
}

/** By the key's place (`code`: any layout, any input method), else by its text. */
const driveCodes: Readonly<Record<string, DriveDirection | 'stop'>> = {
  ArrowUp: 'forward',
  KeyW: 'forward',
  ArrowDown: 'backward',
  KeyS: 'backward',
  ArrowLeft: 'spinLeft',
  KeyA: 'spinLeft',
  ArrowRight: 'spinRight',
  KeyD: 'spinRight',
  Space: 'stop',
};
const driveKeys: Readonly<Record<string, DriveDirection | 'stop'>> = {
  ArrowUp: 'forward',
  w: 'forward',
  ArrowDown: 'backward',
  s: 'backward',
  ArrowLeft: 'spinLeft',
  a: 'spinLeft',
  ArrowRight: 'spinRight',
  d: 'spinRight',
  ' ': 'stop',
  Spacebar: 'stop',
};

/** What a key does in teleop: a direction held, a stop (Space), or nothing. */
export function driveKeyOf(event: { readonly key: string; readonly code?: string }): DriveDirection | 'stop' | null {
  if (event.code !== undefined && event.code !== '' && Object.hasOwn(driveCodes, event.code)) return driveCodes[event.code]!;
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  return Object.hasOwn(driveKeys, key) ? driveKeys[key]! : null;
}

/** N19 E3: R and F move the gripper's arm this much (degrees), and a held key repeats the step. */
export const LIFT_STEP_DEG = 15;

/**
 * N19 E3: a held R, F or arm button steps once at once, then after `GRIPPER_REPEAT_DELAY_MS` every `GRIPPER_REPEAT_INTERVAL_MS`: 10 steps a
 * second, however fast the operating system repeats a held key (the arm's servo does 600° a second: 15° a step is a quarter of its reach in
 * the time of one). The keys and the buttons share it (`createRepeater`).
 */
export const GRIPPER_REPEAT_DELAY_MS = 400;
export const GRIPPER_REPEAT_INTERVAL_MS = 100;

/** The repeats of a held step: `start` schedules them (the first step is the caller's, made at once), `stop` ends them; `stop` is safe at any time. */
export type Repeater = { start(): void; stop(): void };

export function createRepeater(step: () => void): Repeater {
  let delay: ReturnType<typeof setTimeout> | null = null;
  let interval: ReturnType<typeof setInterval> | null = null;
  const stop = () => {
    if (delay !== null) clearTimeout(delay);
    if (interval !== null) clearInterval(interval);
    delay = null;
    interval = null;
  };
  return {
    start() {
      stop();
      delay = setTimeout(() => {
        step();
        interval = setInterval(step, GRIPPER_REPEAT_INTERVAL_MS);
      }, GRIPPER_REPEAT_DELAY_MS);
    },
    stop,
  };
}

/** What a gripper key asks for: the claw open or closed, or the lift moved a step (positive: up). */
export type GripperAction = { readonly part: 'claw'; readonly to: 'open' | 'close' } | { readonly part: 'lift'; readonly stepDeg: number };

/**
 * N19 E3: what a key does to the gripper, by the key's place (`code`: any layout, any input method), else nothing. Q opens the claw, E closes
 * it, R raises the arm a step and F lowers it. Not a letter's text: the keys of the drive (arrows, W A S D, Space) and of the camera (1 2 3 0
 * Home + − and Shift with the arrows) are left alone, and so are the move tool's Q and E (which the view reads only when that tool is on).
 */
export function gripperKeyOf(event: { readonly code?: string }): GripperAction | null {
  switch (event.code) {
    case 'KeyQ':
      return { part: 'claw', to: 'open' };
    case 'KeyE':
      return { part: 'claw', to: 'close' };
    case 'KeyR':
      return { part: 'lift', stepDeg: LIFT_STEP_DEG };
    case 'KeyF':
      return { part: 'lift', stepDeg: -LIFT_STEP_DEG };
    default:
      return null;
  }
}

/** The claw's two angles on `kit`: open at 0°, closed where the jaws meet (the spec's `jawsMeetDeg`); null for a kit without a gripper. */
export function gripperLimits(kit: Kit): { readonly clawOpenDeg: number; readonly clawClosedDeg: number } | null {
  const gripper = kit.modules.find((module) => module.kind === 'gripper');
  return gripper === undefined ? null : { clawOpenDeg: 0, clawClosedDeg: (gripper.spec as ModuleSpecs['gripper']).jawsMeetDeg };
}

/** Where the learner types: a form field, editable text, or the block editor (its workspace and its field editors). */
const typingSelector = 'input, textarea, select, [contenteditable=""], [contenteditable="true"], .injectionDiv, .blocklyWidgetDiv, .blocklyDropDownDiv';

/** The keys a slider (`<input type=range>`) moves with: its own. */
const sliderKeys = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown']);

/**
 * Whether `key` from `target` was typed somewhere (a field, the blocks): the view's keys never take it. A slider (the teleop speed) takes
 * only the keys that move it (N18 R4.8 fix round 1): W A S D and Space drive and stop from it. Without `key`, any field is one.
 */
export function isTypingTarget(target: EventTarget | null, key?: string): boolean {
  if (typeof Element === 'undefined' || !(target instanceof Element)) return false;
  const field = target.closest(typingSelector);
  if (field === null) return false;
  if (key !== undefined && field instanceof HTMLInputElement && field.type === 'range') return sliderKeys.has(key);
  return true;
}
