import { describe, expect, it } from 'vitest';
import fixture from './__fixtures__/all-goals.scenario.json';
import { loadScenario } from './scenario';
import { ScenarioError } from './scenario-schema';

// The zones of one checkpoints-in-order goal may not overlap each other (N18 R6.1): a robot in the overlap would enter two checkpoints at
// once, and which of them comes first would be a matter of the order of the list. The fixture's route is cp-a, cp-b, dock; its zone
// `gate` is changed here to meet cp-a (x 150..190, y 20..60) in different ways. `gate` is the zone of other goals, which is no matter.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const authored = (gate: number[][], zones: string[]): any => {
  const input = structuredClone(fixture) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
  input.arena.paint.zones.find((zone: { id: string }) => zone.id === 'gate').polygonCm = gate;
  input.goals[1].zones = zones;
  return input;
};
const issuesOf = (input: unknown) => {
  try {
    loadScenario(input);
  } catch (error) {
    if (error instanceof ScenarioError) return error.issues;
    throw error;
  }
  return [];
};

describe('the zones of a checkpoints-in-order goal', () => {
  it('load when they are apart', () => {
    expect(() => loadScenario(fixture)).not.toThrow();
  });

  it('may not overlap: the error names the later zone, the one it overlaps and the goal', () => {
    const issues = issuesOf(authored([[140, 40], [160, 40], [160, 80], [140, 80]], ['cp-a', 'cp-b', 'gate']));
    expect(issues).toEqual([
      { path: 'goals[1].zones[2]', message: 'zone "gate" overlaps zone "cp-a" (zones[0]): the zones of one route may not overlap, or it is not clear which is entered first' },
    ]);
  });

  it('may not overlap whichever comes first in the list', () => {
    const issues = issuesOf(authored([[140, 40], [160, 40], [160, 80], [140, 80]], ['gate', 'cp-b', 'cp-a']));
    expect(issues.map((issue) => issue.path)).toEqual(['goals[1].zones[2]']);
    expect(issues[0]!.message).toContain('zone "cp-a" overlaps zone "gate" (zones[0])');
  });

  it('may not hold one another', () => {
    const issues = issuesOf(authored([[160, 30], [180, 30], [180, 50], [160, 50]], ['cp-a', 'gate', 'dock']));
    expect(issues.map((issue) => issue.path)).toEqual(['goals[1].zones[1]']);
  });

  it('may meet along an edge or at a corner, as tiles do', () => {
    expect(issuesOf(authored([[190, 20], [199, 20], [199, 60], [190, 60]], ['cp-a', 'cp-b', 'gate']))).toEqual([]); // a shared edge
    expect(issuesOf(authored([[190, 60], [199, 60], [199, 90], [190, 90]], ['cp-a', 'cp-b', 'gate']))).toEqual([]); // a shared corner
  });

  it('may include one zone twice, which is not an overlap of a zone with itself', () => {
    expect(issuesOf(authored([[140, 40], [160, 40], [160, 80], [140, 80]], ['cp-a', 'dock', 'cp-a']))).toEqual([]);
  });

  it('says it once for a pair, however often the zones are listed', () => {
    const issues = issuesOf(authored([[140, 40], [160, 40], [160, 80], [140, 80]], ['cp-a', 'gate', 'cp-a', 'gate']));
    expect(issues).toHaveLength(1);
    expect(issues[0]!.path).toBe('goals[1].zones[1]');
  });

  it('does not add an overlap to a zone that the arena does not have', () => {
    const issues = issuesOf(authored([[140, 40], [160, 40], [160, 80], [140, 80]], ['cp-a', 'moon']));
    expect(issues.map((issue) => issue.path)).toEqual(['goals[1].zones[1]']);
    expect(issues[0]!.message).toContain('no zone "moon"');
  });

  it('are the only zones that may not overlap: other goals may name zones that do', () => {
    // gate overlaps cp-a, but no route lists both: reach-zone, object-in-zone and servo-angle name it alone
    expect(issuesOf(authored([[140, 40], [160, 40], [160, 80], [140, 80]], ['cp-a', 'cp-b', 'dock']))).toEqual([]);
  });
});
