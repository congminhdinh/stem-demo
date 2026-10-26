import type { Kit } from '../hardware/kit';
import type { Arena, ArenaBox, ArenaCylinder, ArenaObject } from '../world/arena/arena-schema';
import { createWorldRng } from '../world/rng';
import { circleShape, cosSin, insideGround, rectShape, shapesOverlap, wallShape, type Shape } from './overlap';
import type { PoseCm, Scenario } from './scenario-schema';

// The variants of a scenario (N18 R5.1, robot plan §4.6, D-R9): the same task from a slightly different start, so that a program
// that only works for one lucky place fails. A check (R6.2) runs `variants.count` of them and passes when the goals pass in all.
//
//   variant 0     the exact start: no offset at all.
//   variant 1..   the start moves by up to ±startJitterCm in x and y (or, with startJitterAlongCm, by up to ±startJitterAlongCm along its
//                 authored heading and ±startJitterCm across it) and ±yawJitterDeg of yaw; each arena box and cylinder tagged
//                 `jitter` moves by up to ±obstacleJitterCm in x and y; N19 D1: the objects of each entry of `objectJitter` move by
//                 up to ±dxCm in x and ±dyCm in y, all of an entry by the same offset, and the objects of `objectColors` take the colour
//                 of the variant's index. Nothing else moves: not the walls, the paint, an object no entry names, nor an untagged obstacle.
//
// Everything comes from the scenario's seed (the one Mulberry32 of world/rng.ts, never Math.random) and the variant's index, so the
// same scenario gives the same variants on every engine: `variantOffsets` is a pure function.
//
// The random draws (offsets are `uniform(−j, +j)` of the jitter `j`), in this order, from the stream of `variantJitterSeed`:
//   1. the start: dx, dy, dYaw (only when startJitterCm, startJitterAlongCm or yawJitterDeg is above 0); with startJitterAlongCm the first two
//      draws are along and across the heading, turned into dx, dy by the authored yaw (exact at the right angles, dmath elsewhere);
//   2. each box tagged `jitter` in arena order, then each cylinder: dx, dy (only when obstacleJitterCm is above 0);
//   3. N19 D1, after every draw above: each entry of `objectJitter` in order: dx, dy (only when the scenario has `objectJitter`, a draw even
//      for a range of 0). A scenario without it draws exactly the numbers it drew before N19. The colours of `objectColors` are a list,
//      one per variant, and take no draw.
//
// A draw that does not fit is thrown away and the thing is drawn again, at most VARIANT_MAX_ATTEMPTS times; then it keeps the place the
// author gave it (offset 0). The robot keeps its authored position only: the yaw never decides whether a draw fits (it does not move the
// footprint), so after the last failed draw the start turns by the yaw of the first draw. What does not fit:
//   - the start: the robot’s footprint (a circle of `radiusCm`, the kit’s `kitFootprintRadiusCm`: ROBOT_FOOTPRINT_RADIUS_CM when it says
//     none) leaves the ground or overlaps a wall, an object, an untagged obstacle, or a tagged obstacle at its authored place;
//   - a tagged obstacle: it leaves the ground, or overlaps the robot at its final start, a wall, an object, an untagged obstacle, a
//     tagged obstacle placed before it (at its final place) or after it (at its authored place).
//   - N19 D1, an entry of `objectJitter`: one of its objects leaves the ground, or overlaps the robot at its final start, a wall, a box or a
//     cylinder at its final place, an object of an entry before it (at its final place) or any other object (at its authored place). Its
//     objects keep their places relative to one another, so they cannot overlap each other where the author did not.
// The start is placed first, then the obstacles in order, then the objects, each against what is already placed, so if the authored layout
// is clear of overlaps, every variant is: an obstacle that falls back to its authored place was checked against the others at theirs. A draw that
// leaves the start where it was (no x/y jitter, only yaw) always fits: the circle is the same, and a start the author chose close to
// a wall keeps its yaw jitter.
//
// Overlap is judged on the footprint on the floor (overlap.ts); touching is not overlapping.

/** The tag of the arena boxes and cylinders a variant may move. */
export const JITTER_TAG = 'jitter';

/** Draws a thing gets before it keeps its authored place. */
export const VARIANT_MAX_ATTEMPTS = 20;

/**
 * The floor the robot needs at its start, a circle around the point of its pose (the middle of the body). `ref-uno-rover@0` is a
 * 15 × 12 cm body, whose corners are 9.60 cm from the middle, on wheels 6.6 cm across and 2.6 cm wide (track 15 cm, axle 2 cm back)
 * whose outer back corners are the farthest point, 10.27 cm away; its servo arm stays inside the body at every angle. 11 cm leaves
 * 0.73 cm of air. This is the radius of a kit that does not say its own. A kit that reaches farther says a bigger one in its chassis
 * (`footprintRadiusCm`, `kitFootprintRadiusCm`): `robotFootprint(kit).radiusCm` (world/robot/footprint.ts) says how far it reaches, and
 * createWorld refuses a start where any part of the robot overlaps the arena (N18 R3.5).
 */
export const ROBOT_FOOTPRINT_RADIUS_CM = 11;

/**
 * The floor `kit` needs at its start (N19 D-G8): its own `chassis.footprintRadiusCm` when it says one, else `ROBOT_FOOTPRINT_RADIUS_CM`
 * (the rover's, whose file says nothing, and a kit with no chassis). What `variantOffsets` is given as `radiusCm` for the kit a scenario runs on.
 */
export function kitFootprintRadiusCm(kit: Kit): number {
  return kit.chassis?.footprintRadiusCm ?? ROBOT_FOOTPRINT_RADIUS_CM;
}

/** Mixed into the variant seed for the jitter stream, so that it is not the stream the world draws its sensor noise from. */
const JITTER_SALT = 0x9e3779b9;

/** What variants need of a scenario. */
export type VariantSource = Pick<Scenario, 'arena' | 'start' | 'variants'>;

/** How far a box or cylinder moves from where the arena puts it. */
export type ObstacleOffset = { readonly dxCm: number; readonly dyCm: number };

/**
 * One variant, as offsets from the scenario’s own start and arena (all zero for variant 0). `applyVariant` gives the start and the
 * arena the world is built from.
 */
export type VariantOffsets = {
  /** 0 is the exact start; 1.. are the jittered ones. */
  readonly index: number;
  /** The seed of this variant (`variantSeed`): the one a world draws its sensor noise from, and a check result reports. */
  readonly seed: number;
  /** The start pose moves by (dxCm, dyCm) and turns by dYawDeg. */
  readonly start: { readonly dxCm: number; readonly dyCm: number; readonly dYawDeg: number };
  /** One per box of `arena.boxes`, in the same order: zero for a box not tagged `jitter`. */
  readonly boxes: readonly ObstacleOffset[];
  /** One per cylinder of `arena.cylinders`, in the same order. */
  readonly cylinders: readonly ObstacleOffset[];
  /**
   * N19 D1: one per object of `arena.objects`, in the same order (zero for an object no entry of `objectJitter` names). Present only when the
   * scenario has `variants.objectJitter`, so the offsets of every other scenario are what they were before N19.
   */
  readonly objects?: readonly ObstacleOffset[];
};

const NO_OFFSET: ObstacleOffset = { dxCm: 0, dyCm: 0 };

function checkIndex(scenario: Pick<VariantSource, 'variants'>, index: number): void {
  const { count } = scenario.variants;
  if (!Number.isInteger(index) || index < 0 || index >= count) {
    throw new RangeError(`The scenario has ${count} variant${count === 1 ? '' : 's'} (0..${count - 1}), not variant ${index}.`);
  }
}

/** The seed of variant `index`: the scenario's seed plus the index, as a 32-bit number (the seed of `createWorld`, R3.5). */
export function variantSeed(scenario: Pick<VariantSource, 'variants'>, index: number): number {
  checkIndex(scenario, index);
  return (scenario.variants.seed + index) >>> 0;
}

/** The seed of the stream the jitter of variant `index` is drawn from: `variantSeed` mixed with a constant. */
export function variantJitterSeed(scenario: Pick<VariantSource, 'variants'>, index: number): number {
  return (variantSeed(scenario, index) ^ JITTER_SALT) >>> 0;
}

type Tagged = { readonly list: 'boxes' | 'cylinders'; readonly at: number; readonly shapeAt: (dxCm: number, dyCm: number) => Shape };

const boxShapeAt = (box: ArenaBox, dxCm: number, dyCm: number): Shape =>
  rectShape(box.centerCm[0] + dxCm, box.centerCm[1] + dyCm, box.sizeCm[0] / 2, box.sizeCm[1] / 2, box.yawDeg);
const cylinderShapeAt = (cylinder: ArenaCylinder, dxCm: number, dyCm: number): Shape =>
  circleShape(cylinder.centerCm[0] + dxCm, cylinder.centerCm[1] + dyCm, cylinder.radiusCm);
const objectShapeAt = (object: ArenaObject, dxCm: number, dyCm: number): Shape =>
  object.shape === 'box'
    ? rectShape(object.centerCm[0] + dxCm, object.centerCm[1] + dyCm, object.sizeCm[0] / 2, object.sizeCm[1] / 2, object.yawDeg)
    : circleShape(object.centerCm[0] + dxCm, object.centerCm[1] + dyCm, object.radiusCm);

/** `-0` becomes `+0`: an offset that did not move is the same number everywhere. */
const plain = (n: number): number => n + 0;

/**
 * The offsets of variant `index` of the scenario (0 … count − 1; any other index is a RangeError). Variant 0 is all zeros. See the top
 * of this file for what moves, what is drawn in which order and when a draw is thrown away. `radiusCm` is the floor the robot's kit
 * needs around its start (`kitFootprintRadiusCm(kit)`); it decides which draws fit, never which numbers are drawn, and the seed does not
 * depend on it. Required (N19 A2): a caller that forgets the radius of its kit does not compile.
 */
export function variantOffsets(scenario: VariantSource, index: number, radiusCm: number): VariantOffsets {
  checkIndex(scenario, index);
  const { arena, start, variants } = scenario;
  const seed = variantSeed(scenario, index);
  const boxOffsets: ObstacleOffset[] = arena.boxes.map(() => NO_OFFSET);
  const cylinderOffsets: ObstacleOffset[] = arena.cylinders.map(() => NO_OFFSET);
  const objectJitter = variants.objectJitter;
  const objectOffsets: ObstacleOffset[] | undefined = objectJitter === undefined ? undefined : arena.objects.map(() => NO_OFFSET);
  let startOffset = { dxCm: 0, dyCm: 0, dYawDeg: 0 };
  const result = (): VariantOffsets => ({
    index,
    seed,
    start: startOffset,
    boxes: boxOffsets,
    cylinders: cylinderOffsets,
    ...(objectOffsets === undefined ? {} : { objects: objectOffsets }),
  });
  if (index === 0) return result();

  const [width, depth] = arena.ground.sizeCm;
  const obstacleJitter = variants.obstacleJitterCm ?? 0;
  const along = variants.startJitterAlongCm;
  const jitterStart = variants.startJitterCm > 0 || (along ?? 0) > 0 || variants.yawJitterDeg > 0;
  const [headingCos, headingSin] = cosSin(start.yawDeg);
  /** The start's move of one draw: in x and y, or along and across its heading. */
  const drawMove = (): [number, number] => {
    if (along === undefined) return [jitter(variants.startJitterCm), jitter(variants.startJitterCm)];
    const a = jitter(along);
    const c = jitter(variants.startJitterCm);
    return [plain(a * headingCos - c * headingSin), plain(a * headingSin + c * headingCos)];
  };
  if (!jitterStart && obstacleJitter <= 0 && objectOffsets === undefined) return result();

  // What stays where the author put it, and the tagged obstacles in the order they are drawn (boxes, then cylinders).
  const walls = arena.walls.map((wall) => wallShape(wall.fromCm[0], wall.fromCm[1], wall.toCm[0], wall.toCm[1], wall.thicknessCm));
  const fixed: Shape[] = [...walls, ...arena.objects.map((object) => objectShapeAt(object, 0, 0))];
  const tagged: Tagged[] = [];
  arena.boxes.forEach((box, at) => {
    if (box.tags.includes(JITTER_TAG)) tagged.push({ list: 'boxes', at, shapeAt: (dx, dy) => boxShapeAt(box, dx, dy) });
    else fixed.push(boxShapeAt(box, 0, 0));
  });
  arena.cylinders.forEach((cylinder, at) => {
    if (cylinder.tags.includes(JITTER_TAG)) tagged.push({ list: 'cylinders', at, shapeAt: (dx, dy) => cylinderShapeAt(cylinder, dx, dy) });
    else fixed.push(cylinderShapeAt(cylinder, 0, 0));
  });
  const authored = tagged.map((obstacle) => obstacle.shapeAt(0, 0));
  const hits = (shape: Shape, others: readonly Shape[]) => others.some((other) => shapesOverlap(shape, other));

  const rng = createWorldRng(variantJitterSeed(scenario, index));
  const jitter = (limit: number) => plain(rng.uniform(-limit, limit));

  // The start, first. The yaw does not move the footprint, so a draw never fails for its yaw: when no position fits, only the position
  // falls back (offset 0) and the start keeps the yaw of the first draw.
  let robot = circleShape(start.xCm, start.yCm, radiusCm);
  if (jitterStart) {
    let firstYawDeg = 0;
    let placed = false;
    for (let attempt = 0; attempt < VARIANT_MAX_ATTEMPTS && !placed; attempt++) {
      const [dxCm, dyCm] = drawMove();
      const dYawDeg = jitter(variants.yawJitterDeg);
      if (attempt === 0) firstYawDeg = dYawDeg;
      const moved = circleShape(start.xCm + dxCm, start.yCm + dyCm, radiusCm);
      const stays = dxCm === 0 && dyCm === 0;
      if (stays || (insideGround(moved, width, depth) && !hits(moved, fixed) && !hits(moved, authored))) {
        startOffset = { dxCm, dyCm, dYawDeg };
        robot = moved;
        placed = true;
      }
    }
    if (!placed) startOffset = { dxCm: 0, dyCm: 0, dYawDeg: firstYawDeg };
  }

  // Then each tagged obstacle, against what is placed: the robot, the fixed things, the earlier obstacles where they ended up and
  // the later ones where the author put them.
  if (obstacleJitter > 0) {
    const placed: Shape[] = [];
    tagged.forEach((obstacle, order) => {
      const later = authored.slice(order + 1);
      let final = authored[order]!;
      for (let attempt = 0; attempt < VARIANT_MAX_ATTEMPTS; attempt++) {
        const dxCm = jitter(obstacleJitter);
        const dyCm = jitter(obstacleJitter);
        const moved = obstacle.shapeAt(dxCm, dyCm);
        if (insideGround(moved, width, depth) && !shapesOverlap(moved, robot) && !hits(moved, fixed) && !hits(moved, placed) && !hits(moved, later)) {
          (obstacle.list === 'boxes' ? boxOffsets : cylinderOffsets)[obstacle.at] = { dxCm, dyCm };
          final = moved;
          break;
        }
      }
      placed.push(final);
    });
  }

  // N19 D1, last: each entry of objectJitter, all of its objects by one offset, against the robot, the walls, the boxes and cylinders where
  // they ended up, the objects of the earlier entries where they ended up and every other object where the author put it.
  if (objectJitter !== undefined && objectOffsets !== undefined) {
    const obstacles = [
      ...arena.boxes.map((box, i) => boxShapeAt(box, boxOffsets[i]!.dxCm, boxOffsets[i]!.dyCm)),
      ...arena.cylinders.map((cylinder, i) => cylinderShapeAt(cylinder, cylinderOffsets[i]!.dxCm, cylinderOffsets[i]!.dyCm)),
    ];
    const objects = arena.objects.map((object) => objectShapeAt(object, 0, 0));
    const indexOf = new Map(arena.objects.map((object, i) => [object.id, i]));
    for (const entry of objectJitter) {
      const members = entry.objects.map((id) => indexOf.get(id)!);
      const others = objects.filter((_, i) => !members.includes(i));
      for (let attempt = 0; attempt < VARIANT_MAX_ATTEMPTS; attempt++) {
        const dxCm = jitter(entry.dxCm);
        const dyCm = jitter(entry.dyCm);
        const moved = members.map((i) => objectShapeAt(arena.objects[i]!, dxCm, dyCm));
        const stays = dxCm === 0 && dyCm === 0;
        const fits = (shape: Shape) => insideGround(shape, width, depth) && !shapesOverlap(shape, robot) && !hits(shape, walls) && !hits(shape, obstacles) && !hits(shape, others);
        if (stays || moved.every(fits)) {
          members.forEach((i, k) => {
            objectOffsets[i] = { dxCm, dyCm };
            objects[i] = moved[k]!;
          });
          break;
        }
      }
    }
  }
  return result();
}

/**
 * N19 D1: the colour of each arena object that has one in variant `index` (0 … count − 1; any other index is a RangeError), by id: the
 * variant's entry of `variants.objectColors` for an object listed there, else the arena's own `color`. An object with no colour is left out.
 * It is what the variant's arena paints (`applyVariant`) and what the check's report calls the object ("khối đỏ") in that round.
 */
export function variantObjectColors(scenario: Pick<VariantSource, 'arena' | 'variants'>, index: number): Readonly<Record<string, string>> {
  checkIndex(scenario, index);
  const listed = scenario.variants.objectColors ?? {};
  // fromEntries defines each id as an own field, so an id such as "__proto__" (letters and "_" are allowed) is an object like any other.
  return Object.fromEntries(
    scenario.arena.objects.flatMap((object) => {
      const color = Object.hasOwn(listed, object.id) ? listed[object.id]![index] : object.color;
      return color === undefined ? [] : [[object.id, color] as const];
    }),
  );
}

/**
 * The start pose and the arena a world is built from for these offsets: the scenario's own, moved. The scenario is not changed. An
 * arena in which nothing moved is the scenario's own arena (the same object); a box or cylinder that did not move is the same object too.
 */
export function applyVariant(scenario: VariantSource, offsets: VariantOffsets): { start: PoseCm; arena: Arena } {
  const { arena, start } = scenario;
  if (
    offsets.boxes.length !== arena.boxes.length ||
    offsets.cylinders.length !== arena.cylinders.length ||
    (offsets.objects !== undefined && offsets.objects.length !== arena.objects.length)
  ) {
    throw new RangeError('These offsets are for another arena: they do not have one entry per box and per cylinder (and per object, when they move objects).');
  }
  const moves = (list: readonly ObstacleOffset[]) => list.some((move) => move.dxCm !== 0 || move.dyCm !== 0);
  const shifted = <T extends { centerCm: readonly [number, number] }>(item: T, move: ObstacleOffset): T =>
    move.dxCm === 0 && move.dyCm === 0 ? item : { ...item, centerCm: [item.centerCm[0] + move.dxCm, item.centerCm[1] + move.dyCm] };
  // N19 D1: an object moves by its offset and takes its colour of the variant; one that does neither is the same object.
  const colors = scenario.variants.objectColors === undefined ? undefined : variantObjectColors(scenario, offsets.index);
  const varied = (object: ArenaObject, i: number): ArenaObject => {
    const moved = offsets.objects === undefined ? object : shifted(object, offsets.objects[i]!);
    const color = colors !== undefined && Object.hasOwn(colors, object.id) ? colors[object.id] : object.color;
    return color === object.color ? moved : { ...moved, color };
  };
  const objects = offsets.objects === undefined && colors === undefined ? arena.objects : arena.objects.map(varied);
  const objectsChanged = objects.some((object, i) => object !== arena.objects[i]);
  return {
    start: { xCm: start.xCm + offsets.start.dxCm, yCm: start.yCm + offsets.start.dyCm, yawDeg: start.yawDeg + offsets.start.dYawDeg },
    arena:
      moves(offsets.boxes) || moves(offsets.cylinders) || objectsChanged
        ? {
            ...arena,
            boxes: arena.boxes.map((box, i) => shifted(box, offsets.boxes[i]!)),
            cylinders: arena.cylinders.map((cylinder, i) => shifted(cylinder, offsets.cylinders[i]!)),
            objects: objectsChanged ? objects : arena.objects,
          }
        : arena,
  };
}
