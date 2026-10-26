import { describe, expect, it } from 'vitest';
import type { GoalResult } from '../../core/scenario/goals/goal';
import type { Scenario } from '../../core/scenario/scenario';
import { bodyPalette } from '../../core/world/arena/body-colors';
import { scenarioCatalog } from '../../samples/robot-scenarios';
import { goalZoneIds, nextGoalZoneId } from './sensor-overlay-math';

// N19 E4/E5 (ruling on concern 3): the overlays light the zone the next unmet goal needs, and an `object-placed` goal needs one too: its
// `zone`, or, with `zoneByColor`, the zone of its object's colour in the round shown (the run's world's, round-colors.ts), so that a
// gripper lesson lights its drop zone as a rover lesson lights its target. The rover's goals light what they lit: pinned against N18's
// function, kept here as it was.

type Goals = Scenario['goals'];
type Results = readonly GoalResult[];

/** N18's nextGoalZoneId (sensor-overlay-math.ts at 0a7a479), as it was: the reference for the rover's goals. */
function reference(goals: Goals, results: Results): string | null {
  for (const goal of goals) {
    const result = results.find((candidate) => candidate.id === goal.id);
    if (result?.passed === true) continue;
    switch (goal.kind) {
      case 'reach-zone':
      case 'object-in-zone':
      case 'stop-in-zone':
        return goal.zone;
      case 'checkpoints-in-order': {
        const counted = Math.floor((result?.progress ?? 0) * goal.zones.length + 1e-9);
        return goal.zones[Math.min(goal.zones.length - 1, Math.max(0, counted))] ?? null;
      }
      case 'servo-angle':
        if (goal.whenInZone !== undefined) return goal.whenInZone;
        break;
      default:
        break;
    }
  }
  return null;
}

const label = { vi: 'x', en: 'x' };
const placed = (id: string, more: object) => ({ id, kind: 'object-placed', label, points: 10, object: 'cube', fully: true, maxTiltDeg: 15, restS: 0.5, carried: true, maxSlideCm: 3, minCarryLiftCm: 1, minCarryCm: 5, ...more });
const goals = [
  { id: 'grab', kind: 'object-held', label, points: 10, object: 'cube', holdS: 0.5, minLiftCm: 2 },
  placed('drop', { zone: 'drop-zone' }),
  placed('sort', { zoneByColor: { [bodyPalette.red]: 'red-zone', [bodyPalette.green.toUpperCase()]: 'green-zone', [bodyPalette.blue]: 'blue-zone' } }),
] as unknown as Goals;
const result = (id: string, passed: boolean): GoalResult => ({ id, passed, points: passed ? 10 : 0, progress: passed ? 1 : 0 });

describe('the zone of the next goal, for a pick-and-place goal (N19 E4/E5)', () => {
  it('is an object-placed goal’s zone while it is unmet (a grab names none, so it is skipped)', () => {
    expect(nextGoalZoneId(goals, [], { cube: bodyPalette.red })).toBe('drop-zone');
    expect(nextGoalZoneId(goals, [result('grab', true)], { cube: bodyPalette.red })).toBe('drop-zone');
  });

  it('is, for zoneByColor, the zone of the object’s colour in the round shown (any case of its digits), and none for a colour it has none for', () => {
    const done = [result('grab', true), result('drop', true)];
    expect(nextGoalZoneId(goals, done, { cube: bodyPalette.green })).toBe('green-zone');
    expect(nextGoalZoneId(goals, done, { cube: bodyPalette.red })).toBe('red-zone');
    expect(nextGoalZoneId(goals, done, { cube: bodyPalette.blue.toUpperCase() })).toBe('blue-zone');
    expect(nextGoalZoneId(goals, done, { cube: bodyPalette.yellow })).toBeNull();
    expect(nextGoalZoneId(goals, done, {})).toBeNull();
    expect(nextGoalZoneId(goals, [...done, result('sort', true)], { cube: bodyPalette.red })).toBeNull();
  });

  it('lights every zone such a goal can name: its zone and each of its colours’ (the overlays build a highlight for each)', () => {
    expect([...goalZoneIds(goals)]).toEqual(['drop-zone', 'red-zone', 'green-zone', 'blue-zone']);
  });

  it('gives every rover lesson’s goals the very zones N18 lit, at every count of passed goals and route progress, and builds the same highlights', () => {
    let compared = 0;
    for (const scenario of scenarioCatalog.scenarios) {
      const states: Results[] = [[]];
      scenario.goals.forEach((_, n) => states.push(scenario.goals.slice(0, n + 1).map((goal) => result(goal.id, true))));
      for (const goal of scenario.goals) {
        if (goal.kind === 'checkpoints-in-order') for (const progress of [0, 0.25, 0.5, 0.75, 1]) states.push([{ id: goal.id, passed: progress === 1, points: 0, progress }]);
      }
      for (const results of states) {
        expect(nextGoalZoneId(scenario.goals, results, {}), scenario.key).toBe(reference(scenario.goals, results));
        compared += 1;
      }
      // N18's set of the zones goals name (both overlays built it inline).
      const named = new Set<string>();
      for (const goal of scenario.goals) {
        if (goal.kind === 'reach-zone' || goal.kind === 'object-in-zone' || goal.kind === 'stop-in-zone') named.add(goal.zone);
        else if (goal.kind === 'checkpoints-in-order') goal.zones.forEach((zone) => named.add(zone));
        else if (goal.kind === 'servo-angle' && goal.whenInZone !== undefined) named.add(goal.whenInZone);
      }
      expect([...goalZoneIds(scenario.goals)], scenario.key).toEqual([...named]);
    }
    expect(compared).toBeGreaterThan(30);
  });
});
