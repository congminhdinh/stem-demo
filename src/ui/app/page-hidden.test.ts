// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createNewProject } from '../../core/circuit/document';
import { runCheck, type Challenge, type CheckSession } from '../../core/challenge';
import type { RunSnapshot } from '../../core/run/run-session';
import { onPageHidden } from './page-hidden';

// Review Focus 4 of N17 (task B6): a check stops being trusted the moment the page is hidden (the browser then runs its timers
// about once a second), so the lab is told at once.

const setVisibility = (state: DocumentVisibilityState) => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  document.dispatchEvent(new Event('visibilitychange'));
};

afterEach(() => {
  setVisibility('visible');
});

describe('onPageHidden (N17 B6)', () => {
  it('tells when the page becomes hidden, not when it becomes visible again', () => {
    const hidden = vi.fn();
    const stop = onPageHidden(document, hidden);
    setVisibility('visible');
    expect(hidden).not.toHaveBeenCalled();
    setVisibility('hidden');
    expect(hidden).toHaveBeenCalledTimes(1);
    stop();
  });

  it('tells at once when the page is already hidden', () => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    const hidden = vi.fn();
    const stop = onPageHidden(document, hidden);
    expect(hidden).toHaveBeenCalledTimes(1);
    stop();
  });

  it('tells nothing once stopped', () => {
    const hidden = vi.fn();
    onPageHidden(document, hidden)();
    setVisibility('hidden');
    expect(hidden).not.toHaveBeenCalled();
  });
});

// The wiring App.tsx makes: a check started, the page listened to, and `interrupt` told when it is or becomes hidden.
describe('onPageHidden with a check (N17 B6)', () => {
  const idle: RunSnapshot = { status: 'idle', diagnostics: [], error: null, simulation: null };
  const lit: RunSnapshot = { status: 'running', diagnostics: [], error: null, simulation: { nets: [], components: { led: { lit: true } }, pinReads: {} } };
  const challenge: Challenge = { goals: [{ id: 'lit', label: 'Lit', kind: 'led-lit', componentId: 'led' }], durationMs: 1000 };

  /** A session whose run is already lit; it only counts its stops. */
  function litSession() {
    const listeners = new Set<(snapshot: RunSnapshot) => void>();
    let current = idle;
    const set = (next: RunSnapshot) => {
      current = next;
      [...listeners].forEach((listener) => listener(next));
    };
    const stops: number[] = [];
    const session: CheckSession = {
      start: () => {
        set(lit);
        return { ok: true };
      },
      stop: () => {
        stops.push(Date.now());
        set(idle);
      },
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      getSnapshot: () => current,
      setComponentInput: () => {},
    };
    return { session, stops };
  }

  it('a page that becomes hidden mid-check interrupts it, though no timer is late', async () => {
    vi.useFakeTimers();
    try {
      const { session, stops } = litSession();
      const check = runCheck({ session, document: createNewProject('p'), challenge, boardId: null });
      const stop = onPageHidden(document, () => check.interrupt());
      await vi.advanceTimersByTimeAsync(400);
      setVisibility('hidden');
      await vi.advanceTimersByTimeAsync(1000);

      expect(await check.done).toEqual({ status: 'interrupted', reason: 'hidden' });
      expect(stops).toHaveLength(1);
      stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('a page that is already hidden when the check starts interrupts it at once', async () => {
    vi.useFakeTimers();
    try {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      const { session } = litSession();
      const check = runCheck({ session, document: createNewProject('p'), challenge, boardId: null });
      const stop = onPageHidden(document, () => check.interrupt());

      expect(await check.done).toEqual({ status: 'interrupted', reason: 'hidden' });
      stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('a page that stays visible lets the check be judged', async () => {
    vi.useFakeTimers();
    try {
      const { session } = litSession();
      const check = runCheck({ session, document: createNewProject('p'), challenge, boardId: null });
      const stop = onPageHidden(document, () => check.interrupt());
      await vi.advanceTimersByTimeAsync(1000);

      expect(await check.done).toMatchObject({ status: 'checked', result: { passed: true } });
      stop();
    } finally {
      vi.useRealTimers();
    }
  });
});
