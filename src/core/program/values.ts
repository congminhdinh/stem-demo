import { MAX_SAFE_INT, MAX_TEXT_CHARS } from './limits';
import type { CompareOp } from './ybc-ir';

// The runtime values of the YBC dialect and every operation on them (YB plan §6.4,
// §9.3). Learner values are int, bool and str, nothing else, and each operation is
// Python's, not JavaScript's: `//` floors, `%` takes the sign of the divisor, an
// int never leaves the safe range, and nothing is coerced. Pure: no Blockly, no UI.

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
