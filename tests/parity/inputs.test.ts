import { describe, expect, it } from 'vitest';
import { rover } from '../../src/core/program/__fixtures__/uno-blocks';
import { adcValueOf, analogFeed, COLOR_WINDOW_US, colorIntegral, echoFeed, kitInputDefaults, levelAt, levelTimeline, windowEndInRead, type ColorBusEvent } from './inputs';

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

  it('integrates the colour script over a span, a light switch splitting it by whole µs; no light before the first window (N19 C2)', () => {
    const red = { c: 30, r: 20, g: 6, b: 4 };
    const white = { c: 12, r: 4, g: 4, b: 4 };
    const integral = colorIntegral({ windows: [{ fromUs: 1000, light: white }, { fromUs: 0, light: red }] });
    // 100 µs of red before the switch at 1000, 50 of white after it.
    expect(integral(900, 1050)).toEqual({ c: 100 * 30 + 50 * 12, r: 100 * 20 + 50 * 4, g: 100 * 6 + 50 * 4, b: 100 * 4 + 50 * 4 });
    expect(integral(0, 1000)).toEqual({ c: 30_000, r: 20_000, g: 6000, b: 4000 });
    expect(integral(1000, 1000)).toEqual({ c: 0, r: 0, g: 0, b: 0 });
    expect(colorIntegral({ windows: [{ fromUs: 500, light: red }] })(0, 600)).toEqual({ c: 3000, r: 2000, g: 600, b: 400 });
  });

  it('finds where a window\'s end falls in the 8-byte read across it, from the AEN byte on (fix round 1, I1)', () => {
    expect(COLOR_WINDOW_US).toBe(52_800);
    const read = (fromUs: number): ColorBusEvent[] => [
      { kind: 'connect', atUs: fromUs - 100, read: true, ack: true },
      ...Array.from({ length: 8 }, (_, k): ColorBusEvent => ({ kind: 'read', atUs: fromUs + k * 95, byte: 0 })),
      { kind: 'stop', atUs: fromUs + 800 },
    ];
    const enable: ColorBusEvent[] = [
      { kind: 'connect', atUs: 9, read: false, ack: true },
      { kind: 'write', atUs: 10, byte: 0x80 },
      { kind: 'write', atUs: 20, byte: 0x03 },
      { kind: 'stop', atUs: 30 },
    ];
    // The 2nd window ends at 20 + 105 600; a read from 105 600 has it 20 µs after byte 0 and 170 before byte 2.
    expect(windowEndInRead([...enable, ...read(80_000), ...read(105_600)], 2)).toEqual({ endUs: 105_620, beforeUs: 20, afterUs: 170 });
    // A read wholly after the end (or none before AEN's byte) gives null.
    expect(windowEndInRead([...enable, ...read(105_621)], 2)).toBeNull();
    expect(windowEndInRead(read(105_600), 2)).toBeNull();
  });
});
