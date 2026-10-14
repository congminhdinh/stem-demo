// Resource limits of the YBC dialect (YB plan §6.7): named constants, each with
// a reason, each checked before the expensive work, each reported to the learner
// as a diagnostic. This file holds the ones YB-2a owns; the loop and scheduling
// limits (EXEC_SLICE_MS, MAX_REPEAT_ABS, MAX_RANGE_VALUE, MAX_TEXT_JOIN_PARTS…)
// arrive with YB-2b.

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

/** Text parts one `join` takes; matches the preflight of the join mutator. */
export const MAX_TEXT_JOIN_PARTS = 50;

/** Work between two yields to the browser: keeps a 16 ms frame for the UI. */
export const EXEC_SLICE_MS = 8;

/** Steps between two looks at the clock, so the clock is not read on every operation. */
export const STEP_CHECK_INTERVAL = 256;

/** Blocks the preflight counts before it stops looking: one more than the limit is enough to refuse. */
export const PREFLIGHT_BLOCK_COUNT = MAX_PROGRAM_BLOCKS + 1;
