import type { ProgramClock, Timers } from '../capabilities/services';
import type { ExecutionBudget } from '../program/execution-budget';
import type { Sleep } from '../program/interpreter';
import { EXEC_SLICE_MS, STEP_CHECK_INTERVAL } from '../program/limits';

// The virtual clock of a robot run (N18 R2.3, robot plan §3, D-R2). A robot program never reads the wall clock: it runs on two
// virtual clocks, `world.t` (the physics, which the run session steps by dt) and `programClock` (the program's own time), with
//
//     world.t ≤ programClock < world.t + dt          whenever the program runs a statement.
//
// - `programClock` moves only by what is charged to it: every IR node (NODE_US), every iteration of loop() (LOOP_MIN_US), and every
//   Arduino call the hardware makes (`charge(costsUs[call])`, R1). Node costs are put on the clock at the program's next step, sleep
//   or park, so a read (a pulseIn) always happens at a time inside the tick; an Arduino call's charge is on the clock at once.
// - `advanceTo(t)` is one tick: the world is at t. It waits until the program is blocked, then resolves what is due in the tick's
//   interval [t, t + dt) (the program's sleep, the run's timers, a park whose clock the world has reached), ONE AT A TIME in
//   (deadline, seq) order: the clock is set to the deadline (no lateness: `repeat 100 { wait 10 }` takes 1000 ms of virtual time
//   plus its own node costs, whatever the ticks), then it waits until the program is blocked again.
// - The budget looks at the clock on every step. A program whose clock has reached world.t + dt PARKS (a waiter whose deadline is
//   its clock) until a tick whose interval holds it: a loop without `wait` never runs ahead of the world by a dt, and never
//   freezes the page.
// - Blocked is one of three: the program waits in a sleep, waits in a park, or has ended. A housekeeping yield to the browser
//   (a MessageChannel turn, after EXEC_SLICE_MS of wall time in one tick) is never blocked: the tick waits for the program to come
//   back. It changes no clock, so the result of a run never depends on the machine, the frame rate or a hidden tab.
// - `sleep` and `park` reject with the reason of the run's abort (Stop) at once, and leave nothing behind in the queue.
//
// One scheduler serves one run: `sleep` and `park` are the program's own, and `budget(signal)` binds the run's signal. The run
// session builds the services from it: `createRuntimeServices({ clock: programClock, sleep, yieldNow, budget: budget(signal),
// scheduler: createRunScheduler(timers), … })`, starts the program, then calls `advanceTo(world.t)` once per tick, never two at once.

/** Contract UNO §4.2: what one IR node (a statement, an expression, a loop iteration) costs the program. */
export const NODE_US = 1;

/** Contract UNO §4.2, a policy of the simulator: what every iteration of loop() costs at least (the board runs it ~160× faster). */
export const LOOP_MIN_US = 50;

/** The world's step, dt (robot plan §3: 120 Hz). */
export const WORLD_TICK_MS = 1000 / 120;

export type VirtualScheduler = {
  /** The program's time, in ms from the start of the run. `charge(us)` moves it (an Arduino call's cost); time never goes back. */
  programClock: ProgramClock;
  /** The program's own wait: resolves in the tick whose interval holds `now + ms`, the clock set to that. Rejects on abort. */
  sleep: Sleep;
  /** Holds the program until a tick whose interval holds its clock (programClock < world.t + dt). Rejects when the run aborts. */
  park(): Promise<void>;
  /** A turn of the browser's event loop through a MessageChannel (never setTimeout(0)): housekeeping, never blocked. */
  yieldNow(): Promise<void>;
  /** The run's timers on virtual time (`createRunScheduler(timers)`): a task runs in the tick that holds its deadline. */
  timers: Timers;
  /** The run's execution budget on virtual time, for the run's `signal`. */
  budget(signal: AbortSignal): ExecutionBudget;
  /** One tick, the world at `tWorldMs`: runs the program and what is due before `tWorldMs + dt`, one at a time, until blocked. */
  advanceTo(tWorldMs: number): Promise<void>;
  /** Resolves once the program is blocked: in a sleep, in a park, or ended. */
  whenBlocked(): Promise<void>;
};

export type VirtualSchedulerOptions = {
  /** dt of the world, in ms; WORLD_TICK_MS by default. */
  tickMs?: number;
  /** What one IR node costs, in µs; NODE_US by default (0 isolates the timers in a test). */
  nodeUs?: number;
  /** The wall clock the housekeeping yield looks at, in ms; `performance.now` by default. It never reaches program time. */
  wallNow?: () => number;
};

/** Something due at `deadlineUs`: the program's sleep or park, or a timer of the run. `seq` orders a tie by when it was set. */
type Due = { deadlineUs: number; seq: number; fire(): void };

export function createVirtualScheduler(options: VirtualSchedulerOptions = {}): VirtualScheduler {
  const tickMs = options.tickMs ?? WORLD_TICK_MS;
  const nodeUs = options.nodeUs ?? NODE_US;
  const wallNow = options.wallNow ?? (() => performance.now());
  if (!(tickMs > 0) || !Number.isFinite(tickMs) || !(nodeUs >= 0) || !Number.isFinite(nodeUs)) {
    throw new RangeError('A virtual scheduler needs a positive tick and a node cost of 0 or more.');
  }

  /** The program's clock in µs: charges of multiples of 1/32 µs (the costs table) add up exactly in a double. */
  let programUs = 0;
  /** Node costs of the statement under way, put on the clock at the next step, sleep or park. */
  let unsettledUs = 0;
  let worldMs = 0;
  /** world.t + dt, in µs: what is due before it runs in this tick; a program at or past it parks. */
  let horizonUs = tickMs * 1000;
  let seq = 0;
  /** In (deadline, seq) order. */
  const queue: Due[] = [];
  /** running: computing, or in a housekeeping yield. waiting: in a sleep or a park. idle: ended (or not started). */
  let program: 'running' | 'waiting' | 'idle' = 'running';
  let housekeeping = 0;
  let blockedListeners: (() => void)[] = [];
  let probing = false;
  let advancing = false;
  let runSignal: AbortSignal | undefined;
  let sliceStart = wallNow();

  const settle = () => {
    programUs += unsettledUs;
    unsettledUs = 0;
  };

  const enqueue = (deadlineUs: number, fire: () => void): Due => {
    const due: Due = { deadlineUs, seq: seq++, fire };
    // After every entry due at the same time or before (they have a smaller seq); the queue is short.
    let index = queue.length;
    while (index > 0 && (queue[index - 1]?.deadlineUs ?? 0) > deadlineUs) {
      index--;
    }
    queue.splice(index, 0, due);
    return due;
  };

  const dequeue = (due: unknown) => {
    const index = queue.indexOf(due as Due);
    if (index >= 0) {
      queue.splice(index, 1);
    }
  };

  const notifyBlocked = () => {
    const listeners = blockedListeners;
    blockedListeners = [];
    for (const listener of listeners) {
      listener();
    }
  };

  /**
   * Whether the program has ended can only be seen from outside: it then waits for nothing. A macrotask runs once every microtask
   * has, so a program that is not waiting and not in a housekeeping yield by then has nothing left to run.
   */
  const probe = () => {
    if (probing) {
      return;
    }
    probing = true;
    macrotask(() => {
      probing = false;
      if (program !== 'running' || blockedListeners.length === 0) {
        return;
      }
      if (housekeeping > 0) {
        probe();
        return;
      }
      program = 'idle';
      notifyBlocked();
    });
  };

  const whenBlocked = (): Promise<void> =>
    program !== 'running'
      ? Promise.resolve()
      : new Promise((resolve) => {
          blockedListeners.push(resolve);
          probe();
        });

  /** The program waits until `deadlineUs`. Rejects with the abort's reason, at once, and drops the deadline. */
  const waitUntil = (deadlineUs: number, signal: AbortSignal | undefined): Promise<void> =>
    new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(signal.reason);
        return;
      }
      const onAbort = () => {
        dequeue(due);
        // The program unwinds now; it is blocked again once it has ended.
        program = 'running';
        reject(signal?.reason);
      };
      const due = enqueue(deadlineUs, () => {
        signal?.removeEventListener('abort', onAbort);
        program = 'running';
        resolve();
      });
      signal?.addEventListener('abort', onAbort, { once: true });
      program = 'waiting';
      notifyBlocked();
    });

  const park = (signal: AbortSignal | undefined) => {
    settle();
    return waitUntil(programUs, signal);
  };

  const yieldNow = (): Promise<void> => {
    housekeeping++;
    return new Promise((resolve) =>
      macrotask(() => {
        housekeeping--;
        resolve();
      }),
    );
  };

  /** A wait of `ms` from now, in µs: a negative or NaN one is 0, as for setTimeout. */
  const waitUs = (ms: number) => (ms > 0 ? ms * 1000 : 0);

  return {
    programClock: {
      now: () => programUs / 1000,
      charge(us) {
        if (!(us >= 0) || !Number.isFinite(us)) {
          throw new RangeError(`A charge is a finite number of µs, 0 or more, not ${us}.`);
        }
        programUs += us;
      },
    },
    sleep(ms, signal) {
      settle();
      return waitUntil(programUs + waitUs(ms), signal);
    },
    park: () => park(runSignal),
    yieldNow,
    timers: {
      setTimeout: (task, ms) => enqueue(programUs + waitUs(ms), task),
      clearTimeout: dequeue,
    },
    budget(signal) {
      runSignal = signal;
      let steps = 0;
      return {
        work() {
          unsettledUs += nodeUs;
        },
        step() {
          signal.throwIfAborted();
          program = 'running';
          unsettledUs += nodeUs;
          settle();
          if (programUs >= horizonUs) {
            return park(signal);
          }
          if (++steps < STEP_CHECK_INTERVAL) {
            return undefined;
          }
          steps = 0;
          if (wallNow() - sliceStart < EXEC_SLICE_MS) {
            return undefined;
          }
          return yieldNow().then(() => {
            signal.throwIfAborted();
            sliceStart = wallNow();
          });
        },
        // A virtual pause does not give the browser a turn: the wall slice goes on until a housekeeping yield or the next tick.
        startSlice() {},
        loopIteration() {
          unsettledUs += LOOP_MIN_US;
        },
      };
    },
    async advanceTo(tWorldMs) {
      if (advancing) {
        throw new Error('advanceTo is already running: one tick at a time.');
      }
      if (!Number.isFinite(tWorldMs) || tWorldMs < worldMs) {
        throw new RangeError(`The world only goes forward: ${tWorldMs} ms is not at or after ${worldMs} ms.`);
      }
      advancing = true;
      try {
        worldMs = tWorldMs;
        horizonUs = (tWorldMs + tickMs) * 1000;
        sliceStart = wallNow();
        await whenBlocked();
        for (let due = queue[0]; due !== undefined && due.deadlineUs < horizonUs; due = queue[0]) {
          queue.shift();
          // A task due while the program was ahead runs at the program's time: the clock never goes back.
          programUs = Math.max(programUs, due.deadlineUs);
          due.fire();
          await whenBlocked();
        }
      } finally {
        advancing = false;
      }
    },
    whenBlocked,
  };
}

/**
 * Runs `task` on a later turn of the event loop through a MessageChannel: setTimeout(0) is clamped to 4 ms and throttled in a
 * hidden tab. A channel of its own every time, closed once it has delivered: Node drains a port's queue with the messages posted
 * meanwhile, so one shared port posting from its own turns starves timers and I/O (spikes/message-channel, Node 24.22.1: a 1 ms
 * interval ran once in 300 ms of 8 ms slices with a shared port, 36–37 times with a fresh one; a fresh one costs about 6 µs).
 * Nothing relies on the order of two turns.
 */
function macrotask(task: () => void): void {
  if (typeof MessageChannel === 'undefined') {
    setTimeout(task, 0);
    return;
  }
  const { port1, port2 } = new MessageChannel();
  port1.onmessage = () => {
    port1.close();
    task();
  };
  port2.postMessage(null);
}
