import { createExecutionBudget, timerYield, type ExecutionBudget } from '../program/execution-budget';
import type { RunConsole } from '../program/console';
import { timerSleep, type Sleep } from '../program/interpreter';

// The runtime services (YB plan §10, YB-CP deliverable 1): what RunSession provides to every YBC
// program, as opposed to hardware. The console, the budget and `Sleep` exist since YB-2 and are FROZEN
// here, not redone: this file gives them one name and adds the clock and the scheduler.

/** Milliseconds from an arbitrary origin; monotonic. The execution budget and timed peripherals read it. */
export type Clock = { now(): number };

/** Where `print` writes. The run console (500 lines / 256 KB, plan §6.7) is one; it is runtime state, never the document. */
export type ConsoleSink = Pick<RunConsole, 'write'>;

/**
 * Timers of ONE run (plan §10: "timing lives in the run of the construct, using sleep / scheduler").
 * A scrolling text, a note that ends, a debounce: whatever has to happen later goes through here, so
 * that Stop (or the replacement of the run) cancels it all at once and nothing fires into a dead run.
 */
export type RunScheduler = {
  /** Runs `task` once after `ms`. Returns a function that cancels it; a no-op after it ran. After `dispose`, nothing is scheduled. */
  schedule(task: () => void, ms: number): () => void;
  /** The run ended: cancel everything pending and refuse new tasks. Idempotent. */
  dispose(): void;
  readonly disposed: boolean;
};

/**
 * The services of ONE run (plan §10). RunSession creates them once per run and hands the same object to the
 * capability factory and to `runYbcProgram(ir, capabilities, services)`: there is no second shape.
 *
 * `signal` is the run's cancellation (Stop). The budget, `sleep` and the interpreter all use it, so the run has
 * one owner of cancellation; the plan's five services need it, since `Sleep` takes a signal and the budget
 * throws when it aborts.
 */
export type RuntimeServices = {
  clock: Clock;
  console: ConsoleSink;
  /** The cooperative execution budget of the run (plan §6.7): fresh for every run, never shared between runs. */
  budget: ExecutionBudget;
  sleep: Sleep;
  scheduler: RunScheduler;
  signal: AbortSignal;
};

const performanceClock: Clock = { now: () => performance.now() };

/**
 * Builds the services of a run. The budget is the YB-2 one (`createExecutionBudget`), on the run's signal
 * and clock; nothing about its semantics is decided here. Everything but `signal` and `console` has a
 * default: the real timers, the browser clock, a scheduler of its own.
 */
export function createRuntimeServices(options: {
  signal: AbortSignal;
  console: ConsoleSink;
  sleep?: Sleep;
  clock?: Clock;
  /** How the budget hands control back to the browser. Defaults to a zero-delay timer. */
  yieldNow?: () => Promise<void>;
  scheduler?: RunScheduler;
}): RuntimeServices {
  const { signal, console } = options;
  const clock = options.clock ?? performanceClock;
  return {
    clock,
    console,
    budget: createExecutionBudget({ signal, now: () => clock.now(), yieldNow: options.yieldNow ?? timerYield }),
    sleep: options.sleep ?? timerSleep,
    scheduler: options.scheduler ?? createRunScheduler(),
    signal,
  };
}

type Timers = {
  setTimeout(task: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
};

const browserTimers: Timers = {
  setTimeout: (task, ms) => setTimeout(task, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export function createRunScheduler(timers: Timers = browserTimers): RunScheduler {
  const pending = new Set<unknown>();
  let disposed = false;
  return {
    schedule(task, ms) {
      if (disposed) {
        return () => {};
      }
      const handle = timers.setTimeout(() => {
        pending.delete(handle);
        task();
      }, ms);
      pending.add(handle);
      return () => {
        if (pending.delete(handle)) {
          timers.clearTimeout(handle);
        }
      };
    },
    dispose() {
      disposed = true;
      for (const handle of pending) {
        timers.clearTimeout(handle);
      }
      pending.clear();
    },
    get disposed() {
      return disposed;
    },
  };
}
