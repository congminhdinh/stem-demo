// Resource limits of the YBC dialect (YB plan §6.7): named constants, each with
// a reason, each checked before the expensive work, each reported to the learner
// as a diagnostic. This file holds the ones YB-2a owns; the loop and scheduling
// limits (EXEC_SLICE_MS, MAX_REPEAT_ABS, MAX_RANGE_VALUE, MAX_TEXT_JOIN_PARTS…)
// arrive with YB-2b.

import type { NumericModel } from './ybc-ir';

/** 2^53 − 1: the JavaScript interpreter is exact only inside this range (plan §6.4). */
export const MAX_SAFE_INT = Number.MAX_SAFE_INTEGER;

/** Lessons use < 200 characters; bounds text growth and keeps the board's heap safe. */
export const MAX_TEXT_CHARS = 1000;

/** A single print cannot be longer than a single text. */
export const MAX_CONSOLE_LINE_CHARS = MAX_TEXT_CHARS;

/** Presentation only: the console keeps the newest lines, so the UI stays responsive. */
export const MAX_CONSOLE_ENTRIES = 500;
export const MAX_CONSOLE_BYTES = 256 * 1024;

/** Lessons use < 200 blocks. */
export const MAX_PROGRAM_BLOCKS = 2000;

// --- YB-2b: loops, wait and the execution budget ---------------------------------------------------

/** The domain of `wait` (plan §6.4): a limit of the domain, not of the board. */
export const MAX_WAIT_MS = 60_000;

/** Range arguments must fit a machine word (contract §3.2); every intermediate stays below 2^21. */
export const MAX_RANGE_VALUE = 1_000_000;
export const MAX_REPEAT_ABS = 1_000_000;

/**
 * N17 B4, contract §3.5 (C-40): the ends of a random number are each within ±MAX_RANDOM_ABS and at most MAX_RANDOM_SPAN apart,
 * so the width of the range stays below 2^21, inside the 32 bits getrandbits gives at a time (DOC-M3).
 */
export const MAX_RANDOM_ABS = 1_000_000;
export const MAX_RANDOM_SPAN = 1_000_000;

/** Text parts one `join` takes; matches the preflight of the join mutator. */
export const MAX_TEXT_JOIN_PARTS = 50;

/** Work between two yields to the browser: keeps a 16 ms frame for the UI. */
export const EXEC_SLICE_MS = 8;

/** Steps between two looks at the clock, so the clock is not read on every operation. */
export const STEP_CHECK_INTERVAL = 256;

/** Blocks the preflight counts before it stops looking: one more than the limit is enough to refuse. */
export const PREFLIGHT_BLOCK_COUNT = MAX_PROGRAM_BLOCKS + 1;

// --- N18 R2.3: the cxx-int32 model of the UNO family (contract UNO §3) -------------------------------

/** A C++ `long` on the ATmega328P: 32 bits (contract UNO §3.1, ARD-09). Every value of a cxx-int32 program is in this range. */
export const INT32_MIN = -2_147_483_648;
export const INT32_MAX = 2_147_483_647;

/** Contract UNO §3.3: the end of a count up, so that the generated `_c += 1L` never overflows past INT32_MAX. */
export const INT32_COUNT_UP_MAX_END = INT32_MAX - 1;

/** N18 R2.3: an inclusive range of whole numbers. */
export type IntRange = readonly [low: number, high: number];

/**
 * N18 R2.3: the domains a numeric model gives the language (a typed-in value is checked by the compiler, a computed one by the
 * interpreter, with the same numbers). `python`: the YB-2 limits above, unchanged. `cxx-int32` (contract UNO §3.1, §3.3, §3.4): a
 * literal is a `long`, `repeat` takes any `long` (`_r < _n` never overflows), a count up starts anywhere, ends at
 * INT32_COUNT_UP_MAX_END at most, and counts by 1 (`_c += 1L`).
 */
export type NumericDomains = { literal: IntRange; repeat: IntRange; countUpFrom: IntRange; countUpTo: IntRange; countUpStep: IntRange };

export const numericDomains: Readonly<Record<NumericModel, NumericDomains>> = {
  python: {
    literal: [-MAX_SAFE_INT, MAX_SAFE_INT],
    repeat: [-MAX_REPEAT_ABS, MAX_REPEAT_ABS],
    countUpFrom: [0, MAX_RANGE_VALUE],
    countUpTo: [0, MAX_RANGE_VALUE],
    countUpStep: [1, MAX_RANGE_VALUE],
  },
  'cxx-int32': {
    literal: [INT32_MIN, INT32_MAX],
    repeat: [INT32_MIN, INT32_MAX],
    countUpFrom: [INT32_MIN, INT32_MAX],
    countUpTo: [INT32_MIN, INT32_COUNT_UP_MAX_END],
    countUpStep: [1, 1],
  },
};
