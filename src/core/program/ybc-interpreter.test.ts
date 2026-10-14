import { describe, expect, it } from 'vitest';
import { localDeviceDefinitions } from '../devices/local-catalog';
import { createDeviceRegistry } from '../devices/registry';
import { productionProfiles } from '../profiles';
import { createBlockPackCatalog } from './block-packs';
import { compileYbcProgram } from './compile-ybc-program';
import { createRunConsole } from './console';
import {
  add, and, bool, cmp, getVar, idiv, ifThen, mod, mul, not, num, or, print, program, setVar, sub, text,
  type Json,
} from './__fixtures__/ybc-blocks';
import { MAX_SAFE_INT } from './limits';
import type { Sleep } from './interpreter';
import { runYbc } from './__fixtures__/run-ybc';

// Semantic traces of YB-2a programs: compile real block JSON, run it, read what the
// program printed and how it ended. The same traces become the simulator / generator
// parity fixtures of YB-5A.

const packs = createBlockPackCatalog(createDeviceRegistry(localDeviceDefinitions));
const exposed = packs.typesOf(productionProfiles.get('ybc-basic')?.blockPacks ?? []);

/** A sleep that never finishes by itself: `forever` stops at its first pause unless stopped. */
const blockedSleep: Sleep = (_ms, signal) =>
  new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });

async function run(blocks: Json) {
  const compiled = compileYbcProgram(blocks, exposed);
  if (!compiled.ok) {
    throw new Error(`Does not compile: ${JSON.stringify(compiled.diagnostics)}`);
  }
  const runConsole = createRunConsole();
  const running = runYbc(compiled.ir, { sleep: blockedSleep, console: runConsole });
  const outcome = await running.done;
  return { outcome, lines: runConsole.snapshot().lines };
}
const printed = async (...statements: Json[]) => (await run(program(statements))).lines;

describe('variables and assignment', () => {
  it('x = 1; x = x + 2; print(x) prints 3', async () => {
    expect(await printed(setVar('x', num(1)), setVar('x', add(getVar('x'), num(2))), print(getVar('x')))).toEqual(['3']);
  });

  it('starts every variable at 0', async () => {
    expect(await printed(print(getVar('x')), print(getVar('y')))).toEqual(['0', '0']);
  });

  it('lets a variable be read by its own assignment, and reassigned', async () => {
    expect(await printed(setVar('x', num(5)), setVar('y', mul(getVar('x'), getVar('x'))), setVar('x', num(-1)), print(getVar('y')), print(getVar('x')))).toEqual(['25', '-1']);
  });
});

describe('arithmetic, with Python semantics', () => {
  it.each([
    ['7 // 2', idiv(num(7), num(2)), '3'],
    ['-7 // 2', idiv(num(-7), num(2)), '-4'],
    ['7 // -2', idiv(num(7), num(-2)), '-4'],
    ['-7 // -2', idiv(num(-7), num(-2)), '3'],
    ['7 % 3', mod(num(7), num(3)), '1'],
    ['-7 % 3', mod(num(-7), num(3)), '2'],
    ['7 % -3', mod(num(7), num(-3)), '-2'],
    ['-7 % -3', mod(num(-7), num(-3)), '-1'],
    ['2 + 3 * 4', add(num(2), mul(num(3), num(4))), '14'],
    ['(2 + 3) * 4', mul(add(num(2), num(3)), num(4)), '20'],
    ['3 - 5', sub(num(3), num(5)), '-2'],
    ['0 * -5', mul(num(0), num(-5)), '0'],
  ])('%s prints %s', async (_, expression, expected) => {
    expect(await printed(print(expression))).toEqual([expected]);
  });

  it('prints the largest safe integer and stays inside the domain', async () => {
    expect(await printed(print(num(MAX_SAFE_INT)), print(sub(num(MAX_SAFE_INT), num(1))))).toEqual([String(MAX_SAFE_INT), String(MAX_SAFE_INT - 1)]);
  });
});

describe('faults stop the program at the block that caused them', () => {
  it.each([
    ['2^53 − 1 + 1', add(num(MAX_SAFE_INT), num(1)), 'out-of-domain'],
    ['-(2^53 − 1) − 1', sub(num(-MAX_SAFE_INT), num(1)), 'out-of-domain'],
    ['(2^53 − 1) * 2', mul(num(MAX_SAFE_INT), num(2)), 'out-of-domain'],
    ['1 // 0', idiv(num(1), num(0)), 'zero-division'],
    ['1 % 0', mod(num(1), num(0)), 'zero-division'],
  ])('%s → %s', async (_, expression, code) => {
    const statement = print(expression);
    const { outcome, lines } = await run(program([print(text('before')), statement, print(text('after'))]));
    expect(lines).toEqual(['before']);
    expect(outcome).toMatchObject({ status: 'error', code, blockId: expression.id });
  });

  it('an overflow in a variable assignment stops there', async () => {
    const { outcome, lines } = await run(program([setVar('x', num(MAX_SAFE_INT)), setVar('x', add(getVar('x'), num(1))), print(getVar('x'))]));
    expect(lines).toEqual([]);
    expect(outcome).toMatchObject({ status: 'error', code: 'out-of-domain' });
  });
});

describe('Boolean logic', () => {
  it('prints True and False like Python', async () => {
    expect(await printed(print(bool(true)), print(not(bool(true))), print(cmp('LT', num(1), num(2))))).toEqual(['True', 'False', 'True']);
  });

  it.each([
    ['true and true', and(bool(true), bool(true)), 'True'],
    ['true and false', and(bool(true), bool(false)), 'False'],
    ['false or true', or(bool(false), bool(true)), 'True'],
    ['false or false', or(bool(false), bool(false)), 'False'],
    ['not (1 == 1)', not(cmp('EQ', num(1), num(1))), 'False'],
  ])('%s', async (_, expression, expected) => {
    expect(await printed(print(expression))).toEqual([expected]);
  });

  // The right side would stop the program (1 // 0), so printing proves it was not evaluated.
  const failingRhs = () => cmp('EQ', idiv(num(1), num(0)), num(1));

  it('false and RHS does not evaluate RHS', async () => {
    expect(await printed(print(and(bool(false), failingRhs())), print(text('done')))).toEqual(['False', 'done']);
  });

  it('true or RHS does not evaluate RHS', async () => {
    expect(await printed(print(or(bool(true), failingRhs())), print(text('done')))).toEqual(['True', 'done']);
  });

  it('true and RHS and false or RHS do evaluate RHS', async () => {
    for (const expression of [and(bool(true), failingRhs()), or(bool(false), failingRhs())]) {
      const { outcome, lines } = await run(program([print(expression), print(text('done'))]));
      expect(lines).toEqual([]);
      expect(outcome).toMatchObject({ status: 'error', code: 'zero-division' });
    }
  });

  it('suppresses a nested right side as well: (false and X) or true', async () => {
    expect(await printed(print(or(and(bool(false), failingRhs()), bool(true))))).toEqual(['True']);
  });

  it('evaluates left to right: a failing left side stops before the right is looked at', async () => {
    const { outcome } = await run(program([print(and(failingRhs(), failingRhs()))]));
    expect(outcome).toMatchObject({ status: 'error', code: 'zero-division' });
  });
});

describe('if and if / else', () => {
  it.each([
    [true, ['then']],
    [false, []],
  ])('if %s', async (condition, expected) => {
    expect(await printed(ifThen(bool(condition), [print(text('then'))]))).toEqual(expected);
  });

  it.each([
    [true, ['then']],
    [false, ['else']],
  ])('if / else %s', async (condition, expected) => {
    expect(await printed(ifThen(bool(condition), [print(text('then'))], [print(text('else'))]))).toEqual(expected);
  });

  it('runs only the chosen branch, once, with later statements after it', async () => {
    expect(
      await printed(
        setVar('x', num(0)),
        ifThen(cmp('GT', num(2), num(1)), [setVar('x', add(getVar('x'), num(1))), print(getVar('x'))], [setVar('x', num(99))]),
        print(getVar('x')),
      ),
    ).toEqual(['1', '1']);
  });

  it('nests', async () => {
    const nested = (a: boolean, b: boolean) =>
      printed(ifThen(bool(a), [ifThen(bool(b), [print(text('ab'))], [print(text('a'))])], [print(text('none'))]));
    expect(await nested(true, true)).toEqual(['ab']);
    expect(await nested(true, false)).toEqual(['a']);
    expect(await nested(false, true)).toEqual(['none']);
  });

  it('does not evaluate the branch it does not take', async () => {
    expect(await printed(ifThen(bool(false), [print(idiv(num(1), num(0)))]), print(text('ok')))).toEqual(['ok']);
  });

  it('uses a comparison of variables as a condition', async () => {
    expect(await printed(setVar('x', num(3)), setVar('y', num(4)), ifThen(cmp('LT', getVar('x'), getVar('y')), [print(text('lt'))], [print(text('ge'))]))).toEqual(['lt']);
  });
});

describe('life cycle', () => {
  it('finishes a program with only on start', async () => {
    expect((await run(program([print(text('hi'))]))).outcome).toEqual({ status: 'finished' });
  });

  it('runs forever until stopped: on start, then the forever body, then a pause', async () => {
    const compiled = compileYbcProgram(program([print(text('start'))], [print(text('tick'))]), exposed);
    if (!compiled.ok) {
      throw new Error('does not compile');
    }
    const runConsole = createRunConsole();
    const running = runYbc(compiled.ir, { sleep: blockedSleep, console: runConsole });
    await new Promise((resolve) => setTimeout(resolve, 5));
    running.stop();
    expect(await running.done).toEqual({ status: 'stopped' });
    expect(runConsole.snapshot().lines).toEqual(['start', 'tick']);
  });

  it('prints nothing after it was stopped', async () => {
    const compiled = compileYbcProgram(program([print(text('start'))]), exposed);
    if (!compiled.ok) {
      throw new Error('does not compile');
    }
    const runConsole = createRunConsole();
    const running = runYbc(compiled.ir, { sleep: blockedSleep, console: runConsole });
    running.stop();
    expect(await running.done).toEqual({ status: 'stopped' });
    expect(runConsole.snapshot().lines).toEqual([]);
  });

  it('calls onPrint after each line', async () => {
    const compiled = compileYbcProgram(program([print(num(1)), print(num(2))]), exposed);
    if (!compiled.ok) {
      throw new Error('does not compile');
    }
    const seen: string[][] = [];
    const runConsole = createRunConsole();
    await runYbc(compiled.ir, { sleep: blockedSleep, console: runConsole, onPrint: () => seen.push(runConsole.snapshot().lines) }).done;
    expect(seen).toEqual([['1'], ['1', '2']]);
  });
});
