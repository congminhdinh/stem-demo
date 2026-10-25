import { describe, expect, it } from 'vitest';
import { createHold, TIME_EPSILON_S } from './hold';

describe('createHold', () => {
  it('starts counting at the first frame the condition holds, so a hold of N s is N s between two frames', () => {
    const hold = createHold(1);
    expect(hold.tick(true, 0.25)).toBe(false); // the first frame: 0 s held, its tick is not credited
    expect(hold.heldS).toBe(0);
    expect(hold.tick(true, 0.25)).toBe(false);
    expect(hold.tick(true, 0.25)).toBe(false);
    expect(hold.tick(true, 0.25)).toBe(false);
    expect(hold.heldS).toBe(0.75);
    expect(hold.tick(true, 0.25)).toBe(true);
    expect(hold.heldS).toBe(1);
  });

  it('starts over when the condition fails for a frame', () => {
    const hold = createHold(0.5);
    hold.tick(true, 0.25);
    hold.tick(true, 0.25);
    expect(hold.tick(false, 0.25)).toBe(false);
    expect(hold.heldS).toBe(0);
    expect(hold.tick(true, 0.25)).toBe(false);
    expect(hold.tick(true, 0.25)).toBe(false);
    expect(hold.tick(true, 0.25)).toBe(true);
  });

  it('absorbs the rounding of a sum of ticks that are not exact in binary', () => {
    const hold = createHold(1);
    let done = false;
    for (let k = 0; k <= 10; k++) done = hold.tick(true, 0.1); // the first frame and ten ticks
    expect(0.1 * 10).toBe(1);
    expect([0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1].reduce((sum, dt) => sum + dt, 0)).toBeLessThan(1); // 0.9999999999999999
    expect(done).toBe(true);
    expect(TIME_EPSILON_S).toBe(1e-9);
  });

  it('is not fooled by a tick that is a hair short of the rest', () => {
    const hold = createHold(1);
    hold.tick(true, 0.5);
    hold.tick(true, 0.5);
    expect(hold.tick(true, 0.499)).toBe(false);
    expect(hold.heldS).toBeCloseTo(0.999, 12);
  });

  it('reports how much of the hold is done, never more than all of it', () => {
    const hold = createHold(2);
    expect(hold.progress).toBe(0);
    hold.tick(true, 1);
    hold.tick(true, 1);
    expect(hold.progress).toBe(0.5);
    hold.tick(true, 1);
    hold.tick(true, 1);
    expect(hold.progress).toBe(1);
  });

  it.each([-0.1, Number.NaN, Number.POSITIVE_INFINITY])('refuses a tick of %s s: the caller has a bug', (dtS) => {
    expect(() => createHold(1).tick(true, dtS)).toThrow(RangeError);
  });

  it('takes a tick of 0 s: the first frame of a run may have none', () => {
    const hold = createHold(1);
    expect(hold.tick(true, 0)).toBe(false);
    expect(hold.heldS).toBe(0);
  });
});
