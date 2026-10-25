import { outcome, type Goal, type GoalContext, type GoalSpec } from './goal';
import { goalReasons } from './reasons';

// `finish-within`: passes when all the other goals of the scenario passed by `seconds` of simulated time, the limit included.
//
// This goal does not see the world; it cannot know whether the others are met. The scorer (R6.2) does, and answers through
// `ctx.othersPassedAtS`: the time at which the last of the other goals passed (the first instant at which they were all passed
// together), or null while one of them has not. The goal asks when its result is read and compares: it needs no frames, so `update`
// does nothing. A goal made without the callback throws: the scorer has to be wired in.

export function createFinishWithinGoal(spec: GoalSpec<'finish-within'>, ctx: Pick<GoalContext, 'othersPassedAtS'>): Goal {
  const othersPassedAtS = ctx.othersPassedAtS;
  if (othersPassedAtS === undefined) {
    throw new TypeError('finish-within needs ctx.othersPassedAtS, the scorer\'s answer to when the other goals had all passed.');
  }
  return {
    update() {},
    result() {
      const passedAtS = othersPassedAtS();
      if (passedAtS !== null && passedAtS <= spec.seconds) return outcome(spec, { passed: true, atS: passedAtS });
      return outcome(spec, { passed: false, progress: 0, reasonKey: goalReasons.notFinishedInTime });
    },
  };
}
