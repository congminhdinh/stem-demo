import { MAX_SAFE_INT, MAX_TEXT_CHARS } from './limits';
import type { CompareOp, NumericModel } from './ybc-ir';

// The runtime values of the YBC dialect and every operation on them (YB plan §6.4,
// §9.3). Learner values are int, bool and str, nothing else, and each operation is
// Python's, not JavaScript's: `//` floors, `%` takes the sign of the divisor, an
// int never leaves the safe range, and nothing is coerced. Pure: no Blockly, no UI.
//
// N18 R2.3: `valuesFor(numeric)` gives the operations of a numeric model. `python` is
// this file's own, untouched; `cxx-int32` is the C++ `long` of the UNO family
// (contract UNO §3.1), which only changes + − × // % and how a value prints.

export type Value = { t: 'int'; v: number } | { t: 'bool'; v: boolean } | { t: 'str'; v: string };
export type ValueType = Value['t'];

/** A deterministic runtime fault of the program, reported with the block that caused it. */
export class RuntimeFault extends Error {
  constructor(
    readonly code: 'out-of-domain' | 'zero-division' | 'limit-exceeded' | 'internal-error',
    message: string,
  ) {
    super(message);
  }
}

export const int = (v: number): Value => ({ t: 'int', v });
export const bool = (v: boolean): Value => ({ t: 'bool', v });
export const str = (v: string): Value => ({ t: 'str', v });

/** A safe integer, normalised so that -0 never exists; anything else is out of the domain. */
export function checkedInt(n: number, what: string): Value {
  if (!Number.isSafeInteger(n)) {
    throw new RuntimeFault('out-of-domain', `${what} is outside the supported integer range (±${MAX_SAFE_INT}).`);
  }
  return int(n === 0 ? 0 : n);
}

export function asInt(value: Value): number {
  if (value.t !== 'int') {
    throw new RuntimeFault('internal-error', `Expected an int, got ${value.t}.`);
  }
  return value.v;
}

function asBool(value: Value): boolean {
  if (value.t !== 'bool') {
    throw new RuntimeFault('internal-error', `Expected a bool, got ${value.t}.`);
  }
  return value.v;
}

// Two safe integers add, subtract and multiply exactly whenever the true result is
// itself safe, and any true result outside the safe range rounds to a value outside
// it, so checking the double is exact.
export const add = (a: Value, b: Value) => checkedInt(asInt(a) + asInt(b), 'The sum');
export const subtract = (a: Value, b: Value) => checkedInt(asInt(a) - asInt(b), 'The difference');
export const multiply = (a: Value, b: Value) => checkedInt(asInt(a) * asInt(b), 'The product');

/** Python `a // b`: rounds towards negative infinity (-7 // 2 == -4). Exact, through BigInt. */
export function floorDivide(a: Value, b: Value): Value {
  const x = BigInt(asInt(a));
  const y = BigInt(asInt(b));
  if (y === 0n) {
    throw new RuntimeFault('zero-division', 'Division by zero.');
  }
  let quotient = x / y;
  if (x % y !== 0n && x < 0n !== y < 0n) {
    quotient -= 1n;
  }
  return checkedInt(Number(quotient), 'The quotient');
}

/** Python `a % b`: the result has the sign of the divisor (-7 % 3 == 2). */
export function remainder(a: Value, b: Value): Value {
  const x = BigInt(asInt(a));
  const y = BigInt(asInt(b));
  if (y === 0n) {
    throw new RuntimeFault('zero-division', 'Division by zero.');
  }
  let result = x % y;
  if (result !== 0n && result < 0n !== y < 0n) {
    result += y;
  }
  return checkedInt(Number(result), 'The remainder');
}

/** Equality between two values of one type; ordering between ints. Types are checked at compile time, so a mismatch here is a bug. */
export function compare(op: CompareOp, a: Value, b: Value): Value {
  if (op === '==' || op === '!=') {
    if (a.t !== b.t) {
      throw new RuntimeFault('internal-error', `Cannot compare ${a.t} with ${b.t}.`);
    }
    return bool((a.v === b.v) === (op === '=='));
  }
  const x = asInt(a);
  const y = asInt(b);
  switch (op) {
    case '<':
      return bool(x < y);
    case '<=':
      return bool(x <= y);
    case '>':
      return bool(x > y);
    case '>=':
      return bool(x >= y);
  }
}

export const not = (a: Value) => bool(!asBool(a));
export { asBool };

/** Python `str(value)`: decimal for an int, True / False for a bool, a str as it is. */
export function toText(value: Value): string {
  const text = value.t === 'bool' ? (value.v ? 'True' : 'False') : String(value.v);
  if (text.length > MAX_TEXT_CHARS) {
    throw new RuntimeFault('limit-exceeded', `A text is limited to ${MAX_TEXT_CHARS} characters.`);
  }
  return text;
}

/**
 * N18 R2.3: the operations that depend on the numeric model of the program (ybc-ir.ts `NumericModel`). Everything else (the
 * comparisons, not, and the types) is the same in both models.
 */
export type NumericValues = {
  readonly model: NumericModel;
  add(a: Value, b: Value): Value;
  subtract(a: Value, b: Value): Value;
  multiply(a: Value, b: Value): Value;
  /** The IR's `//`: Python's floor division, or C++'s division truncated toward zero. */
  divide(a: Value, b: Value): Value;
  /** The IR's `%`: with the sign of the divisor (Python) or of the dividend (C++). */
  remainder(a: Value, b: Value): Value;
  /** What print and join make of a value: a truth value is True / False in Python, 1 / 0 in C++. */
  toText(value: Value): string;
};

const pythonValues: NumericValues = { model: 'python', add, subtract, multiply, divide: floorDivide, remainder, toText };

/** A 32-bit result as the board has it: `| 0` keeps the low 32 bits, two's complement, and never gives -0. */
const int32 = (n: number): Value => int(n | 0);

/**
 * The operations of `numeric`. `python` is this file's (a division by zero is a `zero-division` fault, so the hook is never
 * called). `cxx-int32` (contract UNO §3.1): + and − wrap through `| 0`, × through `Math.imul` (`(a * b) | 0` loses the low bits once
 * the product passes 2^53), `//` truncates (`Math.trunc` of two int32 is exact), `%` keeps JavaScript's sign of the dividend,
 * `INT32_MIN // -1` is INT32_MIN, `x % -1` is 0, a division or a remainder by zero gives 0 and calls `hooks.divisionByZero` (the run
 * warns), and a truth value prints 1 / 0. The values are the interpreter's, already int32, so no result ever leaves the range.
 */
export function valuesFor(numeric: NumericModel, hooks: { divisionByZero?(): void } = {}): NumericValues {
  if (numeric === 'python') {
    return pythonValues;
  }
  const byZero = () => {
    hooks.divisionByZero?.();
    return int(0);
  };
  return {
    model: 'cxx-int32',
    add: (a, b) => int32(asInt(a) + asInt(b)),
    subtract: (a, b) => int32(asInt(a) - asInt(b)),
    multiply: (a, b) => int32(Math.imul(asInt(a), asInt(b))),
    divide(a, b) {
      const x = asInt(a);
      const y = asInt(b);
      if (y === 0) {
        return byZero();
      }
      return y === -1 ? int32(-x) : int32(Math.trunc(x / y));
    },
    remainder(a, b) {
      const x = asInt(a);
      const y = asInt(b);
      if (y === 0) {
        return byZero();
      }
      return y === -1 ? int(0) : int32(x % y);
    },
    toText(value) {
      return value.t === 'bool' ? (value.v ? '1' : '0') : toText(value);
    },
  };
}
