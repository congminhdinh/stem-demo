import { createSeededRandomInt } from '../capabilities/services';

// Seeded random numbers for the robot world (N18 R3.1): sensor noise (R3.4) and scenario variants (R5.1).
// It is the repo's one generator, the Mulberry32 behind a seeded run's `random.randint` (N17 B4), read
// 32 bits at a time: the same seed gives the same numbers, in the same order, on every engine (integer
// operations and a division by 2^32 only).

/** A seeded stream of numbers. Not for anything that must be unpredictable. */
export type WorldRng = {
  /** The next number in [0, 1): a whole multiple of 2^-32. */
  next(): number;
  /** The next number from `min` to `max`: `min + (max − min) · next()`. */
  uniform(min: number, max: number): number;
};

const UINT32_MAX = 0xffffffff;
const TWO_POW_32 = 4294967296;

export function createWorldRng(seed: number): WorldRng {
  if (!Number.isSafeInteger(seed)) {
    throw new RangeError(`A world seed is a whole number, not ${seed}.`);
  }
  // A draw over [0, 2^32 − 1] is Mulberry32's raw 32-bit output, unchanged.
  const draw = createSeededRandomInt(seed);
  const next = () => draw(0, UINT32_MAX) / TWO_POW_32;
  return {
    next,
    uniform: (min, max) => min + (max - min) * next(),
  };
}
