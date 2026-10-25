import type { Arena } from '../../core/world/arena/arena-schema';
import type { RobotSnapshot } from '../../core/world/snapshot';
import { CM_PER_M } from '../../core/world/units';
import type { RobotModel } from './robot-model';
import { dynamicBodyIds, sameView, type Vec3Tuple } from './scene-math';

// The arithmetic of the robot lab's 2D top view (N18 R4.6). The view draws in the arena's own units: its stage shows the arena with x to
// the right and y up the screen, in centimetres (TopView2D flips the stage's y once, so nothing else has to), a yaw is counter-clockwise on
// the screen, and the robot's parts sit at their kit mounts (x forward, y left). Nothing here imports Konva: plain numbers, tested exactly.

export type StageSize = { width: number; height: number };
export type StageMargins = { left: number; right: number; top: number; bottom: number };

/** Where the arena sits on the stage: `scale` px a cm, and the stage point of the arena's origin (its lower left corner). */
export type TopViewFit = { scale: number; originX: number; originY: number };

/** The least scale: a stage with no room left by its margins still gets a view that draws without error. */
const MIN_SCALE = 0.05;

/** The arena at the largest scale that fits `stage` inside `margins`, centred in the room that is left. */
export function fitTopView(arenaCm: readonly [number, number], stage: StageSize, margins: StageMargins): TopViewFit {
  const [widthCm, depthCm] = arenaCm;
  const roomWidth = stage.width - margins.left - margins.right;
  const roomHeight = stage.height - margins.top - margins.bottom;
  const scale = Math.max(MIN_SCALE, Math.min(roomWidth / widthCm, roomHeight / depthCm));
  return {
    scale,
    originX: margins.left + (roomWidth - widthCm * scale) / 2,
    // The stage's y grows down, the arena's up: the arena's y = 0 edge is its lower one.
    originY: margins.top + (roomHeight - depthCm * scale) / 2 + depthCm * scale,
  };
}

/** The scale bar: it is 10 cm long, `lengthPx` on a stage at `scale` px a cm. */
export function scaleBar(scale: number): { cm: number; lengthPx: number } {
  const cm = 10;
  return { cm, lengthPx: cm * scale };
}

/** A part of the robot at its three.js position (the model's, m: x forward, y up, z right) as [x forward, y left] in the robot frame, cm. */
export function robotPartCm(position: Vec3Tuple): readonly [number, number] {
  return [position[0] * CM_PER_M, 0 - position[2] * CM_PER_M];
}

/** The place of a wheel's turn among the snapshot's `wheelRad` ([left, right]): the right side is the wheel facing +Z. */
export function wheelRadIndex(wheel: Pick<RobotModel['wheels'][number], 'outward'>): 0 | 1 {
  return wheel.outward === 1 ? 1 : 0;
}

/** Where a mark on a wheel's rim shows along the wheel's length, seen from above, after it rolled `wheelRad` forward from the top. */
export function treadOffsetCm(radiusCm: number, wheelRad: number): number {
  return radiusCm * Math.sin(wheelRad);
}

/** A ray with no echo is drawn this far (cm): a short, faint dash that says "listening, nothing there", not a line across the arena. */
export const NO_ECHO_RAY_CM = 40;

/** How far an ultrasonic ray is drawn: to its echo, or, with none (the reading is then its 400 cm range), `NO_ECHO_RAY_CM`. */
export function rayLengthCm(readingCm: number, echo: boolean): number {
  return echo ? readingCm : Math.min(readingCm, NO_ECHO_RAY_CM);
}

/** What a moving body of the arena looks like from above, in the order of a snapshot's `objects`; `colorKey` names its colour. */
export type MovingBody = { id: string } & (
  | { shape: 'box'; widthCm: number; depthCm: number; colorKey: 'box' | 'object' }
  | { shape: 'cylinder'; radiusCm: number; colorKey: 'cylinder' | 'object' }
);

/** The arena's moving bodies: its dynamic boxes, its dynamic cylinders, then the objects to push (the snapshot's order, scene-math.ts). */
export function movingBodies(arena: Pick<Arena, 'boxes' | 'cylinders' | 'objects'>): MovingBody[] {
  const ids = dynamicBodyIds(arena);
  const shapes: Omit<MovingBody, 'id'>[] = [
    ...arena.boxes.filter((box) => box.body === 'dynamic').map((box) => ({ shape: 'box' as const, widthCm: box.sizeCm[0], depthCm: box.sizeCm[1], colorKey: 'box' as const })),
    ...arena.cylinders.filter((cylinder) => cylinder.body === 'dynamic').map((cylinder) => ({ shape: 'cylinder' as const, radiusCm: cylinder.radiusCm, colorKey: 'cylinder' as const })),
    ...arena.objects.map((object) =>
      object.shape === 'box'
        ? { shape: 'box' as const, widthCm: object.sizeCm[0], depthCm: object.sizeCm[1], colorKey: 'object' as const }
        : { shape: 'cylinder' as const, radiusCm: object.radiusCm, colorKey: 'object' as const },
    ),
  ];
  return shapes.map((shape, i) => ({ ...shape, id: ids[i]! }) as MovingBody);
}

/** An ultrasonic reading changes the picture from this much (cm): below it the ray is the same length to the eye, even close up. */
const SAME_RAY_CM = 0.05;

/**
 * Whether two worlds draw the same top view: the 3D view's picture (`sameView`) and the ultrasonic rays. The map asks for a draw only
 * when this says no, so a robot at rest, or a snapshot that only moves the time and the score, draws nothing.
 */
export function sameTopView(a: RobotSnapshot | null, b: RobotSnapshot | null): boolean {
  if (!sameView(a, b)) return false;
  if (a === b || a === null || b === null) return true;
  for (let i = 0; i < a.sensors.length; i++) {
    const [sa, sb] = [a.sensors[i]!, b.sensors[i]!];
    if (sa.kind === 'ultrasonic' && (sb.kind !== 'ultrasonic' || !(Math.abs(sa.cm - sb.cm) < SAME_RAY_CM) || sa.hitId !== sb.hitId)) return false;
  }
  return true;
}
