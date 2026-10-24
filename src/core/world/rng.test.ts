import { describe, expect, it } from 'vitest';
import { createSeededRandomInt } from '../capabilities/services';
import { createWorldRng } from './rng';

describe('createWorldRng', () => {
  it('is the repo’s Mulberry32 stream, scaled to [0, 1)', () => {
    const rng = createWorldRng(42);
    const draw = createSeededRandomInt(42);
    for (let i = 0; i < 1000; i++) {
      expect(rng.next()).toBe(draw(0, 0xffffffff) / 4294967296);
    }
  });

  it('gives the same numbers for the same seed, every time (canonical Mulberry32 of seed 2026)', () => {
    const rng = createWorldRng(2026);
    expect([rng.next(), rng.next(), rng.next()]).toEqual([0.45540769933722913, 0.30849614599719644, 0.6611574492417276]);
  });

  it('gives a different stream for another seed', () => {
    const a = createWorldRng(1);
    const b = createWorldRng(2);
    expect([a.next(), a.next()]).not.toEqual([b.next(), b.next()]);
  });

  it('stays in [0, 1) and in [min, max] for uniform()', () => {
    const rng = createWorldRng(7);
    for (let i = 0; i < 10000; i++) {
      const u = rng.next();
      expect(u >= 0 && u < 1).toBe(true);
      const v = rng.uniform(-3, 5);
      expect(v >= -3 && v <= 5).toBe(true);
    }
  });

  it('refuses a seed that is not a safe integer', () => {
    expect(() => createWorldRng(1.5)).toThrow(RangeError);
    expect(() => createWorldRng(Number.NaN)).toThrow(RangeError);
  });
});
