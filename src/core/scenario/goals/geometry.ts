import type { Arena, PointCm } from '../../world/arena/arena-schema';

// Where things are, for the goals (N18 R6.1). Lengths in centimetres, the arena's frame.

/**
 * Whether the point (x, y) is inside the polygon, even-odd (a crossing count along +x), by exactly the arithmetic that
 * `arena/ground-paint.ts` paints a zone with, so that the robot is "in a zone" precisely when its sensors would read the zone.
 * For the same reason the edge rule is the paint's: a point on a lower or left edge is inside, on an upper or right edge outside
 * (a half-open rule, so zones that tile the floor share no point). Written out here because ground-paint's own is private and
 * works on flat coordinates; geometry.test.ts holds the two together on a grid with the edges and corners on it.
 */
export function insidePolygon(polygon: readonly PointCm[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i]!;
    const [xj, yj] = polygon[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** The polygon of a painted zone by its id. A goal is made from a spec the scenario schema has checked, so a miss is a bug: it throws. */
export function zonePolygon(arena: Pick<Arena, 'paint'>, zoneId: string): readonly PointCm[] {
  const zones = arena.paint.zones;
  const zone = zones.find((candidate) => candidate.id === zoneId);
  if (zone === undefined) {
    throw new Error(`There is no zone "${zoneId}" in the arena (${zones.length > 0 ? `zones: ${zones.map((candidate) => candidate.id).join(', ')}` : 'the arena has no zones'}).`);
  }
  return zone.polygonCm;
}
