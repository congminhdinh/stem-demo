import { describe, expect, it } from 'vitest';
import { createExecutionBudget } from '../program/execution-budget';
import { createVirtualScheduler, WORLD_TICK_MS } from './virtual-clock';

// N18 R2.2: the virtual budget's `atHardware` (program/execution-budget.ts): before a module op of a uno program the program waits
// for the world when its clock has reached world.t + dt, so every op happens inside the tick of its time. It costs nothing itself.

const dt = WORLD_TICK_MS;
/** Resolves after the event loop has had a turn, so whatever could settle has settled. */
const turn = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('atHardware of the virtual budget', () => {
  it('lets a program inside its tick go on at once, and charges nothing', () => {
    const controller = new AbortController();
    const scheduler = createVirtualScheduler({ signal: controller.signal });
    const budget = scheduler.budget(controller.signal);
    scheduler.programClock.charge(1000);
    expect(budget.atHardware?.()).toBeUndefined();
    expect(scheduler.programClock.now()).toBe(1);
  });

  it('parks a program whose clock has reached world.t + dt until the tick that holds its clock', async () => {
    const controller = new AbortController();
    const scheduler = createVirtualScheduler({ signal: controller.signal });
    const budget = scheduler.budget(controller.signal);
    // A read without an echo: 20.8 ms, past the first tick (8.33 ms) and the second.
    scheduler.programClock.charge(20_777.6875);
    const parked = budget.atHardware?.();
    expect(parked).toBeInstanceOf(Promise);
    let resumed = false;
    void parked?.then(() => void (resumed = true));
    await scheduler.advanceTo(dt);
    await turn();
    expect(resumed).toBe(false);
    await scheduler.advanceTo(2 * dt);
    await turn();
    // 20.78 ms is in [16.67, 25) ms: the third tick.
    expect(resumed).toBe(true);
    expect(scheduler.programClock.now()).toBeCloseTo(20.7776875, 9);
  });

  it('throws when the run was stopped, and a parked program ends with the abort', async () => {
    const controller = new AbortController();
    const scheduler = createVirtualScheduler({ signal: controller.signal });
    const budget = scheduler.budget(controller.signal);
    scheduler.programClock.charge(10_000);
    const parked = budget.atHardware?.();
    controller.abort(new Error('Stop'));
    await expect(parked).rejects.toThrow('Stop');
    expect(() => budget.atHardware?.()).toThrow('Stop');
  });

  it('is not part of the budget of a Yolo:Bit run, whose programs have no module op', () => {
    const budget = createExecutionBudget({ signal: new AbortController().signal, now: () => 0, yieldNow: () => Promise.resolve() });
    expect(budget.atHardware).toBeUndefined();
  });
});
