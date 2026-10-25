import { describe, expect, it } from 'vitest';
import { CAP_DRAW_MS, CAP_FRAME_MS, CHAIN_WINDOW_MS, createFrameWatch, createLowTierWatch, drawDue, OFFER_FRAME_MS, SLOW_FRAME_MS, SLOW_WINDOW_MS, type LowTierStep, type LowTierWatch } from './frame-watch';

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

  it('lets a run whose robot stands still and blinks an LED be: a pair of frames every 0.5 s (484 ms, then 16.7 ms back to back) is not slow (fix round 2, N2)', () => {
    const watch = createFrameWatch();
    let slow = false;
    // 60 s of blinks: the frame loop stops after each pair, and the first frame of a pair comes after that stop.
    for (let i = 0; i < 120; i++) {
      slow = watch.frame(484, true, false) || slow;
      slow = watch.frame(16.7, true, true) || slow;
    }
    expect(slow).toBe(false);
  });

  it('still says a slow run is slow when its frames come back to back, every one of them late', () => {
    const watch = createFrameWatch();
    let slow = false;
    for (let i = 0; i < 70; i++) slow = watch.frame(70, true, true) || slow;
    expect(slow).toBe(true);
  });
});

describe('the low tier’s frame watch (N18 P2)', () => {
  const steps = (watch: LowTierWatch, frames: number, ms: number, running = true) => {
    const said: LowTierStep[] = [];
    for (let i = 0; i < frames; i++) {
      const step = watch.frame(ms, running);
      if (step) said.push(step);
    }
    return said;
  };

  it('lets a run at 36 fps or more be, however long it goes (43 fps on a busy machine included)', () => {
    expect([CHAIN_WINDOW_MS, CAP_FRAME_MS, OFFER_FRAME_MS]).toEqual([3000, 28, 50]);
    const watch = createLowTierWatch();
    expect(steps(watch, 2000, 16.7)).toEqual([]);
    expect(steps(watch, 400, 23.3)).toEqual([]);
    expect(steps(watch, 300, 28)).toEqual([]);
  });

  it('draws a run slower than 36 fps at 30 fps once 3 s of it were judged, then offers the 2D map only if the capped draws stay under 20 fps', () => {
    const watch = createLowTierWatch();
    // 3 s of 31.25 ms draws (32 fps): cap. Then capped at 30 fps (33.3 ms): nothing more, for as long as it holds.
    expect(steps(watch, 95, 31.25)).toEqual([]);
    expect(steps(watch, 1, 31.25)).toEqual(['cap']);
    expect(steps(watch, 900, 33.3)).toEqual([]);
    // A pause, then the capped draws fall under 20 fps (60 ms): after 3 s of them, the offer; then nothing, ever.
    expect(watch.frame(16.7, false)).toBeNull();
    expect(steps(watch, 49, 60)).toEqual([]);
    expect(steps(watch, 1, 60)).toEqual(['offer']);
    expect(steps(watch, 500, 200)).toEqual([]);
  });

  it('goes one way only: a fast spell after the cap does not lift it, and a slow one before the offer is judged afresh after the cap', () => {
    const watch = createLowTierWatch();
    // Very slow from the start (6 fps): the first window caps, the next (after the cap) offers.
    expect(steps(watch, 18, 170)).toEqual(['cap']);
    // 3 s at 60 fps after the cap: judged, and nothing (there is no way back up).
    expect(steps(watch, 180, 16.7)).toEqual([]);
    expect(steps(watch, 18, 170)).toEqual(['offer']);
  });

  it('counts only a run’s back-to-back draws: an idle view, a pause and the wait before a draw after the loop stopped are none', () => {
    const watch = createLowTierWatch();
    expect(steps(watch, 1000, 40, false)).toEqual([]);
    // 2 s, a pause, 2 s: never 3 s in one window.
    expect(steps(watch, 50, 40)).toEqual([]);
    expect(steps(watch, 1, 40, false)).toEqual([]);
    expect(steps(watch, 50, 40)).toEqual([]);
    expect(watch.frame(16.7, false)).toBeNull();
    // A blinking LED's pairs: the first of each comes after the loop stopped, the second 16.7 ms later.
    for (let i = 0; i < 200; i++) {
      expect(watch.frame(484, true, false)).toBeNull();
      expect(watch.frame(16.7, true, true)).toBeNull();
    }
  });
});

describe('a capped view’s draws (N18 P2)', () => {
  it('draws every second display frame at 60 Hz, every fourth at 120 Hz, every fifth at 144 Hz: about 30 fps', () => {
    expect(CAP_DRAW_MS).toBeCloseTo(29.333, 3);
    const drawsPerSecond = (hz: number) => {
      let since = Infinity;
      let draws = 0;
      for (let frame = 0; frame < hz; frame++) {
        since += 1000 / hz;
        if (drawDue(since)) {
          draws += 1;
          since = 0;
        }
      }
      return draws;
    };
    expect([drawsPerSecond(60), drawsPerSecond(120), drawsPerSecond(144)]).toEqual([30, 30, 29]);
    expect(drawDue(33.3 - 3.9)).toBe(true);
    expect(drawDue(16.7)).toBe(false);
  });
});

describe('the low tier’s frame watch of a canvas made capped (N18 P2)', () => {
  it('starts at the cap: 30 fps draws say nothing, draws under 20 fps offer the 2D map', () => {
    const watch = createLowTierWatch('capped');
    let said: LowTierStep | null = null;
    for (let i = 0; i < 300; i++) said = watch.frame(33.3, true) ?? said;
    expect(said).toBeNull();
    for (let i = 0; i < 60; i++) said = watch.frame(60, true) ?? said;
    expect(said).toBe('offer');
  });
});
