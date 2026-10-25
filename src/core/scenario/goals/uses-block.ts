import { runningBlockTypes } from '../../challenge/running-blocks';
import { outcome, type Goal, type GoalContext, type GoalSpec } from './goal';
import { goalReasons } from './reasons';

// `uses-block`: the program has a block of the type, judged from the program alone (never from the frames). It is the static walk of
// `challenge/running-blocks.ts`: only the blocks reachable from an enabled "on start" or "forever" count, so a block the learner
// disabled, with what is inside it, and a loose block that no program starts from do not. The walk reads the program as it is when the
// goal is made. A program of any shape is read without throwing; one that has no blocks has no block of the type.

export function createUsesBlockGoal(spec: GoalSpec<'uses-block'>, ctx: Pick<GoalContext, 'program'>): Goal {
  if (ctx.program === undefined) {
    throw new TypeError('uses-block needs ctx.program, the learner\'s Blockly workspace as JSON.');
  }
  const used = runningBlockTypes(ctx.program).has(spec.blockType);
  return {
    update() {},
    result() {
      return used ? outcome(spec, { passed: true }) : outcome(spec, { passed: false, progress: 0, reasonKey: goalReasons.blockNotUsed });
    },
  };
}
