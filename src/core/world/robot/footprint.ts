import type { Kit, RobotPointCm } from '../../hardware/kit';
import { robotMechanics } from '../../hardware/kit-mechanics';
import { circleShape, rectShape, shapesOverlap, wallShape, type Shape } from '../../scenario/overlap';
import type { Arena, PointCm } from '../arena/arena-schema';
import { cos, sin } from '../dmath';
import { degToRad } from '../units';

// The robot seen from above (N18 R3.5), from the kit's mechanics: what createWorld checks a start against, what the goal frame
// calls the robot's footprint, and how far the robot reaches from the point of its pose (the scenario variants keep a circle of
// ROBOT_FOOTPRINT_RADIUS_CM clear; footprint.test.ts holds the reference kit to it).
//
// Frame: the robot frame of kit.ts (`KitModule.mount`) in cm, x forward and y left, seen from above; the start pose puts it on
// the arena (units.ts: x right, y away, yaw counter-clockwise from +x). The parts, and how high their bottom is above the floor:
//   - the body box (`bodyCm`), from `clearanceCm` up;
//   - each drive wheel, a rectangle as long as the wheel is across and as wide as the wheel, from the floor up;
//   - the caster, a circle of its radius, from the floor up;
//   - each servo's arm at every angle it can turn to (minDeg..maxDeg), from the mount's height less half the arm's: an arm that
//     rests folded but swings out when the program starts (the Servo library starts at 90°) must find room there too.
// An arena thing (walls, boxes, cylinders, objects) stands on the floor from 0 up to its height, so a part and a thing collide when
// they overlap seen from above and the thing is taller than the part's bottom: a 1 cm strip may lie under the body, not under a
// wheel. Overlap is overlap.ts's, the one the variants use: touching is not overlapping.

/** The arm is checked at every whole degree of its range (and at its end), each sample grown by ARM_SAMPLE_GROWTH_CM. */
export const ARM_SWEEP_STEP_DEG = 1;
/**
 * Between two samples 1° apart the arm's far corners sweep an arc whose middle lies r·(1 − cos 0.5°) beyond the chord the samples
 * cover: 2.3 µm at the 6 cm of an SG90 horn. A tenth of a millimetre covers it for any arm under 2.6 m.
 */
const ARM_SAMPLE_GROWTH_CM = 0.01;

/** A part of the robot seen from above, in the robot frame: a rectangle turned by `yawDeg`, or a circle. */
type RectPart = { readonly kind: 'rect'; readonly x: number; readonly y: number; readonly hx: number; readonly hy: number; readonly yawDeg: number };
type PartShape = RectPart | { readonly kind: 'circle'; readonly x: number; readonly y: number; readonly r: number };

type Part = {
  /** How a message names it: `body`, `left wheel`, `servo arm of servo1 (anywhere from 0° to 180°)`. */
  readonly name: string;
  readonly shapes: readonly PartShape[];
  /** The height of its bottom above the floor, cm. */
  readonly bottomCm: number;
};

export type RobotFootprint = {
  /** The parts, in the order a message lists them. */
  readonly parts: readonly Part[];
  /**
   * What stands on the floor: the convex hull of the body box and the wheels, counter-clockwise from the back right, in the robot
   * frame (cm). The servo arms ride above it and are not part of it.
   */
  readonly outlineCm: readonly PointCm[];
  /** How far any part reaches from the point of the pose, servo arms at every angle included, cm. */
  readonly radiusCm: number;
};

const footprints = new WeakMap<Kit, RobotFootprint>();

/** The kit's robot seen from above (computed once per kit object). Throws a HardwareDataError for a kit without valid mechanics. */
export function robotFootprint(kit: Kit): RobotFootprint {
  let footprint = footprints.get(kit);
  if (footprint === undefined) {
    footprint = computeFootprint(kit);
    footprints.set(kit, footprint);
  }
  return footprint;
}

function computeFootprint(kit: Kit): RobotFootprint {
  const { chassis, motorLeft, motorRight, servos } = robotMechanics(kit);
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
      // Servo angle θ points the arm at the mount's yaw + θ (servo-arm.ts); the bar runs from the axis out to its length.
      const [c, s] = cosSin(mount.yawDeg + deg);
      const half = spec.armLengthCm / 2;
      shapes.push({
        kind: 'rect',
        x: mount.posCm[0] + half * c,
        y: mount.posCm[1] + half * s,
        hx: half + ARM_SAMPLE_GROWTH_CM,
        hy: spec.armWidthCm / 2 + ARM_SAMPLE_GROWTH_CM,
        yawDeg: mount.yawDeg + deg,
      });
      if (deg >= spec.maxDeg) break;
    }
    parts.push({
      name: `servo arm of ${servo.role} (anywhere from ${spec.minDeg}° to ${spec.maxDeg}°)`,
      shapes,
      bottomCm: mount.posCm[2] - spec.armHeightCm / 2,
    });
  }

  let radiusCm = 0;
  for (const part of parts) {
    for (const shape of part.shapes) {
      for (const [x, y] of reachPoints(shape)) radiusCm = Math.max(radiusCm, Math.sqrt(x * x + y * y));
      if (shape.kind === 'circle') radiusCm = Math.max(radiusCm, Math.sqrt(shape.x * shape.x + shape.y * shape.y) + shape.r);
    }
  }
  return { parts, outlineCm: convexHull([...corners(body), ...corners(left), ...corners(right)]), radiusCm };
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
  const placed = parts.map((part) => ({ part, shapes: part.shapes.map(place) }));

  const things: { path: string; id: string; shape: Shape; heightCm: number }[] = [
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
          }
        : { path: `objects[${i}]`, id: object.id, shape: circleShape(object.centerCm[0], object.centerCm[1], object.radiusCm), heightCm: object.heightCm },
    ),
  ];

  const issues: { path: string; message: string }[] = [];
  for (const thing of things) {
    const hit = placed
      .filter(({ part, shapes }) => thing.heightCm > part.bottomCm && shapes.some((shape) => shapesOverlap(shape, thing.shape)))
      .map(({ part }) => part.name);
    if (hit.length === 0) continue;
    const names = hit.length === 1 ? hit[0]! : `${hit.slice(0, -1).join(', ')} and ${hit.at(-1)!}`;
    const where = variant === undefined ? '' : `in variant ${variant}, `;
    issues.push({ path: 'start', message: `${where}the robot’s ${names} ${hit.length === 1 ? 'overlaps' : 'overlap'} ${thing.path} (${thing.id})` });
  }
  return issues;
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
