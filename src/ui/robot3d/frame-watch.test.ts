import { describe, expect, it } from 'vitest';
import { createFrameWatch, SLOW_FRAME_MS, SLOW_WINDOW_MS } from './frame-watch';

// N18 R4.7 fix round 1 (C6): the high tier gives way to the low one, once, when a run's frames are slow: the median frame time over 3 s
// of a run above 33 ms (under 30 fps).

const feed = (watch: ReturnType<typeof createFrameWatch>, frames: number, ms: number, running = true) => {
  let slow = false;
  for (let i = 0; i < frames; i++) slow = watch.frame(ms, running) || slow;
  return slow;
};

describe('the frame watch (N18 R4.7)', () => {
  it('says a run is slow once its frames over 3 s have a median above 33 ms, and not before 3 s of them', () => {
    expect([SLOW_WINDOW_MS, SLOW_FRAME_MS]).toEqual([3000, 33]);
    const watch = createFrameWatch();
    // 2.9 s of 50 ms frames: not yet.
    expect(feed(watch, 58, 50)).toBe(false);
    expect(feed(watch, 2, 50)).toBe(true);
  });

  it('lets a run at 30 fps or more be, and a few long frames among fast ones (a hitch) do not count', () => {
    const watch = createFrameWatch();
    expect(feed(watch, 200, 16.7)).toBe(false);
    expect(feed(watch, 100, 33)).toBe(false);
    const hitchy = createFrameWatch();
    let slow = false;
    for (let i = 0; i < 180; i++) slow = hitchy.frame(i % 4 === 0 ? 90 : 16.7, true) || slow;
    expect(slow).toBe(false);
  });

  it('counts only frames of a run: an idle view, a paused run and the gap before a run are no frames of it', () => {
    const watch = createFrameWatch();
    expect(feed(watch, 100, 50, false)).toBe(false);
    // 2 s of a slow run, a pause, 2 s more: two windows cut short, never 3 s in one.
    expect(feed(watch, 40, 50)).toBe(false);
    expect(feed(watch, 1, 50, false)).toBe(false);
    expect(feed(watch, 40, 50)).toBe(false);
    // The first frame after a long gap (the demand loop drew nothing meanwhile) starts the count again.
    expect(watch.frame(4000, true)).toBe(false);
    expect(feed(watch, 59, 50)).toBe(false);
    expect(feed(watch, 1, 50)).toBe(true);
  });
});
