import { BufferGeometry, Float32BufferAttribute, ShapeUtils, Vector2 } from 'three';

// The geometry of the soft highlight on the zone the next unmet goal needs (N18 R4.3, sensor-overlay.ts): the zone's polygon as a flat
// fill a little over the mat, and its outline as a band of thin quads along the edges. Built once for each zone a goal names. Every
// triangle faces up (counter-clockwise seen from above, the arena's x to the right and y away), whichever way the polygon is wound.

export type PolygonCm = readonly (readonly [number, number])[];

/** An arena point (cm) as a three.js position (m) at height `liftM` over the mat. */
const at = (x: number, y: number, liftM: number): [number, number, number] => [x / 100, liftM, 0 - y / 100];

/** The polygon, filled: triangulated by three's ShapeUtils (earcut), so a zone that is not convex fills right. */
export function zoneFillGeometry(polygonCm: PolygonCm, liftM: number): BufferGeometry {
  const contour = polygonCm.map(([x, y]) => new Vector2(x, y));
  const faces = ShapeUtils.triangulateShape(contour, []);
  const positions = contour.flatMap((point) => at(point.x, point.y, liftM));
  const index: number[] = [];
  for (const [a, b, c] of faces as [number, number, number][]) {
    const [pa, pb, pc] = [contour[a]!, contour[b]!, contour[c]!];
    const area = (pb.x - pa.x) * (pc.y - pa.y) - (pb.y - pa.y) * (pc.x - pa.x);
    index.push(...(area >= 0 ? [a, b, c] : [a, c, b]));
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setIndex(index);
  return geometry;
}

/**
 * The polygon's outline: a quad of `widthCm` on each edge, centred on it and `widthCm / 2` past both ends (a square join at a corner),
 * so the band is as wide inside the zone as outside.
 */
export function zoneBandGeometry(polygonCm: PolygonCm, widthCm: number, liftM: number): BufferGeometry {
  const half = widthCm / 2;
  const positions: number[] = [];
  const index: number[] = [];
  for (let i = 0; i < polygonCm.length; i++) {
    const [x0, y0] = polygonCm[i]!;
    const [x1, y1] = polygonCm[(i + 1) % polygonCm.length]!;
    const length = Math.hypot(x1 - x0, y1 - y0);
    if (length === 0) continue;
    const [ex, ey] = [(x1 - x0) / length, (y1 - y0) / length];
    // The edge's own frame: e along the edge, n a quarter turn counter-clockwise from it (a right-handed pair seen from above).
    const [nx, ny] = [0 - ey, ex];
    const corners: [number, number][] = [
      [x0 - ex * half - nx * half, y0 - ey * half - ny * half],
      [x1 + ex * half - nx * half, y1 + ey * half - ny * half],
      [x1 + ex * half + nx * half, y1 + ey * half + ny * half],
      [x0 - ex * half + nx * half, y0 - ey * half + ny * half],
    ];
    const first = positions.length / 3;
    for (const [x, y] of corners) positions.push(...at(x, y, liftM));
    index.push(first, first + 1, first + 2, first, first + 2, first + 3);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setIndex(index);
  return geometry;
}
