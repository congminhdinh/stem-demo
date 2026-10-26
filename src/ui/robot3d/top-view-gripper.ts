import { createGripperPose, gripperPoseInto, type GripperState } from './gripper-pose';
import type { GripperModel } from './robot-model';
import type { MovingBody } from './top-view-math';
import { objectPattern, OBJECT_PATTERN_MARGIN_CM, patternDots, patternInk, patternSegments, type PatternSegment } from './zone-pattern';
import type { BodyMark } from './body-marks';

// The gripper car on the 2D map (N19 E4, Review Focus 5: a school PC without WebGL still sees the jaws and what they hold). In the robot's
// frame, as TopView2D draws its parts (cm, x forward, y left; a turn counter-clockwise), by the very geometry of the 3D view's pose
// (gripper-pose.ts, the world's: world/robot/gripper.ts, ADR 0004 §2): the boom from its pivot at the kit's mount, as long seen from above as
// its length times the cosine of its elevation (boomElevationAtLift0Deg + lift: −40° lowered, level at lift 40, the farthest reach, 50°
// raised); the level carriage at its tip; each finger at its hinge (u, ±v on the carriage), turned out by β (12° open, −23.6° at the jaws'
// meeting angle). The held object is drawn where the snapshot's `objects` say (the world moves it with the carriage), with a ring round it.
// An object of a palette colour gets its colour's mark (zone-pattern.ts `objectPattern`), like the foam cube's top face (E7). Plain
// numbers, tested exactly; nothing here imports Konva.

/** The carriage from above, half its size along u and v, cm: geometry the kit does not name (ADR 0004 §2; world/robot/gripper.ts). */
export const CARRIAGE_HALF_CM = { u: 0.5, v: 2.6 } as const;
/** The boom's side plates (0.4 cm across) and its cross bar (0.6 cm square), cm (ADR 0004 §2). */
export const BOOM_PLATE_CM = 0.4;
export const BOOM_BAR_CM = 0.6;

/** The gripper as the map draws it, in the robot's frame (cm, degrees counter-clockwise). */
export type GripperTopView = {
  /** The boom's pivot (the kit's mount), and how far ahead of it the carriage hangs seen from above. */
  pivotXCm: number;
  reachCm: number;
  /** The carriage's origin: the boom's tip. */
  tipXCm: number;
  /** The boom's middle across (the mount's y; 0 on ref-uno-gripper@0), and the fingers' hinges: at `hingeXCm`, `hingeYCm` left (the left finger) and right of it. */
  midYCm: number;
  hingeXCm: number;
  hingeYCm: number;
  /** Each finger's turn: the left one opens counter-clockwise (+β), the right one clockwise (−β). */
  leftDeg: number;
  rightDeg: number;
};

/** A view to write into, made once (the map writes it on every drawn change). */
export const createGripperTopView = (): GripperTopView => ({ pivotXCm: 0, reachCm: 0, tipXCm: 0, midYCm: 0, hingeXCm: 0, hingeYCm: 0, leftDeg: 0, rightDeg: 0 });

const scratch = createGripperPose();
const CM_PER_M = 100;

/** The gripper from above at `state`, written into `out`: gripper-pose.ts's pose in the robot's frame (three's x is forward, its −z left). */
export function gripperTopViewInto(out: GripperTopView, gripper: GripperModel, state: Pick<GripperState, 'clawDeg' | 'liftDeg'>): GripperTopView {
  const pose = gripperPoseInto(scratch, gripper, state);
  out.pivotXCm = gripper.position[0] * CM_PER_M;
  out.tipXCm = pose.tip[0] * CM_PER_M;
  out.reachCm = out.tipXCm - out.pivotXCm;
  out.midYCm = 0 - gripper.position[2] * CM_PER_M;
  out.hingeXCm = pose.jawLeft[0] * CM_PER_M;
  out.hingeYCm = gripper.hinge.vM * CM_PER_M;
  const betaDeg = (pose.betaRad * 180) / Math.PI;
  out.leftDeg = betaDeg;
  out.rightDeg = 0 - betaDeg;
  return out;
}

/**
 * The four corners of a finger from above (robot frame, cm), `side` 1 the left one and −1 the right one: the finger's box, `fingerLength`
 * long and `fingerThickness` across, from its hinge (the box straddles the hinge's line, as the world's collider does), turned by its β.
 * In order: the hinge's left edge, its right edge, the tip's right edge, the tip's left edge.
 */
export function jawCornersCm(view: GripperTopView, gripper: GripperModel, side: 1 | -1): [number, number][] {
  const length = gripper.finger.lengthM * CM_PER_M;
  const half = (gripper.finger.thicknessM * CM_PER_M) / 2;
  const angle = ((side === 1 ? view.leftDeg : view.rightDeg) * Math.PI) / 180;
  const [c, s] = [Math.cos(angle), Math.sin(angle)];
  const hingeY = view.midYCm + side * view.hingeYCm;
  return ([
    [0, half],
    [0, -half],
    [length, -half],
    [length, half],
  ] as const).map(([u, v]): [number, number] => [view.hingeXCm + u * c - v * s, hingeY + u * s + v * c]);
}

/** How far the ring round the held object stands clear of its corners, cm. */
export const HELD_RING_GAP_CM = 0.8;

/** The radius of the ring round a held body, cm: past its corners from above (a box's half diagonal, a cylinder's radius) by HELD_RING_GAP_CM. */
export function heldRingRadiusCm(body: MovingBody): number {
  return (body.shape === 'box' ? Math.hypot(body.widthCm, body.depthCm) / 2 : body.radiusCm) + HELD_RING_GAP_CM;
}

/** An object's colour mark as the map strokes it, in the object's own frame (cm, its centre at 0): lines, or dots as round specks. */
export type ObjectMarks = {
  mark: BodyMark;
  kind: 'lines' | 'dots';
  /** The map's ink of its fill (3:1 or more against it, R8). */
  ink: string;
  /** A line's width, or a dot's diameter, cm (the map draws at least a pixel and a half of it). */
  widthCm: number;
  segments: PatternSegment[];
  dots: (readonly [number, number])[];
};

/** A disc as the polygon a pattern is cut to. */
const DISC_SIDES = 24;

/** The mark of an object of a palette colour (red stripes, green a grid, blue large dots), or null for any other body. */
export function objectMarks(body: MovingBody): ObjectMarks | null {
  if (body.colorKey !== 'object' || body.fill === undefined) return null;
  const spec = objectPattern(body.fill);
  const mark = spec === null ? null : spec.kind === 'dots' ? 'dots' : spec.anglesDeg.length > 1 ? 'grid' : 'stripes';
  if (spec === null || mark === null) return null;
  const outline: (readonly [number, number])[] =
    body.shape === 'box'
      ? [
          [-body.widthCm / 2, -body.depthCm / 2],
          [body.widthCm / 2, -body.depthCm / 2],
          [body.widthCm / 2, body.depthCm / 2],
          [-body.widthCm / 2, body.depthCm / 2],
        ]
      : Array.from({ length: DISC_SIDES }, (_, k): [number, number] => [body.radiusCm * Math.cos((2 * Math.PI * k) / DISC_SIDES), body.radiusCm * Math.sin((2 * Math.PI * k) / DISC_SIDES)]);
  const ink = patternInk(body.fill, 'screen');
  return spec.kind === 'hatch'
    ? { mark, kind: 'lines', ink, widthCm: spec.widthCm, segments: patternSegments(outline, spec, OBJECT_PATTERN_MARGIN_CM), dots: [] }
    : { mark, kind: 'dots', ink, widthCm: 2 * spec.radiusCm, segments: [], dots: patternDots(outline, spec, OBJECT_PATTERN_MARGIN_CM) };
}
