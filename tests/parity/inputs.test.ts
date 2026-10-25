import { describe, expect, it } from 'vitest';
import { rover } from '../../src/core/program/__fixtures__/uno-blocks';
import { adcValueOf, analogFeed, echoFeed, kitInputDefaults, levelAt, levelTimeline } from './inputs';

// N18 C2: the scripted inputs, applied the same way to both sides.

describe('the scripted inputs of a parity fixture', () => {
  it('drives every input pin of ref-uno-rover@0: the echo and the line sensors LOW, the button HIGH as its pull-up would (pull-up)', () => {
    expect([...kitInputDefaults(rover)]).toEqual([
      ['D11', 0],
      ['A0', 0],
      ['A1', 0],
      ['A2', 0],
      ['D3', 1],
    ]);
  });

  it('gives each pin its levels in time order, the default at 0 first, and the last change at or before a time', () => {
    const timeline = levelTimeline(rover, {
      levels: [
        { pin: 'D3', atUs: 35_000, level: 1 },
        { pin: 'D3', atUs: 15_000, level: 0 },
      ],
    });
    const button = timeline.get('D3') ?? [];
    expect(button.map((change) => [change.atUs, change.level])).toEqual([
      [0, 1],
      [15_000, 0],
      [35_000, 1],
    ]);
    expect([0, 14_999.9375, 15_000, 34_999, 35_000].map((us) => levelAt(button, us))).toEqual([1, 1, 0, 0, 1]);
    expect(() => levelTimeline(rover, { levels: [{ pin: 'D3', atUs: -1, level: 0 }] })).toThrow('A level change is at 0 µs or later, not -1 (D3)');
  });

  it('hands out analog values in read order, one counter per group, and refuses a read past the script', () => {
    const feed = analogFeed([{ pins: ['A0', 'A1', 'A2'], values: [100, 200, 300] }]);
    expect([feed.next('A0'), feed.next('A2'), feed.next('A1')]).toEqual([100, 200, 300]);
    expect(() => feed.next('A0')).toThrow('The fixture has 3 analog values for A0/A1/A2, and the program read one more');
    expect(() => analogFeed([]).next('A3')).toThrow('The fixture gives no analog value for A3');
    expect([adcValueOf(-5), adcValueOf(511.9), adcValueOf(2000)]).toEqual([0, 511, 1023]);
  });

  it('hands out one echo per trigger, null when there is none', () => {
    const feed = echoFeed({ trig: 'D12', echo: 'D11', readings: [{ waitUs: 450, widthUs: 630 }, null] });
    expect([feed.next(), feed.next(), feed.next(), feed.read()]).toEqual([{ waitUs: 450, widthUs: 630 }, null, null, 3]);
  });
});
