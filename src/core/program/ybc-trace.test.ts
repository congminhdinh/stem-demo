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

  it('a uno program compiled for its kit (compileUnoProject): on start, then the forever body once per loop() iteration', async () => {
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
    // Arduino's loop() has no pause of its own, so no hat is reported between two iterations.
    expect(traced.slice(0, 8)).toEqual([idOf(setX), idOf(pause), idOf(bump), idOf(show), idOf(bump), idOf(show), idOf(bump), idOf(show)]);
    expect(traced.every((blockId) => typeof blockId === 'string' && blockId !== '')).toBe(true);
    // Every iteration of loop() is the same two statements, to the end of the run.
    const iterations = traced.slice(2);
    expect(iterations.length).toBeGreaterThan(8);
    expect(iterations.filter((blockId, index) => blockId !== (index % 2 === 0 ? idOf(bump) : idOf(show)))).toEqual([]);
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

  it('a ybc wait is the block that waits; the pause at the end of each forever iteration is the forever hat', async () => {
    const pause = wait(num(250));
    const body = print(text('tick'));
    const ir = ybcIr(program([pause], [body]));
    expect(ir.foreverBlockId).toBe('forever');
    const watch = watching();
    let iterations = 0;
    const runConsole = createRunConsole();
    const services = createRuntimeServices({
      signal: watch.controller.signal,
      console: { write: (line) => { runConsole.write(line); if (++iterations === 2) { watch.controller.abort(); } } },
      sleep: watch.sleep,
      trace: watch.trace,
    });
    const outcome = await runYbcProgram(ir, {}, services).done;
    expect(outcome).toEqual({ status: 'stopped' });
    expect(watch.sleeps).toEqual([
      { ms: 250, active: idOf(pause) },
      { ms: 10, active: 'forever' },
    ]);
    expect(watch.traced).toEqual([idOf(pause), idOf(body), 'forever', idOf(body)]);
  });

  it('a uno wait lights the wait block for as long as the robot waits (the virtual clock), and loop() has no pause to report', async () => {
    const pause = wait(num(500));
    const after = print(text('after'));
    const compiled = compileRobot([pause, after]);
    if (!compiled.ok) {
      throw new Error(`Does not compile: ${JSON.stringify(compiled.diagnostics)}`);
    }
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

  it('an IR without a hat id (not the compiler\'s) pauses without a report: the last statement stays the active one, nothing is invented', async () => {
    const body = print(text('tick'));
    const withoutHat: YbcProgramIR = { ...ybcIr(program([], [body])) };
    delete withoutHat.foreverBlockId;
    const watch = watching();
    let sleepsSeen = 0;
    const services = createRuntimeServices({
      signal: watch.controller.signal,
      console: createRunConsole(),
      sleep: (ms, signal) => {
        if (++sleepsSeen === 2) {
          watch.controller.abort();
        }
        return watch.sleep(ms, signal);
      },
      trace: watch.trace,
    });
    const outcome = await runYbcProgram(withoutHat, {}, services).done;
    expect(outcome).toEqual({ status: 'stopped' });
    expect(watch.sleeps).toEqual([
      { ms: 10, active: idOf(body) },
      { ms: 10, active: idOf(body) },
    ]);
    expect(watch.traced).toEqual([idOf(body), idOf(body)]);
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

  it('the hat id is a name for tracing, not a key of the IR: the keys, a copy and a comparison of the IR are what they were', () => {
    const ir = ybcIr(program([print(text('a'))], [print(text('b'))]));
    expect(ir.foreverBlockId).toBe('forever');
    expect(Object.keys(ir)).toEqual(['onStart', 'forever', 'variables']);
    expect(JSON.parse(JSON.stringify(ir))).toEqual({ ...ir });
    expect(ir).toStrictEqual({ ...ir });
    // A program without a forever block has no hat to name.
    expect(ybcIr(program([print(text('a'))])).foreverBlockId).toBeUndefined();
  });
});
