import { describe, expect, it } from 'vitest';
import { createMulberry32 } from './mulberry32';

/** The canonical Mulberry32 (Tommy Ettinger's, in its usual JavaScript form), written independently of the module. */
function reference(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (t ^ (t >>> 14)) >>> 0;
  };
}

describe('createMulberry32', () => {
  it('is the canonical Mulberry32: unsigned 32-bit outputs, the same for the same seed', () => {
    const next = createMulberry32(2026);
    expect([next(), next(), next()]).toEqual([1955961175, 1324980858, 2839649622]);
    for (const seed of [0, 1, 42, 2026, 0xffffffff, -7]) {
      const ours = createMulberry32(seed);
      const theirs = reference(seed);
      for (let i = 0; i < 1000; i++) expect(ours()).toBe(theirs());
    }
  });

  it('reads the seed as an unsigned 32-bit integer', () => {
    const a = createMulberry32(-1);
    const b = createMulberry32(0xffffffff);
    expect([a(), a()]).toEqual([b(), b()]);
  });
});
