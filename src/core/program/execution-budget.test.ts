import { describe, expect, it } from 'vitest';
import { createExecutionBudget } from './execution-budget';
import { EXEC_SLICE_MS, STEP_CHECK_INTERVAL } from './limits';

// The cooperative budget (plan section 6.7): what counts as a step, when the clock is read, when control is handed back.

function setup() {
  const controller = new AbortController();
  let clock = 0;
  let clockReads = 0;
  let yields = 0;
  const budget = createExecutionBudget({
    signal: controller.signal,
    now: () => {
      clockReads++;
      return clock;
    },
    yieldNow: () => {
      yields++;
      return Promise.resolve();
    },
  });
  return {
    budget,
    controller,
    advance: (ms: number) => (clock += ms),
    stats: () => ({ clockReads, yields }),
  };
}

describe('execution budget', () => {
  it('uses the frozen values: an 8 ms slice, a look at the clock every 256 steps', () => {
    expect(EXEC_SLICE_MS).toBe(8);
    expect(STEP_CHECK_INTERVAL).toBe(256);
  });

  it('reads the clock only once per 256 steps, not on every step', () => {
    const { budget, stats } = setup();
    const readsAtStart = stats().clockReads;
    for (let i = 0; i < STEP_CHECK_INTERVAL * 4; i++) {
      budget.step();
    }
    expect(stats().clockReads - readsAtStart).toBe(4);
  });

  it('does not yield while the slice is not over, however many steps pass', () => {
    const { budget, advance, stats } = setup();
    for (let i = 0; i < STEP_CHECK_INTERVAL * 10; i++) {
      advance(0.003); // 2560 steps take 7.68 ms in all: the slice is never over
      expect(budget.step()).toBeUndefined();
    }
    expect(stats().yields).toBe(0);
  });

  it('yields at the first check after the slice is over, and not before it', () => {
    const { budget, advance, stats } = setup();
    advance(EXEC_SLICE_MS);
    for (let i = 0; i < STEP_CHECK_INTERVAL - 1; i++) {
      expect(budget.step()).toBeUndefined(); // the clock is not looked at between checks
    }
    expect(budget.step()).toBeInstanceOf(Promise);
    expect(stats().yields).toBe(1);
  });

  it('starts a new slice after a yield, so the next yield is a slice later', async () => {
    const { budget, advance, stats } = setup();
    advance(EXEC_SLICE_MS);
    for (let i = 0; i < STEP_CHECK_INTERVAL; i++) {
      await budget.step();
    }
    expect(stats().yields).toBe(1);
    for (let i = 0; i < STEP_CHECK_INTERVAL; i++) {
      expect(await budget.step()).toBeUndefined();
    }
    expect(stats().yields).toBe(1);
    advance(EXEC_SLICE_MS);
    for (let i = 0; i < STEP_CHECK_INTERVAL; i++) {
      await budget.step();
    }
    expect(stats().yields).toBe(2);
  });

  it('starts a new slice when the program has paused of its own accord', () => {
    const { budget, advance, stats } = setup();
    advance(1_000); // a long wait
    budget.startSlice();
    for (let i = 0; i < STEP_CHECK_INTERVAL * 2; i++) {
      budget.step();
    }
    expect(stats().yields).toBe(0);
  });

  it('counts expression nodes towards the interval: 255 nodes and one step make the check', () => {
    const { budget, advance, stats } = setup();
    advance(EXEC_SLICE_MS);
    const readsBefore = stats().clockReads;
    for (let i = 0; i < STEP_CHECK_INTERVAL - 1; i++) {
      budget.work();
    }
    expect(stats().clockReads).toBe(readsBefore); // work() never reads the clock
    expect(budget.step()).toBeInstanceOf(Promise);
    expect(stats().clockReads).toBe(readsBefore + 1);
    expect(stats().yields).toBe(1);
  });

  it('does not check the clock for a step that follows too little work', () => {
    const { budget, advance, stats } = setup();
    advance(EXEC_SLICE_MS);
    const readsBefore = stats().clockReads;
    for (let i = 0; i < 100; i++) {
      budget.work();
    }
    expect(budget.step()).toBeUndefined();
    expect(stats().clockReads).toBe(readsBefore);
  });

  it('sees Stop on the very next step, not only at a check', () => {
    const { budget, controller } = setup();
    budget.step();
    controller.abort();
    expect(() => budget.step()).toThrow();
  });

  it('sees Stop after the yield, before the program goes on', async () => {
    const controller = new AbortController();
    let clock = 0;
    const budget = createExecutionBudget({
      signal: controller.signal,
      now: () => clock,
      yieldNow: async () => {
        controller.abort(); // Stop pressed while the browser had control
      },
    });
    clock = EXEC_SLICE_MS;
    let pending: Promise<void> | undefined;
    for (let i = 0; i < STEP_CHECK_INTERVAL; i++) {
      pending = budget.step();
    }
    await expect(pending).rejects.toBeDefined();
  });
});
