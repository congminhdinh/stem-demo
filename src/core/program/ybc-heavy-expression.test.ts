import { describe, expect, it } from 'vitest';
import { localDeviceDefinitions } from '../devices/local-catalog';
import { createDeviceRegistry } from '../devices/registry';
import { productionProfiles } from '../profiles';
import { add, bool, idiv, num, print, program, repeat, setVar, whileLoop, type Json } from './__fixtures__/ybc-blocks';
import { createBlockPackCatalog } from './block-packs';
import { compileYbcProgram } from './compile-ybc-program';
import { createRunConsole } from './console';
import { timerSleep } from './interpreter';
import { MAX_PROGRAM_BLOCKS } from './limits';
import { runYbc } from './__fixtures__/run-ybc';

// Expression nodes are execution steps too (plan section 6.7): a tight loop around a big expression
// must hand control back about every 8 ms, not every 256 iterations of a heavy body. Real timers; the
// bounds catch the old behaviour (gaps of 50-70 ms) with room for Windows timer granularity.

const packs = createBlockPackCatalog(createDeviceRegistry(localDeviceDefinitions));
const exposed = packs.typesOf(productionProfiles.get('ybc-basic')?.blockPacks ?? []);

/** A balanced tree of `combine` over `leaves` leaf blocks: 2 * leaves - 1 blocks, nested log2(leaves) deep. */
function tree(leaves: number, combine: (a: Json, b: Json) => Json, leaf: () => Json): Json {
  if (leaves <= 1) {
    return leaf();
  }
  const left = Math.floor(leaves / 2);
  return combine(tree(left, combine, leaf), tree(leaves - left, combine, leaf));
}

/** About 1 900 blocks, so the whole program stays under the 2 000-block limit. */
const leaves = 950;
const sumTree = () => tree(leaves, add, () => num(1));
// Every leaf is 1 and 1 // 1 is 1, so no division by zero ever stops the program.
const divideTree = () => tree(leaves, idiv, () => num(1));

const prog = (statements: Json[]) => program(statements, undefined, ['x', 'y', 'z', 'i']);
const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function start(blocks: Json) {
  const compiled = compileYbcProgram(blocks, exposed);
  if (!compiled.ok) {
    throw new Error(`Does not compile: ${JSON.stringify(compiled.diagnostics)}`);
  }
  const runConsole = createRunConsole();
  return runYbc(compiled.ir, { sleep: timerSleep, console: runConsole });
}

/** A 1 ms timer: the longest time between two of its ticks is how long the event loop was blocked. */
function heartbeat() {
  let last = performance.now();
  let maxGap = 0;
  const timer = setInterval(() => {
    const now = performance.now();
    maxGap = Math.max(maxGap, now - last);
    last = now;
  }, 1);
  return { maxGap: () => maxGap, stop: () => clearInterval(timer) };
}

// Measured here: 17-24 ms with expression accounting, 37-38 ms without it. The bound is the generous
// one (a gross-blocking guard, Windows timers are coarse); the exact property is pinned by the
// deterministic clock-read test below.
const maxGapAllowedMs = 50;
const stopDeadlineMs = 100;

describe('a tight loop around a big expression', () => {
  const heavy: [string, () => Json][] = [
    ['an addition tree', sumTree],
    ['a floor-division tree (BigInt)', divideTree],
  ];

  it('builds trees of about 1 900 blocks, inside the program limit', () => {
    for (const [, build] of heavy) {
      const blocks = prog([whileLoop(bool(true), [setVar('x', build())])]);
      expect(JSON.stringify(blocks).split('"type"').length - 1).toBeLessThan(MAX_PROGRAM_BLOCKS);
      expect(compileYbcProgram(blocks, exposed).ok).toBe(true);
    }
  });

  it.each(heavy)('leaves the event loop free within %s: the longest gap stays small', async (_, build) => {
    const beat = heartbeat();
    const running = start(prog([whileLoop(bool(true), [setVar('x', build())])]));
    await pause(300);
    running.stop();
    await running.done;
    beat.stop();
    expect(beat.maxGap()).toBeLessThan(maxGapAllowedMs);
  });

  it.each(heavy)('is stopped promptly by a Stop that is itself scheduled on the event loop: %s', async (_, build) => {
    const running = start(prog([whileLoop(bool(true), [setVar('x', build())])]));
    let pressedAt = 0;
    let lateness = 0;
    const due = performance.now() + 60;
    const pressed = new Promise<void>((resolve) => {
      setTimeout(() => {
        pressedAt = performance.now();
        lateness = pressedAt - due; // how long the busy program kept the Stop button waiting
        running.stop();
        resolve();
      }, 60);
    });
    await pressed;
    const outcome = await running.done;
    const total = performance.now() - due;

    expect(outcome).toEqual({ status: 'stopped' });
    expect(lateness).toBeLessThan(maxGapAllowedMs);
    expect(total).toBeLessThan(stopDeadlineMs);
  });

  it('looks at the clock at every iteration of a loop around a big expression, not after 256 iterations', async () => {
    const compiled = compileYbcProgram(prog([repeat(num(300), [setVar('x', sumTree())])]), exposed);
    if (!compiled.ok) {
      throw new Error('does not compile');
    }
    let clockReads = 0;
    let yields = 0;
    await runYbc(compiled.ir, {
      sleep: timerSleep,
      console: createRunConsole(),
      now: () => {
        clockReads++;
        return clockReads * 10; // each look at the clock finds a whole slice used up
      },
      yieldNow: () => {
        yields++;
        return Promise.resolve();
      },
    }).done;
    // 300 iterations of about 1 000 nodes: every iteration has more than 256 steps on its account.
    // Without counting expression nodes the clock would be read about 300 / 256 = 1 time.
    expect(clockReads).toBeGreaterThanOrEqual(300);
    expect(yields).toBeGreaterThanOrEqual(299);
  });

  it('gives the same answer as a plain run: yielding does not change the result', async () => {
    const compiled = compileYbcProgram(prog([print(sumTree())]), exposed);
    if (!compiled.ok) {
      throw new Error('does not compile');
    }
    const lines = async (yieldNow: () => Promise<void>) => {
      const runConsole = createRunConsole();
      await runYbc(compiled.ir, { sleep: timerSleep, console: runConsole, yieldNow }).done;
      return runConsole.snapshot().lines;
    };
    expect(await lines(() => Promise.resolve())).toEqual([String(leaves)]);
    expect(await lines(() => pause(1))).toEqual([String(leaves)]);
  });
});
