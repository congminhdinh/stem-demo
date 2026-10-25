import { describe, expect, it } from 'vitest';
import { formatNumber } from './format';

// N18 R4.4: numbers in the learner's language: a decimal comma in Vietnamese (0,5×, 3,2 s), a point in English.

describe('formatNumber (N18 R4.4)', () => {
  it('writes a decimal comma in Vietnamese and a point in English, with the digits asked for', () => {
    expect(formatNumber(0.5, 'vi')).toBe('0,5');
    expect(formatNumber(0.5, 'en')).toBe('0.5');
    expect(formatNumber(3, 'vi', 1)).toBe('3,0');
    expect(formatNumber(12.34, 'en', 1)).toBe('12.3');
    expect(formatNumber(15, 'vi')).toBe('15');
    expect(formatNumber(120, 'vi')).toBe('120');
  });
});
