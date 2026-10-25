import { describe, expect, it } from 'vitest';
import type { BufferGeometry } from 'three';
import { zoneBandGeometry, zoneFillGeometry, type PolygonCm } from './zone-highlight';

// N18 R4.3: the soft highlight of the next goal's zone is the zone's own polygon, flat over the mat and facing up, whichever way the
// polygon is wound and whether or not it is convex.

/** The triangles of a geometry: their area (m²) and whether each faces up (+Y), by their normals. */
function triangles(geometry: BufferGeometry): { area: number; up: boolean; heights: number[] }[] {
  const position = geometry.getAttribute('position');
  const index = geometry.getIndex()!;
  const out: { area: number; up: boolean; heights: number[] }[] = [];
  for (let i = 0; i < index.count; i += 3) {
    const [a, b, c] = [index.getX(i), index.getX(i + 1), index.getX(i + 2)];
    const [ux, uy, uz] = [position.getX(b) - position.getX(a), position.getY(b) - position.getY(a), position.getZ(b) - position.getZ(a)];
    const [vx, vy, vz] = [position.getX(c) - position.getX(a), position.getY(c) - position.getY(a), position.getZ(c) - position.getZ(a)];
    const normal = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx] as const;
    out.push({ area: Math.hypot(...normal) / 2, up: normal[1] > 0, heights: [a, b, c].map((v) => position.getY(v)) });
  }
  return out;
}

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

describe('the fill of a zone', () => {
  it('covers the rectangle exactly, 3 mm over the mat, every triangle facing up', () => {
    const found = triangles(zoneFillGeometry(rectangle, 0.003));
    expect(found).toHaveLength(2);
    expect(found.reduce((sum, t) => sum + t.area, 0)).toBeCloseTo(0.2 * 0.8, 6);
    expect(found.every((t) => t.up)).toBe(true);
    expect(found.flatMap((t) => t.heights).every((h) => h === Math.fround(0.003))).toBe(true);
  });

  it('faces up whichever way the polygon is wound', () => {
    const clockwise = [...rectangle].reverse();
    const found = triangles(zoneFillGeometry(clockwise, 0.003));
    expect(found.every((t) => t.up)).toBe(true);
    expect(found.reduce((sum, t) => sum + t.area, 0)).toBeCloseTo(0.16, 6);
  });

  it('fills a polygon that is not convex without covering its notch', () => {
    for (const polygon of [ell, [...ell].reverse()]) {
      const found = triangles(zoneFillGeometry(polygon, 0.003));
      expect(found.reduce((sum, t) => sum + t.area, 0)).toBeCloseTo(0.12, 6);
      expect(found.every((t) => t.up)).toBe(true);
    }
  });

  it('places the polygon as the 3D view places the arena: x along +X, y along −Z', () => {
    const position = zoneFillGeometry(rectangle, 0.003).getAttribute('position');
    expect([position.getX(0), position.getY(0), position.getZ(0)].map((v) => Math.round(v * 1e6) / 1e6)).toEqual([1.26, 0.003, -0.1]);
  });
});

describe('the outline of a zone', () => {
  it('is a quad on each edge, centred on it, past both ends by half its width, every one facing up', () => {
    const found = triangles(zoneBandGeometry(rectangle, 1.2, 0.0035));
    expect(found).toHaveLength(8);
    expect(found.every((t) => t.up)).toBe(true);
    // Edges of 20, 80, 20 and 80 cm, each (length + 1.2) × 1.2 cm.
    const area = (20 + 1.2 + (80 + 1.2) + (20 + 1.2) + (80 + 1.2)) * 1.2;
    expect(found.reduce((sum, t) => sum + t.area, 0)).toBeCloseTo(area / 10000, 6);
  });

  it('faces up whichever way the polygon is wound', () => {
    expect(triangles(zoneBandGeometry([...rectangle].reverse(), 1.2, 0.0035)).every((t) => t.up)).toBe(true);
    expect(triangles(zoneBandGeometry([...ell].reverse(), 1.2, 0.0035)).every((t) => t.up)).toBe(true);
  });

  it('reaches half its width outside the zone and half inside', () => {
    const position = zoneBandGeometry(rectangle, 1.2, 0.0035).getAttribute('position');
    const xs = Array.from({ length: position.count }, (_, i) => position.getX(i));
    expect(Math.min(...xs)).toBeCloseTo(1.254, 5);
    expect(Math.max(...xs)).toBeCloseTo(1.466, 5);
  });
});
