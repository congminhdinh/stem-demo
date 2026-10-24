// The repo's one seeded generator (N17 B4, N18 R3.1): Mulberry32, a small 32-bit generator. A seeded run's
// `random.randint` (capabilities/services.ts) and the robot world's noise and variants (world/rng.ts) both
// draw from it. Integer operations only (`+`, `^`, `>>>`, `Math.imul`), so every engine gives the same
// numbers. Fine for dice, games and simulation noise; not for anything that must be unpredictable.

/** A stream of unsigned 32-bit integers from `seed`, read as an unsigned 32-bit integer (`seed >>> 0`). */
export function createMulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };
}
