import { describe, expect, it } from 'vitest';
import { localDeviceDefinitions } from '../devices/local-catalog';
import { createDeviceRegistry } from '../devices/registry';
import { productionProfiles } from '../profiles';
import {
  add, bool, cmp, countUp, getVar, num, print, program, repeat, setVar, text, wait, whileLoop, type Json,
} from './__fixtures__/ybc-blocks';
import { createBlockPackCatalog } from './block-packs';
import { compileYbcProgram } from './compile-ybc-program';
import { createRunConsole } from './console';
import { timerSleep, type Sleep } from './interpreter';
import { MAX_REPEAT_ABS, MAX_WAIT_MS } from './limits';
import { runYbcProgram } from './ybc-interpreter';

// Real time, real timers (no fake clock): a learner loop must not freeze the event loop, and Stop
// must end any program within the frozen 100 ms (plan section 6.7, 18.5). The deadline is the plan's;
// the runs below need a few milliseconds.

const packs = createBlockPackCatalog(createDeviceRegistry(localDeviceDefinitions));
const exposed = packs.typesOf(productionProfiles.get('ybc-basic')?.blockPacks ?? []);
const prog = (statements: Json[], forever?: Json[]) => program(statements, forever, ['x', 'y', 'z', 'i']);
const stopDeadlineMs = 100;

function start(blocks: Json, options: { sleep?: Sleep; yieldNow?: () => Promise<void> } = {}) {
  const compiled = compileYbcProgram(blocks, exposed);
  if (!compiled.ok) {
    throw new Error(`Does not compile: ${JSON.stringify(compiled.diagnostics)}`);
  }
  const runConsole = createRunConsole();
  let yields = 0;
  const sleeps: number[] = [];
  const running = runYbcProgram(compiled.ir, {
    sleep: (ms, signal) => {
      sleeps.push(ms);
      return (options.sleep ?? timerSleep)(ms, signal);
    },
    console: runConsole,
    yieldNow: () => {
      yields++;
      return options.yieldNow ? options.yieldNow() : new Promise((resolve) => setTimeout(resolve, 0));
    },
  });
  return { running, runConsole, stats: () => ({ yields, sleeps }) };
}

/** A 1 ms timer. `maxGap` is the longest time between two ticks: how long the event loop was blocked at a stretch. */
function heartbeat() {
  let beats = 0;
  let last = performance.now();
  let maxGap = 0;
  const timer = setInterval(() => {
    const now = performance.now();
    maxGap = Math.max(maxGap, now - last);
    last = now;
    beats++;
  }, 1);
  return { beats: () => beats, maxGap: () => maxGap, stop: () => clearInterval(timer) };
}

/** Generous for Windows timer granularity; a loop that never yields would show a gap of the whole run. */
const maxGapAllowedMs = 50;

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Presses Stop after `runForMs` and says how long the program took to end. */
async function stopAfter(blocks: Json, runForMs: number, options: Parameters<typeof start>[1] = {}) {
  const { running, runConsole, stats } = start(blocks, options);
  await pause(runForMs);
  const pressed = performance.now();
  running.stop();
  const outcome = await running.done;
  return { outcome, tookMs: performance.now() - pressed, runConsole, stats };
}

describe('the event loop keeps running while a learner loop computes', () => {
  it('lets a timer fire during a tight while true with an empty body', async () => {
    const beat = heartbeat();
    const { tookMs, outcome, stats } = await stopAfter(prog([whileLoop(bool(true), [])]), 100);
    beat.stop();
    expect(outcome).toEqual({ status: 'stopped' });
    expect(beat.maxGap()).toBeLessThan(maxGapAllowedMs);
    expect(stats().yields).toBeGreaterThan(3);
    expect(tookMs).toBeLessThan(stopDeadlineMs);
  });

  it('lets a timer fire during a large repeat, and then finishes it', async () => {
    const beat = heartbeat();
    const { running, runConsole, stats } = start(
      prog([repeat(num(MAX_REPEAT_ABS), [setVar('x', add(getVar('x'), num(1)))]), print(getVar('x'))]),
    );
    expect(await running.done).toEqual({ status: 'finished' });
    beat.stop();
    expect(runConsole.snapshot().lines).toEqual([String(MAX_REPEAT_ABS)]);
    expect(stats().yields).toBeGreaterThan(0);
    expect(beat.beats()).toBeGreaterThan(0);
  });

  it('lets a timer fire during a long count up', async () => {
    const beat = heartbeat();
    const { running, stats } = start(prog([countUp('i', num(0), num(1_000_000), 1, [setVar('x', add(getVar('x'), num(1)))])]));
    expect(await running.done).toEqual({ status: 'finished' });
    beat.stop();
    expect(stats().yields).toBeGreaterThan(0);
    expect(beat.beats()).toBeGreaterThan(0);
  });

  it('lets a timer fire during nested loops', async () => {
    const beat = heartbeat();
    const nested = repeat(num(1000), [repeat(num(1000), [setVar('x', add(getVar('x'), num(1)))])]);
    const { running, runConsole } = start(prog([nested, print(getVar('x'))]));
    expect(await running.done).toEqual({ status: 'finished' });
    beat.stop();
    expect(runConsole.snapshot().lines).toEqual(['1000000']);
    expect(beat.beats()).toBeGreaterThan(0);
  });
});

describe('Stop ends a program within 100 ms', () => {
  const cases: [string, Json][] = [
    ['a tight while', prog([whileLoop(bool(true), [])])],
    ['a while with a body', prog([whileLoop(cmp('GTE', num(1), num(0)), [setVar('x', add(getVar('x'), num(1)))])])],
    ['a large repeat', prog([repeat(num(MAX_REPEAT_ABS), [repeat(num(0), [])]), repeat(num(MAX_REPEAT_ABS), [setVar('x', num(1))])])],
    ['nested repeats', prog([repeat(num(MAX_REPEAT_ABS), [repeat(num(MAX_REPEAT_ABS), [setVar('x', add(getVar('x'), num(1)))])])])],
    ['a count up', prog([countUp('i', num(0), num(1_000_000), 1, [setVar('x', add(getVar('x'), num(1)))]), whileLoop(bool(true), [])])],
    ['a forever with a tight loop in it', prog([], [whileLoop(bool(true), [])])],
    ['a forever', prog([], [print(text('tick'))])],
    ['a long wait', prog([wait(num(MAX_WAIT_MS)), print(text('never'))])],
    ['a wait inside a loop', prog([whileLoop(bool(true), [wait(num(MAX_WAIT_MS))])])],
  ];

  it.each(cases)('during %s', async (_, blocks) => {
    const { outcome, tookMs } = await stopAfter(blocks, 30);
    expect(outcome).toEqual({ status: 'stopped' });
    expect(tookMs).toBeLessThan(stopDeadlineMs);
  });

  it('prints nothing after Stop', async () => {
    const { running, runConsole } = start(prog([], [print(text('tick'))]));
    await pause(40);
    running.stop();
    await running.done;
    const after = runConsole.snapshot().lines.length;
    await pause(50);
    expect(runConsole.snapshot().lines).toHaveLength(after);
  });
});

describe('the budget yield is not program semantics', () => {
  it('gives the same result whether the browser gets control once, often or never', async () => {
    const blocks = prog([
      countUp('i', num(1), num(20_000), 1, [setVar('x', add(getVar('x'), getVar('i')))]),
      repeat(num(5000), [setVar('y', add(getVar('y'), num(2)))]),
      print(getVar('x')),
      print(getVar('y')),
    ]);
    const runWith = async (yieldNow: () => Promise<void>) => {
      const { running, runConsole } = start(blocks, { yieldNow });
      expect(await running.done).toEqual({ status: 'finished' });
      return runConsole.snapshot().lines;
    };
    const instant = await runWith(() => Promise.resolve());
    const slow = await runWith(() => new Promise((resolve) => setTimeout(resolve, 2)));
    expect(instant).toEqual(['200010000', '10000']);
    expect(slow).toEqual(instant);
  });

  it('adds no pause to forever: one 10 ms sleep per iteration, and the budget adds none', async () => {
    const { running, stats } = start(prog([], [print(text('tick'))]));
    await pause(75);
    running.stop();
    await running.done;
    const { sleeps, yields } = stats();
    expect(sleeps.length).toBeGreaterThan(2);
    expect(new Set(sleeps)).toEqual(new Set([10]));
    expect(yields).toBe(0);
  });

  it('keeps a wait exactly as long as the program says, and the budget out of it', async () => {
    const { running, stats } = start(prog([wait(num(5)), wait(num(0)), wait(num(20))]));
    expect(await running.done).toEqual({ status: 'finished' });
    expect(stats().sleeps).toEqual([5, 0, 20]);
    expect(stats().yields).toBe(0);
  });
});
