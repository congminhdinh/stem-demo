import { describe, expect, it } from 'vitest';
import type { Capabilities } from '../capabilities/io';
import { createRuntimeServices, type RuntimeServices } from '../capabilities/services';
import { localDeviceDefinitions } from '../devices/local-catalog';
import { createDeviceRegistry } from '../devices/registry';
import { productionProfiles } from '../profiles';
import { startVirtualRun, worldTimeOf } from '../run/__fixtures__/virtual-run';
import { createBlockPackCatalog } from './block-packs';
import { compileYbcProgram } from './compile-ybc-program';
import { createRunConsole } from './console';
import { compileRobot } from './__fixtures__/uno-blocks';
import { runYbc } from './__fixtures__/run-ybc';
import {
  add, cmp, countUp, getVar, ifThen, num, print, program, repeat, setVar, text, wait, type Json,
} from './__fixtures__/ybc-blocks';
import type { Sleep } from './interpreter';
import { runYbcProgram, type YbcRunOutcome } from './ybc-interpreter';
import type { YbcProgramIR } from './ybc-ir';

// N18 R2.4: `RuntimeServices.trace(blockId)`, the hook the robot lab's highlight reads (through RobotRunSession's `activeBlockId`).
// The interpreter calls it when each statement starts, and in a pause of the program (a `wait`, the pause of `forever`) the block
// that is waiting stays the one reported: never `undefined`, never a block of an earlier statement.

const exposed = createBlockPackCatalog(createDeviceRegistry(localDeviceDefinitions)).typesOf(productionProfiles.get('ybc-basic')?.blockPacks ?? []);

function ybcIr(blocks: Json): YbcProgramIR {
  const compiled = compileYbcProgram(blocks, exposed);
  if (!compiled.ok) {
    throw new Error(`Does not compile: ${JSON.stringify(compiled.diagnostics)}`);
  }
  return compiled.ir;
}

const idOf = (block: Json) => block.id as string;
const instantSleep: Sleep = () => Promise.resolve();

describe('trace reports blockId of each executed statement in order', () => {
  it('a ybc program: each statement when it starts, a body once per iteration, an if only for the branch taken', async () => {
    const setX = setVar('x', num(1));
    const loopPrint = print(getVar('x'));
    const repeated = repeat(num(2), [loopPrint]);
    const taken = print(text('taken'));
    const skipped = print(text('skipped'));
    const branch = ifThen(cmp('EQ', getVar('x'), num(1)), [taken], [skipped]);
    const counting = countUp('x', num(1), num(2), 1, [print(getVar('x'))]);
    const last = print(text('done'));
    const ir = ybcIr(program([setX, repeated, branch, counting, last]));
    const traced: string[] = [];
    const runConsole = createRunConsole();
    const outcome = await runYbc(ir, { sleep: instantSleep, console: runConsole, trace: (blockId) => void traced.push(blockId) }).done;
    expect(outcome).toEqual({ status: 'finished' });
    const countBody = (counting.inputs as { DO: { block: Json } }).DO.block;
    expect(traced).toEqual([
      idOf(setX),
      idOf(repeated), idOf(loopPrint), idOf(loopPrint),
      idOf(branch), idOf(taken),
      idOf(counting), idOf(countBody), idOf(countBody),
      idOf(last),
    ]);
  });

  it('a uno program compiled for its kit (compileUnoProject): on start, then the forever body and the forever hat once per loop() iteration', async () => {
    const setX = setVar('x', num(0));
    const pause = wait(num(20));
    const bump = setVar('x', add(getVar('x'), num(1)));
    const show = print(getVar('x'));
    const compiled = compileRobot([setX, pause], [bump, show]);
    if (!compiled.ok) {
      throw new Error(`Does not compile: ${JSON.stringify(compiled.diagnostics)}`);
    }
    const traced: string[] = [];
    const run = startVirtualRun(compiled.ir, { scheduler: { delayOverheadUs: compiled.board.costsUs.delayOverhead }, trace: (blockId) => void traced.push(blockId) });
    for (let tick = 0; tick < 12; tick++) {
      await run.tick(tick);
    }
    run.stop();
    await run.done;
    // The uno IR names its forever hat, and the end of every loop() iteration is the hat's.
    const hat = compiled.ir.foreverBlockId;
    expect(hat).toBe('forever');
    expect(traced.slice(0, 8)).toEqual([idOf(setX), idOf(pause), idOf(bump), idOf(show), hat, idOf(bump), idOf(show), hat]);
    expect(traced.every((blockId) => typeof blockId === 'string' && blockId !== '')).toBe(true);
    // Every iteration of loop() is the same two statements and the hat, to the end of the run.
    const iterations = traced.slice(2);
    expect(iterations.length).toBeGreaterThan(8);
    const pattern = [idOf(bump), idOf(show), hat];
    expect(iterations.filter((blockId, index) => blockId !== pattern[index % 3])).toEqual([]);
  });

  it('names the block that faulted as the last one traced, and the outcome names it too', async () => {
    const before = print(text('before'));
    const broken = setVar('x', add(num(9007199254740991), num(1)));
    const never = print(text('never'));
    const traced: string[] = [];
    const outcome = await runYbc(ybcIr(program([before, broken, never])), { sleep: instantSleep, console: createRunConsole(), trace: (blockId) => void traced.push(blockId) }).done;
    expect(traced).toEqual([idOf(before), idOf(broken)]);
    expect(outcome).toMatchObject({ status: 'error', code: 'out-of-domain' });
  });
});

describe('wait reports the waiting block, forever pause reports the hat', () => {
  /** A sleep that records which block was the last one traced when the program began to wait. */
  function watching() {
    const traced: string[] = [];
    const sleeps: { ms: number; active: string | undefined }[] = [];
    const controller = new AbortController();
    const sleep: Sleep = (ms) => {
      sleeps.push({ ms, active: traced.at(-1) });
      return Promise.resolve();
    };
    return { traced, sleeps, controller, sleep, trace: (blockId: string) => void traced.push(blockId) };
  }

  /** Services that stop the run at its `stopAt`th sleep, with the watching sleep and trace. */
  function stoppingAt(stopAt: number, watch: ReturnType<typeof watching>) {
    let sleepsSeen = 0;
    return createRuntimeServices({
      signal: watch.controller.signal,
      console: createRunConsole(),
      sleep: (ms, signal) => {
        if (++sleepsSeen === stopAt) {
          watch.controller.abort();
        }
        return watch.sleep(ms, signal);
      },
      trace: watch.trace,
    });
  }

  it('a ybc wait is the block that waits; its forever pause has no hat name, so the last statement of the body stays the reported one', async () => {
    const pause = wait(num(250));
    const body = print(text('tick'));
    const ir = ybcIr(program([pause], [body]));
    expect(ir.foreverBlockId).toBeUndefined();
    const watch = watching();
    const outcome = await runYbcProgram(ir, {}, stoppingAt(3, watch)).done;
    expect(outcome).toEqual({ status: 'stopped' });
    expect(watch.sleeps).toEqual([
      { ms: 250, active: idOf(pause) },
      { ms: 10, active: idOf(body) },
      { ms: 10, active: idOf(body) },
    ]);
    expect(watch.traced).toEqual([idOf(pause), idOf(body), idOf(body)]);
  });

  it('the hat is the block of the forever pause when the IR names it: a loop that has a pause tells the hat before it sleeps', async () => {
    const body = print(text('tick'));
    const compiled = compileRobot([], [body]);
    if (!compiled.ok) {
      throw new Error(`Does not compile: ${JSON.stringify(compiled.diagnostics)}`);
    }
    // A uno IR with a pause of its own, as an IR of another family could have.
    const withPause: YbcProgramIR = { ...compiled.ir, loopPauseUs: 10_000 };
    expect(withPause.foreverBlockId).toBe('forever');
    const watch = watching();
    const outcome = await runYbcProgram(withPause, {}, stoppingAt(2, watch)).done;
    expect(outcome).toEqual({ status: 'stopped' });
    expect(watch.sleeps).toEqual([
      { ms: 10, active: 'forever' },
      { ms: 10, active: 'forever' },
    ]);
    expect(watch.traced).toEqual([idOf(body), 'forever', idOf(body), 'forever']);
  });

  it('a uno wait lights the wait block for as long as the robot waits (the virtual clock), and the hat has the time between two loop() iterations', async () => {
    const pause = wait(num(500));
    const after = print(text('after'));
    const compiled = compileRobot([pause, after]);
    if (!compiled.ok) {
      throw new Error(`Does not compile: ${JSON.stringify(compiled.diagnostics)}`);
    }
    // No forever block: no hat to name.
    expect(compiled.ir.foreverBlockId).toBeUndefined();
    const traced: string[] = [];
    const run = startVirtualRun(compiled.ir, { scheduler: { delayOverheadUs: compiled.board.costsUs.delayOverhead }, trace: (blockId) => void traced.push(blockId) });
    // Tick 0 starts the program; the wait lasts 500 ms (60 ticks), and the block stays the active one throughout it.
    for (const tick of [0, 1, 30, 59]) {
      await run.tick(tick);
      expect(traced.at(-1)).toBe(idOf(pause));
      expect(run.lines()).toEqual([]);
    }
    expect(worldTimeOf(59)).toBeLessThan(500);
    await run.runUntilDone(200);
    expect(run.outcome()).toEqual({ status: 'finished' });
    expect(traced).toEqual([idOf(pause), idOf(after)]);
  });

  it('a wait in a uno loop(): the wait block is the active one during each wait, the hat between two waits', async () => {
    const pause = wait(num(100));
    const compiled = compileRobot([], [pause]);
    if (!compiled.ok) {
      throw new Error(`Does not compile: ${JSON.stringify(compiled.diagnostics)}`);
    }
    const traced: string[] = [];
    const run = startVirtualRun(compiled.ir, { scheduler: { delayOverheadUs: compiled.board.costsUs.delayOverhead }, trace: (blockId) => void traced.push(blockId) });
    await run.tick(0);
    await run.tick(6);
    expect(traced).toEqual([idOf(pause)]);
    // The wait ends at about 100 ms (tick 12): the loop starts over through the hat.
    for (let tick = 7; tick <= 30; tick++) {
      await run.tick(tick);
    }
    run.stop();
    await run.done;
    expect(traced.slice(0, 4)).toEqual([idOf(pause), 'forever', idOf(pause), 'forever']);
  });

  it('an IR without a hat name (a ybc IR, or a hand-made one) pauses without a report: nothing is invented, never undefined', async () => {
    const body = print(text('tick'));
    const withoutHat = ybcIr(program([], [body]));
    const watch = watching();
    const outcome = await runYbcProgram(withoutHat, {}, stoppingAt(2, watch)).done;
    expect(outcome).toEqual({ status: 'stopped' });
    expect(watch.traced).toEqual([idOf(body), idOf(body)]);
    expect(watch.traced.every((blockId) => typeof blockId === 'string')).toBe(true);
  });
});

describe('ybc run without trace behaves exactly as before', () => {
  /** One program of every shape that matters (language, a wait, forever, a warning-free end by Stop), run once per way of building services. */
  async function observe(withTrace: boolean, variant: 'default' | 'bare') {
    const loopPrint = print(getVar('x'));
    const ir = ybcIr(program([setVar('x', num(0)), repeat(num(3), [setVar('x', add(getVar('x'), num(1))), loopPrint]), wait(num(40))], [print(text('tick'))]));
    const controller = new AbortController();
    const runConsole = createRunConsole();
    const sleeps: number[] = [];
    let clockReads = 0;
    let virtualNow = 0;
    let iterations = 0;
    const sleep: Sleep = (ms) => {
      sleeps.push(ms);
      virtualNow += ms;
      return Promise.resolve();
    };
    const sink = {
      write(line: string) {
        runConsole.write(line);
        if (line === 'tick' && ++iterations === 3) {
          controller.abort();
        }
      },
    };
    const clock = { now: () => (++clockReads, virtualNow) };
    const options = { signal: controller.signal, console: sink, sleep, clock, yieldNow: () => Promise.resolve() };
    const traced: string[] = [];
    const services: RuntimeServices =
      variant === 'default'
        ? createRuntimeServices(withTrace ? { ...options, trace: (blockId) => void traced.push(blockId) } : options)
        : // Services built by hand, as a test or an older caller does: no `trace` property at all.
          (() => {
            const bare: RuntimeServices = { ...createRuntimeServices(options) };
            delete bare.trace;
            return bare;
          })();
    const outcome: YbcRunOutcome = await runYbcProgram(ir, {} as Capabilities, services).done;
    return { outcome, lines: runConsole.snapshot().lines, sleeps, clockReads, traced };
  }

  it('gives the same outcome, console, sleeps and clock reads as a run that is traced, and a hand-built services object without trace runs', async () => {
    const untraced = await observe(false, 'default');
    const bare = await observe(false, 'bare');
    const traced = await observe(true, 'default');
    expect(untraced.outcome).toEqual({ status: 'stopped' });
    expect(untraced.lines).toEqual(['1', '2', '3', 'tick', 'tick', 'tick']);
    expect(untraced.sleeps).toEqual([40, 10, 10, 10].slice(0, untraced.sleeps.length));
    expect(untraced.traced).toEqual([]);
    for (const other of [bare, traced]) {
      expect({ ...other, traced: [] }).toEqual({ ...untraced, traced: [] });
    }
    expect(traced.traced.length).toBeGreaterThan(0);
  });

  it('createRuntimeServices adds a trace only when one is given, so the services of a run are shaped as they were', () => {
    const controller = new AbortController();
    const base = { signal: controller.signal, console: { write: () => {} } };
    const none = createRuntimeServices(base);
    expect('trace' in none).toBe(false);
    expect(none.trace?.('a-block')).toBeUndefined();
    const seen: string[] = [];
    const given = createRuntimeServices({ ...base, trace: (blockId) => void seen.push(blockId) });
    given.trace?.('b-block');
    expect(seen).toEqual(['b-block']);
  });

  it('a ybc IR keeps the exact shape it has had since YB-2: the hat id is written for the uno family only', () => {
    const ybc = ybcIr(program([print(text('a'))], [print(text('b'))]));
    expect(Object.keys(ybc)).toEqual(['onStart', 'forever', 'variables']);
    expect('foreverBlockId' in ybc).toBe(false);
    const uno = compileRobot([print(text('a'))], [print(text('b'))]);
    const unoWithoutForever = compileRobot([print(text('a'))]);
    if (!uno.ok || !unoWithoutForever.ok) {
      throw new Error('Does not compile');
    }
    expect(uno.ir.foreverBlockId).toBe('forever');
    expect(Object.keys(uno.ir)).toContain('foreverBlockId');
    // No forever block, no hat to name.
    expect('foreverBlockId' in unoWithoutForever.ir).toBe(false);
  });

  it('the hat id of a uno IR is an ordinary field: it survives structuredClone, a spread and JSON, and a cloned IR traces the hat', async () => {
    const compiled = compileRobot([], [wait(num(10))]);
    if (!compiled.ok) {
      throw new Error(`Does not compile: ${JSON.stringify(compiled.diagnostics)}`);
    }
    const cloned = structuredClone(compiled.ir);
    expect(cloned.foreverBlockId).toBe('forever');
    expect(cloned).toEqual(compiled.ir);
    expect({ ...compiled.ir }.foreverBlockId).toBe('forever');
    expect((JSON.parse(JSON.stringify(compiled.ir)) as YbcProgramIR).foreverBlockId).toBe('forever');
    const traced: string[] = [];
    const run = startVirtualRun(cloned, { scheduler: { delayOverheadUs: compiled.board.costsUs.delayOverhead }, trace: (blockId) => void traced.push(blockId) });
    for (let tick = 0; tick < 6; tick++) {
      await run.tick(tick);
    }
    run.stop();
    await run.done;
    expect(traced).toContain('forever');
  });
});
