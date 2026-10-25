import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRunScheduler } from '../capabilities/services';
import { unoContract } from '../compat/uno-contract';
import { createVirtualScheduler, LOOP_MIN_US, NODE_US, WORLD_TICK_MS } from './virtual-clock';

// N18 R2.3: the virtual clock of a robot run (robot plan §3). Two clocks, world.t and programClock; the scheduler resolves the
// program's waits and the run's timers one at a time in (deadline, seq) order, and parks a program that is a tick ahead.
// Here the scheduler alone, driven by hand; virtual-clock.program.test.ts runs the interpreter on it.

const dt = WORLD_TICK_MS;
/** The world time of tick `k`. */
const at = (k: number) => (k * 1000) / 120;
/** Resolves after the event loop has had a turn, so whatever could settle has settled. */
const turn = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
/** Whether `promise` has settled by the time the event loop had a turn. */
async function settled(promise: Promise<unknown>): Promise<boolean> {
  let done = false;
  promise.then(
    () => void (done = true),
    () => void (done = true),
  );
  await turn();
  return done;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the constants (contract UNO §4.2, robot plan §3)', () => {
  it('charges 1 µs per node and 50 µs per loop() iteration, and ticks at 120 Hz', () => {
    expect([NODE_US, LOOP_MIN_US]).toEqual([unoContract.constants.NODE_US, unoContract.constants.LOOP_MIN_US]);
    expect([NODE_US, LOOP_MIN_US, WORLD_TICK_MS]).toEqual([1, 50, 1000 / 120]);
  });
});

describe('the program clock', () => {
  it('starts at 0 ms and moves by the µs it is charged, and by nothing else while the program runs', () => {
    const { programClock } = createVirtualScheduler();
    expect(programClock.now()).toBe(0);
    programClock.charge(1500);
    programClock.charge(0.25);
    expect(programClock.now()).toBe(1.50025);
    programClock.charge(0);
    expect(programClock.now()).toBe(1.50025);
  });

  it('refuses a charge that is negative or not a finite number: time never goes back', () => {
    const { programClock } = createVirtualScheduler();
    for (const us of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => programClock.charge(us)).toThrow(RangeError);
    }
    expect(programClock.now()).toBe(0);
  });
});

describe('advanceTo: timers one at a time in (deadline, seq) order', () => {
  it('resolves a sleep in the tick whose interval [world.t, world.t + dt) holds its deadline, with the clock set to the deadline', async () => {
    const scheduler = createVirtualScheduler();
    const signal = new AbortController().signal;
    const woke = scheduler.sleep(10, signal);
    await scheduler.advanceTo(at(0));
    expect(await settled(woke)).toBe(false);
    expect(scheduler.programClock.now()).toBe(0);
    await scheduler.advanceTo(at(1));
    expect(await settled(woke)).toBe(true);
    // No lateness: the clock is the deadline, not the tick (16.67 ms) the world is in.
    expect(scheduler.programClock.now()).toBe(10);
  });

  it('runs the timers of a tick in deadline order, the earlier-scheduled first on a tie, each with the clock at its deadline', async () => {
    const scheduler = createVirtualScheduler();
    const order: [string, number][] = [];
    const task = (label: string) => () => void order.push([label, scheduler.programClock.now()]);
    scheduler.timers.setTimeout(task('5a'), 5);
    scheduler.timers.setTimeout(task('3'), 3);
    scheduler.timers.setTimeout(task('5b'), 5);
    scheduler.timers.setTimeout(task('9'), 9);
    scheduler.timers.setTimeout(() => {
      task('1')();
      // Scheduled while the tick runs, and due in it: it runs in this tick, in its place.
      scheduler.timers.setTimeout(task('1+3'), 3);
    }, 1);
    await scheduler.advanceTo(at(0));
    expect(order).toEqual([['1', 1], ['3', 3], ['1+3', 4], ['5a', 5], ['5b', 5]]);
    await scheduler.advanceTo(at(1));
    expect(order.slice(5)).toEqual([['9', 9]]);
  });

  it('cancels a timer with clearTimeout, and a cancel of one that ran is a no-op', async () => {
    const scheduler = createVirtualScheduler();
    const ran: string[] = [];
    const first = scheduler.timers.setTimeout(() => void ran.push('first'), 1);
    const second = scheduler.timers.setTimeout(() => void ran.push('second'), 2);
    scheduler.timers.clearTimeout(second);
    await scheduler.advanceTo(at(0));
    scheduler.timers.clearTimeout(first);
    scheduler.timers.clearTimeout({});
    expect(ran).toEqual(['first']);
  });

  it('drives a run scheduler: a task of the run fires when the world reaches it, and dispose cancels the rest', async () => {
    const scheduler = createVirtualScheduler();
    const runScheduler = createRunScheduler(scheduler.timers);
    const ran: number[] = [];
    runScheduler.schedule(() => void ran.push(scheduler.programClock.now()), 12);
    runScheduler.schedule(() => void ran.push(-1), 30);
    await scheduler.advanceTo(at(0));
    await scheduler.advanceTo(at(1));
    runScheduler.dispose();
    await scheduler.advanceTo(at(10));
    expect(ran).toEqual([12]);
  });

  it('never goes back in time, and runs one tick at a time', async () => {
    const scheduler = createVirtualScheduler();
    await scheduler.advanceTo(10);
    await expect(scheduler.advanceTo(5)).rejects.toThrow(RangeError);
    await expect(scheduler.advanceTo(Number.NaN)).rejects.toThrow(RangeError);
    const first = scheduler.advanceTo(20);
    await expect(scheduler.advanceTo(30)).rejects.toThrow('one tick at a time');
    await first;
    expect(scheduler.programClock.now()).toBe(0);
  });
});

describe('blocked: a sleep, a park, or the end of the program', () => {
  it('is not blocked during a housekeeping yield, only once the program waits in a sleep', async () => {
    const scheduler = createVirtualScheduler();
    const signal = new AbortController().signal;
    const marks: string[] = [];
    void (async () => {
      await scheduler.yieldNow();
      marks.push('yielded');
      await scheduler.yieldNow();
      marks.push('yielded again');
      await scheduler.sleep(5, signal);
    })();
    await scheduler.whenBlocked();
    marks.push('blocked');
    expect(marks).toEqual(['yielded', 'yielded again', 'blocked']);
  });

  it('is blocked in a park, and when the program has ended', async () => {
    const parked = createVirtualScheduler();
    parked.programClock.charge(9000);
    void parked.park();
    expect(await settled(parked.whenBlocked())).toBe(true);
    const ended = createVirtualScheduler();
    void (async () => {
      await ended.yieldNow();
    })();
    await ended.whenBlocked();
    expect(await settled(ended.whenBlocked())).toBe(true);
  });

  it('resumes a parked program in the first tick whose interval holds its clock, and leaves its clock where it was', async () => {
    const scheduler = createVirtualScheduler();
    scheduler.programClock.charge(20_000);
    const parked = scheduler.park();
    await scheduler.advanceTo(at(0));
    await scheduler.advanceTo(at(1));
    expect(await settled(parked)).toBe(false);
    await scheduler.advanceTo(at(2));
    expect(await settled(parked)).toBe(true);
    expect(scheduler.programClock.now()).toBe(20);
  });
});

describe('the virtual budget', () => {
  it('charges NODE_US per node and per step and LOOP_MIN_US per loop() iteration, put on the clock at the next step', () => {
    const scheduler = createVirtualScheduler();
    const budget = scheduler.budget(new AbortController().signal);
    budget.work();
    budget.work();
    budget.work();
    expect(scheduler.programClock.now()).toBe(0);
    expect(budget.step()).toBeUndefined();
    expect(scheduler.programClock.now()).toBe(0.004);
    budget.loopIteration();
    budget.startSlice();
    expect(budget.step()).toBeUndefined();
    expect(scheduler.programClock.now()).toBe(0.055);
  });

  it('parks the program at the first step at or past world.t + dt, and not one step before', async () => {
    const scheduler = createVirtualScheduler();
    const budget = scheduler.budget(new AbortController().signal);
    scheduler.programClock.charge(8331);
    expect(budget.step()).toBeUndefined();
    expect(scheduler.programClock.now()).toBe(8.332);
    expect(budget.step()).toBeUndefined();
    const parked = budget.step();
    expect(parked).toBeInstanceOf(Promise);
    expect(scheduler.programClock.now()).toBe(8.334);
    expect(scheduler.programClock.now()).toBeGreaterThanOrEqual(dt);
    await scheduler.advanceTo(at(1));
    expect(await settled(parked as Promise<void>)).toBe(true);
  });

  it('checks the clock on every step, not every 256: a program never runs a statement past world.t + dt', () => {
    const scheduler = createVirtualScheduler({ wallNow: () => 0 });
    const budget = scheduler.budget(new AbortController().signal);
    let steps = 0;
    while (budget.step() === undefined) {
      steps++;
    }
    expect(steps).toBe(8333);
    expect(scheduler.programClock.now()).toBe(8.334);
  });

  it('gives the browser a turn through a MessageChannel after 8 ms of wall time in a tick, never setTimeout, and that turn is not blocked', async () => {
    let wall = 0;
    const scheduler = createVirtualScheduler({ nodeUs: 0, wallNow: () => wall });
    const budget = scheduler.budget(new AbortController().signal);
    const timeout = vi.spyOn(globalThis, 'setTimeout');
    // Someone waits for the program to block (a tick) before the program takes its turn.
    let isBlocked = false;
    const blocked = scheduler.whenBlocked().then(() => void (isBlocked = true));
    wall = 7.9;
    for (let i = 0; i < 1000; i++) {
      expect(budget.step()).toBeUndefined();
    }
    wall = 8;
    let breather: Promise<void> | undefined;
    for (let i = 0; i < 256 && breather === undefined; i++) {
      breather = budget.step();
    }
    expect(breather).toBeInstanceOf(Promise);
    await breather;
    expect(timeout).not.toHaveBeenCalled();
    // The browser had its turn while the tick waited; the program is back and still running, so the tick still waits for it.
    expect(isBlocked).toBe(false);
    expect(scheduler.programClock.now()).toBe(0);
    // A new slice starts after the turn.
    for (let i = 0; i < 512; i++) {
      expect(budget.step()).toBeUndefined();
    }
    void scheduler.sleep(1, new AbortController().signal);
    await blocked;
    expect(isBlocked).toBe(true);
  });
});

describe('Stop: sleep and park reject when the run aborts', () => {
  it('rejects a sleep at once with the reason of the abort, before it waits or while it does, and drops its deadline', async () => {
    const scheduler = createVirtualScheduler();
    const already = new AbortController();
    already.abort(new Error('stopped before'));
    await expect(scheduler.sleep(5, already.signal)).rejects.toThrow('stopped before');
    const controller = new AbortController();
    const waiting = scheduler.sleep(5, controller.signal);
    controller.abort(new Error('stopped while waiting'));
    await expect(waiting).rejects.toThrow('stopped while waiting');
    await scheduler.advanceTo(at(1));
    // Nothing was due at 5 ms any more: the clock did not move to it.
    expect(scheduler.programClock.now()).toBe(0);
  });

  it('rejects a park at once when the signal of the run aborts, and drops it', async () => {
    const scheduler = createVirtualScheduler();
    const controller = new AbortController();
    const budget = scheduler.budget(controller.signal);
    scheduler.programClock.charge(30_000);
    const parked = budget.step();
    expect(parked).toBeInstanceOf(Promise);
    const viaPark = scheduler.park();
    controller.abort(new Error('stopped while parked'));
    await expect(parked).rejects.toThrow('stopped while parked');
    await expect(viaPark).rejects.toThrow('stopped while parked');
    await scheduler.advanceTo(at(10));
    expect(scheduler.programClock.now()).toBe(30.001);
    expect(() => budget.step()).toThrow('stopped while parked');
  });
});
