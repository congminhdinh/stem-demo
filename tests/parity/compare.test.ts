import { describe, expect, it } from 'vitest';
import { compareTraces, millisInstantUs, sameState, serialLineAllowances, serialLineUs, type CompareInput } from './compare';
import type { SimCall, SimLine } from './sim-run';
import type { PinEvent } from './trace';

// N18 C2: the comparison of the two traces, on synthetic traces with exact times (the times of driver-led, driver-button and
// driver-servo as the harness recorded them).

const at = (pin: string, state: PinEvent['state'], fromUs: number, toUs = fromUs): PinEvent => ({ pin, state, fromUs, toUs });
const call = (name: SimCall['name'], pin: string | null, fromUs: number, toUs: number, result?: number): SimCall => ({ name, pin, args: [], blockId: '', fromUs, toUs, ...(result === undefined ? {} : { result }) });
const line = (atUs: number, text: string, statementUs = atUs, join = false): SimLine => ({ atUs, text, statementUs, join });
const INPUT = { kind: 'input', pullup: false } as const;
const LOW = { kind: 'low' } as const;
const HIGH = { kind: 'high' } as const;

type Sim = CompareInput['sim'];
const input = (sim: Partial<Sim>, board: Partial<CompareInput['board']>, extra: Partial<CompareInput> = {}): CompareInput => ({
  sim: { events: [], lines: [], calls: [], loopStartsUs: [], sleeps: [], nodesUs: [], ...sim },
  board: { events: [], lines: [], serialDoneUs: 0, unfinishedLine: '', ...board },
  inputChanges: [],
  durationUs: 75_000,
  prints: false,
  ...extra,
});

// driver-led: pinMode(13) [0, 4.375], one node, ON [5.375, 9.9375], wait 20 [9.9375, 20 018.5], one node, OFF [20 022.5, 20 027.0625].
const led: Sim = {
  events: [at('D13', INPUT, 0), at('D13', LOW, 0, 4.375), at('D13', HIGH, 5.375, 9.9375), at('D13', LOW, 20_022.5, 20_027.0625)],
  lines: [],
  calls: [call('pinMode', 'D13', 0, 4.375), call('digitalWrite', 'D13', 5.375, 9.9375), call('digitalWrite', 'D13', 20_022.5, 20_027.0625)],
  loopStartsUs: [],
  sleeps: [{ fromUs: 9.9375, toUs: 20_018.5 }],
  nodesUs: [4.375, 9.9375, 20_021.5],
};
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

  it('adds the wait for room once the 64-byte queue is full, draining one byte per 1044.17 µs, the later prints later by it', () => {
    const allowances = serialLineAllowances([line(0, 'x'.repeat(70)), line(1000, 'y'.repeat(10))]);
    const first = serialLineUs('x'.repeat(70)) + 8 * 1044.17;
    expect(allowances[0]).toBeCloseTo(first, 6);
    // The second print comes `first` later on the board: 72 · 1044.17 − (1000 + first) µs of the first line are still queued.
    const pending = Math.ceil((72 * 1044.17 - (1000 + first)) / 1044.17);
    expect(allowances[1]).toBeCloseTo(serialLineUs('y'.repeat(10)) + (pending + 12 - 64) * 1044.17, 6);
  });

  it('times millis() by the board’s model: 20 at 20 · 1024 µs; 41 → 43 at 42 · 1024 µs (3/125 carried), so 42 and 43 there', () => {
    expect([millisInstantUs(0), millisInstantUs(20), millisInstantUs(42), millisInstantUs(43)]).toEqual([0, 20_480, 42 * 1024, 42 * 1024]);
  });
});

describe('compareTraces', () => {
  it('passes the LED of driver-led: the OFF after a 20 ms wait is 4.0625 µs early, within 1 % of the wait', () => {
    const result = compareTraces(input(led, { events: ledBoard }));
    expect(result.problems).toEqual([]);
    expect(result.checks.map((check) => [check.what, check.anchor, check.deviationUs])).toEqual([
      ['D13 LOW', 'setup()', 0],
      ['D13 HIGH', 'D13 LOW', 0],
      ['D13 LOW', 'D13 HIGH', 20_014.0625 - 5.5625 - (20_022.5 - 9.9375)],
    ]);
    expect(result.checks[2]).toMatchObject({ waitUs: 20_018.5 - 9.9375, callUs: 9.125, nodeUs: 2 });
    expect(result.checks[2]?.belowUs).toBeCloseTo(0.01 * (20_018.5 - 9.9375) + 0.41 * 9.125 + 2, 9);
    expect(result.maxDeviationUs).toBe(4.0625);
  });

  it('fails a board 5 % late on a long interval, an event the board lacks, and a state the board does not show', () => {
    const late = compareTraces(input(led, { events: [...ledBoard.slice(0, 3), at('D13', LOW, 21_000)] }));
    expect(late.problems).toEqual([expect.stringMatching(/^D13 LOW: 972\.75 µs from D13 HIGH over 20021\.69 µs \(waits 20008\.56, calls 9\.13, nodes 2\.00\), allowed −/)]);
    const missing = compareTraces(input(led, { events: ledBoard.slice(0, 3) }));
    expect(missing.problems).toEqual(['D13: the simulator went INPUT, LOW, HIGH, LOW; the board INPUT, LOW, HIGH']);
    const pwm = compareTraces(input({ events: [at('D5', INPUT, 0), at('D5', { kind: 'pwm', duty: 128 }, 40, 44)] }, { events: [at('D5', INPUT, 0), at('D5', { kind: 'pwm', duty: 130 }, 3, 600)] }));
    expect(pwm.problems).toEqual(['D5: the simulator went INPUT, pwm 128; the board INPUT, pwm 130']);
  });

  it('allows a wait 1 %, nothing more: 150 µs more of a 1 ms wait on the simulator fails', () => {
    const short = (waitUs: number): Sim => ({
      ...led,
      events: [...led.events.slice(0, 3), at('D13', LOW, 9.9375 + waitUs + 4, 9.9375 + waitUs + 8.5625)],
      calls: [...led.calls.slice(0, 2), call('digitalWrite', 'D13', 9.9375 + waitUs + 4, 9.9375 + waitUs + 8.5625)],
      sleeps: [{ fromUs: 9.9375, toUs: 9.9375 + waitUs }],
      nodesUs: [4.375, 9.9375, 9.9375 + waitUs + 3],
    });
    const boardAt = (atUs: number) => ({ events: [...ledBoard.slice(0, 3), at('D13', LOW, atUs)] });
    expect(compareTraces(input(short(1008.5625), boardAt(1014.0625))).problems).toEqual([]);
    expect(compareTraces(input(short(1158.5625), boardAt(1014.0625))).problems).toEqual([
      'D13 LOW: -154.06 µs from D13 HIGH over 1171.69 µs (waits 1158.56, calls 9.13, nodes 2.00), allowed −17.33…+17.62 (interval, call-costs, isr-load)',
    ]);
  });

  it('compares the lines printed, and refuses a run that ended before the board had sent them', () => {
    const result = compareTraces(input({ lines: [line(1, '10')] }, { lines: [{ atUs: 9, text: '11' }], serialDoneUs: 80_000 }));
    expect(result.problems).toEqual(['Serial: the simulator printed ["10"], the board ["11"]', 'Serial: the board was still sending at the end (80000.0 µs > 75000 µs): the fixture is too short']);
  });

  it('times a line from its print, or from the end of the line before it when that one still goes out', () => {
    // names: "36" printed 59 µs in (after Serial.begin), the first byte out 105.25 µs in; a second line queued behind it.
    const sim = { lines: [line(59, '36'), line(60, 'ab')], nodesUs: Array.from({ length: 34 }, (_, k) => 25 + k) };
    const board = { lines: [{ atUs: 105.25, text: '36' }, { atUs: 105.25 + 4 * 1044.17, text: 'ab' }] };
    const timed = compareTraces(input(sim, board, { prints: true }));
    expect(timed.problems).toEqual([]);
    expect(timed.lineChecks.map((check) => [check.what, check.anchor, check.applied.includes('usart-frame')])).toEqual([
      ['line 1 "36"', 'setup()', false],
      ['line 2 "ab"', 'line 1 on the USART', true],
    ]);
    // 5 ms of wait the board does not have, before the print: the line is 5 ms late.
    const late = compareTraces(input({ ...sim, lines: [line(5059, '36'), line(5060, 'ab')], sleeps: [{ fromUs: 50, toUs: 5050 }] }, board, { prints: true }));
    expect(late.problems[0]).toMatch(/^line 1 "36": -4953\.75 µs from setup\(\)/);
  });

  it('times a servo’s first pulse from its attach call (servo-first-pulse), and refuses one later than 32 768 + 20 000 + 100 µs', () => {
    const simServo = { events: [at('D9', INPUT, 0), at('D9', LOW, 0, 49.5), at('D9', { kind: 'servo', deg: 90 }, 0, 49.5)], calls: [call('servoWrite', 'D9', 0, 49.5)] };
    const boardServo = (firstRiseUs: number) => [at('D9', INPUT, 0), at('D9', LOW, 2.8125), at('D9', { kind: 'servo', deg: 90 }, firstRiseUs - 20_203, firstRiseUs)];
    expect(compareTraces(input(simServo, { events: boardServo(52_804.8125) })).problems).toEqual([]);
    expect(compareTraces(input(simServo, { events: boardServo(53_000) })).problems).toEqual(['D9: the first servo pulse came 52997.2 µs after attach(), more than 52868 µs']);
    const notInCall = { ...simServo, events: [at('D9', INPUT, 0), at('D9', LOW, 5, 49.5), at('D9', { kind: 'servo', deg: 90 }, 5, 49.5)] };
    expect(compareTraces(input(notInCall, { events: boardServo(52_804.8125) })).problems).toEqual(['D9: the simulator’s first servo event (5…49.5 µs) is not its attach call']);
  });

  it('times an LED that follows a button from the press it polled for, with LOOP_MIN_US for the loop() under way', () => {
    // driver-button: the button is pressed at 15 ms; loop() turns are 64.125 µs apart on the simulator, each reads D3.
    const sim = {
      events: [at('D13', INPUT, 0), at('D13', LOW, 0, 4.375), at('D13', HIGH, 15_018.25, 15_022.8125)],
      calls: [call('pinMode', 'D13', 0, 4.375), call('digitalRead', 'D3', 14_947, 14_952.0625, 1), call('digitalRead', 'D3', 15_011.125, 15_016.1875, 0), call('digitalWrite', 'D13', 15_018.25, 15_022.8125)],
      loopStartsUs: [14_941.875, 15_006],
      nodesUs: [15_006, 15_016.1875, 15_017.25],
    };
    const board = { events: [at('D13', INPUT, 0), at('D13', LOW, 2.5), at('D13', HIGH, 15_011.3125)] };
    const result = compareTraces(input(sim, board, { inputChanges: [{ pin: 'D3', atUs: 15_000, level: 0 }] }));
    expect(result.problems).toEqual([]);
    expect(result.checks[1]).toMatchObject({ anchor: 'D3 LOW (input)', deviationUs: 11.3125 - 18.25, applied: ['interval', 'call-costs', 'loop-min-us', 'isr-load'] });
    // Without the read after the press, the LED would be the program's own pace: timed from the LOW at setup().
    const unread = compareTraces(input({ ...sim, calls: sim.calls.filter((c) => c.fromUs < 15_000 || c.name !== 'digitalRead') }, board, { inputChanges: [{ pin: 'D3', atUs: 15_000, level: 0 }] }));
    expect(unread.checks[1]?.anchor).toBe('D13 LOW');
  });

  it('times a print after a loop that waits on millis() from the moment millis() turned', () => {
    const calls = [call('millis', null, 20_470, 20_471.1875, 19), call('millis', null, 20_474.4, 20_475.5875, 20)];
    const result = compareTraces(input({ calls, lines: [line(20_480.5, '1')] }, { lines: [{ atUs: 20_550.25, text: '1' }] }));
    expect(result.lineChecks[0]).toMatchObject({ anchor: 'millis() = 20', ok: true });
  });
});
