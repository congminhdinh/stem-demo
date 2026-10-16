import { describe, expect, it } from 'vitest';
import { parseLaunch } from '../app/launch';
import { localeOf } from './locale';

const of = (search: string) => localeOf(parseLaunch(search), search);

describe('localeOf (N6a S5)', () => {
  it.each(['', '?embed=1&template=blink', '?embed=1&template=blinky', '?template=blink'])('keeps %j in English', (search) => {
    expect(of(search)).toBe('en');
  });

  it.each(['?embed=1&lab=blockly&template=blink', '?embed=1&lab=yolobit&template=ybc-heart&origin=http://localhost:3000', '?embed=1&lab=yolobit&template=blink'])(
    'speaks Vietnamese in the lab launch %j, a broken one too',
    (search) => {
      expect(of(search)).toBe('vi');
    },
  );

  it('follows lang=vi or lang=en whatever the launch', () => {
    expect(of('?lang=vi')).toBe('vi');
    expect(of('?embed=1&template=blink&lang=vi')).toBe('vi');
    expect(of('?embed=1&lab=blockly&template=blink&lang=en')).toBe('en');
    expect(of('?embed=1&lab=blockly&template=blink&lang=fr')).toBe('vi');
  });
});
