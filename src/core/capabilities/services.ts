import { createExecutionBudget, timerYield, type ExecutionBudget } from '../program/execution-budget';
import type { RunConsole } from '../program/console';
import { timerSleep, type Sleep } from '../program/interpreter';

// The runtime services (YB plan §10, YB-CP deliverable 1): what RunSession provides to every YBC
// program, as opposed to hardware. The console, the budget and `Sleep` exist since YB-2 and are FROZEN
// here, not redone: this file gives them one name and adds the clock and the scheduler.

/** Milliseconds from an arbitrary origin; monotonic. The execution budget and timed peripherals read it. */
export type Clock = { now(): number };

/**
 * N18 R2.1 (type only; R2.3 builds it): the clock of a robot program, which runs on virtual time. Every Arduino call the
 * program makes is charged its cost in µs (the board profile's `costsUs`), so time moves as the board's would.
 */
export type ProgramClock = Clock & { charge(us: number): void };

/**
 * N17 B4: a whole number from `low` to `high`, both included (`low <= high`, both safe integers). The program's random numbers come
 * from here, so a run can be given a seeded one (a lab's check: the same numbers every time, so its goals are deterministic).
 */
export type RandomInt = (low: number, high: number) => number;

/**
 * N17 B5: a warning of a run that does not stop it (a value outside its range, clamped). It joins the run's diagnostics, once per
 * code and message, as the board's warnings do (RunEnvironment.warn, N17 B4).
 */
export type RunWarning = { code: string; message: string };

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
  /** N17 B4: the run's random numbers (`random.randint`): Math.random's, or a seeded run's own. */
  randomInt: RandomInt;
  /** N17 B5: tells the run something it should know and goes on (a value clamped). Inert once the run is over. */
  warn(warning: RunWarning): void;
};

const performanceClock: Clock = { now: () => performance.now() };

/** A whole number from `low` to `high` out of a fraction in [0, 1), every number equally likely. */
const between = (low: number, high: number, fraction: number) => low + Math.min(high - low, Math.floor(fraction * (high - low + 1)));

/** The random numbers of a normal run: Math.random's. */
export const mathRandomInt: RandomInt = (low, high) => between(low, high, Math.random());

/**
 * The random numbers of a seeded run (N17 B4: a lab's check): the same seed gives the same numbers, in the same order. Mulberry32,
 * a small 32-bit generator; fine for dice and games, not for anything that must be unpredictable.
 */
export function createSeededRandomInt(seed: number): RandomInt {
  let state = seed >>> 0;
  return (low, high) => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return between(low, high, ((t ^ (t >>> 14)) >>> 0) / 4294967296);
  };
}

/**
 * Builds the services of a run. The budget is the given one or the YB-2 one (`createExecutionBudget`), on the
 * run's signal and clock; nothing about its semantics is decided here. Everything but `signal` and `console` has a
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
  /** N17 B4: where the random numbers come from; Math.random by default. */
  randomInt?: RandomInt;
  /** N17 B5: where the run's warnings go; nowhere by default. */
  warn?(warning: RunWarning): void;
  /**
   * N18 R2.1: the run's execution budget, used as it is (a robot run's budget counts virtual time, R2.3). Absent: the YB-2 one
   * on `signal`, the clock and `yieldNow`.
   */
  budget?: ExecutionBudget;
}): RuntimeServices {
  const { signal, console } = options;
  const clock = options.clock ?? performanceClock;
  return {
    clock,
    console,
    budget: options.budget ?? createExecutionBudget({ signal, now: () => clock.now(), yieldNow: options.yieldNow ?? timerYield }),
    sleep: options.sleep ?? timerSleep,
    scheduler: options.scheduler ?? createRunScheduler(),
    signal,
    randomInt: options.randomInt ?? mathRandomInt,
    warn: options.warn ?? (() => {}),
  };
}

/** The timers a run scheduler uses: the browser's by default, a virtual clock's in the robot lab (N18 R2.3). */
export type Timers = {
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
