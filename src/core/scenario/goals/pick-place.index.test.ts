import { describe, expect, it } from 'vitest';
import { pickPlaceGoalKinds } from '../scenario-schema';
import { feed, frameAt } from './__fixtures__/frames';
import { carryTo, ctx, cubeAt, scenario } from './__fixtures__/pick-place';
import { createGoal } from './index';
import { goalReasonKeys } from './reasons';

// N19 D2: what goals/index.test.ts holds for the N18 kinds, for the four pick-and-place kinds of the pick-place fixture: createGoal makes
// each, every result keeps the goal's id and gives a reason of the library until it passes, every kind checks its tick the same way, and the
// robot leaving the arena ends every one that has not passed.

const goals = scenario.goals.map((spec) => [spec.id, spec] as const);

describe('createGoal for the pick-and-place kinds', () => {
  it('makes a goal for each of them (the fixture has every one)', () => {
    expect(new Set(scenario.goals.map((goal) => goal.kind))).toEqual(new Set(pickPlaceGoalKinds));
    for (const spec of scenario.goals) expect(createGoal(spec, ctx).result().id).toBe(spec.id);
  });

  it.each(goals)('%s starts with no points, a progress in 0..1 and a reason of the library', (_id, spec) => {
    const result = createGoal(spec, ctx).result();
    expect(result).toMatchObject({ passed: false, points: 0 });
    expect(result.progress).toBeGreaterThanOrEqual(0);
    expect(result.progress).toBeLessThanOrEqual(1);
    expect(goalReasonKeys).toContain(result.reasonKey);
  });

  it.each(goals)('%s refuses a tick that is negative or not a finite time, also after it has settled, and takes one of 0 s', (_id, spec) => {
    for (const dtS of [-0.25, Number.NaN, Number.POSITIVE_INFINITY]) expect(() => createGoal(spec, ctx).update(frameAt(), dtS)).toThrow(RangeError);
    const goal = createGoal(spec, ctx);
    expect(() => goal.update(frameAt(), 0)).not.toThrow();
    goal.update(frameAt({ tS: 0.25, outOfArena: true }), 0.25);
    expect(() => goal.update(frameAt({ tS: 0.5 }), -1)).toThrow(RangeError);
  });

  it.each(goals)('%s fails for good with out-of-arena at the time the robot left, whatever comes after', (_id, spec) => {
    const goal = createGoal(spec, ctx);
    feed(goal, [...carryTo(130, 60).slice(0, 3), { ...cubeAt(85, 60), outOfArena: true }, ...carryTo(130, 60).slice(3)]);
    expect(goal.result()).toMatchObject({ passed: false, points: 0, reasonKey: 'robot.goal.reason.out-of-arena', atS: 0.75 });
  });
});
