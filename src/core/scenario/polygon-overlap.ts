import type { PointCm } from '../world/arena/arena-schema';

// Whether two painted zones share an area (N18 R6.1: the zones of one checkpoints-in-order goal may not). Polygons are even-odd, as the paint
// fills them (arena-schema.ts), and need not be convex. Touching is not overlapping: zones that meet along an edge or at a corner, like
// tiles of a floor, do not overlap.
//
// A scan across x. Between two neighbouring x where anything happens (a vertex of either polygon, or a crossing of two edges) no edge starts,
// ends or crosses another, so the order of the edges is the same all through the slab and the inside of each polygon is the same set of y
// intervals at every x of it. One x in the middle of the slab therefore says for the whole slab: the polygons overlap in it when an interval
// of one and an interval of the other share a stretch of y. That is exact for every layout (containment, the same polygon twice, a part of
// the other that shares an edge with it, crossing like a plus) and takes only + − × ÷, so a zone is judged the same on every engine.

/** An overlap shorter than this, cm, is the rounding of two zones that meet along a slanted edge, not an overlap. */
const MIN_OVERLAP_CM = 1e-9;

/** An edge that is not vertical, written left to right, so that the same edge gives the same numbers whichever way it is wound. */
type Edge = { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number };

function edgesOf(polygon: readonly PointCm[]): Edge[] {
  const edges: Edge[] = [];
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [ax, ay] = polygon[j]!;
    const [bx, by] = polygon[i]!;
    if (ax === bx) continue;
    edges.push(ax < bx ? { x0: ax, y0: ay, x1: bx, y1: by } : { x0: bx, y0: by, x1: ax, y1: ay });
  }
  return edges;
}

/** The x at which two edges cross or touch, or undefined when they are parallel or do not meet. */
function crossingX(p: Edge, q: Edge): number | undefined {
  const rx = p.x1 - p.x0;
  const ry = p.y1 - p.y0;
  const sx = q.x1 - q.x0;
  const sy = q.y1 - q.y0;
  const denominator = rx * sy - ry * sx;
  if (denominator === 0) return undefined; // parallel: where they share a stretch, its ends are vertices, which are breakpoints already
  const dx = q.x0 - p.x0;
  const dy = q.y0 - p.y0;
  const t = (dx * sy - dy * sx) / denominator;
  const u = (dx * ry - dy * rx) / denominator;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? p.x0 + t * rx : undefined;
}

/** The stretches of y inside the polygon at x, from its edges that span x: the edges in order of y, taken two at a time (even-odd). */
function insideAt(edges: readonly Edge[], x: number): [number, number][] {
  const ys = edges
    .filter((edge) => edge.x0 < x && x < edge.x1)
    .map((edge) => edge.y0 + ((edge.y1 - edge.y0) * (x - edge.x0)) / (edge.x1 - edge.x0))
    .sort((a, b) => a - b);
  const stretches: [number, number][] = [];
  for (let k = 0; k + 1 < ys.length; k += 2) stretches.push([ys[k]!, ys[k + 1]!]);
  return stretches;
}

export function polygonsOverlap(a: readonly PointCm[], b: readonly PointCm[]): boolean {
  const edgesA = edgesOf(a);
  const edgesB = edgesOf(b);
  const edges = [...edgesA, ...edgesB];

  const breaks = new Set<number>();
  for (const edge of edges) {
    breaks.add(edge.x0);
    breaks.add(edge.x1);
  }
  for (let i = 0; i < edges.length; i++) {
    for (let j = i + 1; j < edges.length; j++) {
      const x = crossingX(edges[i]!, edges[j]!);
      if (x !== undefined) breaks.add(x);
    }
  }
  const xs = [...breaks].sort((p, q) => p - q);

  for (let k = 0; k + 1 < xs.length; k++) {
    const middle = (xs[k]! + xs[k + 1]!) / 2;
    const insideA = insideAt(edgesA, middle);
    if (insideA.length === 0) continue;
    for (const [lowB, highB] of insideAt(edgesB, middle)) {
      for (const [lowA, highA] of insideA) {
        if (Math.min(highA, highB) - Math.max(lowA, lowB) > MIN_OVERLAP_CM) return true;
      }
    }
  }
  return false;
}
