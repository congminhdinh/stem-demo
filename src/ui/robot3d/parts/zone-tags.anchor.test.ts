import { describe, expect, it } from 'vitest';
import { scenarioCatalog } from '../../../samples/robot-scenarios';
import { translate } from '../../i18n/messages';
import { zoneLabelOf } from '../zone-label';
import { zoneTags } from './zone-tags';

// N19 E8 fix round 1 (review F4): a named zone's tag in the 3D view has its line down to a spot clear of what stands in the zone at the
// start (lesson 8's cube in "Khu lấy hàng", lesson 11's base, and the cube stacked on it, in "Vùng xếp"): by its outer edge, as the 2D
// map paints its name (ground-paint.ts), else its other edge. A zone with nothing in it keeps its tag over its middle (N19 E5).

const labels = { zoneLabel: (zone: Parameters<typeof zoneLabelOf>[1]) => zoneLabelOf((key, params) => translate('vi', key, params), zone) };
const gripperLessons = ['rb-grip-pick', 'rb-grip-deliver', 'rb-grip-sort', 'rb-grip-stack'] as const;

/** What stands on `scenario`'s floor at the start: each body's middle and half extents (cm), axis-aligned round a turned box. */
function footprints(scenario: NonNullable<ReturnType<typeof scenarioCatalog.get>>) {
  const { boxes, cylinders, objects } = scenario.arena;
  return [...boxes, ...cylinders, ...objects].map((body) => {
    if ('radiusCm' in body) return { id: 'id' in body ? body.id : undefined, x: body.centerCm[0], y: body.centerCm[1], hx: body.radiusCm, hy: body.radiusCm };
    const turn = (body.yawDeg * Math.PI) / 180;
    const [sx, sy] = [body.sizeCm[0] / 2, body.sizeCm[1] / 2];
    return { id: body.id, x: body.centerCm[0], y: body.centerCm[1], hx: Math.abs(sx * Math.cos(turn)) + Math.abs(sy * Math.sin(turn)), hy: Math.abs(sx * Math.sin(turn)) + Math.abs(sy * Math.cos(turn)) };
  });
}

describe('a named zone’s tag stands clear of what is in the zone (N19 E8)', () => {
  it('has its line’s foot outside every footprint that starts in the zone, a centimetre clear, in the four gripper lessons', () => {
    let moved = 0;
    for (const key of gripperLessons) {
      const scenario = scenarioCatalog.get(key)!;
      const bodies = footprints(scenario);
      for (const tag of zoneTags(scenario, labels)) {
        const zone = scenario.arena.paint.zones.find((candidate) => candidate.id === tag.zoneId)!;
        const xs = zone.polygonCm.map(([x]) => x);
        const ys = zone.polygonCm.map(([, y]) => y);
        const within = bodies.filter((body) => body.x >= Math.min(...xs) && body.x <= Math.max(...xs) && body.y >= Math.min(...ys) && body.y <= Math.max(...ys));
        const [x, y] = tag.centerCm;
        for (const body of within) expect(Math.abs(x - body.x) >= body.hx + 1 || Math.abs(y - body.y) >= body.hy + 1, `${key} ${zone.id} over ${body.id}`).toBe(true);
        // Inside its zone still.
        expect(x > Math.min(...xs) && x < Math.max(...xs) && y > Math.min(...ys) && y < Math.max(...ys), `${key} ${zone.id}`).toBe(true);
        if (within.length > 0) moved += 1;
      }
    }
    // Lesson 8's pickup zone and lesson 11's stack zone at least.
    expect(moved).toBeGreaterThanOrEqual(2);
  });

  it('puts it by the zone’s outer edge, 15 % of its depth (at least 3 cm) inside, across its middle', () => {
    const scenario = scenarioCatalog.get('rb-grip-pick')!;
    // "Khu lấy hàng": x 70–100, y 25–65 of a 90 cm deep arena; its top and bottom are as far from the middle (a tie: the top), 6 cm inside.
    expect(zoneTags(scenario, labels).find((tag) => tag.zoneId === 'pickup')!.centerCm).toEqual([85, 59]);
    // "Vùng thả" has nothing in it: over its middle.
    expect(zoneTags(scenario, labels).find((tag) => tag.zoneId === 'drop')!.centerCm).toEqual([128, 45]);
    // "Vùng xếp": x 148–168, y 28–52 of an 80 cm deep arena (a tie: the top), 3.6 cm inside, clear of the 6 × 6 base at (158, 40).
    expect(zoneTags(scenarioCatalog.get('rb-grip-stack')!, labels).find((tag) => tag.zoneId === 'stack')!.centerCm).toEqual([158, 48.4]);
  });
});
