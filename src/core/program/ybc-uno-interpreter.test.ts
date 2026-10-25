import { describe, expect, it } from 'vitest';
import type { Capabilities } from '../capabilities/io';
import { createRuntimeServices, type RunWarning } from '../capabilities/services';
import { localDeviceDefinitions } from '../devices/local-catalog';
import { createDeviceRegistry } from '../devices/registry';
import { productionProfiles } from '../profiles';
import {
  add, cmp, countUp, getVar, idiv, join, mod, mul, num, print, program, repeat, setVar, sub, text, type Json,
} from './__fixtures__/ybc-blocks';
import { compileUno } from './__fixtures__/uno-language';
import { runYbc } from './__fixtures__/run-ybc';
import { createBlockPackCatalog } from './block-packs';
import { compileYbcProgram } from './compile-ybc-program';
import { createRunConsole } from './console';
import { createExecutionBudget, type ExecutionBudget } from './execution-budget';
import { timerSleep, type Sleep } from './interpreter';
import { STEP_CHECK_INTERVAL } from './limits';
import { runYbcProgram, type YbcRunOutcome } from './ybc-interpreter';
import type { Expr, YbcProgramIR } from './ybc-ir';

// N18 R2.3: the interpreter takes the numeric model and the loop pause from the IR (robot plan §4.4). A uno program computes with
// C++'s 32-bit `long` (contract UNO §3) and its forever has no pause of its own; a ybc program is exactly as before.

const prog = (statements: Json[], forever?: Json[]) => program(statements, forever, ['x', 'i']);
const ybcExposed = createBlockPackCatalog(createDeviceRegistry(localDeviceDefinitions)).typesOf(productionProfiles.get('ybc-basic')?.blockPacks ?? []);

function irOf(result: ReturnType<typeof compileUno>): YbcProgramIR {
  if (!result.ok) {
    throw new Error(`Does not compile: ${JSON.stringify(result.diagnostics)}`);
  }
  return result.ir;
}

async function run(ir: YbcProgramIR, capabilities: Capabilities = {}) {
  const runConsole = createRunConsole();
  const warnings: RunWarning[] = [];
  const sleeps: number[] = [];
  const sleep: Sleep = (ms) => {
    sleeps.push(ms);
    return Promise.resolve();
  };
  const outcome = await runYbc(ir, { sleep, console: runConsole, yieldNow: () => Promise.resolve(), warn: (w) => void warnings.push(w) }, capabilities).done;
  return { outcome, lines: runConsole.snapshot().lines, warnings, sleeps };
}

const light = (blockId: string): Expr => ({ blockId, type: 'int', kind: 'read', op: 'light.level' });
const uno = (onStart: YbcProgramIR['onStart'], forever: YbcProgramIR['forever'] = null): YbcProgramIR => ({
  onStart,
  forever,
  variables: [{ id: 'i', name: 'i', type: 'int' }],
  numeric: 'cxx-int32',
  loopPauseUs: 0,
});

describe('a cxx-int32 program (contract UNO §3)', () => {
  it('wraps, truncates, takes the sign of the dividend and prints a truth value as 1 / 0', async () => {
    const blocks = prog([
      setVar('x', num(2147483647)),
      setVar('x', add(getVar('x'), num(1))),
      print(getVar('x')),
      print(sub(getVar('x'), num(1))),
      print(mul(num(2147483647), num(2147483647))),
      print(idiv(num(-7), num(2))),
      print(mod(num(-7), num(2))),
      print(mod(num(7), num(-2))),
      print(cmp('LT', num(1), num(2))),
      print(cmp('GT', num(1), num(2))),
      print(join(text('x = '), getVar('x'), text(' '), cmp('EQ', num(1), num(1)))),
    ]);
    const { outcome, lines, warnings } = await run(irOf(compileUno(blocks)));
    expect(outcome).toEqual({ status: 'finished' });
    expect(lines).toEqual(['-2147483648', '2147483647', '1', '-3', '-1', '1', '1', '0', 'x = -2147483648 1']);
    expect(warnings).toEqual([]);
  });

  it('gives INT32_MIN for INT32_MIN / -1 and 0 for x % -1', async () => {
    const blocks = prog([
      setVar('x', sub(num(-2147483647), num(1))),
      print(getVar('x')),
      print(idiv(getVar('x'), num(-1))),
      print(mod(getVar('x'), num(-1))),
      print(mod(num(-5), num(-1))),
      print(sub(num(0), getVar('x'))),
    ]);
    expect((await run(irOf(compileUno(blocks)))).lines).toEqual(['-2147483648', '-2147483648', '0', '0', '-2147483648']);
  });

  it('gives 0 for a division or a remainder by zero, goes on, and warns division-by-zero once per block in a run (U-06)', async () => {
    const division = idiv(num(7), num(0));
    const remainder = mod(getVar('x'), num(0));
    const blocks = prog([repeat(num(3), [print(division), print(remainder)]), print(text('after'))]);
    const ir = irOf(compileUno(blocks));
    const first = await run(ir);
    expect(first.outcome).toEqual({ status: 'finished' });
    expect(first.lines).toEqual(['0', '0', '0', '0', '0', '0', 'after']);
    // Two blocks give two warnings; the same block three times in the loop gives one.
    const message = 'A division or a remainder by 0 gave 0, as on the board.';
    expect(first.warnings).toEqual([
      { code: 'division-by-zero', message, blockId: division.id },
      { code: 'division-by-zero', message, blockId: remainder.id },
    ]);
    // Once per block per run: the next run warns again, once per block.
    expect((await run(ir)).warnings).toHaveLength(2);
  });

  it('keeps the Python fault for a ybc program: a division by zero stops it at its block', async () => {
    const division = idiv(num(7), num(0));
    const compiled = compileYbcProgram(prog([print(division), print(text('never'))]), ybcExposed);
    const { outcome, lines, warnings } = await run(irOf(compiled));
    expect(outcome).toEqual({ status: 'error', code: 'zero-division', message: 'Division by zero.', blockId: division.id });
    expect(lines).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it('counts up with the start evaluated before the end, each once, and leaves the variable at the last value', async () => {
    const reads: string[] = [];
    const levels = [2, 4];
    const capabilities: Capabilities = {
      light: {
        lightLevel: () => {
          reads.push(`read ${reads.length + 1}`);
          return levels[reads.length - 1] ?? 99;
        },
      },
    };
    const ir = uno([
      { kind: 'countUp', variable: 'i', from: light('from'), to: light('to'), step: 1, blockId: 'count', body: [{ kind: 'print', value: { blockId: 'v', type: 'int', kind: 'variable', variable: 'i' }, blockId: 'p' }] },
      { kind: 'print', value: { blockId: 'v2', type: 'int', kind: 'variable', variable: 'i' }, blockId: 'after' },
    ]);
    const { outcome, lines } = await run(ir, capabilities);
    expect(outcome).toEqual({ status: 'finished' });
    // The start (2) was read first, the end (4) second, and neither again while the loop ran.
    expect(reads).toEqual(['read 1', 'read 2']);
    expect(lines).toEqual(['2', '3', '4', '4']);
  });

  it('leaves the variable as it was when the start is past the end at run time, and stops at a computed end past 2147483646', async () => {
    const empty = await run(irOf(compileUno(prog([setVar('i', num(7)), countUp('i', add(num(5), num(0)), num(1), 1, [print(text('never'))]), print(getVar('i'))]))));
    expect(empty.lines).toEqual(['7']);
    const end = add(num(2147483646), num(1));
    const tooFar = await run(irOf(compileUno(prog([countUp('i', num(0), end, 1, [])]))));
    expect(tooFar.outcome).toEqual({ status: 'error', code: 'out-of-domain', message: 'The end must be between -2147483648 and 2147483646, not 2147483647.', blockId: end.id });
  });

  it('runs a repeat of any long count: zero or less runs none, where Python would refuse a count past a million', async () => {
    const blocks = prog([repeat(sub(num(-2147483647), num(1)), [print(text('never'))]), repeat(sub(num(0), num(1_000_001)), [print(text('never'))]), print(text('done'))]);
    expect((await run(irOf(compileUno(blocks)))).lines).toEqual(['done']);
    const python = await run(irOf(compileYbcProgram(prog([repeat(sub(num(0), num(1_000_001)), [])]), ybcExposed)));
    expect(python.outcome).toMatchObject({ status: 'error', code: 'out-of-domain' });
  });
});

describe('the loop pause of the IR', () => {
  /** Runs `forever { print tick }` until `ticks` lines, with a budget that records what the interpreter tells it. */
  async function foreverRun(ir: YbcProgramIR, ticks: number) {
    const controller = new AbortController();
    const calls: string[] = [];
    const sleeps: number[] = [];
    const budget: ExecutionBudget = {
      work: () => {},
      step: () => {
        calls.push('step');
        controller.signal.throwIfAborted();
        return undefined;
      },
      startSlice: () => void calls.push('startSlice'),
      loopIteration: () => void calls.push('loop'),
    };
    let printed = 0;
    const services = createRuntimeServices({
      signal: controller.signal,
      console: { write: () => void (++printed >= ticks && controller.abort()) },
      budget,
      sleep: (ms) => {
        sleeps.push(ms);
        return Promise.resolve();
      },
    });
    const outcome = await runYbcProgram(ir, {}, services).done;
    return { outcome, calls, sleeps };
  }

  it('gives a uno forever no pause of its own: each iteration is one loop() call of the budget, then its step', async () => {
    const { outcome, calls, sleeps } = await foreverRun(irOf(compileUno(prog([], [print(text('tick'))]))), 3);
    expect(outcome).toEqual({ status: 'stopped' });
    expect(sleeps).toEqual([]);
    expect(calls).toEqual(['startSlice', 'loop', 'step', 'step', 'loop', 'step', 'step', 'loop', 'step', 'step']);
  });

  it('keeps the 10 ms sleep after every ybc forever iteration (the IR has no pause: YBC_LOOP_PAUSE_US)', async () => {
    const { outcome, calls, sleeps } = await foreverRun(irOf(compileYbcProgram(prog([], [print(text('tick'))]), ybcExposed)), 3);
    expect(outcome).toEqual({ status: 'stopped' });
    // The third iteration is the one Stop ends, before its pause.
    expect(sleeps).toEqual([10, 10]);
    expect(calls).toEqual(['startSlice', 'loop', 'step', 'step', 'startSlice', 'loop', 'step', 'step', 'startSlice', 'loop', 'step', 'step']);
  });

  it('takes any other pause from the IR, in µs', async () => {
    const ir = { ...irOf(compileUno(prog([], [print(text('tick'))]))), loopPauseUs: 2500 };
    expect((await foreverRun(ir, 3)).sleeps).toEqual([2.5, 2.5]);
  });

  it.each([
    ['a numeric model that does not exist', { numeric: 'float' }],
    ['a negative loop pause', { loopPauseUs: -1 }],
    ['a loop pause that is not a number', { loopPauseUs: Number.NaN }],
  ])('ends with an internal error, never a crash, for IR with %s', async (_, forged) => {
    const ir = { ...irOf(compileUno(prog([print(text('never'))], [print(text('never'))]))), ...forged } as YbcProgramIR;
    const { outcome, lines } = await run(ir);
    expect(outcome).toMatchObject({ status: 'error', code: 'internal-error' } satisfies Partial<YbcRunOutcome>);
    expect(lines).toEqual([]);
  });
});

describe('a ybc run (the regression net of R2.3)', () => {
  it('ybc run with real services behaves exactly as before', async () => {
    const blocks = prog([print(idiv(num(-7), num(2))), print(mod(num(-7), num(2))), print(cmp('LT', num(1), num(2))), print(add(num(2147483647), num(1)))], [print(text('tick'))]);
    const ir = irOf(compileYbcProgram(blocks, ybcExposed));
    // The IR of YB-2: no numeric model, no loop pause.
    expect(Object.keys(ir)).toEqual(['onStart', 'forever', 'variables']);
    // The services RunSession gives a ybc run: the YB-2 budget on the performance clock, the browser's timers, a scheduler of its own.
    const controller = new AbortController();
    const runConsole = createRunConsole();
    const sleeps: number[] = [];
    const services = createRuntimeServices({
      signal: controller.signal,
      console: runConsole,
      sleep: (ms, signal) => {
        sleeps.push(ms);
        return timerSleep(ms, signal);
      },
    });
    const { done } = runYbcProgram(ir, {}, services);
    await new Promise((resolve) => setTimeout(resolve, 60));
    controller.abort();
    expect(await done).toEqual({ status: 'stopped' });
    const [floor, rest, truth, big, ...ticks] = runConsole.snapshot().lines;
    // Python's ints: // floors, % takes the sign of the divisor, a truth value is True, and nothing wraps at 32 bits.
    expect([floor, rest, truth, big]).toEqual(['-4', '1', 'True', '2147483648']);
    // Every forever iteration prints and then sleeps 10 ms on a real timer; Stop ends the last sleep. Nothing else waits.
    expect(new Set(ticks)).toEqual(new Set(['tick']));
    expect(new Set(sleeps)).toEqual(new Set([10]));
    expect(ticks.length).toBe(sleeps.length);
    expect(ticks.length).toBeGreaterThan(1);
    expect(ticks.length).toBeLessThanOrEqual(7);
  });

  it('has a YB-2 budget whose loopIteration does nothing: no step counted, no clock read, no yield', () => {
    let reads = 0;
    let yields = 0;
    const budget = createExecutionBudget({
      signal: new AbortController().signal,
      now: () => {
        reads++;
        return 1000 * reads;
      },
      yieldNow: () => {
        yields++;
        return Promise.resolve();
      },
    });
    const readsAtStart = reads;
    for (let i = 0; i < STEP_CHECK_INTERVAL - 1; i++) {
      budget.loopIteration();
      expect(budget.step()).toBeUndefined();
    }
    for (let i = 0; i < 10_000; i++) {
      budget.loopIteration();
    }
    expect([reads - readsAtStart, yields]).toEqual([0, 0]);
    // The 256th step is the first look at the clock, as it always was.
    expect(budget.step()).toBeInstanceOf(Promise);
    expect([reads - readsAtStart, yields]).toEqual([1, 1]);
  });
});
