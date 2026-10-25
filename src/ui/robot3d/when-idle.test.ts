import { afterEach, describe, expect, it, vi } from 'vitest';
import { IDLE_FALLBACK_MS, IDLE_TIMEOUT_MS, whenIdle } from './when-idle';

// N18 P2: work the lab can do later (the physics engine's warm-up) waits for the browser's idle time, or a while where it has none.

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('whenIdle (N18 P2)', () => {
  it('asks the browser for idle time, at most IDLE_TIMEOUT_MS (2 s) away, and calls the work once then', () => {
    const requests: [() => void, { timeout: number }][] = [];
    vi.stubGlobal('requestIdleCallback', (callback: () => void, options: { timeout: number }) => requests.push([callback, options]));
    vi.stubGlobal('cancelIdleCallback', vi.fn());
    const work = vi.fn();
    whenIdle(work);
    expect(IDLE_TIMEOUT_MS).toBe(2000);
    expect(requests.map(([, options]) => options)).toEqual([{ timeout: 2000 }]);
    expect(work).not.toHaveBeenCalled();
    requests[0]![0]();
    expect(work).toHaveBeenCalledTimes(1);
  });

  it('takes it back when cancelled', () => {
    const cancel = vi.fn();
    vi.stubGlobal('requestIdleCallback', () => 7);
    vi.stubGlobal('cancelIdleCallback', cancel);
    whenIdle(vi.fn())();
    expect(cancel).toHaveBeenCalledWith(7);
  });

  it('waits IDLE_FALLBACK_MS (300 ms) where the browser has no idle callbacks, and not when cancelled', () => {
    vi.useFakeTimers();
    vi.stubGlobal('requestIdleCallback', undefined);
    const work = vi.fn();
    const later = vi.fn();
    whenIdle(work);
    whenIdle(later)();
    vi.advanceTimersByTime(IDLE_FALLBACK_MS - 1);
    expect(work).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(IDLE_FALLBACK_MS).toBe(300);
    expect(work).toHaveBeenCalledTimes(1);
    expect(later).not.toHaveBeenCalled();
  });
});
