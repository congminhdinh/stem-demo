import { describe, expect, it } from 'vitest';
import { compileFixture, parityFixtures } from './fixtures';
import { logicalStateOf, outputLowFirst, printsOfJoins, settleTones, toneFormsOf } from './sim-run';
import type { PinEvent } from './trace';

// N18 C2: how the simulator's pin changes become the harness's events.

const at = (pin: string, state: PinEvent['state'], fromUs: number, toUs = fromUs): PinEvent => ({ pin, state, fromUs, toUs });
const state = (partial: Partial<Parameters<typeof logicalStateOf>[0]>) => ({ pin: 'D5', mode: 'OUTPUT' as const, level: 0 as const, duty: 0, toneHz: null, servoDeg: null, ...partial });

describe('the simulator’s events', () => {
  it('names a pin state as the world reads it: input and pull-up, LOW and HIGH by duty, PWM, a servo, a tone', () => {
    expect(logicalStateOf(state({ mode: 'INPUT_PULLUP' }), 255)).toEqual({ kind: 'input', pullup: true });
    expect(logicalStateOf(state({ duty: 0 }), 255)).toEqual({ kind: 'low' });
    expect(logicalStateOf(state({ duty: 255, level: 1 }), 255)).toEqual({ kind: 'high' });
    expect(logicalStateOf(state({ duty: 128 }), 255)).toEqual({ kind: 'pwm', duty: 128 });
    expect(logicalStateOf(state({ servoDeg: 90 }), 255)).toEqual({ kind: 'servo', deg: 90 });
    expect(logicalStateOf(state({ toneHz: 440 }), 255)).toEqual({ kind: 'tone', hz: 440 });
  });

  it('puts a tone’s own end at its call + ms, told late, not told before a new tone, or never told', () => {
    const tone = { kind: 'tone', hz: 1000 } as const;
    const record = { pin: 'D10', endFromUs: 50_001, endToUs: 50_175.0625, settledByCall: false };
    // Told at the next call, 70 ms in.
    expect(settleTones([at('D10', tone, 1, 175.0625), at('D10', { kind: 'low' }, 70_180, 70_190)], [record], 230_000).at(-1)).toEqual(at('D10', { kind: 'low' }, 50_001, 50_175.0625));
    // The next call is a new tone: the LOW was never told.
    const retone = settleTones([at('D10', tone, 1, 175.0625), at('D10', { kind: 'tone', hz: 440 }, 70_190, 70_364)], [record], 230_000);
    expect(retone.map((event) => event.state.kind)).toEqual(['tone', 'low', 'tone']);
    // No call after it, inside the run; and outside it.
    expect(settleTones([at('D10', tone, 1, 175.0625)], [record], 230_000).map((event) => event.fromUs)).toEqual([1, 50_001]);
    expect(settleTones([at('D10', tone, 1, 175.0625)], [record], 40_000)).toHaveLength(1);
    // Ended by a call (noTone, a new tone): nothing to move.
    expect(settleTones([at('D10', tone, 1, 175.0625)], [{ ...record, settledByCall: true }], 230_000)).toHaveLength(1);
  });

  it('gives an analogWrite, an attach or a first tone on an input pin the LOW of its pinMode first, in the same call (output-low-first)', () => {
    const events = [
      at('D9', { kind: 'input', pullup: false }, 0),
      at('D9', { kind: 'servo', deg: 90 }, 0, 49.5),
      at('D9', { kind: 'servo', deg: 45 }, 80_061, 80_110.5),
      at('A4', { kind: 'input', pullup: false }, 0),
      at('A4', { kind: 'high' }, 30, 41.875),
      at('A3', { kind: 'input', pullup: false }, 0),
      at('A3', { kind: 'low' }, 10, 14.375),
      at('A3', { kind: 'high' }, 15, 19.5625),
    ];
    const calls = new Map([
      [events[1], 'servoWrite'],
      [events[2], 'servoWrite'],
      [events[4], 'pwmWrite'],
      [events[6], 'pinMode'],
      [events[7], 'digitalWrite'],
    ] as const);
    expect(outputLowFirst(events, (event) => calls.get(event) ?? null).map((event) => [event.pin, event.state.kind, event.fromUs, event.toUs])).toEqual([
      ['D9', 'input', 0, 0],
      ['D9', 'low', 0, 49.5],
      ['D9', 'servo', 0, 49.5],
      ['D9', 'servo', 80_061, 80_110.5],
      ['A4', 'input', 0, 0],
      ['A4', 'low', 30, 41.875],
      ['A4', 'high', 30, 41.875],
      ['A3', 'input', 0, 0],
      ['A3', 'low', 10, 14.375],
      ['A3', 'high', 15, 19.5625],
    ]);
  });

  it('knows which prints print a join (join-by-parts): sequenced-reads ends with one, logic-reads has none', () => {
    const joins = (name: string) => printsOfJoins(compileFixture(parityFixtures.find((fixture) => fixture.name === name) as (typeof parityFixtures)[number]).ir).size;
    expect([joins('sequenced-reads'), joins('logic-reads'), joins('print-mixed')]).toEqual([1, 0, 4]);
  });

  it('knows how each tone() frequency is written (tone-fold): literals, a variable set from reads, and sequenced-reads’ read', () => {
    const forms = (name: string) => [...toneFormsOf(compileFixture(parityFixtures.find((fixture) => fixture.name === name) as (typeof parityFixtures)[number]).ir).values()];
    expect(forms('driver-tone-led')).toEqual(['literal', 'literal', 'literal']);
    expect(forms('driver-tone-computed')).toEqual(['runtime', 'runtime']);
    expect(forms('sequenced-reads')).toEqual(['runtime']);
  });
});
