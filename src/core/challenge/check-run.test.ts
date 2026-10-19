import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNewProject } from '../circuit/document';
import type { RunSnapshot, StartResult } from '../run/run-session';
import type { ComponentInput } from '../simulation/simulate-circuit';
import type { Challenge } from './challenge';
import { CHECK_LATE_LIMIT_MS, CHECK_RANDOM_SEED, runCheck, type CheckSession, type CheckTimers } from './check-run';

// The check against a fake session (N6a S2): when it starts and stops the run, when it gives inputs, and how it
// ends. Real runs of real templates are in src/samples/challenges.test.ts.

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const running = (lit: boolean): RunSnapshot => ({
  status: 'running',
  diagnostics: [],
  error: null,
  simulation: { nets: [], components: { led: { lit } }, pinReads: {} },
});
const idle: RunSnapshot = { status: 'idle', diagnostics: [], error: null, simulation: null };

function fakeSession(startResult: StartResult = { ok: true }) {
  const listeners = new Set<(snapshot: RunSnapshot) => void>();
  let current: RunSnapshot = idle;
  const calls: string[] = [];
  const inputs: [number, string, ComponentInput][] = [];
  const options: unknown[] = [];
  const publish = (next: RunSnapshot) => {
    current = next;
    [...listeners].forEach((listener) => listener(next));
  };
  const session: CheckSession = {
    start(_project, given) {
      calls.push('start');
      options.push(given);
      if (!startResult.ok) {
        publish(idle);
        return startResult;
      }
      publish(running(false));
      return startResult;
    },
    stop() {
      calls.push('stop');
      publish(idle);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => current,
    setComponentInput(componentId, input) {
      inputs.push([Date.now(), componentId, input]);
    },
  };
  return { session, publish, calls, inputs, listeners, options };
}

const document = createNewProject('p');
const challenge: Challenge = {
  goals: [{ id: 'lit', label: 'Lit', kind: 'led-lit', componentId: 'led' }],
  durationMs: 1000,
  inputScript: [
    { atMs: 300, part: 'button-a', input: { kind: 'hold', closed: true } },
    { atMs: 100, componentId: 'button', input: { kind: 'hold', closed: true } },
  ],
};

describe('runCheck (N6a S2)', () => {
  it('starts its run with the seed of a check, so its random numbers are the same every time (N17 B4)', async () => {
    const fake = fakeSession();
    runCheck({ session: fake.session, document, challenge, boardId: 'board' });
    expect(fake.options).toEqual([{ seed: CHECK_RANDOM_SEED }]);
    expect(Number.isSafeInteger(CHECK_RANDOM_SEED)).toBe(true);
    await vi.advanceTimersByTimeAsync(1000);
  });

  it('runs the program for the duration, then stops it and gives the verdict', async () => {
    const fake = fakeSession();
    const check = runCheck({ session: fake.session, document, challenge, boardId: 'board' });

    await vi.advanceTimersByTimeAsync(500);
    fake.publish(running(true));
    expect(fake.calls).toEqual(['start']);
    await vi.advanceTimersByTimeAsync(500);

    expect(await check.done).toEqual({ status: 'checked', started: true, result: { passed: true, goals: [{ id: 'lit', label: 'Lit', passed: true }] } });
    expect(fake.calls).toEqual(['start', 'stop']);
    expect(fake.listeners.size).toBe(0);
  });

  it('fails a goal the run never met', async () => {
    const fake = fakeSession();
    const check = runCheck({ session: fake.session, document, challenge, boardId: 'board' });
    await vi.advanceTimersByTimeAsync(1000);

    expect(await check.done).toMatchObject({ status: 'checked', result: { passed: false } });
  });

  it('gives each input on time: a part of the board, or a circuit component', async () => {
    const fake = fakeSession();
    const startedAt = Date.now();
    runCheck({ session: fake.session, document, challenge, boardId: 'board' });
    await vi.advanceTimersByTimeAsync(1000);

    expect(fake.inputs).toEqual([
      [startedAt + 100, 'button', { kind: 'hold', closed: true }],
      [startedAt + 300, 'board/button-a', { kind: 'hold', closed: true }],
    ]);
  });

  it('gives no input to a part when there is no board', async () => {
    const fake = fakeSession();
    runCheck({ session: fake.session, document, challenge, boardId: null });
    await vi.advanceTimersByTimeAsync(1000);

    expect(fake.inputs.map(([, componentId]) => componentId)).toEqual(['button']);
  });

  it('is a failed check when the run does not start, without waiting', async () => {
    const fake = fakeSession({ ok: false, reason: 'compile-error', diagnostics: [] });
    const check = runCheck({ session: fake.session, document, challenge, boardId: 'board' });

    expect(await check.done).toEqual({ status: 'checked', started: false, result: { passed: false, goals: [{ id: 'lit', label: 'Lit', passed: false }] } });
    expect(fake.calls).toEqual(['start']);
    expect(fake.listeners.size).toBe(0);
  });

  it('ends without a result when the run is stopped meanwhile, and gives no more input', async () => {
    const fake = fakeSession();
    const check = runCheck({ session: fake.session, document, challenge, boardId: 'board' });
    await vi.advanceTimersByTimeAsync(200);
    fake.session.stop();
    await vi.advanceTimersByTimeAsync(1000);

    expect(await check.done).toEqual({ status: 'cancelled' });
    expect(fake.inputs).toHaveLength(1);
    expect(fake.calls).toEqual(['start', 'stop']);
  });

  // Review Focus 4 of N17 (task B6): a check whose timers ran late (a hidden tab: the browser runs its timers about once a second;
  // a stalled machine) gave its inputs late, so its goals were judged against the wrong moments. It never gives a verdict, so it
  // never passes falsely: it ends as interrupted, and the learner checks again.
  describe('a check that cannot be trusted (Review Focus 4)', () => {
    /** Timers as a hidden tab runs them: each one waits for the next whole second from the start. */
    const hiddenTabTimers = (): CheckTimers => {
      const start = Date.now();
      return {
        setTimeout: (task, ms) => setTimeout(task, Math.ceil((Date.now() + ms - start) / 1000) * 1000 + start - Date.now()),
        clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
        now: () => Date.now(),
      };
    };

    it('ends as interrupted, with no verdict, when an input comes too late, and stops the run', async () => {
      const fake = fakeSession();
      const check = runCheck({ session: fake.session, document, challenge, boardId: 'board', timers: hiddenTabTimers() });
      fake.publish(running(true));
      await vi.advanceTimersByTimeAsync(2000);

      expect(await check.done).toEqual({ status: 'interrupted', reason: 'late' });
      expect(fake.calls).toEqual(['start', 'stop']);
      expect(fake.listeners.size).toBe(0);
      // The late input is not given: the run it was meant for is over.
      expect(fake.inputs).toEqual([]);
    });

    it('ends as interrupted when its end comes too late', async () => {
      const fake = fakeSession();
      const late: CheckTimers = {
        setTimeout: (task, ms) => setTimeout(task, ms >= 1000 ? ms + CHECK_LATE_LIMIT_MS + 1 : ms),
        clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
        now: () => Date.now(),
      };
      const check = runCheck({ session: fake.session, document, challenge, boardId: 'board', timers: late });
      fake.publish(running(true));
      await vi.advanceTimersByTimeAsync(2000);

      expect(await check.done).toEqual({ status: 'interrupted', reason: 'late' });
      expect(fake.calls).toEqual(['start', 'stop']);
    });

    it('accepts a timer a little late, up to the limit', async () => {
      const fake = fakeSession();
      const slightly: CheckTimers = {
        setTimeout: (task, ms) => setTimeout(task, ms + CHECK_LATE_LIMIT_MS),
        clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
        now: () => Date.now(),
      };
      const check = runCheck({ session: fake.session, document, challenge, boardId: 'board', timers: slightly });
      fake.publish(running(true));
      await vi.advanceTimersByTimeAsync(2000);

      expect(await check.done).toMatchObject({ status: 'checked', result: { passed: true } });
      expect(CHECK_LATE_LIMIT_MS).toBeGreaterThan(0);
      expect(CHECK_LATE_LIMIT_MS).toBeLessThanOrEqual(250);
    });

    it('interrupt (the page was hidden) ends it as interrupted at once and stops the run; it does nothing once the check is over', async () => {
      const fake = fakeSession();
      const check = runCheck({ session: fake.session, document, challenge, boardId: 'board' });
      fake.publish(running(true));
      await vi.advanceTimersByTimeAsync(200);
      check.interrupt();
      check.interrupt();
      await vi.advanceTimersByTimeAsync(1000);

      expect(await check.done).toEqual({ status: 'interrupted', reason: 'hidden' });
      expect(fake.calls).toEqual(['start', 'stop']);
      expect(fake.inputs).toHaveLength(1);

      const finished = runCheck({ session: fake.session, document, challenge, boardId: 'board' });
      await vi.advanceTimersByTimeAsync(1000);
      finished.interrupt();
      expect(await finished.done).toMatchObject({ status: 'checked' });
    });
  });

  it('cancel ends the check without a result and stops the run; later calls do nothing', async () => {
    const fake = fakeSession();
    const check = runCheck({ session: fake.session, document, challenge, boardId: 'board' });
    check.cancel();
    check.cancel();
    await vi.advanceTimersByTimeAsync(1000);

    expect(await check.done).toEqual({ status: 'cancelled' });
    expect(fake.calls).toEqual(['start', 'stop']);
    expect(fake.inputs).toEqual([]);
  });
});
