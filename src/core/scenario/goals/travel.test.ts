import { describe, expect, it } from 'vitest';
import { frameAt } from './__fixtures__/frames';
import { createReachMeter, MIN_GUARD_TRAVEL_CM, TRAVEL_EPSILON_CM } from './travel';

// N18 R5.2a fix round 1 (controller ruling): the guard goals ask how far the robot got from where it started (net reach), not how long
// its path was, so a robot cannot earn them by spinning or wiggling on the spot.

describe('createReachMeter', () => {
  it('is the farthest the middle of the body has been from where it was on the first frame', () => {
    const meter = createReachMeter();
    expect(meter.cm).toBe(0);
    meter.add(frameAt({ xCm: 100, yCm: 80 }), 0);
    meter.add(frameAt({ xCm: 106, yCm: 88 }), 0.25);
    expect(meter.cm).toBe(10);
    meter.add(frameAt({ xCm: 100, yCm: 82 }), 0.25); // back near the start: the farthest so far stays
    expect(meter.cm).toBe(10);
  });

  it('reaches the least distance at exactly 20 cm, in any direction, and not at a hair under it', () => {
    expect(MIN_GUARD_TRAVEL_CM).toBe(20);
    const along = createReachMeter();
    along.add(frameAt({ xCm: 100, yCm: 80 }), 0);
    along.add(frameAt({ xCm: 120, yCm: 80 }), 0.25);
    expect(along.enough).toBe(true);
    const slanted = createReachMeter();
    slanted.add(frameAt({ xCm: 100, yCm: 80 }), 0);
    slanted.add(frameAt({ xCm: 88, yCm: 64 }), 0.25);
    expect(slanted.cm).toBe(20);
    expect(slanted.enough).toBe(true);
    const under = createReachMeter();
    under.add(frameAt({ xCm: 100, yCm: 80 }), 0);
    under.add(frameAt({ xCm: 119.99, yCm: 80 }), 0.25);
    expect(under.enough).toBe(false);
    expect(under.progress).toBeCloseTo(0.9995, 12);
  });

  it('absorbs the rounding of two positions, no more than a nanometre of it', () => {
    expect(TRAVEL_EPSILON_CM).toBe(1e-9);
    const meter = createReachMeter();
    meter.add(frameAt({ xCm: 12.3, yCm: 80 }), 0);
    meter.add(frameAt({ xCm: 32.3, yCm: 80 }), 0.25);
    expect(meter.cm).toBeLessThan(20); // 19.999999999999996
    expect(meter.enough).toBe(true);
    const short = createReachMeter();
    short.add(frameAt({ xCm: 100, yCm: 80 }), 0);
    short.add(frameAt({ xCm: 119.999999, yCm: 80 }), 0.25);
    expect(short.enough).toBe(false);
  });

  it('is not met by a long path that stays near the start: a wiggle back and forth, or a spin', () => {
    const wiggle = createReachMeter();
    for (let k = 0; k < 400; k++) wiggle.add(frameAt({ xCm: 100 + (k % 2 === 0 ? 0 : 15), yCm: 80, speedCmS: 60 }), 0.25); // 30 m of path
    expect(wiggle.cm).toBe(15);
    expect(wiggle.enough).toBe(false);
    // The middle of the body circles 2 cm ahead of the axle when the robot spins in place: at most 4 cm from where it started.
    const spin = createReachMeter();
    for (let k = 0; k <= 360; k++) {
      const a = (k * Math.PI) / 180;
      spin.add(frameAt({ xCm: 100 + 2 * Math.cos(a) - 2, yCm: 80 + 2 * Math.sin(a), speedCmS: 0 }), 1 / 120);
    }
    expect(spin.cm).toBeCloseTo(4, 9);
    expect(spin.enough).toBe(false);
  });

  it('shows how much of the least distance is done, never more than all of it', () => {
    const meter = createReachMeter();
    meter.add(frameAt({ xCm: 0, yCm: 0 }), 0);
    meter.add(frameAt({ xCm: 5, yCm: 0 }), 0.5);
    expect(meter.progress).toBe(0.25);
    meter.add(frameAt({ xCm: 500, yCm: 0 }), 1);
    expect(meter.progress).toBe(1);
  });

  it('takes no position from a frame out of the arena, nor one that is not a number; the start is the first that counts', () => {
    const meter = createReachMeter();
    meter.add(frameAt({ xCm: 0, yCm: 0, outOfArena: true }), 0); // not the start
    meter.add(frameAt({ xCm: Number.NaN, yCm: 80 }), 0.25); // not the start either
    meter.add(frameAt({ xCm: 100, yCm: 80 }), 0.25); // the start
    meter.add(frameAt({ xCm: 300, yCm: 80, outOfArena: true }), 0.25); // the fall
    meter.add(frameAt({ xCm: 100, yCm: Number.POSITIVE_INFINITY }), 0.25);
    meter.add(frameAt({ xCm: 115, yCm: 80 }), 0.25);
    expect(meter.cm).toBe(15);
  });

  it('does not read the speed: a robot pushed along without driving gets as far as it is pushed', () => {
    const meter = createReachMeter();
    meter.add(frameAt({ xCm: 100, yCm: 80, speedCmS: 0 }), 0);
    meter.add(frameAt({ xCm: 125, yCm: 80, speedCmS: 0 }), 1);
    expect(meter.enough).toBe(true);
  });

  it('takes a tick of 0 s, and refuses one that is negative or not a time, even on a frame it ignores', () => {
    const meter = createReachMeter();
    meter.add(frameAt({ xCm: 100, yCm: 80 }), 0);
    for (const dtS of [-0.1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => meter.add(frameAt({ outOfArena: true }), dtS)).toThrow(RangeError);
    }
  });
});
