import { EXEC_SLICE_MS, STEP_CHECK_INTERVAL } from './limits';

// The cooperative execution budget of the YBC interpreter (YB plan §6.7). The
// interpreter is one async function on the browser's main thread, so a learner
// loop must hand control back now and then, or the page (and Stop) would freeze.
//
//   work()   called for every expression node evaluated (plan section 6.7: statement,
//            loop iteration and expression node are all steps). Only counts: an
//            expression is synchronous, so there is nothing to wait at.
//   step()   called once per statement and once per loop iteration, the places where
//            the interpreter can wait.
//            - always: throws if Stop was pressed (so Stop is seen within a step);
//            - once STEP_CHECK_INTERVAL steps (of any kind) have been counted since the
//              last look: reads the clock; when the slice is over (EXEC_SLICE_MS) it
//              returns a promise that resolves after the browser ran its own tasks.
//
// So the work of a big expression is on the account before the next safe place to
// yield: a loop around a 2 000-node expression looks at the clock at every iteration,
// not after 256 of them.
//
// A budget yield is housekeeping, not program semantics: it changes no variable,
// prints nothing and does not move the loop. The 10 ms pause of `forever` and
// `wait` are the program's own, and go through the interpreter's `sleep`.
//
// N18 R2.3: a robot run's budget is the virtual one of run/virtual-clock.ts, on the
// same interface: it charges the program clock for the work and parks the program
// when it is a tick ahead of the world. `loopIteration()` tells it a forever iteration
// (Arduino's loop()) begins; this budget has nothing to do there.

export type ExecutionBudget = {
  /** One expression node was evaluated. Synchronous and cheap: no clock, no await. */
  work(): void;
  /** undefined: carry on. A promise: await it before the next step. Throws when aborted. */
  step(): Promise<void> | undefined;
  /** A pause of the program's own just ended; the slice starts again. */
  startSlice(): void;
  /**
   * N18 R2.3: an iteration of `forever` begins (Arduino's loop()), just before its step. Synchronous. This budget does nothing (a
   * Yolo:Bit iteration ends with the program's own 10 ms sleep); the virtual one charges LOOP_MIN_US.
   */
  loopIteration(): void;
};

export function createExecutionBudget(options: {
  signal: AbortSignal;
  now(): number;
  yieldNow(): Promise<void>;
}): ExecutionBudget {
  const { signal, now, yieldNow } = options;
  let steps = 0;
  let sliceStart = now();
  return {
    work() {
      steps++;
    },
    step() {
      signal.throwIfAborted();
      steps++;
      if (steps < STEP_CHECK_INTERVAL) {
        return undefined;
      }
      steps = 0;
      if (now() - sliceStart < EXEC_SLICE_MS) {
        return undefined;
      }
      return yieldNow().then(() => {
        signal.throwIfAborted();
        sliceStart = now();
      });
    },
    startSlice() {
      steps = 0;
      sliceStart = now();
    },
    loopIteration() {},
  };
}

/** Lets the browser run its other tasks (events, rendering, Stop), then continues. */
export const timerYield = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
