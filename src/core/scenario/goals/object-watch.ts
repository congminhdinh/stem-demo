import type { ArenaObject, PointCm } from '../../world/arena/arena-schema';
import { circleShape, rectShape, type Shape } from '../overlap';
import type { GoalFrame, GoalObject } from './frame';
import type { GoalContext } from './goal';
import { insidePolygon } from './geometry';
import { TIME_EPSILON_S } from './hold';

// What the pick-and-place goals (N19 D2, plan §4.5) watch of an object over a run: whether the gripper holds it, whether the robot touches
// it, whether it was carried there (held, let go, and not pushed since), whether it has come to rest, and whether it lies wholly in a zone.
// Plain + − × ÷ and Math.sqrt on the frames' numbers, so every engine judges the same; the one angle, an object's yaw, goes through
// overlap.ts (dmath, exact at the right angles), and its tilt is the frame's own number in degrees.

/** How far an object may still move, cm, over the rest time of a goal and be at rest (plan §4.5: "moved at most 0.3 cm"). */
export const REST_MOVE_CM = 0.3;
/** How far an object may slide after it was let go, cm, for `object-on-object` (`object-placed` says its own, `maxSlideCm`, 3 by default). */
export const STACK_MAX_SLIDE_CM = 3;
/** Lengths this close to a limit are at it: positions in doubles are a few ulps off (as travel.ts TRAVEL_EPSILON_CM). */
export const LENGTH_EPSILON_CM = 1e-9;

/** The arena object `id` of the goal's arena; a goal is made from a spec the schema has checked, so a miss is a bug: it throws. */
export function arenaObject(ctx: Pick<GoalContext, 'arena'>, id: string): ArenaObject {
  const object = ctx.arena.objects.find((candidate) => candidate.id === id);
  if (object === undefined) {
    const ids = ctx.arena.objects.map((candidate) => candidate.id);
    throw new Error(`There is no object "${id}" in the arena (${ids.length > 0 ? `objects: ${ids.join(', ')}` : 'the arena has no objects'}).`);
  }
  return object;
}

/** The height of an object as the arena gives it, cm (a box's third size, a cylinder's height). */
export const objectHeightCm = (object: ArenaObject): number => (object.shape === 'box' ? object.sizeCm[2] : object.heightCm);

/** The object `id` on this frame, or undefined: an object the frame does not have is nowhere. */
export function objectOn(frame: GoalFrame, id: string): GoalObject | undefined {
  return Object.hasOwn(frame.objects, id) ? frame.objects[id] : undefined;
}

/** Whether the gripper holds `id` on this frame: the object says so (`held`), or the gripper does (`heldId`). */
export function isHeld(frame: GoalFrame, id: string): boolean {
  return objectOn(frame, id)?.held === true || frame.gripper?.heldId === id;
}

/** Whether the robot touches `id` on this frame (an object it holds touching it counts: plan §4.4, a held object is part of the robot). */
export function touches(frame: GoalFrame, id: string): boolean {
  return frame.contacts.some((contact) => contact.otherId === id);
}

/** How far apart two places of an object are, cm: in 3D when both have a height, on the floor otherwise. */
export function distanceCm(a: Pick<GoalObject, 'xCm' | 'yCm' | 'zCm'>, b: Pick<GoalObject, 'xCm' | 'yCm' | 'zCm'>): number {
  const dx = a.xCm - b.xCm;
  const dy = a.yCm - b.yCm;
  const dz = a.zCm !== undefined && b.zCm !== undefined ? a.zCm - b.zCm : 0;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** How far apart two places are on the floor, cm. */
export function floorDistanceCm(a: Pick<GoalObject, 'xCm' | 'yCm'>, b: Pick<GoalObject, 'xCm' | 'yCm'>): number {
  const dx = a.xCm - b.xCm;
  const dy = a.yCm - b.yCm;
  return Math.sqrt(dx * dx + dy * dy);
}

/** An object's tilt as the frame gives it, degrees; a frame that does not say is upright (frame.ts). */
export const tiltOf = (pose: GoalObject): number => pose.tiltDeg ?? 0;

/**
 * Whether an object was carried (plan §4.5 `carried`): held by the gripper, let go, and slid no more than `maxSlideCm` on the floor since it
 * was let go. Fed every frame. It also tells an object that was pushed without ever being held from one that was left alone: before the first
 * hold, its slide is from where it was on the first frame.
 */
export type CarryWatch = {
  update(frame: GoalFrame): void;
  /** Held on the last frame. */
  readonly heldNow: boolean;
  /** Held on some frame. */
  readonly everHeld: boolean;
  /** Where and when it was last let go (the first frame not held after a hold); undefined while it is held or has never been. */
  readonly release: { readonly xCm: number; readonly yCm: number; readonly tS: number } | undefined;
  /** The farthest it has been, on the floor, from where it was let go (or, never held, from where it started), cm. */
  readonly slideCm: number;
  /** When `slideCm` first went past the limit, since the last release (or, never held, since the start); undefined while it has not. */
  readonly pushedAtS: number | undefined;
};

export function createCarryWatch(id: string, maxSlideCm: number): CarryWatch {
  let start: { xCm: number; yCm: number } | undefined;
  let heldNow = false;
  let everHeld = false;
  let release: CarryWatch['release'];
  let slideCm = 0;
  let pushedAtS: number | undefined;
  return {
    update(frame) {
      const pose = objectOn(frame, id);
      const held = isHeld(frame, id);
      if (pose === undefined || !Number.isFinite(pose.xCm) || !Number.isFinite(pose.yCm)) {
        heldNow = held;
        return;
      }
      start ??= { xCm: pose.xCm, yCm: pose.yCm };
      if (held) {
        heldNow = true;
        everHeld = true;
        release = undefined;
        slideCm = 0;
        pushedAtS = undefined;
        return;
      }
      if (heldNow) release = { xCm: pose.xCm, yCm: pose.yCm, tS: frame.tS };
      heldNow = false;
      const from = everHeld ? release : start;
      if (from === undefined) return;
      slideCm = Math.max(slideCm, floorDistanceCm(pose, from));
      if (pushedAtS === undefined && slideCm > maxSlideCm + LENGTH_EPSILON_CM) pushedAtS = frame.tS;
    },
    get heldNow() {
      return heldNow;
    },
    get everHeld() {
      return everHeld;
    },
    get release() {
      return release;
    },
    get slideCm() {
      return slideCm;
    },
    get pushedAtS() {
      return pushedAtS;
    },
  };
}

/**
 * Whether an object is at rest at the end (plan §4.5): for the last `restS` of the run, timed as hold.ts times a hold (from the first frame
 * of the stretch to the last), it was not held, the robot did not touch it, and it stayed within REST_MOVE_CM of where it is on the last
 * frame. Keeps only the frames that time needs.
 */
export type RestWatch = {
  update(frame: GoalFrame, dtS: number): void;
  /** At rest on the last frame fed. */
  atRest(): boolean;
};

type RestSample = { readonly dtS: number; readonly pose: GoalObject | undefined; readonly calm: boolean };

export function createRestWatch(id: string, restS: number): RestWatch {
  const samples: RestSample[] = [];
  /** The sum of the ticks of every sample but the first: the longest stretch the samples can time. */
  let spanS = 0;
  return {
    update(frame, dtS) {
      const pose = objectOn(frame, id);
      const calm = pose !== undefined && !isHeld(frame, id) && !touches(frame, id);
      samples.push({ dtS, pose, calm });
      if (samples.length > 1) spanS += dtS;
      // The first sample is not needed once the ones after it time the whole rest on their own.
      while (samples.length > 2 && spanS - samples[1]!.dtS >= restS) {
        samples.shift();
        spanS -= samples[0]!.dtS;
      }
    },
    atRest() {
      const last = samples.at(-1)?.pose;
      if (last === undefined) return false;
      let heldS = 0;
      for (let i = samples.length - 1; i >= 0; i--) {
        const sample = samples[i]!;
        if (!sample.calm || sample.pose === undefined || distanceCm(sample.pose, last) > REST_MOVE_CM + LENGTH_EPSILON_CM) return false;
        if (heldS >= restS - TIME_EPSILON_S) return true;
        heldS += sample.dtS;
      }
      return false;
    },
  };
}

/** The footprint of an arena object standing at `pose` (its place and yaw on this frame). */
export function objectShape(object: ArenaObject, pose: Pick<GoalObject, 'xCm' | 'yCm' | 'yawDeg'>): Shape {
  return object.shape === 'box' ? rectShape(pose.xCm, pose.yCm, object.sizeCm[0] / 2, object.sizeCm[1] / 2, pose.yawDeg) : circleShape(pose.xCm, pose.yCm, object.radiusCm);
}

/**
 * Whether the whole footprint lies in the zone's polygon (plan §4.5 `fully`), by the point-in-polygon rule of geometry.ts: a box when its four
 * corners are in it and no edge of the zone crosses the box or ends inside it; a circle when its middle is in it and no edge of the zone comes
 * nearer than its radius. A footprint that only touches the zone's edge from inside is in it.
 */
export function shapeInsidePolygon(polygon: readonly PointCm[], shape: Shape): boolean {
  const edges = polygon.map((point, i): [PointCm, PointCm] => [polygon[i === 0 ? polygon.length - 1 : i - 1]!, point]);
  if (shape.kind === 'circle') {
    if (!insidePolygon(polygon, shape.x, shape.y)) return false;
    return edges.every(([a, b]) => squaredDistanceToSegment(shape.x, shape.y, a, b) >= shape.r * shape.r);
  }
  const corner = (u: number, v: number): PointCm => [shape.x + u * shape.cos - v * shape.sin, shape.y + u * shape.sin + v * shape.cos];
  const corners = [corner(-shape.hx, -shape.hy), corner(shape.hx, -shape.hy), corner(shape.hx, shape.hy), corner(-shape.hx, shape.hy)];
  if (!corners.every(([x, y]) => insidePolygon(polygon, x, y))) return false;
  const inBox = ([x, y]: PointCm) => {
    const dx = x - shape.x;
    const dy = y - shape.y;
    return Math.abs(dx * shape.cos + dy * shape.sin) < shape.hx && Math.abs(dy * shape.cos - dx * shape.sin) < shape.hy;
  };
  if (polygon.some(inBox)) return false;
  const sides = corners.map((point, i): [PointCm, PointCm] => [corners[i === 0 ? 3 : i - 1]!, point]);
  return !edges.some(([a, b]) => sides.some(([c, d]) => segmentsCross(a, b, c, d)));
}

function squaredDistanceToSegment(px: number, py: number, [ax, ay]: PointCm, [bx, by]: PointCm): number {
  const dx = bx - ax;
  const dy = by - ay;
  const length2 = dx * dx + dy * dy;
  const t = length2 === 0 ? 0 : Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / length2));
  const gx = px - (ax + t * dx);
  const gy = py - (ay + t * dy);
  return gx * gx + gy * gy;
}

/** Whether two segments cross at a point inside both (touching at an end, or lying along each other, is not crossing). */
function segmentsCross(a: PointCm, b: PointCm, c: PointCm, d: PointCm): boolean {
  const side = (p: PointCm, q: PointCm, r: PointCm) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  return side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0;
}
