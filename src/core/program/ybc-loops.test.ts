import { describe, expect, it } from 'vitest';
import { localDeviceDefinitions } from '../devices/local-catalog';
import { createDeviceRegistry } from '../devices/registry';
import { productionProfiles } from '../profiles';
import {
  add, and, bool, cmp, countUp, getVar, idiv, ifElif, join, mul, not, num, print, program, repeat, setVar, sub, text, wait, whileLoop,
  type Json,
} from './__fixtures__/ybc-blocks';
import { createBlockPackCatalog } from './block-packs';
import { compileYbcProgram } from './compile-ybc-program';
import { createRunConsole } from './console';
import type { Sleep } from './interpreter';
import { MAX_RANGE_VALUE, MAX_REPEAT_ABS, MAX_TEXT_CHARS, MAX_WAIT_MS } from './limits';
import { runYbcProgram } from './ybc-interpreter';

// YB-2b semantics: else-if, repeat, while, count up, wait and join, as compiled traces.

const prog = (statements: Json[]) => program(statements, undefined, ['x', 'y', 'z', 'i']);
const packs = createBlockPackCatalog(createDeviceRegistry(localDeviceDefinitions));
const exposed = packs.typesOf(productionProfiles.get('ybc-basic')?.blockPacks ?? []);

const blockedSleep: Sleep = (_ms, signal) =>
  new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });

/** Runs a program to its end. The budget yields instantly and waits are recorded, not slept. */
async function run(blocks: Json) {
  const compiled = compileYbcProgram(blocks, exposed);
  if (!compiled.ok) {
    throw new Error(`Does not compile: ${JSON.stringify(compiled.diagnostics)}`);
  }
  const runConsole = createRunConsole();
  const slept: number[] = [];
  const outcome = await runYbcProgram(compiled.ir, {
    sleep: (ms) => {
      slept.push(ms);
      return Promise.resolve();
    },
    console: runConsole,
    yieldNow: () => Promise.resolve(),
  }).done;
  return { outcome, lines: runConsole.snapshot().lines, slept };
}
const printed = async (...statements: Json[]) => (await run(prog(statements))).lines;
const compileCodes = (...statements: Json[]) => {
  const result = compileYbcProgram(prog(statements), exposed);
  return result.diagnostics.map((d) => d.code);
};

describe('else if', () => {
  const failing = () => cmp('EQ', idiv(num(1), num(0)), num(1));
  const say = (value: string) => [print(text(value))];

  it('takes the first true branch, in order', async () => {
    expect(await printed(ifElif([[bool(true), say('a')], [bool(true), say('b')]], say('else')))).toEqual(['a']);
    expect(await printed(ifElif([[bool(false), say('a')], [bool(true), say('b')], [bool(true), say('c')]], say('else')))).toEqual(['b']);
  });

  it('runs else only when no condition is true', async () => {
    expect(await printed(ifElif([[bool(false), say('a')], [bool(false), say('b')]], say('else')))).toEqual(['else']);
    expect(await printed(ifElif([[bool(false), say('a')], [bool(false), say('b')]]))).toEqual([]);
  });

  it('does not evaluate a later condition once a branch has won', async () => {
    expect((await run(prog([ifElif([[bool(true), say('a')], [failing(), say('b')]]), print(text('done'))]))).lines).toEqual(['a', 'done']);
  });

  it('does evaluate a later condition when the earlier ones are false', async () => {
    const { outcome, lines } = await run(prog([ifElif([[bool(false), say('a')], [failing(), say('b')]], say('else')), print(text('done'))]));
    expect(lines).toEqual([]);
    expect(outcome).toMatchObject({ status: 'error', code: 'zero-division' });
  });

  it('evaluates conditions top to bottom, stopping at the first fault', async () => {
    const { outcome } = await run(prog([ifElif([[failing(), say('a')], [bool(true), say('b')]])]));
    expect(outcome).toMatchObject({ status: 'error', code: 'zero-division' });
  });

  it('keeps every condition Bool-only: a number as else-if condition is an error', () => {
    expect(compileCodes(ifElif([[bool(true), say('a')], [num(1), say('b')]]))).toEqual(['invalid-condition']);
    expect(compileCodes(ifElif([[text('x'), say('a')], [bool(true), say('b')]]))).toEqual(['invalid-condition']);
  });

  it('reports a missing else-if condition', () => {
    const broken = ifElif([[bool(true), say('a')], [bool(true), say('b')]]);
    (broken.inputs as Record<string, unknown>).IF1 = undefined;
    expect(compileCodes(broken)).toEqual(['missing-input']);
  });
});

describe('repeat', () => {
  const countTo = (times: Json) => run(prog([repeat(times, [setVar('x', add(getVar('x'), num(1)))]), print(getVar('x'))]));

  it.each([
    [0, '0'],
    [1, '1'],
    [7, '7'],
    [-1, '0'],
    [-1_000_000, '0'],
  ])('repeat %d times runs %s time(s)', async (times, expected) => {
    expect((await countTo(num(times))).lines).toEqual([expected]);
  });

  it('runs the largest supported count', async () => {
    const result = await countTo(num(MAX_REPEAT_ABS));
    expect(result.lines).toEqual([String(MAX_REPEAT_ABS)]);
    expect(result.outcome).toEqual({ status: 'finished' });
  });

  it('evaluates the count once: changing the variable in the body does not change the count', async () => {
    const counted = prog([
      setVar('x', num(3)),
      repeat(getVar('x'), [setVar('x', add(getVar('x'), num(10))), print(getVar('x'))]),
    ]);
    expect((await run(counted)).lines).toEqual(['13', '23', '33']);
  });

  it('rejects a typed-in count outside the domain at compile time, in both directions', () => {
    expect(compileCodes(repeat(num(MAX_REPEAT_ABS + 1), []))).toEqual(['value-out-of-range']);
    expect(compileCodes(repeat(num(-MAX_REPEAT_ABS - 1), []))).toEqual(['value-out-of-range']);
  });

  it('stops a computed count outside the domain at run time, at the repeat block', async () => {
    for (const count of [MAX_REPEAT_ABS + 1, -MAX_REPEAT_ABS - 1]) {
      const loop = repeat(add(num(count), num(0)), [print(text('never'))]);
      const { outcome, lines } = await run(prog([print(text('before')), loop]));
      expect(lines).toEqual(['before']);
      expect(outcome).toMatchObject({ status: 'error', code: 'out-of-domain' });
    }
  });

  it('needs an int count', () => {
    expect(compileCodes(repeat(text('3'), []))).toEqual(['type-mismatch']);
    expect(compileCodes(repeat(bool(true), []))).toEqual(['type-mismatch']);
  });

  it('nests', async () => {
    expect(await printed(repeat(num(2), [repeat(num(3), [setVar('x', add(getVar('x'), num(1)))])]), print(getVar('x')))).toEqual(['6']);
  });
});

describe('while', () => {
  it('does not run its body when the condition starts false', async () => {
    expect(await printed(whileLoop(bool(false), [print(text('never'))]), print(text('after')))).toEqual(['after']);
  });

  it('repeats while the condition holds, testing it before every iteration', async () => {
    expect(
      await printed(
        whileLoop(cmp('LT', getVar('x'), num(3)), [setVar('x', add(getVar('x'), num(1))), print(getVar('x'))]),
        print(text('done')),
      ),
    ).toEqual(['1', '2', '3', 'done']);
  });

  it('sees a condition that the body changes', async () => {
    expect(await printed(setVar('x', num(10)), whileLoop(cmp('GT', getVar('x'), num(0)), [setVar('x', sub(getVar('x'), num(4)))]), print(getVar('x')))).toEqual(['-2']);
  });

  it('needs a Bool condition: no truthiness', () => {
    expect(compileCodes(whileLoop(num(1), []))).toEqual(['invalid-condition']);
    expect(compileCodes(whileLoop(getVar('x'), []))).toEqual(['invalid-condition']);
    expect(compileCodes(whileLoop(text('yes'), []))).toEqual(['invalid-condition']);
  });

  it('stops on a fault in the condition or in the body, at that block', async () => {
    const badCondition = cmp('EQ', idiv(num(1), num(0)), num(1));
    const first = await run(prog([whileLoop(badCondition, [print(text('never'))])]));
    expect(first.outcome).toMatchObject({ status: 'error', code: 'zero-division' });

    const badBody = idiv(num(1), num(0));
    const second = await run(prog([print(text('a')), whileLoop(bool(true), [print(badBody)])]));
    expect(second.lines).toEqual(['a']);
    expect(second.outcome).toMatchObject({ status: 'error', code: 'zero-division', blockId: badBody.id });
  });

  it('uses and / or / not as the condition, with short-circuit', async () => {
    expect(await printed(whileLoop(and(cmp('LT', getVar('x'), num(2)), not(bool(false))), [setVar('x', add(getVar('x'), num(1)))]), print(getVar('x')))).toEqual(['2']);
  });
});

describe('count up', () => {
  const trace = (from: Json, to: Json, step: number, extra: Json[] = []) =>
    run(prog([countUp('i', from, to, step, [print(getVar('i')), ...extra]), print(getVar('i'))]));

  it('counts from the start to the end, both included', async () => {
    expect((await trace(num(1), num(4), 1)).lines).toEqual(['1', '2', '3', '4', '4']);
  });

  it('runs once when start equals end', async () => {
    expect((await trace(num(5), num(5), 1)).lines).toEqual(['5', '5']);
  });

  it.each([
    [0, 5, 2, ['0', '2', '4']],
    [1, 10, 3, ['1', '4', '7', '10']],
    [0, 3, 10, ['0']],
  ])('counts %d to %d by %d', async (from, to, step, expected) => {
    expect((await run(prog([countUp('i', num(from), num(to), step, [print(getVar('i'))])]))).lines).toEqual(expected);
  });

  it('runs zero times when a computed start is above the end, and leaves the variable as it was', async () => {
    const result = await run(prog([setVar('i', num(42)), countUp('i', add(num(5), num(0)), add(num(2), num(0)), 1, [print(text('never'))]), print(getVar('i'))]));
    expect(result.lines).toEqual(['42']);
  });

  it('keeps the last value in the variable after the loop', async () => {
    expect((await run(prog([countUp('i', num(1), num(3), 1, []), print(getVar('i'))]))).lines).toEqual(['3']);
  });

  it('evaluates the start and the end once each, before the loop: a body that changes them does not move the count', async () => {
    const result = await run(
      prog([
        setVar('x', num(1)),
        setVar('y', num(3)),
        countUp('i', getVar('x'), getVar('y'), 1, [setVar('x', num(100)), setVar('y', num(100)), print(getVar('i'))]),
      ]),
    );
    expect(result.lines).toEqual(['1', '2', '3']);
  });

  it('sets the variable at the start of every iteration: a change in the body does not move the sequence', async () => {
    const result = await run(prog([countUp('i', num(1), num(3), 1, [print(getVar('i')), setVar('i', num(50))])]));
    expect(result.lines).toEqual(['1', '2', '3']);
  });

  it('evaluates the start before the end: a bad start stops the program before the end is looked at', async () => {
    // The end would stop the program with a division by zero, if it were evaluated.
    const badEnd = idiv(num(1), num(0));
    const { outcome } = await run(prog([countUp('i', sub(num(0), num(1)), badEnd, 1, [])]));
    expect(outcome).toMatchObject({ status: 'error', code: 'out-of-domain' });
  });

  it('evaluates the end after the start: a faulty start is reported before a bad end', async () => {
    const badStart = idiv(num(1), num(0));
    const { outcome } = await run(prog([countUp('i', badStart, add(num(MAX_RANGE_VALUE + 5), num(0)), 1, [])]));
    expect(outcome).toMatchObject({ status: 'error', code: 'zero-division' });
  });

  it('checks each bound right after evaluating it', async () => {
    const start = add(num(MAX_RANGE_VALUE + 1), num(0));
    const end = add(num(MAX_RANGE_VALUE + 1), num(0));
    const first = await run(prog([countUp('i', start, end, 1, [])]));
    expect(first.outcome).toMatchObject({ status: 'error', code: 'out-of-domain', blockId: start.id });
    const second = await run(prog([countUp('i', num(1), end, 1, [])]));
    expect(second.outcome).toMatchObject({ status: 'error', code: 'out-of-domain', blockId: end.id });
  });

  it('accepts the boundary values 0 and 1 000 000', async () => {
    expect((await run(prog([countUp('i', num(0), num(0), 1, [print(getVar('i'))])]))).lines).toEqual(['0']);
    expect((await run(prog([countUp('i', num(MAX_RANGE_VALUE), num(MAX_RANGE_VALUE), 1, [print(getVar('i'))])]))).lines).toEqual([String(MAX_RANGE_VALUE)]);
    const whole = await run(prog([countUp('i', num(0), num(MAX_RANGE_VALUE), MAX_RANGE_VALUE, [print(getVar('i'))])]));
    expect(whole.lines).toEqual(['0', String(MAX_RANGE_VALUE)]);
  });

  it('counts a million steps', async () => {
    const result = await run(prog([countUp('i', num(1), num(MAX_RANGE_VALUE), 1, [setVar('x', add(getVar('x'), num(1)))]), print(getVar('x'))]));
    expect(result.lines).toEqual([String(MAX_RANGE_VALUE)]);
  });

  it('rejects typed-in bounds outside 0..1 000 000 at compile time', () => {
    expect(compileCodes(countUp('i', num(-1), num(5), 1, []))).toEqual(['value-out-of-range']);
    expect(compileCodes(countUp('i', num(0), num(MAX_RANGE_VALUE + 1), 1, []))).toEqual(['value-out-of-range']);
    expect(compileCodes(countUp('i', num(MAX_RANGE_VALUE + 1), num(MAX_RANGE_VALUE + 1), 1, []))).toEqual(['value-out-of-range', 'value-out-of-range']);
  });

  it('rejects two typed-in bounds that count down', () => {
    expect(compileCodes(countUp('i', num(5), num(1), 1, []))).toEqual(['descending-range-not-supported']);
  });

  it.each([0, -1, MAX_RANGE_VALUE + 1])('rejects the step %d', (step) => {
    expect(compileCodes(countUp('i', num(1), num(5), step, []))).toEqual(['value-out-of-range']);
  });

  it.each([1.5, Number.NaN])('rejects the step %s', (step) => {
    expect(compileCodes(countUp('i', num(1), num(5), step, []))).toEqual(['malformed-program']);
  });

  it('accepts the step 1 000 000', () => {
    expect(compileCodes(countUp('i', num(1), num(5), MAX_RANGE_VALUE, []))).toEqual([]);
  });

  it('needs int bounds and a known variable', () => {
    expect(compileCodes(countUp('i', text('1'), num(5), 1, []))).toEqual(['type-mismatch']);
    expect(compileCodes(countUp('i', num(1), bool(true), 1, []))).toEqual(['type-mismatch']);
    expect(compileCodes(countUp('nope', num(1), num(5), 1, []))).toEqual(['undefined-variable']);
  });
});

describe('wait', () => {
  it('waits the given milliseconds, in order with the rest of the program', async () => {
    const result = await run(prog([print(text('a')), wait(num(250)), print(text('b')), wait(add(num(100), num(50)))]));
    expect(result.lines).toEqual(['a', 'b']);
    expect(result.slept).toEqual([250, 150]);
  });

  it('accepts 0 and 60000', async () => {
    expect((await run(prog([wait(num(0)), wait(num(MAX_WAIT_MS))]))).slept).toEqual([0, MAX_WAIT_MS]);
  });

  it('rejects a typed-in wait outside 0..60000 at compile time', () => {
    expect(compileCodes(wait(num(-1)))).toEqual(['value-out-of-range']);
    expect(compileCodes(wait(num(MAX_WAIT_MS + 1)))).toEqual(['value-out-of-range']);
  });

  it('stops a computed wait outside the domain at run time, without sleeping', async () => {
    for (const ms of [MAX_WAIT_MS + 1, -1]) {
      const result = await run(prog([wait(add(num(ms), num(0)))]));
      expect(result.slept).toEqual([]);
      expect(result.outcome).toMatchObject({ status: 'error', code: 'out-of-domain' });
    }
  });

  it('needs an int', () => {
    expect(compileCodes(wait(text('5')))).toEqual(['type-mismatch']);
  });

  it('ends at once when Stop is pressed during a long wait', async () => {
    const compiled = compileYbcProgram(prog([wait(num(MAX_WAIT_MS)), print(text('never'))]), exposed);
    if (!compiled.ok) {
      throw new Error('does not compile');
    }
    const runConsole = createRunConsole();
    const running = runYbcProgram(compiled.ir, { sleep: blockedSleep, console: runConsole });
    await new Promise((resolve) => setTimeout(resolve, 5));
    running.stop();
    expect(await running.done).toEqual({ status: 'stopped' });
    expect(runConsole.snapshot().lines).toEqual([]);
  });
});

describe('join', () => {
  it('joins parts, each through str()', async () => {
    expect(await printed(print(join(text('x = '), num(-4), text(', ok: '), bool(true))))).toEqual(['x = -4, ok: True']);
  });

  it('joins the value of a variable and of an expression', async () => {
    expect(await printed(setVar('x', num(7)), print(join(text('x*2='), mul(getVar('x'), num(2)))))).toEqual(['x*2=14']);
  });

  it('is a text, so it compares with a text and not with a number', async () => {
    expect(await printed(print(cmp('EQ', join(text('a'), text('b')), text('ab'))))).toEqual(['True']);
    expect(compileCodes(print(cmp('EQ', join(text('a')), num(1))))).toEqual(['type-mismatch']);
  });

  it('takes at most 50 parts', async () => {
    const parts = (count: number) => Array.from({ length: count }, () => text('a'));
    expect((await run(prog([print(join(...parts(50)))]))).lines).toEqual(['a'.repeat(50)]);
    expect(compileCodes(print(join(...parts(51))))).toEqual(['limit-exceeded']);
  });

  it('stops before building a text longer than 1000 characters', async () => {
    const part = () => text('x'.repeat(334));
    const ok = await run(prog([print(join(part(), part(), text('x'.repeat(MAX_TEXT_CHARS - 668))))]));
    expect(ok.lines[0]).toHaveLength(MAX_TEXT_CHARS);
    const tooLong = await run(prog([print(join(part(), part(), part(), part()))]));
    expect(tooLong.lines).toEqual([]);
    expect(tooLong.outcome).toMatchObject({ status: 'error', code: 'limit-exceeded' });
  });

  it('reports an empty part', () => {
    const broken = join(text('a'), text('b'));
    (broken.inputs as Record<string, unknown>).ADD1 = undefined;
    expect(compileCodes(print(broken))).toEqual(['missing-input']);
  });
});
