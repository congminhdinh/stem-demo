// Limits of a generated sketch (N18 C1): the same numbers as the MicroPython generator's (yolobit/limits.ts), well above what a lesson
// uses. avr-gcc has no nesting limit of its own this low; the compiler already stops at 100 nested blocks.

/** Statements nested inside statements. */
export const MAX_STATEMENT_DEPTH = 64;

/** Expressions nested inside expressions. */
export const MAX_EXPRESSION_DEPTH = 100;

/** The largest generated sketch, in UTF-8 bytes (plan §6.7, as the Python file). */
export const MAX_GENERATED_BYTES = 256 * 1024;
