import { describe, expect, it } from 'vitest';
import type { Capabilities } from '../capabilities/io';
import { unoContract } from '../compat/uno-contract';
import { cpuMs, heartbeat, wallCeilingMs } from '../program/__fixtures__/cpu-clock';
import { compileUno, unoLanguageBlockTypes } from '../program/__fixtures__/uno-language';
import { add, bool, getVar, num, print, program, repeat, setVar, wait, whileLoop, type Json } from '../program/__fixtures__/ybc-blocks';
import type { Expr, YbcProgramIR, YbcStatement } from '../program/ybc-ir';
import { startVirtualRun, worldTimeOf, type VirtualRun } from './__fixtures__/virtual-run';
import { WORLD_TICK_MS } from './virtual-clock';

// N18 R2.3: the interpreter on the virtual clock, as a robot run drives it (robot plan §3, Review Focus 1). The world is reduced to
// its time; a "pulseIn" is a read that charges the program clock what contract UNO §4.4 says the board spends.

const dt = WORLD_TICK_MS;
const costs = unoContract.costsUs;
const prog = (statements: Json[], forever?: Json[]) => program(statements, forever, ['x', 'd']);

function irOf(result: ReturnType<typeof compileUno>): YbcProgramIR {
  if (!result.ok) {
    throw new Error(`Does not compile: ${JSON.stringify(result.diagnostics)}`);
  }
  return result.ir;
}

// Hand-written uno IR for what needs a sensor (the uno block packs are R2.2's).
const lit = (value: number): Expr => ({ blockId: `n${value}`, type: 'int', kind: 'int', value });
const get = (variable: string): Expr => ({ blockId: `get-${variable}`, type: 'int', kind: 'variable', variable });
const sensor: Expr = { blockId: 'pulse-in', type: 'int', kind: 'read', op: 'light.level' };
const set = (variable: string, value: Expr): YbcStatement => ({ kind: 'set', variable, value, blockId: `set-${variable}` });
const less = (left: Expr, right: Expr): Expr => ({ blockId: 'less', type: 'bool', kind: 'compare', op: '<', left, right });
const unoIr = (onStart: YbcStatement[], forever: YbcStatement[] | null): YbcProgramIR => ({
  onStart,
  forever,
  variables: [
    { id: 'd', name: 'd', type: 'int' },
    { id: 'x', name: 'x', type: 'int' },
  ],
  numeric: 'cxx-int32',
  loopPauseUs: 0,
});

type Read = { clockMs: number; worldMs: number; cm: number };

/**
 * An HC-SR04 behind the `light` capability: a read is a pulseIn, synchronous, of the world at world.t. It charges the wait for the
 * echo (450 µs), the echo and 3.25 µs, or without an echo the measured 20 752 µs, never the 30 000 of the timeout (contract §4.4).
 */
function ultrasonic(reads: Read[], echoUsAt: (worldMs: number) => number | null) {
  return ({ scheduler, worldMs }: { scheduler: VirtualRun['scheduler']; worldMs(): number }): Capabilities => ({
    light: {
      lightLevel() {
        const echoUs = echoUsAt(worldMs());
        const cm = echoUs === null ? 100 : Math.min(100, Math.floor(echoUs / 58));
        reads.push({ clockMs: scheduler.programClock.now(), worldMs: worldMs(), cm });
        scheduler.programClock.charge(echoUs === null ? costs.pulseInNoPulse30000 : 450 + echoUs + costs.pulseInAfterPulse);
        return cm;
      },
    },
  });
}

/**
 * The CPU time of this thread alone, in ms: what blocks the page is the main thread computing. `process.cpuUsage` (cpuMs) also
 * counts V8's GC and compiler threads, which run beside it (a full test run measured a tick of 8.5 ms process CPU that the thread
 * did not spend). Node 23.9+ has `threadCpuUsage`; @types/node 20 does not know it.
 */
function threadCpuMs(): number {
  const usage = (process as NodeJS.Process & { threadCpuUsage?: () => NodeJS.CpuUsage }).threadCpuUsage;
  if (usage === undefined) {
    return cpuMs();
  }
  const { user, system } = usage.call(process);
  return (user + system) / 1000;
}

/** world.t ≤ programClock < world.t + dt. */
const insideTick = ({ clockMs, worldMs }: { clockMs: number; worldMs: number }) => worldMs <= clockMs && clockMs < worldMs + dt;

describe('no lateness', () => {
  it('repeat 100 × wait 10 ends at exactly 1000 ms virtual', async () => {
    const ir = irOf(compileUno(prog([repeat(num(100), [wait(num(10))])])));
    // The waits alone: nodes cost nothing here, so the program ends at 1000 ms exactly, whatever ticks the world takes.
    const waitsOnly = startVirtualRun(ir, { scheduler: { nodeUs: 0 } });
    expect(await waitsOnly.runUntilDone(200)).not.toBeNull();
    expect(waitsOnly.outcome()).toEqual({ status: 'finished' });
    expect(waitsOnly.scheduler.programClock.now()).toBe(1000);
    // With the contract's 1 µs per node, the program's own 302 nodes come on top, and nothing else: no tick rounds a wait up.
    const charged = startVirtualRun(ir);
    expect(await charged.runUntilDone(200)).not.toBeNull();
    expect(charged.scheduler.programClock.now()).toBe(1000.302);
  });

  it('ends every wait on its own 10 ms mark, not on the tick after it', async () => {
    const exposed = new Set([...unoLanguageBlockTypes, 'ybc_running_time']);
    const runningTime: Json = { type: 'ybc_running_time', id: 'running-time' };
    const run = startVirtualRun(irOf(compileUno(prog([repeat(num(100), [wait(num(10)), print(runningTime)])]), exposed)));
    expect(await run.runUntilDone(200)).toBe(120);
    expect(run.lines()).toEqual(Array.from({ length: 100 }, (_, index) => String((index + 1) * 10)));
  });
});

describe('a program never runs ahead of the world by a dt (Review Focus 1)', () => {
  it('pulseIn loop never leads world by more than dt', async () => {
    const reads: Read[] = [];
    // No echo for the first 2 s (nothing in front), then an obstacle at 20 cm (1160 µs).
    const run = startVirtualRun(unoIr([], [set('d', sensor)]), { capabilities: ultrasonic(reads, (world) => (world < 2000 ? null : 1160)) });
    for (let k = 0; k < 600; k++) {
      await run.tick(k);
      expect(insideTick({ clockMs: run.scheduler.programClock.now(), worldMs: run.worldMs() })).toBe(false);
    }
    expect(reads.length).toBeGreaterThan(1000);
    expect(reads.filter((read) => !insideTick(read))).toEqual([]);
    // Parking loses and gains no time: between two reads there is exactly the pulseIn and the loop's 53 µs of nodes.
    const noEcho = reads.filter((read) => read.cm === 100);
    for (let index = 1; index < noEcho.length; index++) {
      expect((noEcho[index]?.clockMs ?? 0) - (noEcho[index - 1]?.clockMs ?? 0)).toBeCloseTo((costs.pulseInNoPulse30000 + 53) / 1000, 9);
    }
    expect(noEcho.length).toBe(97);
  });

  it('holds for a while without wait in on-start, the loop of "drive until the wall is near"', async () => {
    const reads: Read[] = [];
    const ir = unoIr([set('d', lit(100)), { kind: 'while', condition: less(lit(20), get('d')), body: [set('d', sensor)], blockId: 'until-near' }, { kind: 'print', value: get('d'), blockId: 'arrived' }], null);
    const run = startVirtualRun(ir, { capabilities: ultrasonic(reads, (world) => (world < 1000 ? null : 1160)) });
    const ended = await run.runUntilDone(600);
    expect(run.outcome()).toEqual({ status: 'finished' });
    expect(run.lines()).toEqual(['20']);
    expect(reads.filter((read) => !insideTick(read))).toEqual([]);
    // It ends in the tick that holds the first read of the obstacle.
    const firstNear = reads.find((read) => read.cm === 20);
    expect(firstNear && worldTimeOf(ended ?? -1)).toBe(firstNear?.worldMs);
  });
});

describe('the page stays responsive', () => {
  it('tight forever loop never blocks a tick > 8 ms wall', async () => {
    // Time is the CPU time the main thread uses in the tick (program/__fixtures__/cpu-clock.ts: on a loaded machine the wall clock
    // also counts other processes), with a wall-clock ceiling. The bound is the EXEC_SLICE_MS a frame keeps for the UI.
    for (const ir of [
      irOf(compileUno(prog([], [setVar('x', add(getVar('x'), num(1)))]))),
      irOf(compileUno(prog([whileLoop(bool(true), [setVar('x', add(getVar('x'), num(1)))])]))),
    ]) {
      const run = startVirtualRun(ir);
      let maxCpuMs = 0;
      let maxWallMs = 0;
      for (let k = 0; k < 240; k++) {
        const cpu = threadCpuMs();
        const wall = performance.now();
        await run.tick(k);
        maxCpuMs = Math.max(maxCpuMs, threadCpuMs() - cpu);
        maxWallMs = Math.max(maxWallMs, performance.now() - wall);
        // The program used its whole tick and at most one iteration (54 µs) more.
        const clock = run.scheduler.programClock.now();
        expect(clock).toBeGreaterThanOrEqual(run.worldMs() + dt);
        expect(clock).toBeLessThan(run.worldMs() + dt + 0.054);
      }
      run.stop();
      expect(await run.done).toEqual({ status: 'stopped' });
      expect(maxCpuMs).toBeLessThan(8);
      expect(maxWallMs).toBeLessThan(wallCeilingMs);
    }
  });

  it('charges every uno forever iteration LOOP_MIN_US plus its nodes: an empty loop() is 51 µs', async () => {
    const run = startVirtualRun(irOf(compileUno(prog([], []))));
    await run.tick(0);
    // 164 × 51 µs is the first step at or past dt (8333.33 µs).
    expect(run.scheduler.programClock.now()).toBe(8.364);
    await run.tick(1);
    expect(run.scheduler.programClock.now()).toBe(16.677);
  });

  it('keeps the page alive with a breather when a tick has no virtual end (no cost per node), and Stop still ends it', async () => {
    const run = startVirtualRun(irOf(compileUno(prog([whileLoop(bool(true), [])]))), { scheduler: { nodeUs: 0 } });
    const beat = heartbeat();
    let tickEnded = false;
    const tick = run.tick(0).then(() => void (tickEnded = true));
    await new Promise((resolve) => setTimeout(resolve, 60));
    beat.stop();
    // A housekeeping yield is not blocked: the tick is still waiting for the program.
    expect(tickEnded).toBe(false);
    expect(beat.beats()).toBeGreaterThan(0);
    expect(beat.maxBusyMs()).toBeLessThan(50);
    run.stop();
    await tick;
    expect(run.outcome()).toEqual({ status: 'stopped' });
  });
});

describe('Stop', () => {
  it('Stop while parked ahead of world ends the run within one tick', async () => {
    const reads: Read[] = [];
    // A read of 50 ms: the program is six ticks ahead of the world after it.
    const run = startVirtualRun(unoIr([], [set('d', sensor)]), {
      capabilities: ({ scheduler, worldMs }) => ({
        light: {
          lightLevel() {
            reads.push({ clockMs: scheduler.programClock.now(), worldMs: worldMs(), cm: 0 });
            scheduler.programClock.charge(50_000);
            return 0;
          },
        },
      }),
    });
    await run.tick(0);
    await run.tick(1);
    const parkedAt = run.scheduler.programClock.now();
    expect(reads).toHaveLength(1);
    expect(parkedAt).toBeGreaterThanOrEqual(run.worldMs() + dt);
    run.stop();
    const next = run.tick(2);
    const first = await Promise.race([run.done, next.then(() => 'the tick ended first' as const)]);
    expect(first).toEqual({ status: 'stopped' });
    await next;
    await run.tick(3);
    await run.tick(20);
    // Nothing of the run is left: no read, no wait, and the clock where the park left it.
    expect(reads).toHaveLength(1);
    expect(run.scheduler.programClock.now()).toBe(parkedAt);
  });

  it('ends a program that waits in a long sleep within one tick too', async () => {
    const run = startVirtualRun(irOf(compileUno(prog([], [wait(num(60_000))]))));
    await run.tick(0);
    run.stop();
    const next = run.tick(1);
    const first = await Promise.race([run.done, next.then(() => 'the tick ended first' as const)]);
    expect(first).toEqual({ status: 'stopped' });
    await next;
  });
});

describe('deterministic replay', () => {
  /** A program that reads, branches, waits and sounds a tone in the background, and the trace of everything it does in 300 ticks. */
  async function traceOf(wallNow?: () => number) {
    const trace: unknown[] = [];
    const ir = unoIr(
      [set('x', lit(0))],
      [
        set('d', sensor),
        {
          kind: 'if',
          branches: [{ condition: less(get('d'), lit(30)), body: [{ kind: 'call', op: 'sound.pitch', args: [lit(440), lit(7)], blockId: 'tone' }, { kind: 'waitMs', ms: lit(3), blockId: 'wait' }] }],
          else: [set('x', { blockId: 'sum', type: 'int', kind: 'arith', op: '+', left: get('x'), right: get('d') })],
          blockId: 'near',
        },
        { kind: 'print', value: { blockId: 'rest', type: 'int', kind: 'arith', op: '%', left: get('x'), right: lit(7) }, blockId: 'print' },
      ],
    );
    const run = startVirtualRun(ir, {
      ...(wallNow ? { scheduler: { wallNow } } : {}),
      capabilities: ({ scheduler, worldMs }) => {
        const at = (event: string, value?: number) => trace.push([event, scheduler.programClock.now(), worldMs(), value]);
        return {
          light: {
            lightLevel() {
              // An obstacle that comes and goes with the world's time; no echo one period in three.
              const world = worldMs();
              const echoUs = Math.floor(world / 200) % 3 === 0 ? null : 580 + 58 * (Math.floor(world / 50) % 40);
              const cm = echoUs === null ? 100 : Math.floor(echoUs / 58);
              at('read', cm);
              scheduler.programClock.charge(echoUs === null ? costs.pulseInNoPulse30000 : 450 + echoUs + costs.pulseInAfterPulse);
              return cm;
            },
          },
          sound: { startTone: (hz) => at('tone on', hz), stopTone: () => at('tone off') },
        };
      },
    });
    for (let k = 0; k < 300; k++) {
      await run.tick(k);
    }
    run.stop();
    await run.done;
    return { trace, lines: run.lines() };
  }

  it('gives the same trace twice for the same program and the same ticks, however often the browser gets a turn', async () => {
    const first = await traceOf();
    const second = await traceOf();
    expect(first.trace.length).toBeGreaterThan(200);
    expect(first.trace.filter((event) => (event as unknown[])[0] === 'tone off').length).toBeGreaterThan(5);
    expect(second).toEqual(first);
    // A wall clock that is always 10 ms later: a housekeeping yield at every check. The run is the same, bit for bit.
    let wall = 0;
    const breathless = await traceOf(() => (wall += 10));
    expect(breathless).toEqual(first);
  });
});
