import { BufferGeometry, Float32BufferAttribute, ShapeUtils, Vector2 } from 'three';
import type { Rgba } from './overlay-geometry';

// The geometry of the soft highlight on the zone the next unmet goal needs (N18 R4.3, sensor-overlay.ts): the zone's polygon as a flat
// fill a little over the mat, and its outline as a band along the edges, both in one vertex-coloured mesh (one draw call). Built once for
// each zone a goal names. Every triangle faces up (counter-clockwise seen from above, the arena's x to the right and y away), whichever
// way the polygon is wound.
//
// The band is mitred: at each corner the outer and the inner edge meet on the bisector, so the quads of two edges share the corner's two
// points and never overlap (an overlapping corner would blend twice and read darker). A very sharp corner is cut at MITER_LIMIT times
// the half width.

export type PolygonCm = readonly (readonly [number, number])[];

/** Plain vertices (m, three's frame) and triangles of a flat shape. */
export type Flat = { positions: number[]; index: number[] };

/** An arena point (cm) as a three.js position (m) at height `liftM` over the mat. */
const at = (x: number, y: number, liftM: number): [number, number, number] => [x / 100, liftM, 0 - y / 100];

/** The polygon, filled: triangulated by three's ShapeUtils (earcut), so a zone that is not convex fills right. */
export function zoneFill(polygonCm: PolygonCm, liftM: number): Flat {
  const contour = polygonCm.map(([x, y]) => new Vector2(x, y));
  const faces = ShapeUtils.triangulateShape(contour, []);
  const positions = contour.flatMap((point) => at(point.x, point.y, liftM));
  const index: number[] = [];
  for (const [a, b, c] of faces as [number, number, number][]) {
    const [pa, pb, pc] = [contour[a]!, contour[b]!, contour[c]!];
    const area = (pb.x - pa.x) * (pc.y - pa.y) - (pb.y - pa.y) * (pc.x - pa.x);
    index.push(...(area >= 0 ? [a, b, c] : [a, c, b]));
  }
  return { positions, index };
}

/** A corner is cut when the mitre would be this many times the half width long. */
export const MITER_LIMIT = 3;

/**
 * The polygon's outline: a band of `widthCm` centred on its edges, `widthCm / 2` inside and outside them, the corners mitred. For a
 * simple convex polygon its area is its perimeter times the width, exactly.
 */
export function zoneBand(polygonCm: PolygonCm, widthCm: number, liftM: number): Flat {
  const half = widthCm / 2;
  const n = polygonCm.length;
  const positions: number[] = [];
  for (let i = 0; i < n; i++) {
    const [px, py] = polygonCm[(i + n - 1) % n]!;
    const [x, y] = polygonCm[i]!;
    const [nx, ny] = polygonCm[(i + 1) % n]!;
    const [l0, l1] = [Math.hypot(x - px, y - py) || 1, Math.hypot(nx - x, ny - y) || 1];
    // The unit normals (a quarter turn counter-clockwise from each edge) of the edge into the corner and of the edge out of it.
    const [n0x, n0y] = [0 - (y - py) / l0, (x - px) / l0];
    const [n1x, n1y] = [0 - (ny - y) / l1, (nx - x) / l1];
    let [mx, my] = [n0x + n1x, n0y + n1y];
    const length = Math.hypot(mx, my);
    if (length < 1e-9) {
      // A turn back on itself: the band is cut square.
      [mx, my] = [n1x, n1y];
    } else {
      [mx, my] = [mx / length, my / length];
    }
    // The mitre is half / cos(angle to the normal) long, cut at MITER_LIMIT half widths.
    const cosine = Math.max(1 / MITER_LIMIT, mx * n0x + my * n0y);
    const reach = half / cosine;
    positions.push(...at(x + mx * reach, y + my * reach, liftM), ...at(x - mx * reach, y - my * reach, liftM));
  }
  const index: number[] = [];
  const flat = (a: number, b: number, c: number) => {
    const [ax, az, bx, bz, cx, cz] = [positions[3 * a]!, positions[3 * a + 2]!, positions[3 * b]!, positions[3 * b + 2]!, positions[3 * c]!, positions[3 * c + 2]!];
    // Counter-clockwise seen from above is x to the right, −z away: the sign of the same cross product with z turned back into y.
    const area = (bx - ax) * (0 - (cz - az)) - (0 - (bz - az)) * (cx - ax);
    index.push(...(area >= 0 ? [a, b, c] : [a, c, b]));
  };
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    flat(2 * i, 2 * i + 1, 2 * j);
    flat(2 * i + 1, 2 * j + 1, 2 * j);
  }
  return { positions, index };
}

/** The zone's highlight as one mesh's geometry: the fill in `fill`, the band in `edge` (RGBA vertex colours). */
export function zoneHighlightGeometry(polygonCm: PolygonCm, fill: Rgba, edge: Rgba, bandCm: number, liftM: number): BufferGeometry {
  const filled = zoneFill(polygonCm, liftM);
  const band = zoneBand(polygonCm, bandCm, liftM + 0.0005);
  const positions = [...filled.positions, ...band.positions];
  const offset = filled.positions.length / 3;
  const index = [...filled.index, ...band.index.map((i) => i + offset)];
  const colors = [...Array.from({ length: offset }, () => fill).flat(), ...Array.from({ length: band.positions.length / 3 }, () => edge).flat()];
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 4));
  geometry.setIndex(index);
  return geometry;
}
