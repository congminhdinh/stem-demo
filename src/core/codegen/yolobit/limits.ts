// Limits of the generated source: well above what a lesson uses, and below the
// nesting limits of the Python parsers that have to read it (CPython allows 100
// indentation levels and 200 nested parentheses).

/** Statements nested inside statements. */
export const MAX_STATEMENT_DEPTH = 64;

/** Expressions nested inside expressions; the compiler already stops at 100 nested blocks. */
export const MAX_EXPRESSION_DEPTH = 100;

/** Plan §6.7: the largest generated file, in UTF-8 bytes (it matches the program limits above). */
export const MAX_GENERATED_BYTES = 256 * 1024;
