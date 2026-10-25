import { GCProfiler, getHeapStatistics, setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import { createProgramIO, createVirtualUno, kitPort } from '../../hardware';
import { startVirtualRun } from '../../run/__fixtures__/virtual-run';
import { compileRobot } from './uno-blocks';
import { num, wait, type Json } from './ybc-blocks';

// TEST-ONLY (N18 P1): how many bytes of JS heap a piece of work allocates, and what a uno program allocates per hardware read.
//
// V8's heap grows by what is allocated and shrinks at each collection by what it freed, so what `work` allocated is the growth of the
// used heap plus what every collection in between freed (node:v8 GCProfiler), however many there were. A full collection first leaves
// none half done from before. `gc` comes from --expose-gc when Node was started with it, else it is exposed at run time the way
// jest-leak-detector does it (`v8.setFlagsFromString('--expose-gc')`, then the `gc` of a new context); a Node that gives neither
// cannot measure, and the tests that need it say so and skip.

/** A full collection of the heap, or undefined when this Node gives none. */
export function fullGc(): (() => void) | undefined {
  const exposed = (globalThis as { gc?: unknown }).gc;
  if (typeof exposed === 'function') {
    return exposed as () => void;
  }
  try {
    setFlagsFromString('--expose-gc');
    const gc: unknown = runInNewContext('gc');
    return typeof gc === 'function' ? (gc as () => void) : undefined;
  } catch {
    return undefined;
  } finally {
    setFlagsFromString('--no-expose-gc');
  }
}

/** The JS heap `work` allocated, in bytes: what the used heap grew by plus what every collection in between freed. */
export async function heapAllocated(work: () => Promise<void>, gc: (() => void) | undefined = fullGc()): Promise<number> {
  gc?.();
  const profiler = new GCProfiler();
  const before = getHeapStatistics().used_heap_size;
  profiler.start();
  await work();
  const { statistics } = profiler.stop();
  const after = getHeapStatistics().used_heap_size;
  return after - before + statistics.reduce((freed, collection) => freed + collection.beforeGC.heapStatistics.usedHeapSize - collection.afterGC.heapStatistics.usedHeapSize, 0);
}

export type ReadAllocation = {
  ticks: number;
  reads: number;
  /** Everything the ticks allocated. */
  bytes: number;
  /** `bytes` per read. */
  bytesPerRead: number;
  /** Per read, beyond what a tick allocates by itself (`tickBytes`, when given): the read's own share. */
  bytesPerReadBeyondTick: number;
};

/**
 * A uno program (`forever`, the reference rover, Advanced blocks, variable x) on the virtual clock and the virtual UNO, as the robot lab
 * runs it (program/__fixtures__/uno-run.ts, without the record of every read), with the world reduced to its time and to sources that
 * allocate nothing: every line sensor reads LOW (not dark on this kit) and an ADC of 512, the button is released, the ultrasonic hears an
 * echo of `echoUs` (0: none). After `warmupTicks` (the JIT's), what `ticks` more allocate, everything included (the interpreter, the
 * hardware, the virtual clock, the harness's own ticks), and per hardware read: the module reads the program made in those ticks.
 */
export async function readAllocation(forever: Json[], options: { warmupTicks?: number; ticks?: number; echoUs?: number; tickBytes?: number } = {}): Promise<ReadAllocation> {
  const warmupTicks = options.warmupTicks ?? 600;
  const ticks = options.ticks ?? 1200;
  const echoUs = options.echoUs ?? 0;
  const compiled = compileRobot([], forever, { variables: ['x'] });
  if (!compiled.ok) {
    throw new Error(`Does not compile: ${JSON.stringify(compiled.diagnostics)}`);
  }
  const { kit, board, uses } = compiled;
  let reads = 0;
  const run = startVirtualRun(compiled.ir, {
    scheduler: { delayOverheadUs: board.costsUs.delayOverhead },
    capabilities: ({ scheduler }) => {
      const uno = createVirtualUno(board, scheduler.programClock);
      for (const module of kit.modules) {
        const pins = kitPort(kit, module.port)?.pins;
        if (module.kind === 'line-sensor' && pins?.PIN !== undefined) {
          uno.attachDigitalSource(pins.PIN, () => 0);
          uno.attachAnalogSource(pins.PIN, () => 512);
        } else if (module.kind === 'button' && pins?.PIN !== undefined) {
          uno.attachDigitalSource(pins.PIN, () => 1);
        } else if (module.kind === 'ultrasonic' && pins?.ECHO !== undefined) {
          uno.attachPulseSource(pins.ECHO, () => echoUs);
        }
      }
      const io = createProgramIO(kit, uno, uses);
      const { call, read } = io.modules;
      return {
        ...io,
        modules: {
          uses: io.modules.uses,
          call,
          read(role, op) {
            reads += 1;
            return read(role, op);
          },
        },
      };
    },
  });
  for (let k = 0; k < warmupTicks; k++) {
    await run.tick(k);
  }
  const readsBefore = reads;
  const bytes = await heapAllocated(async () => {
    for (let k = warmupTicks; k < warmupTicks + ticks; k++) {
      await run.tick(k);
    }
  });
  const measured = reads - readsBefore;
  const outcome = run.outcome();
  run.stop();
  if (outcome !== undefined || measured === 0) {
    throw new Error(`The program did not keep reading: ${JSON.stringify(outcome)}, ${measured} reads.`);
  }
  const beyond = bytes - (options.tickBytes ?? 0) * ticks;
  return { ticks, reads: measured, bytes, bytesPerRead: bytes / measured, bytesPerReadBeyondTick: beyond / measured };
}

/**
 * What a tick of this harness allocates by itself, in bytes: a loop() that waits 8 ms (no read, no op), so the program blocks and goes
 * on about once a tick (a tick is 8.33 ms), as a reading one does when it parks. It is the virtual clock's (the wait, the tick's wait for
 * the program), the harness's and one iteration's own, the same with a read or without: a program that reads a few times a tick (an
 * ultrasonic read takes 1.2 to 20.8 ms) shares it among few reads.
 */
export async function tickAllocation(options: { warmupTicks?: number; ticks?: number } = {}): Promise<number> {
  const warmupTicks = options.warmupTicks ?? 600;
  const ticks = options.ticks ?? 1200;
  const compiled = compileRobot([], [wait(num(8))], { variables: ['x'] });
  if (!compiled.ok) {
    throw new Error(`Does not compile: ${JSON.stringify(compiled.diagnostics)}`);
  }
  const run = startVirtualRun(compiled.ir, { scheduler: { delayOverheadUs: compiled.board.costsUs.delayOverhead } });
  for (let k = 0; k < warmupTicks; k++) {
    await run.tick(k);
  }
  const bytes = await heapAllocated(async () => {
    for (let k = warmupTicks; k < warmupTicks + ticks; k++) {
      await run.tick(k);
    }
  });
  run.stop();
  return bytes / ticks;
}
