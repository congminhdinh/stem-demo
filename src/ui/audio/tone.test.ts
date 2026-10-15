import { describe, expect, it } from 'vitest';
import { describeTone, formatHz, toneHz } from './tone';

describe('toneHz', () => {
  it('reads the frequency of a sounding buzzer', () => {
    expect(toneHz({ hz: 262 })).toBe(262);
  });

  it.each([
    ['no state (idle)', undefined],
    ['a state without a tone', {}],
    ['zero', { hz: 0 }],
    ['a negative frequency', { hz: -440 }],
    ['NaN', { hz: Number.NaN }],
    ['Infinity', { hz: Number.POSITIVE_INFINITY }],
    ['a string', { hz: '440' as unknown as number }],
  ])('is silence for %s', (_label, state) => {
    expect(toneHz(state)).toBeUndefined();
  });
});

describe('the words for a tone', () => {
  it('writes the frequency in Hz, rounded', () => {
    expect(formatHz(262)).toBe('262 Hz');
    expect(formatHz(261.63)).toBe('262 Hz');
  });

  it('says what is sounding, or that nothing is', () => {
    expect(describeTone(undefined)).toBe('Silent');
    expect(describeTone(440)).toBe('Playing 440 Hz');
  });
});
