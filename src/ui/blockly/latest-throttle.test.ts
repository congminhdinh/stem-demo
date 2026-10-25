import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLatestThrottle } from './latest-throttle';

// N18 R2.4: the throttle behind the highlight. Leading and trailing, never stale, at most one change per delay.

beforeEach(() => void vi.useFakeTimers());
afterEach(() => void vi.useRealTimers());

function recorded(delayMs = 100, initial: string | null = null) {
  const shown: { at: number; value: string | null }[] = [];
  const start = Date.now();
  const throttle = createLatestThrottle<string | null>((value) => void shown.push({ at: Date.now() - start, value }), delayMs, initial);
  const advance = (ms: number) => void vi.advanceTimersByTime(ms);
  return { throttle, shown, advance };
}

describe('createLatestThrottle', () => {
  it('shows the first value at once (leading), and a value requested inside the delay at the end of it (trailing)', () => {
    const { throttle, shown, advance } = recorded();
    throttle.request('a');
    expect(shown).toEqual([{ at: 0, value: 'a' }]);
    advance(30);
    throttle.request('b');
    advance(30);
    throttle.request('c');
    expect(shown).toHaveLength(1);
    advance(39);
    expect(shown).toHaveLength(1);
    advance(1);
    expect(shown).toEqual([{ at: 0, value: 'a' }, { at: 100, value: 'c' }]);
  });

  it('a value every 10 ms for a second shows a value about every 100 ms, always the latest one at that time, and then the last one', () => {
    const { throttle, shown, advance } = recorded();
    for (let step = 0; step < 100; step++) {
      throttle.request(`v${step}`);
      advance(10);
    }
    // The latest one asked for when each delay ends (v9 at 100 ms: v10 is asked for just after). The stream stopped with v99, asked at
    // 990 ms, and the show due at 1000 ms is that one.
    expect(shown.map((entry) => entry.at)).toEqual([0, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000]);
    expect(shown.map((entry) => entry.value)).toEqual(['v0', 'v9', 'v19', 'v29', 'v39', 'v49', 'v59', 'v69', 'v79', 'v89', 'v99']);
    // Quiet again: nothing more is shown.
    advance(1000);
    expect(shown).toHaveLength(11);
  });

  it('shows a value that comes after a quiet at once, and a value equal to the shown one starts no delay', () => {
    const { throttle, shown, advance } = recorded();
    throttle.request('a');
    advance(500);
    throttle.request('a');
    throttle.request('b');
    expect(shown).toEqual([{ at: 0, value: 'a' }, { at: 500, value: 'b' }]);
    // Back to what is shown before the delay is over: nothing to show at its end.
    advance(50);
    throttle.request('c');
    throttle.request('b');
    advance(200);
    expect(shown).toHaveLength(2);
    throttle.request('c');
    expect(shown[2]).toEqual({ at: 750, value: 'c' });
  });

  it('starts from the value it is given: that value is not shown again, and null clears like any other value', () => {
    const { throttle, shown, advance } = recorded(100, 'a');
    throttle.request('a');
    expect(shown).toEqual([]);
    throttle.request(null);
    advance(10);
    throttle.request('x');
    advance(200);
    expect(shown).toEqual([{ at: 0, value: null }, { at: 100, value: 'x' }]);
  });

  it('dispose cancels the pending value and refuses new ones', () => {
    const { throttle, shown, advance } = recorded();
    throttle.request('a');
    throttle.request('b');
    throttle.dispose();
    advance(1000);
    throttle.request('c');
    advance(1000);
    expect(shown).toEqual([{ at: 0, value: 'a' }]);
  });
});
