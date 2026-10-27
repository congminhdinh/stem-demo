import { describe, expect, it } from 'vitest';
import type { Scenario } from '../../core/scenario/scenario';
import { scenarioCatalog } from '../../samples/robot-scenarios';
import { objectPattern, zonePatternOf, type ZonePatternSpec } from './zone-pattern';

// N19 E8 (E4/E5 review M6): an `area`'s cross-hatch (lines at 45° and 135°) is green's grid (0° and 90°) turned 45°, which a learner who
// cannot tell green from the area's pale yellow could take for green. Checked over every lesson this build ships: the two never meet in one
// arena (lesson 8 has the area and no green; lesson 10 has green and no area), so neither needs another pattern. What each lesson's arena
// shows on the mat and the 2D map is pinned below, so a lesson that brings them together fails here.

/** Every pattern a scenario's arena shows: each zone's, and each object's mark in every colour its rounds paint it. */
function patternsOf(scenario: Scenario): { what: string; spec: ZonePatternSpec }[] {
  const zones = scenario.arena.paint.zones.flatMap((zone) => {
    const spec = zonePatternOf(zone);
    return spec === null ? [] : [{ what: `zone ${zone.id}`, spec }];
  });
  const objects = scenario.arena.objects.flatMap((object) => {
    const colours = new Set([object.color, ...(scenario.variants.objectColors?.[object.id] ?? [])].filter((colour) => colour !== undefined));
    return [...colours].flatMap((colour) => {
      const spec = objectPattern(colour);
      return spec === null ? [] : [{ what: `object ${object.id} ${colour}`, spec }];
    });
  });
  return [...zones, ...objects];
}

/** A lattice of lines (two angles), as its angles turned into 0..90°. */
const lattice = (spec: ZonePatternSpec) => (spec.kind === 'hatch' && spec.anglesDeg.length === 2 ? spec.anglesDeg.map((angle) => ((angle % 90) + 90) % 90).sort((a, b) => a - b) : null);

describe('no lesson shows a lattice and the same lattice turned (N19 E8, M6)', () => {
  it('in no arena does the area’s cross-hatch meet a grid', () => {
    for (const scenario of scenarioCatalog.scenarios) {
      const lattices = patternsOf(scenario).flatMap(({ what, spec }) => {
        const angles = lattice(spec);
        return angles === null ? [] : [{ what, turn: angles[0]! }];
      });
      const turns = new Set(lattices.map((entry) => entry.turn));
      expect(turns.size, `${scenario.key}: ${JSON.stringify(lattices)}`).toBeLessThanOrEqual(1);
    }
  });

  it('the gripper lessons’ patterns: lesson 8 the area’s cross-hatch and no grid, lesson 10 the grid and no cross-hatch', () => {
    const shown = (key: string) => patternsOf(scenarioCatalog.get(key)!).map(({ what, spec }) => `${what}: ${spec.kind === 'dots' ? `dots ${spec.radiusCm}` : `hatch ${spec.anglesDeg.join('/')}`}`);
    expect(shown('rb-grip-pick')).toEqual(['zone start: dots 0.45', 'zone pickup: hatch 45/135', 'zone drop: hatch 45']);
    expect(shown('rb-grip-deliver')).toEqual(['zone start: dots 0.45', 'zone kho: hatch 45']);
    expect(shown('rb-grip-sort')).toEqual([
      'zone start: dots 0.45',
      'zone red-zone: hatch 0',
      'zone green-zone: hatch 0/90',
      'zone blue-zone: dots 0.9',
      'object cube #388e3c: hatch 0/90',
      'object cube #d32f2f: hatch 0',
      'object cube #1976d2: dots 0.38',
    ]);
    expect(shown('rb-grip-stack')).toEqual(['zone start: dots 0.45', 'zone stack: hatch 45', 'object cube #d32f2f: hatch 0']);
  });
});
