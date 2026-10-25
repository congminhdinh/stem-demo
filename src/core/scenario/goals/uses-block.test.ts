import { describe, expect, it } from 'vitest';
import { base, ctx } from './__fixtures__/context';
import { feed } from './__fixtures__/frames';
import { goalReasons } from './reasons';
import { createUsesBlockGoal } from './uses-block';
import type { GoalSpec } from './goal';

const spec: GoalSpec<'uses-block'> = { ...base, kind: 'uses-block', blockType: 'controls_repeat_ext' };
const workspace = (...blocks: unknown[]) => ({ blocks: { languageVersion: 0, blocks } });
const withProgram = (program: unknown) => ({ ...ctx, program });

const repeatInForever = workspace({
  type: 'stem_forever',
  id: 'f',
  inputs: { DO: { block: { type: 'controls_repeat_ext', id: 'r', next: { block: { type: 'stem_wait', id: 'w' } } } } },
});

describe('uses-block', () => {
  it('passes when the block is in the program that runs', () => {
    expect(createUsesBlockGoal(spec, withProgram(repeatInForever)).result()).toEqual({ id: 'goal', passed: true, points: 10, progress: 1 });
    expect(createUsesBlockGoal({ ...spec, blockType: 'stem_wait' }, withProgram(repeatInForever)).result().passed).toBe(true);
  });

  it('fails with the reason when the program does not use it', () => {
    expect(createUsesBlockGoal({ ...spec, blockType: 'controls_if' }, withProgram(repeatInForever)).result()).toEqual({
      id: 'goal',
      passed: false,
      points: 0,
      progress: 0,
      reasonKey: goalReasons.blockNotUsed,
    });
  });

  it('does not count a block the learner disabled, with what is inside it, but counts what follows it', () => {
    const program = workspace({
      type: 'stem_on_start',
      id: 's',
      inputs: { DO: { block: { type: 'controls_repeat_ext', id: 'r', disabledReasons: ['MANUALLY_DISABLED'], inputs: { DO: { block: { type: 'stem_wait', id: 'in' } } }, next: { block: { type: 'math_number', id: 'n' } } } } },
    });
    expect(createUsesBlockGoal(spec, withProgram(program)).result().passed).toBe(false);
    expect(createUsesBlockGoal({ ...spec, blockType: 'stem_wait' }, withProgram(program)).result().passed).toBe(false);
    expect(createUsesBlockGoal({ ...spec, blockType: 'math_number' }, withProgram(program)).result().passed).toBe(true);
  });

  it('does not count a loose block that no program starts from, enabled or not', () => {
    const program = workspace(
      { type: 'controls_repeat_ext', id: 'loose' },
      { type: 'controls_repeat_ext', id: 'orphan', disabledReasons: ['ORPHANED_BLOCK'] },
      { type: 'stem_forever', id: 'f' },
    );
    expect(createUsesBlockGoal(spec, withProgram(program)).result().passed).toBe(false);
  });

  it('does not count a block under a disabled hat', () => {
    const program = workspace({ type: 'stem_forever', id: 'f', disabledReasons: ['x'], inputs: { DO: { block: { type: 'controls_repeat_ext', id: 'r' } } } });
    expect(createUsesBlockGoal(spec, withProgram(program)).result().passed).toBe(false);
  });

  it.each([null, 42, 'blocks', [], {}, { blocks: null }])('finds nothing in %j, without throwing', (program) => {
    expect(createUsesBlockGoal(spec, withProgram(program)).result()).toMatchObject({ passed: false, reasonKey: goalReasons.blockNotUsed });
  });

  it('is judged from the program alone: the frames change nothing, and the answer has no time', () => {
    const goal = createUsesBlockGoal(spec, withProgram(repeatInForever));
    feed(goal, [{ outOfArena: true }, { contacts: [{ otherId: 'w', tags: ['wall'] }] }]);
    expect(goal.result()).toEqual({ id: 'goal', passed: true, points: 10, progress: 1 });
    expect(goal.result().atS).toBeUndefined();
  });

  it('is the program of the moment the goal is made', () => {
    const program = { blocks: { languageVersion: 0, blocks: [{ type: 'stem_forever', id: 'f', inputs: { DO: { block: { type: 'controls_repeat_ext', id: 'r' } } } }] } };
    const goal = createUsesBlockGoal(spec, withProgram(program));
    program.blocks.blocks.length = 0;
    expect(goal.result().passed).toBe(true);
  });

  it('cannot judge without a program, which is told when the goal is made', () => {
    expect(() => createUsesBlockGoal(spec, ctx)).toThrow('uses-block needs ctx.program');
  });
});
