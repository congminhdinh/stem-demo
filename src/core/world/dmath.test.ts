import { describe, expect, it } from 'vitest';
import { atan2, cos, sin } from './dmath';
import { ATAN2_GOLDEN, SIN_COS_GOLDEN } from './dmath.golden';

const view = new DataView(new ArrayBuffer(8));

function fromBits(hex: string): number {
  view.setBigUint64(0, BigInt(`0x${hex}`));
  return view.getFloat64(0);
}

/** The bit pattern of a result, or "nan" for any NaN (NaN payloads differ between CPUs; fdlibm does not fix them). */
function bitsOf(value: number): string {
  if (Number.isNaN(value)) {
    return 'nan';
  }
  view.setFloat64(0, value);
  return view.getBigUint64(0).toString(16).padStart(16, '0');
}

describe('dmath matches bit-exact golden table', () => {
  it('sin', () => {
    const wrong = SIN_COS_GOLDEN.filter(([x, expected]) => bitsOf(sin(fromBits(x))) !== expected);
    expect(wrong).toEqual([]);
  });

  it('cos', () => {
    const wrong = SIN_COS_GOLDEN.filter(([x, , expected]) => bitsOf(cos(fromBits(x))) !== expected);
    expect(wrong).toEqual([]);
  });

  it('atan2', () => {
    const wrong = ATAN2_GOLDEN.filter(([y, x, expected]) => bitsOf(atan2(fromBits(y), fromBits(x))) !== expected);
    expect(wrong).toEqual([]);
  });

  it('covers every branch of the port with enough cases', () => {
    expect(SIN_COS_GOLDEN.length).toBeGreaterThan(450);
    expect(ATAN2_GOLDEN.length).toBeGreaterThan(400);
  });
});

describe('dmath edge cases', () => {
  it('keeps the sign of zero and returns NaN for infinities', () => {
    expect(Object.is(sin(-0), -0)).toBe(true);
    expect(cos(-0)).toBe(1);
    expect(sin(Infinity)).toBeNaN();
    expect(cos(-Infinity)).toBeNaN();
    expect(atan2(NaN, 1)).toBeNaN();
  });

  it('follows the IEEE quadrant rules of atan2', () => {
    expect(atan2(0, -1)).toBe(Math.PI);
    expect(atan2(-0, -1)).toBe(-Math.PI);
    expect(atan2(1, 0)).toBe(Math.PI / 2);
    expect(atan2(-Infinity, -Infinity)).toBe((-3 * Math.PI) / 4);
    expect(Object.is(atan2(-0, 1), -0)).toBe(true);
  });
});
