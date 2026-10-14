import type { ProgramRun, RunOutcome, Sleep } from './interpreter';
import type { YbcProgramIR } from './ybc-ir';

// Runs a skeleton `YbcProgramIR` (YB plan §9.0, YB-1): enough to start and
// stop a Yolo:Bit-compatible project. Its statements do nothing, so this is
// the life cycle only: `onStart` once, then `forever` until stopped, with the
// same 10 ms pause per iteration as the legacy interpreter (E3). The typed
// interpreter, `runYbcProgram`, replaces it in YB-2. The legacy `runProgram`
// is not touched.

const foreverYieldMs = 10;

/** Like `runProgram`, the program starts after this returns, and `done` never rejects. */
export function runYbcSkeleton(ir: YbcProgramIR, options: { sleep: Sleep }): ProgramRun {
  const controller = new AbortController();
  const done = Promise.resolve().then(() => execute(ir, options.sleep, controller.signal));
  return { done, stop: () => controller.abort() };
}

async function execute(ir: YbcProgramIR, sleep: Sleep, signal: AbortSignal): Promise<RunOutcome> {
  try {
    signal.throwIfAborted();
    if (ir.forever) {
      for (;;) {
        signal.throwIfAborted();
        await sleep(foreverYieldMs, signal);
      }
    }
    return { status: 'finished' };
  } catch (error) {
    if (signal.aborted) {
      return { status: 'stopped' };
    }
    return { status: 'error', message: error instanceof Error ? error.message : 'Unexpected runtime error' };
  }
}
