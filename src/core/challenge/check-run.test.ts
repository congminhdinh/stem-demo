import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNewProject } from '../circuit/document';
import type { RunSnapshot, StartResult } from '../run/run-session';
import type { ComponentInput } from '../simulation/simulate-circuit';
import type { Challenge } from './challenge';
import { CHECK_LATENESS_LIMIT_MS, CHECK_RANDOM_SEED, runCheck, type CheckSession, type CheckTimers } from './check-run';

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

  // Review Focus 4 of N17 (task B6): a hidden tab runs a check's timers about once a second, so its inputs reach the run at the wrong
  // moments. A check whose page is hidden is interrupted (the UI tells `interrupt` on visibilitychange); a timer more than
  // CHECK_LATENESS_LIMIT_MS late interrupts it too. Neither gives a verdict, so a check never passes falsely: the learner checks
  // again. A visible tab that is only busy (late by less than the limit) is judged.
  describe('a check that cannot be trusted (Review Focus 4)', () => {
    /** Timers that all come `lateMs` after they were due (a busy or stalled tab). */
    const lateBy = (lateMs: number, only: (ms: number) => boolean = () => true): CheckTimers => ({
      setTimeout: (task, ms) => setTimeout(task, only(ms) ? ms + lateMs : ms),
      clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
      now: () => Date.now(),
    });

    it('the limit is a second: a hidden tab runs timers at least that far apart', () => {
      expect(CHECK_LATENESS_LIMIT_MS).toBe(1000);
    });

    it('does not interrupt a visible tab whose timers are 600 ms late: it is judged, and its inputs are given', async () => {
      const fake = fakeSession();
      const startedAt = Date.now();
      const check = runCheck({ session: fake.session, document, challenge, boardId: 'board', timers: lateBy(600) });
      fake.publish(running(true));
      await vi.advanceTimersByTimeAsync(2000);

      expect(await check.done).toMatchObject({ status: 'checked', started: true, result: { passed: true } });
      expect(fake.inputs.map(([at]) => at - startedAt)).toEqual([700, 900]);
      expect(fake.calls).toEqual(['start', 'stop']);
    });

    it('ends as interrupted, with no verdict, when an input is 1200 ms late, and stops the run', async () => {
      const fake = fakeSession();
      const check = runCheck({ session: fake.session, document, challenge, boardId: 'board', timers: lateBy(1200) });
      fake.publish(running(true));
      await vi.advanceTimersByTimeAsync(3000);

      expect(await check.done).toEqual({ status: 'interrupted', reason: 'late' });
      expect(fake.calls).toEqual(['start', 'stop']);
      expect(fake.listeners.size).toBe(0);
      // The late input is not given: the run it was meant for is over.
      expect(fake.inputs).toEqual([]);
    });

    it('ends as interrupted when only its end is 1200 ms late', async () => {
      const fake = fakeSession();
      const check = runCheck({ session: fake.session, document, challenge, boardId: 'board', timers: lateBy(1200, (ms) => ms >= 1000) });
      fake.publish(running(true));
      await vi.advanceTimersByTimeAsync(3000);

      expect(await check.done).toEqual({ status: 'interrupted', reason: 'late' });
      expect(fake.calls).toEqual(['start', 'stop']);
    });

    it('accepts a timer late by exactly the limit, and interrupts one a millisecond later', async () => {
      const exactly = fakeSession();
      const accepted = runCheck({ session: exactly.session, document, challenge, boardId: 'board', timers: lateBy(CHECK_LATENESS_LIMIT_MS) });
      exactly.publish(running(true));
      await vi.advanceTimersByTimeAsync(3000);
      expect(await accepted.done).toMatchObject({ status: 'checked', result: { passed: true } });

      const over = fakeSession();
      const refused = runCheck({ session: over.session, document, challenge, boardId: 'board', timers: lateBy(CHECK_LATENESS_LIMIT_MS + 1) });
      over.publish(running(true));
      await vi.advanceTimersByTimeAsync(3000);
      expect(await refused.done).toEqual({ status: 'interrupted', reason: 'late' });
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
