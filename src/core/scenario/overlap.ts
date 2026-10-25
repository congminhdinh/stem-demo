import { cos, sin } from '../world/dmath';
import { degToRad } from '../world/units';

// Flat shapes on the arena floor, for the one question the variants (variants.ts) ask: does this thing touch that thing?
// A circle (a cylinder, the robot's footprint) or a box turned by a yaw (a box, an object, a wall). Lengths are centimetres,
// the frame is the arena's (x right, y away, yaw counter-clockwise from +x). Touching is not overlapping: a jittered box may
// stand against a wall.
//
// The yaw goes through dmath, never `Math.sin`/`Math.cos`, and the right angles are exact, so an accept or a reject (and with it
// a variant) cannot differ from one JS engine to another.

export type Shape =
  | { readonly kind: 'circle'; readonly x: number; readonly y: number; readonly r: number }
  | {
      readonly kind: 'rect';
      readonly x: number;
      readonly y: number;
      /** Half of the side along the box's own x axis, and half of the side along its y axis. */
      readonly hx: number;
      readonly hy: number;
      /** The cosine and sine of the box's yaw: its x axis in the arena is (cos, sin). */
      readonly cos: number;
      readonly sin: number;
    };

export const circleShape = (x: number, y: number, r: number): Shape => ({ kind: 'circle', x, y, r });

/** A box with half-sides `hx` (along its x) and `hy`, turned `yawDeg` counter-clockwise. */
export function rectShape(x: number, y: number, hx: number, hy: number, yawDeg: number): Shape {
  const [c, s] = cosSin(yawDeg);
  return { kind: 'rect', x, y, hx, hy, cos: c, sin: s };
}

/**
 * A wall (arena-schema.ts): the box along the segment (x0, y0) → (x1, y1) with square ends that reach thickness/2 past both points.
 * Its x axis is the segment's direction, taken without trigonometry. The segment must have a length (the arena schema sees to it).
 */
export function wallShape(x0: number, y0: number, x1: number, y1: number, thicknessCm: number): Shape {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const run = Math.sqrt(dx * dx + dy * dy);
  return { kind: 'rect', x: (x0 + x1) / 2, y: (y0 + y1) / 2, hx: (run + thicknessCm) / 2, hy: thicknessCm / 2, cos: dx / run, sin: dy / run };
}

/** cos and sin of a yaw in degrees: exact at the right angles, dmath’s everywhere else. */
function cosSin(yawDeg: number): [number, number] {
  const turn = ((yawDeg % 360) + 360) % 360;
  if (turn === 0) return [1, 0];
  if (turn === 90) return [0, 1];
  if (turn === 180) return [-1, 0];
  if (turn === 270) return [0, -1];
  const rad = degToRad(turn);
  return [cos(rad), sin(rad)];
}

export function shapesOverlap(a: Shape, b: Shape): boolean {
  if (a.kind === 'circle') {
    return b.kind === 'circle' ? circlesOverlap(a, b) : circleHitsRect(a, b);
  }
  return b.kind === 'circle' ? circleHitsRect(b, a) : rectsOverlap(a, b);
}

type Circle = Extract<Shape, { kind: 'circle' }>;
type Rect = Extract<Shape, { kind: 'rect' }>;

function circlesOverlap(a: Circle, b: Circle): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const reach = a.r + b.r;
  return dx * dx + dy * dy < reach * reach;
}

/** The circle's centre in the box's frame, then the nearest point of the box to it. */
function circleHitsRect(circle: Circle, rect: Rect): boolean {
  const dx = circle.x - rect.x;
  const dy = circle.y - rect.y;
  const lx = dx * rect.cos + dy * rect.sin;
  const ly = dy * rect.cos - dx * rect.sin;
  const nx = Math.max(-rect.hx, Math.min(rect.hx, lx));
  const ny = Math.max(-rect.hy, Math.min(rect.hy, ly));
  const gx = lx - nx;
  const gy = ly - ny;
  return gx * gx + gy * gy < circle.r * circle.r;
}

/** Separating axis test on the four side directions: boxes overlap when no axis separates them. */
function rectsOverlap(a: Rect, b: Rect): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const axes: [number, number][] = [
    [a.cos, a.sin],
    [-a.sin, a.cos],
    [b.cos, b.sin],
    [-b.sin, b.cos],
  ];
  for (const [ax, ay] of axes) {
    if (Math.abs(dx * ax + dy * ay) >= radiusOn(a, ax, ay) + radiusOn(b, ax, ay)) return false;
  }
  return true;
}

/** How far the box reaches from its centre along the unit direction (ax, ay). */
function radiusOn(rect: Rect, ax: number, ay: number): number {
  return rect.hx * Math.abs(ax * rect.cos + ay * rect.sin) + rect.hy * Math.abs(-ax * rect.sin + ay * rect.cos);
}

/** Whether the whole shape lies on the ground, 0..widthCm by 0..depthCm, its borders included. */
export function insideGround(shape: Shape, widthCm: number, depthCm: number): boolean {
  const [ex, ey] =
    shape.kind === 'circle'
      ? [shape.r, shape.r]
      : [shape.hx * Math.abs(shape.cos) + shape.hy * Math.abs(shape.sin), shape.hx * Math.abs(shape.sin) + shape.hy * Math.abs(shape.cos)];
  return shape.x - ex >= 0 && shape.x + ex <= widthCm && shape.y - ey >= 0 && shape.y + ey <= depthCm;
}
