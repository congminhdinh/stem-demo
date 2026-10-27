import { GRIPPER_ANGLE, GRIPPER_START } from '../../hardware/drivers/gripper-servo2';
import type { Kit, RobotPointCm } from '../../hardware/kit';
import { robotMechanics, type KitMechanicalModule } from '../../hardware/kit-mechanics';
import { circleShape, rectShape, shapesOverlap, wallShape, type Shape } from '../../scenario/overlap';
import type { Arena, PointCm } from '../arena/arena-schema';
import { cos, sin } from '../dmath';
import { degToRad } from '../units';
import { BOOM_BAR_HALF_CM, BOOM_PLATE_HALF_CM, CARRIAGE_HALF_CM } from './gripper-geometry';

// The robot seen from above (N18 R3.5), from the kit's mechanics: what createWorld checks a start against, what the goal frame
// calls the robot's footprint, and how far the robot reaches from the point of its pose (the scenario variants keep a circle of the
// kit's radius clear, `kitFootprintRadiusCm`: ROBOT_FOOTPRINT_RADIUS_CM unless the kit's chassis says another; footprint.test.ts holds the
// reference kit to the constant, and variants.kit-radius.test.ts every kit of the catalog to its own radius).
//
// Frame: the robot frame of kit.ts (`KitModule.mount`) in cm, x forward and y left, seen from above; the start pose puts it on
// the arena (units.ts: x right, y away, yaw counter-clockwise from +x). The parts, and how high their bottom is above the floor:
//   - the body box (`bodyCm`), from `clearanceCm` up;
//   - each drive wheel, a rectangle as long as the wheel is across and as wide as the wheel, from the floor up;
//   - the caster, a circle of its radius, from the floor up;
//   - each servo's arm at every angle it can turn to (minDeg..maxDeg), from the mount's height less half the arm's: an arm that
//     rests folded but swings out when the program starts (the Servo library starts at 90°) must find room there too.
//   - N19 B5: the gripper (gripper.ts's colliders: the boom's two plates and cross bar, the carriage, the claw servo's case, the two
//     fingers) at every lift angle (0..90°) and every finger angle the claw can turn them to, each piece from its own bottom at that lift:
//     a thing under where only the raised arm reaches may be lower than the lowered jaws (`gripperParts`). The gripper reaches past the
//     body (D-G8), so the gripper car's kit names a larger radius (16 cm) for the variants to keep clear. Against the walls, boxes and
//     cylinders the whole sweep counts, as a servo arm's does. Against the arena's objects only the gripper as setup() leaves it (lift 90°,
//     claw open: what the world builds) counts: the objects are what the gripper is for, and unlike a servo arm, which the Servo library
//     swings to 90° when the program starts, the gripper moves only when the program or the learner moves it. So a car may start with a
//     cube between its open jaws, as the teleop sandbox does, but not with a box there.
// An arena thing (walls, boxes, cylinders, objects) stands on the floor from 0 up to its height, so a part and a thing collide when
// they overlap seen from above and the thing is taller than the part's bottom: a 1 cm strip may lie under the body, not under a
// wheel. Overlap is overlap.ts's, the one the variants use: touching is not overlapping.

/**
 * The arm is checked at every whole degree of its range (and at its end), each sample grown so that the samples cover every angle
 * between them (`armSample`).
 */
export const ARM_SWEEP_STEP_DEG = 1;
/** What each sample is grown by besides what the angle between samples needs: a tenth of a millimetre, for the float arithmetic. */
const ARM_SAMPLE_SLACK_CM = 0.01;
/** sin of half the step: how far, as a part of its distance from the axis, a point of the arm turns between a sample and the next. */
const HALF_STEP_SIN = sin(degToRad(ARM_SWEEP_STEP_DEG) / 2);

/**
 * A part of the robot seen from above, in the robot frame: a rectangle turned by `yawDeg`, or a circle. A shape may have a bottom of its
 * own (N19 B5: a sample of the gripper at one lift angle); else it has its part's.
 */
type RectPart = {
  readonly kind: 'rect';
  readonly x: number;
  readonly y: number;
  readonly hx: number;
  readonly hy: number;
  readonly yawDeg: number;
  readonly bottomCm?: number;
};
type PartShape = RectPart | { readonly kind: 'circle'; readonly x: number; readonly y: number; readonly r: number };

type Part = {
  /** How a message names it: `body`, `left wheel`, `servo arm of servo1 (anywhere from 0° to 180°)`. */
  readonly name: string;
  readonly shapes: readonly PartShape[];
  /** The height of its bottom above the floor, cm: the lowest of its shapes' own bottoms when they have some. */
  readonly bottomCm: number;
  /**
   * N19 B5: a circle (robot frame, cm) that holds every shape of the part, for a part of many shapes (the gripper's 7 000): a thing that
   * does not overlap it is not checked against each shape. Parts without one are checked shape by shape, as they always were.
   */
  readonly bound?: { readonly x: number; readonly y: number; readonly r: number };
  /**
   * N19 B5: the arena things the part is checked against: the walls, boxes and cylinders only ('obstacles'), or the objects only
   * ('objects'). Every thing when not given.
   */
  readonly meets?: 'obstacles' | 'objects';
};

export type RobotFootprint = {
  /** The parts, in the order a message lists them. */
  readonly parts: readonly Part[];
  /**
   * What stands on the floor: the convex hull of the body box and the wheels, counter-clockwise from the back right, in the robot
   * frame (cm). The servo arms and the gripper ride above it and are not part of it.
   */
  readonly outlineCm: readonly PointCm[];
  /** How far any part reaches from the point of the pose, servo arms and the gripper at every angle included, cm. */
  readonly radiusCm: number;
};

const footprints = new WeakMap<Kit, RobotFootprint>();
const outlines = new WeakMap<Kit, readonly PointCm[]>();

/** The kit's robot seen from above (computed once per kit object). Throws a HardwareDataError for a kit without valid mechanics. */
export function robotFootprint(kit: Kit): RobotFootprint {
  let footprint = footprints.get(kit);
  if (footprint === undefined) {
    footprint = computeFootprint(kit);
    footprints.set(kit, footprint);
  }
  return footprint;
}

/**
 * N19 E9: the footprint's `outlineCm` alone (computed once per kit object, and the very array `robotFootprint(kit).outlineCm` is, whichever
 * is asked for first). The lab asks for it when it opens, for the view tools' ghost and the floor picker, and it is the hull of the body and
 * the wheels: it needs none of the gripper's 7 189 samples (13.9 ms on an M4 Pro, 55 to 64 ms on a school PC's profile, CPU 6x, a long task
 * before first paint), which wait for the first world or start check. Throws as `robotFootprint` does.
 */
export function robotOutline(kit: Kit): readonly PointCm[] {
  let outline = outlines.get(kit);
  if (outline === undefined) {
    const { body, left, right } = bodyParts(kit);
    outline = convexHull([...corners(body), ...corners(left), ...corners(right)]);
    outlines.set(kit, outline);
  }
  return outline;
}

/** What stands on the floor: the body box and the two drive wheels, seen from above (robot frame, cm). */
function bodyParts(kit: Kit): { body: RectPart; left: RectPart; right: RectPart } {
  const { chassis, motorLeft, motorRight } = robotMechanics(kit);
  const [length, width] = chassis.bodyCm;
  const body: RectPart = { kind: 'rect', x: 0, y: 0, hx: length / 2, hy: width / 2, yawDeg: 0 };
  const wheel = (posCm: RobotPointCm, radiusCm: number, widthCm: number): RectPart => ({
    kind: 'rect',
    x: posCm[0],
    y: posCm[1],
    hx: radiusCm,
    hy: widthCm / 2,
    yawDeg: 0,
  });
  const left = wheel(motorLeft.mount.posCm, motorLeft.spec.wheelRadiusCm, motorLeft.spec.wheelWidthCm);
  const right = wheel(motorRight.mount.posCm, motorRight.spec.wheelRadiusCm, motorRight.spec.wheelWidthCm);
  return { body, left, right };
}

function computeFootprint(kit: Kit): RobotFootprint {
  const { chassis, servos } = robotMechanics(kit);
  const { body, left, right } = bodyParts(kit);
  const parts: Part[] = [
    { name: 'body', shapes: [body], bottomCm: chassis.clearanceCm },
    { name: 'left wheel', shapes: [left], bottomCm: 0 },
    { name: 'right wheel', shapes: [right], bottomCm: 0 },
    { name: 'caster', shapes: [{ kind: 'circle', x: chassis.casterCm[0], y: chassis.casterCm[1], r: chassis.casterRadiusCm }], bottomCm: 0 },
  ];
  for (const servo of servos) {
    const { spec, mount } = servo;
    const shapes: PartShape[] = [];
    for (let deg = spec.minDeg; ; deg = Math.min(spec.maxDeg, deg + ARM_SWEEP_STEP_DEG)) {
      shapes.push(armSample(mount.posCm, mount.yawDeg + deg, spec.armLengthCm, spec.armWidthCm));
      if (deg >= spec.maxDeg) break;
    }
    parts.push({
      name: `servo arm of ${servo.role} (anywhere from ${spec.minDeg}° to ${spec.maxDeg}°)`,
      shapes,
      bottomCm: mount.posCm[2] - spec.armHeightCm / 2,
    });
  }
  const gripper = robotMechanics(kit).gripper;
  if (gripper !== null) parts.push(...gripperParts(gripper));

  let radiusCm = 0;
  for (const part of parts) {
    for (const shape of part.shapes) {
      for (const [x, y] of reachPoints(shape)) radiusCm = Math.max(radiusCm, Math.sqrt(x * x + y * y));
      if (shape.kind === 'circle') radiusCm = Math.max(radiusCm, Math.sqrt(shape.x * shape.x + shape.y * shape.y) + shape.r);
    }
  }
  return { parts, outlineCm: robotOutline(kit), radiusCm };
}

/**
 * Every thing of the arena the robot would stand in at `start`, as scenario issues on `start` that name the thing by its arena path
 * and id, and the parts of the robot in it (see the top of this file). Empty when the start is clear. `variant`, when given, is
 * named in each message. Throws a HardwareDataError for a kit without valid mechanics.
 */
export function startFootprintIssues(
  arena: Pick<Arena, 'walls' | 'boxes' | 'cylinders' | 'objects'>,
  kit: Kit,
  start: { readonly xCm: number; readonly yCm: number; readonly yawDeg: number },
  variant?: number,
): { path: string; message: string }[] {
  const { parts } = robotFootprint(kit);
  const [c, s] = cosSin(start.yawDeg);
  const place = (shape: PartShape): Shape => {
    const x = start.xCm + shape.x * c - shape.y * s;
    const y = start.yCm + shape.x * s + shape.y * c;
    return shape.kind === 'circle' ? circleShape(x, y, shape.r) : rectShape(x, y, shape.hx, shape.hy, start.yawDeg + shape.yawDeg);
  };
  const placed = parts.map((part) => {
    let shapes: readonly { shape: Shape; bottomCm: number }[] | null = null;
    return {
      part,
      bound: part.bound === undefined ? null : place({ kind: 'circle', ...part.bound }),
      /** The part's shapes on the arena, each with its bottom; placed when first needed (a part with a bound may never be). */
      shapes: () => (shapes ??= part.shapes.map((shape) => ({ shape: place(shape), bottomCm: (shape.kind === 'rect' ? shape.bottomCm : undefined) ?? part.bottomCm }))),
    };
  });

  const things: { path: string; id: string; shape: Shape; heightCm: number; object?: true }[] = [
    ...arena.walls.map((wall, i) => ({
      path: `walls[${i}]`,
      id: wall.id ?? `#wall-${i}`,
      shape: wallShape(wall.fromCm[0], wall.fromCm[1], wall.toCm[0], wall.toCm[1], wall.thicknessCm),
      heightCm: wall.heightCm,
    })),
    ...arena.boxes.map((box, i) => ({
      path: `boxes[${i}]`,
      id: box.id ?? `#box-${i}`,
      shape: rectShape(box.centerCm[0], box.centerCm[1], box.sizeCm[0] / 2, box.sizeCm[1] / 2, box.yawDeg),
      heightCm: box.sizeCm[2],
    })),
    ...arena.cylinders.map((cylinder, i) => ({
      path: `cylinders[${i}]`,
      id: cylinder.id ?? `#cylinder-${i}`,
      shape: circleShape(cylinder.centerCm[0], cylinder.centerCm[1], cylinder.radiusCm),
      heightCm: cylinder.heightCm,
    })),
    ...arena.objects.map((object, i) =>
      object.shape === 'box'
        ? {
            path: `objects[${i}]`,
            id: object.id,
            shape: rectShape(object.centerCm[0], object.centerCm[1], object.sizeCm[0] / 2, object.sizeCm[1] / 2, object.yawDeg),
            heightCm: object.sizeCm[2],
            object: true as const,
          }
        : { path: `objects[${i}]`, id: object.id, shape: circleShape(object.centerCm[0], object.centerCm[1], object.radiusCm), heightCm: object.heightCm, object: true as const },
    ),
  ];

  const issues: { path: string; message: string }[] = [];
  for (const thing of things) {
    const hit = placed
      .filter(
        ({ part, bound, shapes }) =>
          (part.meets === undefined || (part.meets === 'objects') === (thing.object === true)) &&
          thing.heightCm > part.bottomCm &&
          (bound === null || shapesOverlap(bound, thing.shape)) &&
          shapes().some(({ shape, bottomCm }) => thing.heightCm > bottomCm && shapesOverlap(shape, thing.shape)),
      )
      .map(({ part }) => part.name);
    if (hit.length === 0) continue;
    const names = hit.length === 1 ? hit[0]! : `${hit.slice(0, -1).join(', ')} and ${hit.at(-1)!}`;
    const where = variant === undefined ? '' : `in variant ${variant}, `;
    issues.push({ path: 'start', message: `${where}the robot’s ${names} ${hit.length === 1 ? 'overlaps' : 'overlap'} ${thing.path} (${thing.id})` });
  }
  return issues;
}

/**
 * The arm, a bar `lengthCm` long and `widthCm` wide from the axis at `axisCm`, pointing `deg` (robot frame), grown so that the
 * samples 1° apart cover the arm at every angle between them. A point of the bar at (a, b) (along it 0..L, across it −w/2..w/2) at
 * an angle δ ≤ ½° from the nearest sample is, in that sample's frame, at a cos δ ± b sin δ along it and b cos δ ∓ a sin δ across
 * it: at most (w/2)·sin ½° past either end and L·sin ½° past either side. So each sample is lengthened by (w/2)·sin ½° at both ends
 * (what a wide arm's tip corner needs) and widened by L·sin ½° on both sides (what a long, thin arm needs between two samples), each
 * plus ARM_SAMPLE_SLACK_CM: every arm a kit may describe is covered, at most L·sin ½° (0.5 mm for a 6 cm horn) more than it reaches.
 */
function armSample(axisCm: RobotPointCm, deg: number, lengthCm: number, widthCm: number): RectPart {
  // Servo angle θ points the arm at the mount's yaw + θ (servo-arm.ts); the bar runs from the axis out to its length.
  const [c, s] = cosSin(deg);
  const half = lengthCm / 2;
  return {
    kind: 'rect',
    x: axisCm[0] + half * c,
    y: axisCm[1] + half * s,
    hx: half + (widthCm / 2) * HALF_STEP_SIN + ARM_SAMPLE_SLACK_CM,
    hy: widthCm / 2 + lengthCm * HALF_STEP_SIN + ARM_SAMPLE_SLACK_CM,
    yawDeg: deg,
  };
}

/**
 * The gripper's lift is checked at every whole degree of its range (and at its end); its fingers, as servo arms are, every ARM_SWEEP_STEP_DEG
 * of theirs.
 */
export const GRIPPER_SWEEP_STEP_DEG = 1;
/** 2·sin(¼°): the chord of half a step, as a part of the radius: how far a point turns between a sample and the next half-way. */
const HALF_STEP_CHORD = 2 * sin(degToRad(GRIPPER_SWEEP_STEP_DEG) / 4);

/**
 * The gripper seen from above (gripper.ts builds the same pieces from the same numbers), as two parts (see the top of this file): at every
 * angle it can take, checked against the walls, boxes and cylinders, and as setup() leaves it (GRIPPER_START), checked against the objects.
 *
 * At a lift ℓ (the boom's elevation is ℓ + boomElevationAtLift0Deg): the boom's two side plates and its cross bar (turned with the boom: seen
 * from above, each shrinks along x by the cosine of the elevation), the carriage box and the claw servo's case (level: the parallelogram), and
 * each finger at a finger angle β (fingerOpenDeg − fingerDegPerServoDeg·claw, down to the jaws' meeting angle). The sweep takes ℓ at every
 * whole degree of the servo's 0..90 and β at every whole degree from the meeting angle to fingerOpenDeg, each sample grown so the samples
 * cover every angle between them, and its bottom lowered as much:
 *   - between two lift samples the carriage and what rides on it move along the boom tip's arc, at most boomLength · 2·sin(¼°) (0.44 mm)
 *     either way, seen from above or up and down; a point of the boom at distance d from its axis moves at most d · 2·sin(¼°);
 *   - between two β samples a finger turns about its hinge as a servo arm does about its axis (`armSample`).
 * Each is also grown by ARM_SAMPLE_SLACK_CM for the float arithmetic. So the sweep reaches at most about 1 mm farther than the gripper does.
 * The start pose's pieces are grown as much (one lift, one β): a little more room than the world needs.
 */
function gripperParts(gripper: KitMechanicalModule<'gripper'>): Part[] {
  const { spec, mount } = gripper;
  const [px, py, pz] = mount.posCm;
  const length = spec.boomLengthCm;
  const betaMin = spec.fingerOpenDeg - spec.fingerDegPerServoDeg * spec.jawsMeetDeg;
  const betaMax = spec.fingerOpenDeg;
  const betaOfClaw = (clawDeg: number) => Math.min(betaMax, Math.max(betaMin, spec.fingerOpenDeg - spec.fingerDegPerServoDeg * clawDeg));
  /** An axis-aligned rectangle over x0..x1 × y0..y1, grown by `grow`, its bottom `bottomCm` lowered as much. */
  const box = (x0: number, x1: number, y0: number, y1: number, bottomCm: number, grow: number): RectPart => ({
    kind: 'rect',
    x: (x0 + x1) / 2,
    y: (y0 + y1) / 2,
    hx: (x1 - x0) / 2 + grow + ARM_SAMPLE_SLACK_CM,
    hy: (y1 - y0) / 2 + grow + ARM_SAMPLE_SLACK_CM,
    yawDeg: 0,
    bottomCm: bottomCm - grow - ARM_SAMPLE_SLACK_CM,
  });
  /** A piece of the boom, `along` (from its axis) by `up` (across it, in the side view) in its own frame, seen from above at elevation (c, s). */
  const boomPiece = (c: number, s: number, along: readonly [number, number], up: number, y0: number, y1: number): RectPart => {
    const xs: number[] = [];
    const zs: number[] = [];
    for (const a of along) {
      for (const n of [0 - up, up]) {
        xs.push(px + a * c - n * s);
        zs.push(pz + a * s + n * c);
      }
    }
    const reach = Math.sqrt(Math.max(along[0] * along[0], along[1] * along[1]) + up * up);
    return box(Math.min(...xs), Math.max(...xs), y0, y1, Math.min(...zs), reach * HALF_STEP_CHORD);
  };
  const plate = BOOM_PLATE_HALF_CM;
  const bar = BOOM_BAR_HALF_CM;
  const span = spec.boomHalfSpanCm;
  const onTip = length * HALF_STEP_CHORD;
  /** The gripper's pieces at lift `liftDeg`, the fingers at each β of `betas`. */
  const at = (liftDeg: number, betas: readonly number[]): RectPart[] => {
    const shapes: RectPart[] = [];
    const [c, s] = cosSin(liftDeg + spec.boomElevationAtLift0Deg);
    for (const side of [1, -1]) {
      shapes.push(boomPiece(c, s, [0, length], plate.up, py + side * span - plate.across, py + side * span + plate.across));
    }
    shapes.push(boomPiece(c, s, [length - bar, length + bar], bar, py - span - plate.across, py + span + plate.across));
    // The boom's tip, where the level carriage hangs: its frame's origin (u forward, v left, w up).
    const tx = px + length * c;
    const tz = pz + length * s;
    shapes.push(box(tx - CARRIAGE_HALF_CM.u, tx + CARRIAGE_HALF_CM.u, py - CARRIAGE_HALF_CM.v, py + CARRIAGE_HALF_CM.v, tz - CARRIAGE_HALF_CM.w, onTip));
    const servoX = tx + spec.clawServoCenterUCm;
    const servoY = py + spec.clawServoCenterVCm;
    shapes.push(
      box(
        servoX - spec.clawServoSizeUCm / 2,
        servoX + spec.clawServoSizeUCm / 2,
        servoY - spec.clawServoSizeVCm / 2,
        servoY + spec.clawServoSizeVCm / 2,
        tz + spec.clawServoCenterWCm - spec.clawServoSizeWCm / 2,
        onTip,
      ),
    );
    const fingerBottom = tz - spec.jawHeightCm / 2 - onTip - ARM_SAMPLE_SLACK_CM;
    for (const side of [1, -1]) {
      for (const beta of betas) {
        // β opens a finger away from the middle: the left one (side +1) turns towards +y.
        const sample = armSample([tx + spec.fingerHingeUCm, py + side * spec.fingerHingeVCm, 0], side * beta, spec.fingerLengthCm, spec.fingerThicknessCm);
        shapes.push({ ...sample, hx: sample.hx + onTip, hy: sample.hy + onTip, bottomCm: fingerBottom });
      }
    }
    return shapes;
  };
  /** From `from` to `to` in whole steps of `step` degrees, `to` included. */
  const steps = (from: number, to: number, step: number) => {
    const out: number[] = [];
    for (let deg = from; ; deg = Math.min(to, deg + step)) {
      out.push(deg);
      if (deg >= to) return out;
    }
  };
  // Each sample's growth is for its own step: the fingers are `armSample`s, grown for ARM_SWEEP_STEP_DEG; the lift's HALF_STEP_CHORD is
  // for GRIPPER_SWEEP_STEP_DEG.
  const betas = steps(betaMin, betaMax, ARM_SWEEP_STEP_DEG);
  const swept = steps(GRIPPER_ANGLE.min, GRIPPER_ANGLE.max, GRIPPER_SWEEP_STEP_DEG).flatMap((liftDeg) => at(liftDeg, betas));
  const start = at(GRIPPER_START.liftDeg, [betaOfClaw(GRIPPER_START.clawDeg)]);
  // A circle about the pivot that holds every sample: their farthest corner from it.
  let r = 0;
  for (const shape of swept) for (const [x, y] of corners(shape)) r = Math.max(r, Math.sqrt((x - px) * (x - px) + (y - py) * (y - py)));
  const lowest = (shapes: readonly RectPart[]) => Math.min(...shapes.map((shape) => shape.bottomCm!));
  const range = `${GRIPPER_ANGLE.min}° to ${GRIPPER_ANGLE.max}°`;
  return [
    { name: `gripper (lift anywhere from ${range}, claw anywhere from ${range})`, shapes: swept, bottomCm: lowest(swept), bound: { x: px, y: py, r: r + ARM_SAMPLE_SLACK_CM }, meets: 'obstacles' },
    { name: `gripper (as setup() leaves it: lift ${GRIPPER_START.liftDeg}°, claw ${GRIPPER_START.clawDeg}°)`, shapes: start, bottomCm: lowest(start), meets: 'objects' },
  ];
}

/** cos and sin of an angle in degrees: exact at the right angles (as overlap.ts), dmath's everywhere else. */
function cosSin(deg: number): [number, number] {
  const turn = ((deg % 360) + 360) % 360;
  if (turn === 0) return [1, 0];
  if (turn === 90) return [0, 1];
  if (turn === 180) return [-1, 0];
  if (turn === 270) return [0, -1];
  const rad = degToRad(turn);
  return [cos(rad), sin(rad)];
}

/** The four corners of a rectangle part (counter-clockwise), in the robot frame. */
function corners(shape: RectPart): PointCm[] {
  const [c, s] = cosSin(shape.yawDeg);
  return [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([u, v]) => [shape.x + u! * shape.hx * c - v! * shape.hy * s, shape.y + u! * shape.hx * s + v! * shape.hy * c] as PointCm);
}

/** The points of a part that bound how far it reaches: a rectangle's corners (a circle is handled on its own). */
function reachPoints(shape: PartShape): PointCm[] {
  return shape.kind === 'rect' ? corners(shape) : [];
}

/** The convex hull of the points, counter-clockwise from the lowest x (then lowest y), without collinear points (Andrew's monotone chain). */
function convexHull(points: readonly PointCm[]): PointCm[] {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: PointCm, a: PointCm, b: PointCm) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (list: readonly PointCm[]) => {
    const chain: PointCm[] = [];
    for (const point of list) {
      while (chain.length >= 2 && cross(chain[chain.length - 2]!, chain[chain.length - 1]!, point) <= 0) chain.pop();
      chain.push(point);
    }
    chain.pop();
    return chain;
  };
  return [...half(sorted), ...half([...sorted].reverse())];
}
