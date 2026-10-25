import { describe, expect, it } from 'vitest';
import { composite, contrastRatio, parseColor, relativeLuminance } from './contrast';

// N18 R8: WCAG 2.2 contrast arithmetic (success criteria 1.4.3 and 1.4.11), for the robot lab's colour audit. Exact published values.

describe('parseColor', () => {
  it('reads #rgb, #rrggbb, #rrggbbaa, rgb() and rgba() as r, g, b in 0..255 and a in 0..1', () => {
    expect(parseColor('#fff')).toEqual([255, 255, 255, 1]);
    expect(parseColor('#4f46e5')).toEqual([79, 70, 229, 1]);
    expect(parseColor('#4F46E5')).toEqual([79, 70, 229, 1]);
    expect(parseColor('#00000080')).toEqual([0, 0, 0, 128 / 255]);
    expect(parseColor('rgb(15, 23, 42)')).toEqual([15, 23, 42, 1]);
    expect(parseColor('rgba(255, 255, 255, 0.95)')).toEqual([255, 255, 255, 0.95]);
    expect(parseColor('rgba(32 33 36 / 0.86)')).toEqual([32, 33, 36, 0.86]);
  });

  it('refuses what it cannot read instead of guessing a colour', () => {
    expect(() => parseColor('var(--stem-color-text)')).toThrow(RangeError);
    expect(() => parseColor('red')).toThrow(RangeError);
    expect(() => parseColor('#12')).toThrow(RangeError);
  });
});

describe('relativeLuminance', () => {
  it('is 0 for black and 1 for white, and follows the sRGB curve in between', () => {
    expect(relativeLuminance(parseColor('#000000'))).toBe(0);
    expect(relativeLuminance(parseColor('#ffffff'))).toBeCloseTo(1, 12);
    // WCAG's own example: #767676 is the lightest grey with 4.5:1 on white.
    expect(relativeLuminance(parseColor('#767676'))).toBeCloseTo(0.1812, 4);
    // Below the curve's knee (0.03928) the sRGB value is divided by 12.92.
    expect(relativeLuminance([10, 10, 10, 1])).toBeCloseTo(10 / 255 / 12.92, 12);
  });
});

describe('contrastRatio', () => {
  it('is 21 for black on white, 1 for a colour on itself, and the same either way round', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 10);
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 10);
    expect(contrastRatio('#4f46e5', '#4f46e5')).toBe(1);
  });

  it('matches the published ratios the AA line is drawn through', () => {
    expect(contrastRatio('#767676', '#ffffff')).toBeCloseTo(4.54, 2);
    expect(contrastRatio('#777777', '#ffffff')).toBeCloseTo(4.48, 2);
    expect(contrastRatio('#949494', '#ffffff')).toBeCloseTo(3.03, 2);
  });

  it('composites a translucent background over what is under it first, and refuses a translucent text colour', () => {
    // 95 % white over black is (242.25, 242.25, 242.25): the same ratio as that grey, opaque.
    const overlay = composite(parseColor('rgba(255, 255, 255, 0.95)'), parseColor('#000000'));
    expect(overlay).toEqual([242.25, 242.25, 242.25, 1]);
    expect(contrastRatio('#1e293b', overlay)).toBeCloseTo(contrastRatio('#1e293b', 'rgb(242.25, 242.25, 242.25)'), 10);
    // A translucent text colour has no ratio of its own: it depends on what is under it.
    expect(() => contrastRatio('rgba(30, 41, 59, 0.42)', '#ffffff')).toThrow(RangeError);
  });
});

describe('composite', () => {
  it('lays the top colour over the one under it by alpha', () => {
    expect(composite([0, 0, 0, 0.5], [255, 255, 255, 1])).toEqual([127.5, 127.5, 127.5, 1]);
    expect(composite([10, 20, 30, 1], [255, 255, 255, 1])).toEqual([10, 20, 30, 1]);
    expect(composite([10, 20, 30, 0], [200, 100, 50, 1])).toEqual([200, 100, 50, 1]);
  });

  it('needs something opaque under it', () => {
    expect(() => composite([0, 0, 0, 0.5], [255, 255, 255, 0.5])).toThrow(RangeError);
  });
});
