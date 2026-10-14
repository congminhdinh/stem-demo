import { describe, expect, it } from 'vitest';
import { MAX_SAFE_INT, MAX_TEXT_CHARS } from './limits';
import { RuntimeFault, add, asBool, bool, compare, floorDivide, int, multiply, not, remainder, str, subtract, toText } from './values';

// The value operations of the YBC dialect (plan §6.4): Python's semantics on the
// supported domain, never JavaScript's.

const n = (value: ReturnType<typeof int>) => value.v;
const fault = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    return error instanceof RuntimeFault ? error.code : 'other';
  }
  return 'none';
};

describe('floor division (Python //)', () => {
  // Python: 7 // 2 = 3, -7 // 2 = -4, 7 // -2 = -4, -7 // -2 = 3
  it.each([
    [7, 2, 3],
    [-7, 2, -4],
    [7, -2, -4],
    [-7, -2, 3],
    [6, 3, 2],
    [-6, 3, -2],
    [6, -3, -2],
    [0, 5, 0],
    [0, -5, 0],
    [1, 2, 0],
    [-1, 2, -1],
    [1, -2, -1],
    [-1, -2, 0],
  ])('%d // %d = %d', (a, b, expected) => {
    expect(n(floorDivide(int(a), int(b)))).toBe(expected);
  });

  it('is exact at the top of the safe range, where a double division would round', () => {
    expect(n(floorDivide(int(MAX_SAFE_INT), int(3)))).toBe(3002399751580330);
    expect(n(floorDivide(int(-MAX_SAFE_INT), int(2)))).toBe(-4503599627370496);
    expect(n(floorDivide(int(MAX_SAFE_INT), int(1)))).toBe(MAX_SAFE_INT);
    expect(n(floorDivide(int(-MAX_SAFE_INT), int(-1)))).toBe(MAX_SAFE_INT);
  });

  it('never returns -0', () => {
    expect(Object.is(n(floorDivide(int(0), int(-3))), 0)).toBe(true);
  });

  it('stops on division by zero', () => {
    expect(fault(() => floorDivide(int(1), int(0)))).toBe('zero-division');
    expect(fault(() => floorDivide(int(0), int(0)))).toBe('zero-division');
  });
});

describe('remainder (Python %)', () => {
  // Python: 7 % 3 = 1, -7 % 3 = 2, 7 % -3 = -2, -7 % -3 = -1
  it.each([
    [7, 3, 1],
    [-7, 3, 2],
    [7, -3, -2],
    [-7, -3, -1],
    [6, 3, 0],
    [-6, 3, 0],
    [6, -3, 0],
    [0, 3, 0],
    [2, 5, 2],
    [-2, 5, 3],
    [2, -5, -3],
  ])('%d %% %d = %d', (a, b, expected) => {
    expect(n(remainder(int(a), int(b)))).toBe(expected);
  });

  it('is consistent with //: a == (a // b) * b + a % b', () => {
    for (const a of [-13, -7, -1, 0, 1, 7, 13, MAX_SAFE_INT, -MAX_SAFE_INT]) {
      for (const b of [-5, -3, -2, -1, 1, 2, 3, 5]) {
        const q = n(floorDivide(int(a), int(b)));
        const r = n(remainder(int(a), int(b)));
        expect(BigInt(q) * BigInt(b) + BigInt(r)).toBe(BigInt(a));
      }
    }
  });

  it('stops on a remainder by zero, and never returns -0', () => {
    expect(fault(() => remainder(int(5), int(0)))).toBe('zero-division');
    expect(Object.is(n(remainder(int(-6), int(3))), 0)).toBe(true);
  });
});

describe('the safe-integer domain', () => {
  it('adds, subtracts and multiplies inside the range', () => {
    expect(n(add(int(MAX_SAFE_INT - 1), int(1)))).toBe(MAX_SAFE_INT);
    expect(n(subtract(int(-MAX_SAFE_INT + 1), int(1)))).toBe(-MAX_SAFE_INT);
    expect(n(multiply(int(94906265), int(94906265)))).toBe(9007199136250225);
  });

  it('refuses a result outside the range: 2^53 − 1 + 1', () => {
    expect(fault(() => add(int(MAX_SAFE_INT), int(1)))).toBe('out-of-domain');
    expect(fault(() => add(int(-MAX_SAFE_INT), int(-1)))).toBe('out-of-domain');
  });

  it('refuses subtraction overflow', () => {
    expect(fault(() => subtract(int(-MAX_SAFE_INT), int(1)))).toBe('out-of-domain');
    expect(fault(() => subtract(int(MAX_SAFE_INT), int(-1)))).toBe('out-of-domain');
  });

  it('refuses multiplication overflow', () => {
    expect(fault(() => multiply(int(94906266), int(94906266)))).toBe('out-of-domain'); // 9007199326062756 > 2^53 − 1
    expect(fault(() => multiply(int(MAX_SAFE_INT), int(2)))).toBe('out-of-domain');
    expect(fault(() => multiply(int(MAX_SAFE_INT), int(-2)))).toBe('out-of-domain');
    expect(fault(() => multiply(int(MAX_SAFE_INT), int(MAX_SAFE_INT)))).toBe('out-of-domain');
    expect(n(multiply(int(MAX_SAFE_INT), int(1)))).toBe(MAX_SAFE_INT);
    expect(n(multiply(int(MAX_SAFE_INT), int(-1)))).toBe(-MAX_SAFE_INT);
  });

  it('never produces -0', () => {
    expect(Object.is(n(multiply(int(0), int(-5))), 0)).toBe(true);
    expect(Object.is(n(subtract(int(0), int(0))), 0)).toBe(true);
  });

  it('is not 32-bit: general arithmetic keeps the full safe-integer range', () => {
    expect(n(add(int(2 ** 31), int(2 ** 31)))).toBe(2 ** 32);
    expect(n(multiply(int(2 ** 31), int(2 ** 20)))).toBe(2 ** 51);
  });

  it('refuses a wrong operand type as a bug, not a domain case', () => {
    expect(fault(() => add(int(1), bool(true)))).toBe('internal-error');
    expect(fault(() => asBool(int(1)))).toBe('internal-error');
  });
});

describe('comparison', () => {
  it('orders ints', () => {
    expect(compare('<', int(1), int(2))).toEqual(bool(true));
    expect(compare('<=', int(2), int(2))).toEqual(bool(true));
    expect(compare('>', int(2), int(2))).toEqual(bool(false));
    expect(compare('>=', int(-1), int(-2))).toEqual(bool(true));
    expect(compare('==', int(0), int(0))).toEqual(bool(true));
    expect(compare('!=', int(0), int(1))).toEqual(bool(true));
  });

  it('compares bools and texts for equality only, and never across types', () => {
    expect(compare('==', bool(true), bool(true))).toEqual(bool(true));
    expect(compare('!=', str('a'), str('b'))).toEqual(bool(true));
    expect(fault(() => compare('==', int(1), str('1')))).toBe('internal-error');
    expect(fault(() => compare('==', bool(true), int(1)))).toBe('internal-error');
    expect(fault(() => compare('<', str('a'), str('b')))).toBe('internal-error');
  });

  it('negates only a bool', () => {
    expect(not(bool(false))).toEqual(bool(true));
    expect(fault(() => not(int(0)))).toBe('internal-error');
  });
});

describe('str(value)', () => {
  it('writes ints in decimal, bools as True / False, texts as they are', () => {
    expect(toText(int(-42))).toBe('-42');
    expect(toText(int(MAX_SAFE_INT))).toBe('9007199254740991');
    expect(toText(bool(true))).toBe('True');
    expect(toText(bool(false))).toBe('False');
    expect(toText(str('héllo'))).toBe('héllo');
  });

  it('refuses a text longer than the limit', () => {
    expect(toText(str('a'.repeat(MAX_TEXT_CHARS))).length).toBe(MAX_TEXT_CHARS);
    expect(fault(() => toText(str('a'.repeat(MAX_TEXT_CHARS + 1))))).toBe('limit-exceeded');
  });
});
