import { describe, expect, it } from 'vitest';
import { templateKeys, templateKeysOf } from '../../samples/templates';
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

describe('parseLaunch: lab, profile and origin (N6a S0)', () => {
  const host = 'http://localhost:3000';
  const lab = (kind: 'blockly' | 'yolobit', profile: string | null = null, hostOrigin: string | null = host) => ({ kind, profile, hostOrigin });

  it.each(templateKeysOf('blockly'))('opens the Blockly lab of %s', (key) => {
    expect(parseLaunch(`?embed=1&lab=blockly&template=${key}&origin=${host}`)).toEqual({ mode: 'embed', template: key, lab: lab('blockly') });
  });

  it.each(templateKeysOf('yolobit'))('opens the Yolo:Bit lab of %s, with or without a profile', (key) => {
    expect(parseLaunch(`?embed=1&lab=yolobit&template=${key}&origin=${host}`)).toEqual({ mode: 'embed', template: key, lab: lab('yolobit') });
    expect(parseLaunch(`?embed=1&lab=yolobit&template=${key}&origin=${host}&profile=ybc-advanced`)).toEqual({
      mode: 'embed',
      template: key,
      lab: lab('yolobit', 'ybc-advanced'),
    });
  });

  it('reads the URL the learn app builds (lab-launch.ts), percent-encoded origin included', () => {
    expect(parseLaunch('?embed=1&lab=yolobit&template=ybc-heart&origin=http%3A%2F%2Flocalhost%3A3000&profile=ybc-basic')).toEqual({
      mode: 'embed',
      template: 'ybc-heart',
      lab: lab('yolobit', 'ybc-basic'),
    });
  });

  it('opens a lab without origin: it works but has no host to talk to', () => {
    expect(parseLaunch('?embed=1&lab=blockly&template=blink')).toEqual({ mode: 'embed', template: 'blink', lab: lab('blockly', null, null) });
  });

  it.each(['https://school.example', 'http://lesson.localhost:5190', 'http://127.0.0.1:8080', 'https://xn--trng-hoa.vn'])(
    'accepts the page origin %s',
    (origin) => {
      expect(parseLaunch(`?embed=1&lab=blockly&template=blink&origin=${encodeURIComponent(origin)}`)).toMatchObject({
        lab: { hostOrigin: origin },
      });
    },
  );

  it.each([
    ['*', 'origin "*" is not a page origin such as https://school.example.'],
    ['null', 'origin "null" is not a page origin such as https://school.example.'],
    ['', 'origin "" is not a page origin such as https://school.example.'],
    ['localhost:3000', 'origin "localhost:3000" is not a page origin such as https://school.example.'],
    ['http://localhost:3000/', 'origin "http://localhost:3000/" is not a page origin such as https://school.example.'],
    ['http://localhost:3000/lesson', 'origin "http://localhost:3000/lesson" is not a page origin such as https://school.example.'],
    ['https://school.example:443', 'origin "https://school.example:443" is not a page origin such as https://school.example.'],
    ['HTTP://LOCALHOST:3000', 'origin "HTTP://LOCALHOST:3000" is not a page origin such as https://school.example.'],
    ['javascript:alert(1)', 'origin "javascript:alert(1)" is not a page origin such as https://school.example.'],
    ['file:///tmp', 'origin "file:///tmp" is not a page origin such as https://school.example.'],
  ])('refuses the origin %j: the lab compares it to event.origin exactly', (origin, problem) => {
    expect(parseLaunch(`?embed=1&lab=blockly&template=blink&origin=${encodeURIComponent(origin)}`)).toEqual({
      mode: 'invalid',
      problem,
      lab: 'blockly',
    });
  });

  it.each([
    ['?embed=1&lab=yolobit&template=blink', 'The template "blink" does not open in lab=yolobit.', 'yolobit'],
    ['?embed=1&lab=blockly&template=ybc-heart', 'The template "ybc-heart" does not open in lab=blockly.', 'blockly'],
    ['?embed=1&lab=blockly&template=blinky', 'Unknown template "blinky".', 'blockly'],
    ['?embed=1&lab=yolobit', 'No template was given: add template=<key>.', 'yolobit'],
    ['?embed=1&lab=yolobit&template=ybc-heart&template=ybc-melody', 'template must be given once.', 'yolobit'],
    ['?embed=1&lab=yolobit&template=ybc-heart&profile=ybc-pro', 'Unknown profile "ybc-pro": use ybc-basic or ybc-advanced.', 'yolobit'],
    ['?embed=1&lab=yolobit&template=ybc-heart&profile=', 'Unknown profile "": use ybc-basic or ybc-advanced.', 'yolobit'],
    ['?embed=1&lab=yolobit&template=ybc-heart&profile=ybc-basic&profile=ybc-basic', 'profile must be given once.', 'yolobit'],
    ['?embed=1&lab=blockly&template=blink&profile=ybc-basic', 'profile is only for lab=yolobit.', 'blockly'],
    [`?embed=1&lab=blockly&template=blink&origin=${host}&origin=${host}`, 'origin must be given once.', 'blockly'],
  ])('refuses the lab launch %j', (search, problem, kind) => {
    expect(parseLaunch(search)).toEqual({ mode: 'invalid', problem, lab: kind });
  });

  it.each([
    ['?embed=1&lab=scratch&template=blink', 'Unknown lab "scratch": use lab=blockly or lab=yolobit.'],
    ['?embed=1&lab=Blockly&template=blink', 'Unknown lab "Blockly": use lab=blockly or lab=yolobit.'],
    ['?embed=1&lab=&template=blink', 'Unknown lab "": use lab=blockly or lab=yolobit.'],
    ['?embed=1&lab=blockly&lab=blockly&template=blink', 'lab must be given once.'],
    ['?lab=blockly&template=blink', 'A template opens only in an embedded lab: add embed=1.'],
    ['?lab=yolobit', 'A template opens only in an embedded lab: add embed=1.'],
  ])('refuses %j, naming no lab', (search, problem) => {
    expect(parseLaunch(search)).toEqual({ mode: 'invalid', problem });
  });

  it('keeps the legacy S1 launch as it was: any key, profile and origin ignored, no lab', () => {
    expect(parseLaunch('?embed=1&template=blink&origin=*&profile=nonsense')).toEqual({ mode: 'embed', template: 'blink' });
    expect(parseLaunch('?embed=1&template=ybc-heart')).toEqual({ mode: 'embed', template: 'ybc-heart' });
    expect(parseLaunch('?embed=1&template=blink')).not.toHaveProperty('lab');
  });
});
