import { describe, expect, it } from 'vitest';
import { MITER_LIMIT, zoneBand, zoneFill, zoneHighlightGeometry, type Flat, type PolygonCm } from './zone-highlight';
import { rgba } from './overlay-geometry';

// N18 R4.3: the soft highlight of the next goal's zone is the zone's own polygon, flat over the mat and facing up, whichever way the
// polygon is wound and whether or not it is convex; its outline is a band whose corners are mitred, so that no corner is covered twice
// (a doubly covered corner blends twice and reads darker).

/** The triangles of a flat shape: their area (m²) and whether each faces up (+Y), by their normals. */
function triangles({ positions, index }: Flat): { area: number; up: boolean; heights: number[] }[] {
  const p = (v: number) => [positions[3 * v]!, positions[3 * v + 1]!, positions[3 * v + 2]!] as const;
  const out: { area: number; up: boolean; heights: number[] }[] = [];
  for (let i = 0; i < index.length; i += 3) {
    const [a, b, c] = [p(index[i]!), p(index[i + 1]!), p(index[i + 2]!)];
    const [u, v] = [[b[0] - a[0], b[1] - a[1], b[2] - a[2]], [c[0] - a[0], c[1] - a[1], c[2] - a[2]]] as [number[], number[]];
    const normal = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!] as const;
    out.push({ area: Math.hypot(...normal) / 2, up: normal[1] > 0, heights: [a[1], b[1], c[1]] });
  }
  return out;
}
const areaOf = (shape: Flat) => triangles(shape).reduce((sum, t) => sum + t.area, 0);

const rectangle: PolygonCm = [
  [126, 10],
  [146, 10],
  [146, 90],
  [126, 90],
];
// An L: a 40 × 20 bar with a 20 × 20 block on top of its left end (area 1200 cm²), not convex.
const ell: PolygonCm = [
  [0, 0],
  [40, 0],
  [40, 20],
  [20, 20],
  [20, 40],
  [0, 40],
];
const perimeter = (polygon: PolygonCm) => polygon.reduce((sum, [x, y], i) => sum + Math.hypot(polygon[(i + 1) % polygon.length]![0] - x, polygon[(i + 1) % polygon.length]![1] - y), 0);

describe('the fill of a zone', () => {
  it('covers the rectangle exactly, 3 mm over the mat, every triangle facing up', () => {
    const found = triangles(zoneFill(rectangle, 0.003));
    expect(found).toHaveLength(2);
    expect(found.reduce((sum, t) => sum + t.area, 0)).toBeCloseTo(0.2 * 0.8, 12);
    expect(found.every((t) => t.up)).toBe(true);
    expect(found.flatMap((t) => t.heights).every((h) => h === 0.003)).toBe(true);
  });

  it('faces up whichever way the polygon is wound', () => {
    const found = triangles(zoneFill([...rectangle].reverse(), 0.003));
    expect(found.every((t) => t.up)).toBe(true);
    expect(found.reduce((sum, t) => sum + t.area, 0)).toBeCloseTo(0.16, 12);
  });

  it('fills a polygon that is not convex without covering its notch', () => {
    for (const polygon of [ell, [...ell].reverse()]) {
      const found = triangles(zoneFill(polygon, 0.003));
      expect(found.reduce((sum, t) => sum + t.area, 0)).toBeCloseTo(0.12, 12);
      expect(found.every((t) => t.up)).toBe(true);
    }
  });

  it('places the polygon as the 3D view places the arena: x along +X, y along −Z', () => {
    const { positions } = zoneFill(rectangle, 0.003);
    expect(positions.slice(0, 3).map((v) => Math.round(v * 1e6) / 1e6)).toEqual([1.26, 0.003, -0.1]);
  });
});

describe('the outline of a zone', () => {
  it('has the area of its length times its width and no more: the corners are mitred, not covered twice', () => {
    // A rectangle 20 × 80: the band's area is the perimeter (200 cm) times 1.2 cm; overlapping quads at the corners would add 4 × 0.6².
    const band = zoneBand(rectangle, 1.2, 0.0035);
    expect(triangles(band)).toHaveLength(8);
    expect(areaOf(band)).toBeCloseTo((perimeter(rectangle) * 1.2) / 10000, 9);
  });

  it('has the same area, perimeter times width, for a polygon that is not convex, wound either way', () => {
    for (const polygon of [ell, [...ell].reverse()]) expect(areaOf(zoneBand(polygon, 1.2, 0.0035))).toBeCloseTo((perimeter(polygon) * 1.2) / 10000, 9);
  });

  it('faces up whichever way the polygon is wound', () => {
    for (const polygon of [rectangle, [...rectangle].reverse(), ell, [...ell].reverse()]) expect(triangles(zoneBand(polygon, 1.2, 0.0035)).every((t) => t.up)).toBe(true);
  });

  it('reaches half its width outside the zone and half inside, the corner on the bisector', () => {
    const { positions } = zoneBand(rectangle, 1.2, 0.0035);
    const xs = positions.filter((_, i) => i % 3 === 0);
    expect(Math.min(...xs)).toBeCloseTo(1.254, 9);
    expect(Math.max(...xs)).toBeCloseTo(1.466, 9);
    // The corner (126, 10): its outer point is 0.6 cm out along each axis, its inner 0.6 cm in.
    const corners = [0, 1].map((k) => [positions[3 * k]!, positions[3 * k + 2]!]);
    expect(corners.map(([x, z]) => [Math.round(x! * 1e6) / 1e6, Math.round(z! * 1e6) / 1e6]).sort()).toEqual([
      [1.254, -0.094],
      [1.266, -0.106],
    ]);
  });

  it('cuts a very sharp corner at the mitre limit rather than shooting a spike', () => {
    const spike: PolygonCm = [
      [0, 0],
      [100, 4],
      [0, 8],
    ];
    const { positions } = zoneBand(spike, 1.2, 0);
    const reach = Math.max(...positions.filter((_, i) => i % 3 === 0)) * 100 - 100;
    expect(reach).toBeLessThanOrEqual(MITER_LIMIT * 0.6 + 1e-6);
  });
});

describe('the zone’s highlight as one mesh', () => {
  it('has the fill in its colour and the band in its own, one geometry with positions, vertex colours and an index', () => {
    const geometry = zoneHighlightGeometry(rectangle, rgba('#2f7d32', 0.24), rgba('#2f7d32', 0.8), 1.2, 0.003);
    const filled = zoneFill(rectangle, 0.003).positions.length / 3;
    const colors = geometry.getAttribute('color');
    expect(colors.itemSize).toBe(4);
    expect(colors.count).toBe(geometry.getAttribute('position').count);
    expect(colors.getW(0)).toBeCloseTo(0.24, 6);
    expect(colors.getW(filled)).toBeCloseTo(0.8, 6);
    expect(geometry.getIndex()!.count).toBe(3 * (2 + 8));
  });
});
