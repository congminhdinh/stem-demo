import { describe, expect, it } from 'vitest';
import { unoContract } from '../compat/uno-contract';
import { INT32_MAX, INT32_MIN, MAX_SAFE_INT } from './limits';
import {
  RuntimeFault, add, bool, floorDivide, int, multiply, remainder, str, subtract, toText, valuesFor, type Value,
} from './values';

// N18 R2.3: the numeric models of the IR (robot plan §4.4). `python` is the Yolo:Bit dialect of values.ts, untouched; `cxx-int32` is
// the C++ `long` of the UNO family (contract UNO §3.1), pinned here to the machine-readable contract (test-only data).

const cxx = valuesFor('cxx-int32');
const n = (value: Value) => {
  if (value.t !== 'int') {
    throw new Error(`not an int: ${value.t}`);
  }
  return value.v;
};
const fault = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    return error instanceof RuntimeFault ? error.code : 'other';
  }
  return 'none';
};

describe('cxx-int32 (contract UNO §3.1)', () => {
  it('cxx-int32: 2147483647+1 wraps to -2147483648', () => {
    expect(n(cxx.add(int(2147483647), int(1)))).toBe(-2147483648);
    expect(n(cxx.add(int(-2147483648), int(-1)))).toBe(2147483647);
    expect(n(cxx.subtract(int(-2147483648), int(1)))).toBe(2147483647);
    expect(n(cxx.subtract(int(0), int(-2147483648)))).toBe(-2147483648);
    expect([INT32_MIN, INT32_MAX]).toEqual([unoContract.numeric.min, unoContract.numeric.max]);
  });

  it('-7/2 = -3, -7%2 = -1', () => {
    expect(n(cxx.divide(int(-7), int(2)))).toBe(-3);
    expect(n(cxx.remainder(int(-7), int(2)))).toBe(-1);
  });

  it.each([
    [7, 2, 3, 1],
    [-7, 2, -3, -1],
    [7, -2, -3, 1],
    [-7, -2, 3, -1],
    [6, 3, 2, 0],
    [1, 2, 0, 1],
    [-1, 2, 0, -1],
    [2147483647, 2, 1073741823, 1],
    [-2147483648, 2, -1073741824, 0],
    [-2147483648, 3, -715827882, -2],
  ])('%d / %d = %d and %d %% %d = %d: truncated, the remainder with the sign of the dividend', (a, b, quotient, rest) => {
    expect(n(cxx.divide(int(a), int(b)))).toBe(quotient);
    expect(n(cxx.remainder(int(a), int(b)))).toBe(rest);
  });

  it('multiplies with Math.imul: the low 32 bits, where (a * b) | 0 would lose them beyond 2^53', () => {
    expect(n(cxx.multiply(int(2147483647), int(2147483647)))).toBe(1);
    expect((2147483647 * 2147483647) | 0).toBe(0);
    expect(n(cxx.multiply(int(300), int(200)))).toBe(60000);
    expect(n(cxx.multiply(int(65536), int(65536)))).toBe(0);
    expect(n(cxx.multiply(int(46341), int(46341)))).toBe(-2147479015);
    expect(n(cxx.multiply(int(-2147483648), int(-1)))).toBe(-2147483648);
  });

  it('INT32_MIN / -1 is INT32_MIN, x % -1 is 0 (INT32_MIN % -1 too), as the contract decides', () => {
    expect(n(cxx.divide(int(INT32_MIN), int(-1)))).toBe(unoContract.numeric.int32MinDividedByMinusOne);
    expect(n(cxx.divide(int(INT32_MIN), int(-1)))).toBe(-2147483648);
    expect(n(cxx.divide(int(INT32_MAX), int(-1)))).toBe(-2147483647);
    expect(n(cxx.divide(int(5), int(-1)))).toBe(-5);
    for (const a of [INT32_MIN, -5, 0, 7, INT32_MAX]) {
      expect(Object.is(n(cxx.remainder(int(a), int(-1))), unoContract.numeric.remainderByMinusOne)).toBe(true);
    }
  });

  it('gives 0 for a division or a remainder by zero and tells the hook each time (the run warns once)', () => {
    let told = 0;
    const counted = valuesFor('cxx-int32', { divisionByZero: () => void told++ });
    expect(n(counted.divide(int(7), int(0)))).toBe(unoContract.numeric.divisionByZero.quotient);
    expect(n(counted.divide(int(INT32_MIN), int(0)))).toBe(0);
    expect(n(counted.remainder(int(-7), int(0)))).toBe(unoContract.numeric.divisionByZero.remainder);
    expect(told).toBe(3);
    expect(n(cxx.divide(int(1), int(0)))).toBe(0);
  });

  it('never returns -0', () => {
    for (const value of [
      cxx.divide(int(-1), int(2)),
      cxx.divide(int(0), int(-3)),
      cxx.remainder(int(-4), int(2)),
      cxx.remainder(int(-6), int(-1)),
      cxx.remainder(int(-6), int(0)),
      cxx.multiply(int(0), int(-5)),
      cxx.subtract(int(0), int(0)),
      cxx.add(int(-2147483648), int(-2147483648)),
    ]) {
      expect(Object.is(n(value), 0)).toBe(true);
    }
  });

  it('keeps a == (a / b) * b + a % b on int32, with wrap', () => {
    for (const a of [INT32_MIN, -13, -7, -1, 0, 1, 7, 13, INT32_MAX]) {
      for (const b of [INT32_MIN, -5, -2, -1, 1, 2, 5, INT32_MAX]) {
        const q = cxx.divide(int(a), int(b));
        expect(n(cxx.add(cxx.multiply(q, int(b)), cxx.remainder(int(a), int(b))))).toBe(a);
      }
    }
  });

  it('prints a truth value 1 / 0 (Print has no bool overload) and a number in decimal', () => {
    expect(cxx.toText(bool(true))).toBe(unoContract.numeric.boolPrints.true);
    expect(cxx.toText(bool(false))).toBe(unoContract.numeric.boolPrints.false);
    expect([cxx.toText(int(-2147483648)), cxx.toText(int(42)), cxx.toText(str('Xin chào'))]).toEqual(['-2147483648', '42', 'Xin chào']);
  });

  it('is the model the contract names, with the same rules', () => {
    expect(cxx.model).toBe(unoContract.numeric.model);
    expect(unoContract.numeric).toMatchObject({ overflow: 'wrap', division: 'truncate-toward-zero', remainder: 'sign-of-dividend' });
  });
});

describe('python (the Yolo:Bit dialect)', () => {
  it('python semantics unchanged (existing fixtures)', () => {
    const python = valuesFor('python');
    // The very operations of values.ts, so every fixture of values.test.ts is a fixture of the python model.
    expect(python).toMatchObject({ model: 'python', add, subtract, multiply, divide: floorDivide, remainder, toText });
    // A sample of those fixtures, through the model.
    expect([[-7, 2], [7, -2], [-1, 2]].map(([a, b]) => n(python.divide(int(a ?? 0), int(b ?? 0))))).toEqual([-4, -4, -1]);
    expect([[-7, 3], [7, -3], [-2, 5]].map(([a, b]) => n(python.remainder(int(a ?? 0), int(b ?? 0))))).toEqual([2, -2, 3]);
    expect(n(python.add(int(2147483647), int(1)))).toBe(2147483648);
    expect(fault(() => python.multiply(int(2147483647), int(2147483647)))).toBe('out-of-domain');
    expect(fault(() => python.add(int(MAX_SAFE_INT), int(1)))).toBe('out-of-domain');
    expect(fault(() => python.divide(int(1), int(0)))).toBe('zero-division');
    expect(fault(() => python.remainder(int(1), int(0)))).toBe('zero-division');
    expect([python.toText(bool(true)), python.toText(bool(false))]).toEqual(['True', 'False']);
  });

  it('ignores the division-by-zero hook: Python stops on it, as before', () => {
    let told = 0;
    const python = valuesFor('python', { divisionByZero: () => void told++ });
    expect(fault(() => python.divide(int(1), int(0)))).toBe('zero-division');
    expect(told).toBe(0);
  });
});
