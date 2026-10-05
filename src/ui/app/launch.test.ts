import { describe, expect, it } from 'vitest';
import { templateKeys } from '../../samples/templates';
import { parseLaunch } from './launch';

describe('parseLaunch (S1 launch contract)', () => {
  it.each(['', '?', '?lang=vi', '?embedded=1', '?Embed=1&Template=blink'])(
    'opens the standalone editor for %j: no embed, no template',
    (search) => {
      expect(parseLaunch(search)).toEqual({ mode: 'standalone' });
    },
  );

  it.each(templateKeys)('opens an embedded lab for ?embed=1&template=%s', (key) => {
    expect(parseLaunch(`?embed=1&template=${key}`)).toEqual({ mode: 'embed', template: key });
  });

  it('reads the parameters in any order, ignoring others', () => {
    expect(parseLaunch('?lang=vi&template=button-led&embed=1')).toEqual({ mode: 'embed', template: 'button-led' });
    expect(parseLaunch('embed=1&template=blink')).toEqual({ mode: 'embed', template: 'blink' });
  });

  it.each([
    ['blinky', '?embed=1&template=blinky'],
    ['Blink', '?embed=1&template=Blink'],
    [' blink', '?embed=1&template=%20blink'],
    ['sample-blink', '?embed=1&template=sample-blink'],
    ['constructor', '?embed=1&template=constructor'],
  ])('refuses the unknown template %j, naming it', (key, search) => {
    expect(parseLaunch(search)).toEqual({ mode: 'invalid', problem: `Unknown template "${key}".` });
  });

  it.each(['?embed=1', '?embed=1&template=', '?embed=1&template'])('refuses %j: the template is missing', (search) => {
    expect(parseLaunch(search)).toEqual({ mode: 'invalid', problem: 'No template was given: add template=<key>.' });
  });

  it.each([
    ['?template=blink', 'A template opens only in an embedded lab: add embed=1.'],
    ['?embed=true&template=blink', 'embed must be given once, as embed=1.'],
    ['?embed=0&template=blink', 'embed must be given once, as embed=1.'],
    ['?embed=0', 'embed must be given once, as embed=1.'],
    ['?embed=&template=blink', 'embed must be given once, as embed=1.'],
    ['?embed=1&embed=1&template=blink', 'embed must be given once, as embed=1.'],
    ['?embed=1&template=blink&template=led-on', 'template must be given once.'],
    ['?embed=1&template=blink&template=blink', 'template must be given once.'],
  ])('refuses the malformed launch %j', (search, problem) => {
    expect(parseLaunch(search)).toEqual({ mode: 'invalid', problem });
  });
});
