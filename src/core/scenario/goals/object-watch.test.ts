import { describe, expect, it } from 'vitest';
import { firstFailure, judgeStep, reasonsOf } from './object-watch';
import { goalReasons } from './reasons';

// N19 D1–D3 fix round 1 (review M4): an end-judged pick-and-place goal is a list of steps, tried in order; the order of its reasons is the
// order of its steps, and a step may only give the reasons it declares.

type View = { held: boolean; tipped: boolean };
const steps = [
  judgeStep<View>([goalReasons.objectStillHeld], (v) => (v.held ? { reasonKey: goalReasons.objectStillHeld, progress: 0.5 } : null)),
  judgeStep<View>([goalReasons.objectTipped], (v) => (v.tipped ? { reasonKey: goalReasons.objectTipped, progress: 0.75 } : null)),
];

describe('the steps of an end-judged goal', () => {
  it('give the first failure in their order, or null', () => {
    expect(firstFailure(steps, { held: true, tipped: true })).toEqual({ reasonKey: goalReasons.objectStillHeld, progress: 0.5 });
    expect(firstFailure(steps, { held: false, tipped: true })).toEqual({ reasonKey: goalReasons.objectTipped, progress: 0.75 });
    expect(firstFailure(steps, { held: false, tipped: false })).toBeNull();
    expect(reasonsOf(steps)).toEqual([goalReasons.objectStillHeld, goalReasons.objectTipped]);
  });

  it('refuse a step that gives a reason it does not declare: the order would no longer be the declared one', () => {
    const wrong = [judgeStep<View>([goalReasons.objectTipped], () => ({ reasonKey: goalReasons.objectPushed, progress: 0 }))];
    expect(() => firstFailure(wrong, { held: false, tipped: false })).toThrow('A step of robot.goal.reason.object-tipped gave robot.goal.reason.object-pushed.');
  });
});
