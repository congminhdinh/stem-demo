import { describe, expect, it } from 'vitest';
import { base, ctx, nowhere } from './__fixtures__/context';
import { feed } from './__fixtures__/frames';
import { createFinishWithinGoal } from './finish-within';
import { goalReasons } from './reasons';
import type { GoalSpec } from './goal';

const spec: GoalSpec<'finish-within'> = { ...base, kind: 'finish-within', seconds: 45 };
/** The scorer's answer: when the last of the other goals passed, or null while one has not. */
const scorer = (answer: () => number | null) => ({ ...ctx, othersPassedAtS: answer });

describe('finish-within', () => {
  it('passes when the other goals all passed before the time, with the time they did', () => {
    const goal = createFinishWithinGoal(spec, scorer(() => 31.5));
    expect(goal.result()).toEqual({ id: 'goal', passed: true, points: 10, progress: 1, atS: 31.5 });
  });

  it('takes exactly the time asked for as within it, and a hair over as late', () => {
    expect(createFinishWithinGoal(spec, scorer(() => 45)).result()).toMatchObject({ passed: true, atS: 45 });
    expect(createFinishWithinGoal(spec, scorer(() => 45.0001)).result()).toEqual({
      id: 'goal',
      passed: false,
      points: 0,
      progress: 0,
      reasonKey: goalReasons.notFinishedInTime,
    });
  });

  it('has not passed while some other goal has not, and says so', () => {
    const goal = createFinishWithinGoal(spec, scorer(() => null));
    expect(goal.result()).toEqual({ id: 'goal', passed: false, points: 0, progress: 0, reasonKey: goalReasons.notFinishedInTime });
  });

  it('asks the scorer each time, so it follows the run', () => {
    let passedAt: number | null = null;
    const goal = createFinishWithinGoal(spec, scorer(() => passedAt));
    expect(goal.result().passed).toBe(false);
    passedAt = 12.25;
    expect(goal.result()).toMatchObject({ passed: true, atS: 12.25 });
  });

  it('is not moved by the frames: the scorer is the only one that knows', () => {
    const goal = createFinishWithinGoal(spec, scorer(() => null));
    feed(goal, [nowhere, { ...nowhere, outOfArena: true }, nowhere]);
    expect(goal.result()).toMatchObject({ passed: false, reasonKey: goalReasons.notFinishedInTime });
  });

  it('cannot judge without the scorer, which is told when the goal is made', () => {
    expect(() => createFinishWithinGoal(spec, ctx)).toThrow('finish-within needs ctx.othersPassedAtS');
  });
});
