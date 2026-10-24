import { cos, sin } from '../dmath';
import type { Arena, PointCm } from './arena-schema';

// What a downward-looking line sensor sees on the arena floor (N18 R3.2; read by sensors/line.ts, R3.4).
// The paint is vectors, never a texture: a reading is the same on every engine and at any scale, and only
// the lines and zones near the sensor are tested. Layers, top first:
//   1. lines: black tape, reflectance 0;
//   2. zones, the later one over the earlier: the zone's `reflectance`, or its colour's luma;
//   3. the ground: its `reflectance`, or its colour's luma;
// and beyond the ground there is nothing to reflect: 0, as a real sensor over an edge reads dark.
// The sensor's spot is a disc of radius `radiusCm`, read as the area-weighted mean over a fixed pattern of
// points. Under one surface only, a reading is that surface's reflectance exactly.

/** Reflectance of the black tape lines. */
export const LINE_REFLECTANCE = 0;
/** Reflectance where there is no ground under the sensor. */
export const OFF_GROUND_REFLECTANCE = 0;

/**
 * The reflectance a colour stands for: its Rec. 709 luma on the sRGB values, (0.2126 R + 0.7152 G +
 * 0.0722 B) / 255. Integer weights keep white at exactly 1 and black at exactly 0.
 */
export function colorReflectance(color: string): number {
  const rgb = Number.parseInt(color.slice(1), 16);
  const r = (rgb >> 16) & 0xff;
  const g = (rgb >> 8) & 0xff;
  const b = rgb & 0xff;
  return (2126 * r + 7152 * g + 722 * b) / (10000 * 255);
}

/**
 * The spot pattern, as (u, v) pairs in the unit disc: the cell centres of a 16 × 16 grid over the disc's
 * bounding square that fall inside it, turned by 0.5 rad. An axis-aligned grid puts its points in rows
 * that an axis-aligned edge (most arenas) crosses all at once, which makes readings jump in steps of up to
 * 0.08; turned, the points project to distinct offsets on every axis and the fraction of a straight band
 * under the spot is within about 0.02 of its area. The pattern is symmetric through the centre with no
 * point on it, so a spot centred on a straight edge reads exactly half of each side, at any angle.
 */
const GRID = 16;
const SPOT_TURN_RAD = 0.5;
const SPOT: readonly number[] = (() => {
  const c = cos(SPOT_TURN_RAD);
  const s = sin(SPOT_TURN_RAD);
  const offsets: number[] = [];
  for (let i = 0; i < GRID; i++) {
    for (let j = 0; j < GRID; j++) {
      const u = (2 * i + 1 - GRID) / GRID;
      const v = (2 * j + 1 - GRID) / GRID;
      if (u * u + v * v <= 1) offsets.push(u * c - v * s, u * s + v * c);
    }
  }
  return offsets;
})();

/** How many points one reading samples (when the radius is not 0). */
export const LINE_SAMPLE_COUNT = SPOT.length / 2;

export type GroundPaint = {
  /**
   * The mean reflectance (0 dark .. 1 white) of the floor in the disc of radius `radiusCm` around
   * (`xCm`, `yCm`), in arena coordinates. A radius of 0 reads the single point.
   */
  groundReflectanceAt(xCm: number, yCm: number, radiusCm: number): number;
};

const OFF_GROUND = 0;
const LINE = 1;
const GROUND = 2;
const FIRST_ZONE = 3;

type Segment = {
  ax: number;
  ay: number;
  dx: number;
  dy: number;
  /** |b − a|²; 0 for a segment of two equal points, which paints a dot. */
  length2: number;
  halfWidth2: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

type Zone = {
  /** Where its sample count is kept: after the off-ground, line and ground surfaces. */
  surface: number;
  /** x0, y0, x1, y1, … */
  coords: readonly number[];
  reflectance: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

export function createGroundPaint(arena: Pick<Arena, 'ground' | 'paint'>): GroundPaint {
  const [width, depth] = arena.ground.sizeCm;
  const groundReflectance = arena.ground.reflectance ?? colorReflectance(arena.ground.color);
  const segments: Segment[] = arena.paint.lines.flatMap((line) => {
    const halfWidth = line.widthCm / 2;
    return line.pointsCm.slice(1).map((b, k) => segmentOf(line.pointsCm[k]!, b, halfWidth));
  });
  const zones: Zone[] = arena.paint.zones.map((zone, i) => {
    const xs = zone.polygonCm.map(([x]) => x);
    const ys = zone.polygonCm.map(([, y]) => y);
    return {
      surface: FIRST_ZONE + i,
      coords: zone.polygonCm.flat(),
      reflectance: zone.reflectance ?? colorReflectance(zone.color),
      minX: Math.min(...xs),
      minY: Math.min(...ys),
      maxX: Math.max(...xs),
      maxY: Math.max(...ys),
    };
  });

  // The reflectance of each surface a sample can land on, and the samples a reading counts on each.
  const reflectances = [OFF_GROUND_REFLECTANCE, LINE_REFLECTANCE, groundReflectance, ...zones.map((zone) => zone.reflectance)];
  const counts = new Int32Array(reflectances.length);
  // Reused by every reading: the segments and zones whose bounds meet the spot's square.
  const nearSegments: Segment[] = [];
  const nearZones: Zone[] = [];

  const surfaceAt = (x: number, y: number): number => {
    if (!(x >= 0 && x <= width && y >= 0 && y <= depth)) return OFF_GROUND;
    for (const segment of nearSegments) {
      if (onSegment(segment, x, y)) return LINE;
    }
    for (let i = nearZones.length - 1; i >= 0; i--) {
      if (insidePolygon(nearZones[i]!.coords, x, y)) return nearZones[i]!.surface;
    }
    return GROUND;
  };

  return {
    groundReflectanceAt(xCm, yCm, radiusCm) {
      if (!(radiusCm >= 0)) {
        throw new RangeError(`A sensor spot radius is 0 or more, not ${radiusCm}.`);
      }
      const minX = xCm - radiusCm;
      const maxX = xCm + radiusCm;
      const minY = yCm - radiusCm;
      const maxY = yCm + radiusCm;
      nearSegments.length = 0;
      for (const segment of segments) {
        if (segment.minX <= maxX && segment.maxX >= minX && segment.minY <= maxY && segment.maxY >= minY) nearSegments.push(segment);
      }
      nearZones.length = 0;
      for (const zone of zones) {
        if (zone.minX <= maxX && zone.maxX >= minX && zone.minY <= maxY && zone.maxY >= minY) nearZones.push(zone);
      }
      if (radiusCm === 0) return reflectances[surfaceAt(xCm, yCm)]!;
      // Plain ground under the whole spot: every sample would read the same.
      if (nearSegments.length === 0 && nearZones.length === 0 && minX >= 0 && maxX <= width && minY >= 0 && maxY <= depth) {
        return groundReflectance;
      }
      counts.fill(0);
      for (let k = 0; k < SPOT.length; k += 2) {
        counts[surfaceAt(xCm + radiusCm * SPOT[k]!, yCm + radiusCm * SPOT[k + 1]!)]! += 1;
      }
      let sum = 0;
      for (let surface = 0; surface < counts.length; surface++) {
        const count = counts[surface]!;
        if (count === LINE_SAMPLE_COUNT) return reflectances[surface]!;
        sum += count * reflectances[surface]!;
      }
      return sum / LINE_SAMPLE_COUNT;
    },
  };
}

function segmentOf(a: PointCm, b: PointCm, halfWidth: number): Segment {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  return {
    ax: a[0],
    ay: a[1],
    dx,
    dy,
    length2: dx * dx + dy * dy,
    halfWidth2: halfWidth * halfWidth,
    minX: Math.min(a[0], b[0]) - halfWidth,
    minY: Math.min(a[1], b[1]) - halfWidth,
    maxX: Math.max(a[0], b[0]) + halfWidth,
    maxY: Math.max(a[1], b[1]) + halfWidth,
  };
}

/** Whether (x, y) is within half the line width of the segment (round ends). */
function onSegment(s: Segment, x: number, y: number): boolean {
  const px = x - s.ax;
  const py = y - s.ay;
  const t = s.length2 === 0 ? 0 : Math.min(1, Math.max(0, (px * s.dx + py * s.dy) / s.length2));
  const ex = px - t * s.dx;
  const ey = py - t * s.dy;
  return ex * ex + ey * ey <= s.halfWidth2;
}

/** Even-odd point-in-polygon (crossing number), over [x0, y0, x1, y1, …]. */
function insidePolygon(coords: readonly number[], x: number, y: number): boolean {
  let inside = false;
  const n = coords.length;
  for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
    const xi = coords[i]!;
    const yi = coords[i + 1]!;
    const xj = coords[j]!;
    const yj = coords[j + 1]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
