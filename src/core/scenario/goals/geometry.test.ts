import { describe, expect, it } from 'vitest';
import { createGroundPaint } from '../../world/arena/ground-paint';
import { parseArena, type PointCm } from '../../world/arena/arena-schema';
import { insidePolygon, zonePolygon } from './geometry';

const square: PointCm[] = [
  [10, 20],
  [50, 20],
  [50, 60],
  [10, 60],
];

describe('insidePolygon', () => {
  it('takes the lower and left edges in and the upper and right edges out, so that tiled zones share no point', () => {
    expect(insidePolygon(square, 10, 40)).toBe(true); // left edge
    expect(insidePolygon(square, 30, 20)).toBe(true); // lower edge
    expect(insidePolygon(square, 10, 20)).toBe(true); // lower-left corner
    expect(insidePolygon(square, 50, 40)).toBe(false); // right edge
    expect(insidePolygon(square, 30, 60)).toBe(false); // upper edge
    expect(insidePolygon(square, 50, 60)).toBe(false); // upper-right corner
    expect(insidePolygon(square, 50, 20)).toBe(false); // lower-right corner
    expect(insidePolygon(square, 10, 60)).toBe(false); // upper-left corner
  });

  it('does not depend on which way the polygon is wound', () => {
    const reversed = [...square].reverse();
    for (const [x, y] of [[10, 40], [30, 20], [50, 40], [30, 60], [30, 40], [5, 40], [60, 40]] as const) {
      expect(insidePolygon(reversed, x, y)).toBe(insidePolygon(square, x, y));
    }
  });

  it('answers for a polygon that is not convex', () => {
    const arrow: PointCm[] = [[0, 0], [40, 0], [40, 40], [20, 10], [0, 40]]; // a notch cut into the top
    expect(insidePolygon(arrow, 5, 5)).toBe(true);
    expect(insidePolygon(arrow, 20, 30)).toBe(false); // inside the notch
    expect(insidePolygon(arrow, 35, 30)).toBe(true);
    expect(insidePolygon(arrow, 3, 30)).toBe(true);
  });

  // Where nothing lies over the zone, the goal and the sensor agree: a point that reads the zone's colour is inside it, and no other is.
  it('is the rule the ground paint paints a zone by, at every point of a fine grid with the edges and corners on it', () => {
    const polygon: PointCm[] = [[10, 20], [50, 20], [50, 60], [30, 40], [10, 60]];
    const arena = parseArena({
      ground: { sizeCm: [80, 80], color: '#ffffff', reflectance: 1 },
      paint: { zones: [{ id: 'z', kind: 'area', polygonCm: polygon, color: '#808080', reflectance: 0.5 }] },
    });
    const paint = createGroundPaint(arena);
    let inside = 0;
    for (let x = 0; x <= 80; x += 2.5) {
      for (let y = 0; y <= 80; y += 2.5) {
        const painted = paint.groundReflectanceAt(x, y, 0) === 0.5;
        expect(insidePolygon(polygon, x, y), `(${x}, ${y})`).toBe(painted);
        if (painted) inside += 1;
      }
    }
    expect(inside).toBeGreaterThan(100); // the grid did land in the zone
  });
});

describe('insidePolygon where the paint is covered', () => {
  const polygon: PointCm[] = [[10, 10], [50, 10], [50, 50], [10, 50]];
  const arena = parseArena({
    ground: { sizeCm: [100, 100], color: '#ffffff', reflectance: 1 },
    paint: {
      lines: [{ pointsCm: [[0, 30], [100, 30]], widthCm: 4 }],
      zones: [
        { id: 'under', kind: 'area', polygonCm: polygon, color: '#808080', reflectance: 0.5 },
        { id: 'over', kind: 'area', polygonCm: [[30, 10], [70, 10], [70, 50], [30, 50]], color: '#404040', reflectance: 0.25 },
      ],
    },
  });
  const paint = createGroundPaint(arena);

  it('says a point under the tape is inside the zone, though a sensor reads the tape', () => {
    expect(paint.groundReflectanceAt(20, 30, 0)).toBe(0);
    expect(insidePolygon(polygon, 20, 30)).toBe(true);
  });

  it('says a point in the overlap is inside both zones, though a sensor reads the later one', () => {
    expect(paint.groundReflectanceAt(40, 20, 0)).toBe(0.25);
    expect(insidePolygon(polygon, 40, 20)).toBe(true);
    expect(insidePolygon([[30, 10], [70, 10], [70, 50], [30, 50]], 40, 20)).toBe(true);
  });
});

describe('zonePolygon', () => {
  const arena = parseArena({
    ground: { sizeCm: [100, 100], color: '#ffffff' },
    paint: { zones: [{ id: 'goal', kind: 'target', polygonCm: square, color: '#00ff00' }] },
  });

  it('finds a zone by its id', () => {
    expect(zonePolygon(arena, 'goal')).toEqual(square);
  });

  it('throws for a zone the arena does not have, naming the zones it has', () => {
    expect(() => zonePolygon(arena, 'nowhere')).toThrow('no zone "nowhere" in the arena (zones: goal)');
    expect(() => zonePolygon(parseArena({ ground: { sizeCm: [10, 10], color: '#ffffff' } }), 'a')).toThrow('the arena has no zones');
  });
});
