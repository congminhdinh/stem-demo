import { describe, expect, it } from 'vitest';
import { assertTickS } from './tick';

describe('assertTickS', () => {
  it.each([0, 1 / 120, 0.25, 3600])('takes %f s', (dtS) => {
    expect(() => assertTickS(dtS)).not.toThrow();
  });

  it.each([-1e-12, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])('refuses %f s with a RangeError that names it', (dtS) => {
    expect(() => assertTickS(dtS)).toThrow(RangeError);
    expect(() => assertTickS(dtS)).toThrow(`not ${dtS}`);
  });
});
