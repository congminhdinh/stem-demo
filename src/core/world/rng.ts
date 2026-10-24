import { createMulberry32 } from '../random/mulberry32';

// Seeded random numbers for the robot world (N18 R3.1): sensor noise (R3.4) and scenario variants (R5.1).
// It is the repo's one generator (random/mulberry32.ts), the one behind a seeded run's `random.randint`
// (N17 B4), read 32 bits at a time: the same seed gives the same numbers, in the same order, on every engine
// (integer operations and a division by 2^32 only).

/** A seeded stream of numbers. Not for anything that must be unpredictable. */
export type WorldRng = {
  /** The next number in [0, 1): a whole multiple of 2^-32. */
  next(): number;
  /** The next number from `min` to `max`: `min + (max − min) · next()`. */
  uniform(min: number, max: number): number;
};

const TWO_POW_32 = 4294967296;

export function createWorldRng(seed: number): WorldRng {
  if (!Number.isSafeInteger(seed)) {
    throw new RangeError(`A world seed is a whole number, not ${seed}.`);
  }
  const next32 = createMulberry32(seed);
  const next = () => next32() / TWO_POW_32;
  return {
    next,
    uniform: (min, max) => min + (max - min) * next(),
  };
}
