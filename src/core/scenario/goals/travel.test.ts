import { describe, expect, it } from 'vitest';
import { frameAt } from './__fixtures__/frames';
import { createTravelMeter, MIN_GUARD_TRAVEL_CM, TRAVEL_EPSILON_CM } from './travel';

describe('createTravelMeter', () => {
  it('adds speed times tick for each frame', () => {
    const meter = createTravelMeter();
    expect(meter.cm).toBe(0);
    meter.add(frameAt({ speedCmS: 10 }), 0.25);
    meter.add(frameAt({ speedCmS: 4 }), 0.5);
    expect(meter.cm).toBe(4.5);
  });

  it('reaches the least path at exactly 20 cm and not at a hair under it', () => {
    expect(MIN_GUARD_TRAVEL_CM).toBe(20);
    const exactly = createTravelMeter();
    exactly.add(frameAt({ speedCmS: 80 }), 0.25);
    expect(exactly.enough).toBe(true);
    const under = createTravelMeter();
    under.add(frameAt({ speedCmS: 79.99 }), 0.25);
    expect(under.enough).toBe(false);
    expect(under.progress).toBeCloseTo(0.999875, 12);
  });

  it('absorbs the rounding of a long sum, no more than a nanometre of it', () => {
    expect(TRAVEL_EPSILON_CM).toBe(1e-9);
    const meter = createTravelMeter();
    for (let k = 0; k < 100; k++) meter.add(frameAt({ speedCmS: 2 }), 0.1);
    expect(meter.cm).toBeLessThan(20); // 19.99999999999996
    expect(meter.enough).toBe(true);
    const short = createTravelMeter();
    short.add(frameAt({ speedCmS: 79.999999 }), 0.25);
    expect(short.enough).toBe(false);
  });

  it('shows how much of the least path is done, never more than all of it', () => {
    const meter = createTravelMeter();
    meter.add(frameAt({ speedCmS: 10 }), 0.5);
    expect(meter.progress).toBe(0.25);
    meter.add(frameAt({ speedCmS: 1000 }), 1);
    expect(meter.progress).toBe(1);
  });

  it('adds nothing for a frame out of the arena, or a speed that is not a positive number', () => {
    const meter = createTravelMeter();
    meter.add(frameAt({ speedCmS: 50, outOfArena: true }), 1);
    meter.add(frameAt({ speedCmS: Number.NaN }), 1);
    meter.add(frameAt({ speedCmS: Number.POSITIVE_INFINITY }), 1);
    meter.add(frameAt({ speedCmS: -5 }), 1);
    meter.add(frameAt({ speedCmS: 0 }), 1);
    expect(meter.cm).toBe(0);
    expect(meter.enough).toBe(false);
  });

  it('takes a tick of 0 s, and refuses one that is negative or not a time, even on a frame it ignores', () => {
    const meter = createTravelMeter();
    meter.add(frameAt({ speedCmS: 50 }), 0);
    expect(meter.cm).toBe(0);
    for (const dtS of [-0.1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => meter.add(frameAt({ speedCmS: 0, outOfArena: true }), dtS)).toThrow(RangeError);
    }
  });
});
