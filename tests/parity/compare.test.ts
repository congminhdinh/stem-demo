import { describe, expect, it } from 'vitest';
import { compareTraces, sameState, serialLineAllowances, serialLineUs, type CompareInput } from './compare';
import type { PinEvent } from './trace';

// N18 C2: the comparison of the two traces, on synthetic traces with exact times (the times of driver-led and driver-button).

const at = (pin: string, state: PinEvent['state'], fromUs: number, toUs = fromUs): PinEvent => ({ pin, state, fromUs, toUs });
const INPUT = { kind: 'input', pullup: false } as const;
const LOW = { kind: 'low' } as const;
const HIGH = { kind: 'high' } as const;

const input = (simEvents: PinEvent[], boardEvents: PinEvent[], extra: Partial<CompareInput> = {}): CompareInput => ({
  sim: { events: simEvents, lines: [], calls: [], loopStartsUs: [], sleeps: [] },
  board: { events: boardEvents, lines: [], serialDoneUs: 0 },
  inputChanges: [],
  durationUs: 75_000,
  motorEnablePins: new Set(),
  ...extra,
});

// driver-led: pinMode(13) [0, 4.375], ON [5.375, 9.9375], wait 20, OFF [20 022.5, 20 027.0625]; the board's edges.
const ledSim = [at('D13', INPUT, 0), at('D13', LOW, 0, 4.375), at('D13', HIGH, 5.375, 9.9375), at('D13', LOW, 20_022.5, 20_027.0625)];
const ledBoard = [at('D13', INPUT, 0), at('D13', LOW, 2.5), at('D13', HIGH, 5.5625), at('D13', LOW, 20_014.0625)];

describe('sameState', () => {
  it('compares a duty and an angle exactly, a tone within 1 % (tone-frequency) and an input with its pull-up', () => {
    expect(sameState({ kind: 'pwm', duty: 128 }, { kind: 'pwm', duty: 128 })).toBe(true);
    expect(sameState({ kind: 'pwm', duty: 128 }, { kind: 'pwm', duty: 127 })).toBe(false);
    expect(sameState({ kind: 'servo', deg: 90 }, { kind: 'servo', deg: 89 })).toBe(false);
    expect(sameState({ kind: 'tone', hz: 440 }, { kind: 'tone', hz: 440.141 })).toBe(true);
    expect(sameState({ kind: 'tone', hz: 1000 }, { kind: 'tone', hz: 1010.5 })).toBe(false);
    expect(sameState({ kind: 'input', pullup: true }, INPUT)).toBe(false);
    expect(sameState(LOW, HIGH)).toBe(false);
  });
});

describe('the Serial time the board may spend (allowed differences serial-time, usart-frame, tx-queue)', () => {
  it('prices a line by the contract §7 model: a digit as a whole number, a minus sign, a text byte, the line end', () => {
    expect(serialLineUs('10')).toBe(17.25 + 2 * (9.375 + 45.1875));
    expect(serialLineUs('-7')).toBe(17.25 + 6.8125 + 54.5625);
    expect(serialLineUs('Xin chào')).toBe(17.25 + 9 * 6.28125);
  });

  it('adds the wait for room once the 64-byte queue is full, draining one byte per 1044.17 µs', () => {
    const allowances = serialLineAllowances([
      { atUs: 0, text: 'x'.repeat(70) },
      { atUs: 1000, text: 'y'.repeat(10) },
    ]);
    expect(allowances[0]).toBeCloseTo(serialLineUs('x'.repeat(70)) + 8 * 1044.17, 6);
    expect(allowances[1]).toBeCloseTo(serialLineUs('y'.repeat(10)) + 20 * 1044.17, 6);
  });
});

describe('compareTraces', () => {
  it('passes the LED of driver-led: the OFF after a 20 ms wait is 4.0625 µs early, within ±1 % of 20 ms', () => {
    const result = compareTraces(input(ledSim, ledBoard));
    expect(result.problems).toEqual([]);
    expect(result.checks.map((check) => [check.state, check.anchor, check.deviationUs])).toEqual([
      ['LOW', 'setup()', 0],
      ['HIGH', 'D13 LOW', 0],
      ['LOW', 'D13 HIGH', 20_014.0625 - 5.5625 - (20_022.5 - 9.9375)],
    ]);
    expect(result.checks[2]).toMatchObject({ spanUs: 20_027.0625 - 5.375, applied: ['interval'], ok: true });
    expect(result.maxDeviationUs).toBe(4.0625);
  });

  it('fails a board 5 % late on a long interval, an event the board lacks, and a state the board does not show', () => {
    const late = compareTraces(input(ledSim, [...ledBoard.slice(0, 3), at('D13', LOW, 21_000)]));
    // 21 000 − 5.5625 on the board against at most 20 027.0625 − 5.375 on the simulator.
    expect(late.problems).toEqual(['D13 LOW: 972.75 µs from D13 HIGH over 20021.69 µs, allowed −200.22…+200.22 (interval)']);
    const missing = compareTraces(input(ledSim, ledBoard.slice(0, 3)));
    expect(missing.problems).toEqual(['D13: the simulator went INPUT, LOW, HIGH, LOW; the board INPUT, LOW, HIGH']);
    const pwm = compareTraces(input([at('D5', INPUT, 0), at('D5', { kind: 'pwm', duty: 128 }, 40, 44)], [at('D5', INPUT, 0), at('D5', { kind: 'pwm', duty: 130 }, 3, 600)]));
    expect(pwm.problems).toEqual(['D5: the simulator went INPUT, pwm 128; the board INPUT, pwm 130']);
  });

  it('compares the lines printed, and refuses a run that ended before the board had sent them', () => {
    const lines = compareTraces(
      input([], [], { sim: { events: [], lines: [{ atUs: 1, text: '10' }], calls: [], loopStartsUs: [], sleeps: [] }, board: { events: [], lines: [{ atUs: 9, text: '11' }], serialDoneUs: 80_000 } }),
    );
    expect(lines.problems).toEqual(['Serial: the simulator printed ["10"], the board ["11"]', 'Serial: the board was still sending at the end (80000.0 µs > 75000 µs): the fixture is too short']);
  });

  it('times a servo’s first pulse from its attach (servo-first-pulse), and refuses one later than 32 768 + 20 000 µs', () => {
    const simServo = [at('D9', INPUT, 0), at('D9', LOW, 0, 49.5), at('D9', { kind: 'servo', deg: 90 }, 0, 49.5)];
    const boardServo = (firstRiseUs: number) => [at('D9', INPUT, 0), at('D9', LOW, 2.8125), at('D9', { kind: 'servo', deg: 90 }, firstRiseUs - 20_203, firstRiseUs)];
    expect(compareTraces(input(simServo, boardServo(52_804.8125))).problems).toEqual([]);
    expect(compareTraces(input(simServo, boardServo(53_000))).problems).toEqual(['D9: the first servo pulse came 52997.2 µs after attach(), more than 52768 µs']);
  });

  it('times an LED that follows a button from the press (an input anchor), with LOOP_MIN_US for the loop() under way', () => {
    // driver-button: the button is pressed at 15 ms; loop() turns are 64.125 µs apart on the simulator.
    const sim = [at('D13', INPUT, 0), at('D13', LOW, 0, 4.375), at('D13', HIGH, 15_061.1875, 15_065.75)];
    const board = [at('D13', INPUT, 0), at('D13', LOW, 2.5), at('D13', HIGH, 15_011.3125)];
    const result = compareTraces(
      input(sim, board, {
        sim: { events: sim, lines: [], calls: [], loopStartsUs: [14_949.75, 15_013.875], sleeps: [] },
        inputChanges: [{ pin: 'D3', atUs: 15_000, level: 0 }],
      }),
    );
    expect(result.problems).toEqual([]);
    expect(result.checks[1]).toMatchObject({ anchor: 'D3 LOW (input)', spanUs: 65.75, deviationUs: 11.3125 - 61.1875, applied: ['interval', 'call-costs', 'isr-load', 'loop-min-us'] });
    expect(result.checks[1]?.belowUs).toBeCloseTo(65.75 * 0.41 + 50, 9);
  });
});
