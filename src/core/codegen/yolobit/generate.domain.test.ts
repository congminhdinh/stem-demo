import { describe, expect, it } from 'vitest';
import { compileYbcProgram } from '../../program/compile-ybc-program';
import { createRunConsole } from '../../program/console';
import { runYbc } from '../../program/__fixtures__/run-ybc';
import { type YbcRunOutcome } from '../../program/ybc-interpreter';
import { add, countUp, getVar, idiv, join, mod, mul, num, print, program, repeat, setVar, sub, text, wait, type Json } from '../../program/__fixtures__/ybc-blocks';
import { compileBlocks } from './__fixtures__/compile-case';
import { runUnderCpython, type CpythonRun } from './__fixtures__/cpython-run';
import { python } from './__fixtures__/python';
import { generateYbcMicroPython } from './generate';

// Domain semantics, simulator versus generated Python (plan §6.3 "Domain guard (frozen)", §6.4, §6.7).
//
// SOURCE OF TRUTH. The plan freezes: when a value computed at run time leaves the supported domain
// (safe integer, wait, repeat, count up, text length) the SIMULATOR stops the program with
// `out-of-domain` / `limit-exceeded`; "that run carries no compatibility claim, and the generated code
// does not change. It is a refusal to simulate, not a guess at behaviour." The enforcement table
// (§6.4) says the generator "does not change the value" for wait / repeat and writes temporaries for
// count up. So generated Python has NO runtime guards. A run out of domain is OUTSIDE the claim, it is
// not a divergence, and MicroPython has big integers, so such a program is "out of domain, not
// different" (§6.4). What stays shared is every IN-domain value (the boundaries below), the literal
// checks (compile time AND generator), and the errors the language itself raises.
//
// Each row: what the simulator does, what the generated Python does when CPython runs it, and which
// of the two statements above applies. A row of kind `domain` is a simulator refusal; the generated
// Python is the unguarded form (checked: no guard, no helper).

const MAX = Number.MAX_SAFE_INTEGER;

type Sim = { status: string; code?: string; blockId?: string; lines: string[] };
type Row = {
  name: string;
  blocks: Json;
  /** The block the simulator names when it refuses, if it does. */
  refusedAt?: Json;
  /** `parity`: both finish alike. `domain`: the simulator refuses, the target is unguarded. `fault`: both stop with the language's own error. */
  kind: 'parity' | 'domain' | 'fault';
  sim: { code?: string };
  py: { lines?: string[]; sleeps?: number[]; error?: string | null };
};

async function simulate(blocks: Json): Promise<Sim> {
  const runConsole = createRunConsole();
  const running = runYbc(compileBlocks(blocks), { sleep: async () => {}, console: runConsole });
  const outcome: YbcRunOutcome = await running.done;
  return {
    status: outcome.status,
    ...(outcome.status === 'error' ? { code: outcome.code, ...(outcome.blockId ? { blockId: outcome.blockId } : {}) } : {}),
    lines: runConsole.snapshot().lines,
  };
}

const x = () => getVar('x');
const y = () => getVar('y');
const z = () => getVar('z');
const withX = (value: number, ...rest: Json[]) => program([setVar('x', num(value)), ...rest]);

/** A loop that counts its iterations in y, then prints y. */
const counting = (times: number) => {
  const loop = repeat(x(), [setVar('y', add(y(), num(1)))]);
  return { blocks: withX(times, loop, print(y())), loop };
};

const rows: Row[] = [];

// --- safe integer ---------------------------------------------------------------------------------
{
  const overflowAdd = add(x(), num(1));
  rows.push({ name: 'safe-int: 2^53-1 is in domain', kind: 'parity', blocks: withX(MAX, print(x()), print(sub(x(), num(1)))), sim: {}, py: { lines: [String(MAX), String(MAX - 1)] } });
  rows.push({ name: 'safe-int: -(2^53-1) is in domain', kind: 'parity', blocks: withX(-MAX, print(x()), print(add(x(), num(1)))), sim: {}, py: { lines: [String(-MAX), String(-MAX + 1)] } });
  rows.push({ name: 'safe-int: (2^53-1) + 1 overflows', kind: 'domain', blocks: withX(MAX, print(overflowAdd)), refusedAt: overflowAdd, sim: { code: 'out-of-domain' }, py: { lines: ['9007199254740992'] } });
  const underflow = sub(x(), num(1));
  rows.push({ name: 'safe-int: -(2^53-1) - 1 overflows', kind: 'domain', blocks: withX(-MAX, print(underflow)), refusedAt: underflow, sim: { code: 'out-of-domain' }, py: { lines: ['-9007199254740992'] } });
  const product = mul(x(), x());
  rows.push({ name: 'safe-int: 94906266 * 94906266 overflows', kind: 'domain', blocks: withX(94_906_266, print(product)), refusedAt: product, sim: { code: 'out-of-domain' }, py: { lines: ['9007199326062756'] } });
  const inner = add(x(), num(1));
  rows.push({ name: 'safe-int: an intermediate overflow whose final result is back in domain', kind: 'domain', blocks: withX(MAX, print(add(inner, num(-5)))), refusedAt: inner, sim: { code: 'out-of-domain' }, py: { lines: [String(MAX - 4)] } });
}

// --- wait ---------------------------------------------------------------------------------------------
{
  const dynamicWait = (ms: number) => {
    const block = wait(x());
    return { blocks: withX(ms, block), block };
  };
  for (const ms of [0, 60_000]) {
    rows.push({ name: `wait: dynamic ${ms} is in domain`, kind: 'parity', blocks: dynamicWait(ms).blocks, sim: {}, py: { sleeps: [ms], lines: [] } });
  }
  for (const ms of [-1, 60_001, 70_000]) {
    const { blocks } = dynamicWait(ms);
    rows.push({ name: `wait: dynamic ${ms} is out of domain`, kind: 'domain', blocks, sim: { code: 'out-of-domain' }, py: { sleeps: [ms], lines: [] } });
  }
}

// --- repeat ----------------------------------------------------------------------------------------------
for (const [times, count] of [[-1_000_000, 0], [0, 0], [1_000_000, 1_000_000]] as const) {
  const { blocks } = counting(times);
  rows.push({ name: `repeat: dynamic ${times} is in domain (${count} iterations)`, kind: 'parity', blocks, sim: {}, py: { lines: [String(count)] } });
}
for (const [times, count] of [[-1_000_001, 0], [1_000_001, 1_000_001]] as const) {
  const { blocks } = counting(times);
  rows.push({ name: `repeat: dynamic ${times} is out of domain`, kind: 'domain', blocks, sim: { code: 'out-of-domain' }, py: { lines: [String(count)] } });
}

// --- count up --------------------------------------------------------------------------------------------
{
  const loopOver = (from: number, to: number, step = 1, loud = true) => {
    const loop = countUp('z', x(), y(), step, loud ? [print(z())] : []);
    return { loop, blocks: program([setVar('x', num(from)), setVar('y', num(to)), loop, print(z())]) };
  };
  const run = (from: number, to: number, step = 1) => {
    const printed: string[] = [];
    for (let i = from; i <= to; i += step) {
      printed.push(String(i));
    }
    return printed;
  };
  rows.push({ name: 'count up: 0..3 is in domain', kind: 'parity', blocks: loopOver(0, 3).blocks, sim: {}, py: { lines: [...run(0, 3), '3'] } });
  rows.push({ name: 'count up: 1000000..1000000 is in domain', kind: 'parity', blocks: loopOver(1_000_000, 1_000_000).blocks, sim: {}, py: { lines: ['1000000', '1000000'] } });
  rows.push({ name: 'count up: step 1000000 over 0..1000000 is in domain', kind: 'parity', blocks: loopOver(0, 1_000_000, 1_000_000).blocks, sim: {}, py: { lines: ['0', '1000000', '1000000'] } });
  rows.push({ name: 'count up: step 1 over 5..8', kind: 'parity', blocks: loopOver(5, 8).blocks, sim: {}, py: { lines: [...run(5, 8), '8'] } });
  // start > end at run time, both in domain: no iteration, the variable keeps its value in both consumers.
  rows.push({ name: 'count up: start > end at run time runs zero times and keeps the variable', kind: 'parity', blocks: loopOver(9, 2).blocks, sim: {}, py: { lines: ['0'] } });
  for (const [label, from, to] of [['start -1', -1, 3], ['start 1000001', 1_000_001, 1_000_002], ['end -1', 0, -1], ['end 1000001', 0, 1_000_001]] as const) {
    // CPython runs whatever range it is given (quietly: the point is the unguarded `range`, not its output).
    const { blocks } = loopOver(from, to, 1, false);
    rows.push({ name: `count up: dynamic ${label} is out of domain`, kind: 'domain', blocks, sim: { code: 'out-of-domain' }, py: {} });
  }
}

// --- text length, and the errors the language itself raises ---------------------------------------------
{
  const longJoin = join(text('a'.repeat(600)), text('b'.repeat(600)));
  const printJoin = print(longJoin);
  rows.push({ name: 'text: a join of 1000 characters is in domain', kind: 'parity', blocks: program([print(join(text('a'.repeat(500)), text('b'.repeat(500))))]), sim: {}, py: { lines: ['a'.repeat(500) + 'b'.repeat(500)] } });
  rows.push({ name: 'text: a join of 1200 characters exceeds the limit', kind: 'domain', blocks: program([printJoin]), refusedAt: longJoin, sim: { code: 'limit-exceeded' }, py: { lines: ['a'.repeat(600) + 'b'.repeat(600)] } });
  const dividing = idiv(num(1), x());
  rows.push({ name: 'fault: // by zero stops both', kind: 'fault', blocks: withX(0, print(dividing)), refusedAt: dividing, sim: { code: 'zero-division' }, py: { error: 'ZeroDivisionError' } });
  const remainder = mod(num(1), x());
  rows.push({ name: 'fault: % by zero stops both', kind: 'fault', blocks: withX(0, print(remainder)), refusedAt: remainder, sim: { code: 'zero-division' }, py: { error: 'ZeroDivisionError' } });
}

// The unguarded form: no guard, helper, exception or clamp of any kind in the generated file.
const guardWords = /\b(raise|assert|try|except|def|lambda|abs|min|max|int|float|round|import (?!time\b)|from)\b/;

describe.skipIf(python === null)('domain semantics: the simulator refuses out-of-domain runs, the generated Python is unguarded', () => {
  const sources = Object.fromEntries(
    rows.map((row) => {
      const generated = generateYbcMicroPython(compileBlocks(row.blocks));
      if (!generated.ok) {
        throw new Error(`${row.name}: ${JSON.stringify(generated.diagnostics)}`);
      }
      return [row.name, generated.source];
    }),
  );
  const runs: Record<string, CpythonRun> = python ? runUnderCpython(sources) : {};

  it.each(rows.map((row) => [row.name, row] as const))('%s', async (name, row) => {
    const sim = await simulate(row.blocks);
    const target = runs[name] as CpythonRun;

    // The generated file never guards, whatever the value turns out to be.
    expect(sources[name]).not.toMatch(guardWords);

    if (row.kind === 'parity') {
      expect(sim.status).toBe('finished');
      expect(sim.lines).toEqual(row.py.lines ?? []);
      expect(target.error).toBeNull();
      expect(target.lines).toEqual(sim.lines);
      expect(target.sleeps).toEqual(row.py.sleeps ?? []);
      return;
    }
    expect(sim).toMatchObject({ status: 'error', code: row.sim.code });
    // The simulator names the block it was evaluating: the operation for arithmetic, text and faults, the value read for a loop or a wait.
    if (row.refusedAt) {
      expect(sim.blockId).toBe(row.refusedAt.id);
    } else {
      expect(typeof sim.blockId).toBe('string');
    }
    if (row.kind === 'fault') {
      expect(target.error).toBe(row.py.error);
      return;
    }
    // A refusal of the simulator: the target just runs the unguarded program.
    expect(target.error).toBeNull();
    if (row.py.lines) {
      expect(target.lines).toEqual(row.py.lines);
    }
    if (row.py.sleeps) {
      expect(target.sleeps).toEqual(row.py.sleeps);
    }
  });

  it('keeps the table honest: every rule has an in-domain row and an out-of-domain row', () => {
    const kinds = (prefix: string) => new Set(rows.filter((row) => row.name.startsWith(prefix)).map((row) => row.kind));
    for (const rule of ['safe-int', 'wait', 'repeat', 'count up', 'text']) {
      expect(kinds(rule), rule).toContain('parity');
      expect(kinds(rule), rule).toContain('domain');
    }
  });
});

describe('literals outside the domain are refused by BOTH the compiler and the generator', () => {
  it.each([
    ['wait -1', wait(num(-1))],
    ['wait 60001', wait(num(60_001))],
    ['repeat 1000001', repeat(num(1_000_001), [])],
    ['repeat -1000001', repeat(num(-1_000_001), [])],
    ['count up start -1', countUp('x', num(-1), num(3), 1, [])],
    ['count up end 1000001', countUp('x', num(0), num(1_000_001), 1, [])],
    ['count up step 0', countUp('x', num(0), num(3), 0, [])],
    ['count up step 1000001', countUp('x', num(0), num(3), 1_000_001, [])],
    ['count up descending literals', countUp('x', num(5), num(1), 1, [])],
    ['a text of 1001 characters', print(text('x'.repeat(1001)))],
    ['an int literal past 2^53-1', print(num(2 ** 53))],
  ])('%s', (_label, statement) => {
    const blocks = program([statement]);
    expect(compileYbcProgram(blocks, new Set(['stem_on_start', 'ybc_wait_ms', 'controls_repeat_ext', 'ybc_count_up', 'text_print', 'text', 'math_number'])).ok).toBe(false);
  });
});
