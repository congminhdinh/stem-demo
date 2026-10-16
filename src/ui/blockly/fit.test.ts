import { describe, expect, it } from 'vitest';
import { fittedScale, minFitScale } from './fit';

describe('fittedScale (N8s)', () => {
  it('keeps the scale of a program that fits', () => {
    expect(fittedScale(1, { width: 300, height: 200 }, { width: 500, height: 400 })).toBe(1);
  });

  it('shrinks a program that is wider than the view, leaving a margin', () => {
    expect(fittedScale(1, { width: 468, height: 100 }, { width: 400, height: 400 })).toBeCloseTo(368 / 468);
  });

  it('never goes below the smallest readable scale', () => {
    expect(fittedScale(1, { width: 5000, height: 100 }, { width: 400, height: 400 })).toBe(minFitScale);
  });

  it('never enlarges, and leaves an empty workspace as it is', () => {
    expect(fittedScale(0.8, { width: 10, height: 10 }, { width: 400, height: 400 })).toBe(0.8);
    expect(fittedScale(1, { width: 0, height: 0 }, { width: 400, height: 400 })).toBe(1);
  });
});
