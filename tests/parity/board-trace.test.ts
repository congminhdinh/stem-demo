import { describe, expect, it } from 'vitest';
import { decodePin, findRuns, type RawChange, type WaveformDecoding } from './board-trace';

// N18 C2: the board's recorded edges read back into events, on synthetic edges with exact times.

const pwm: WaveformDecoding = { kind: 'pwm', periodUs: 1024, scale: 256 };
const servo: WaveformDecoding = { kind: 'servo', frameUs: 20_000, minUs: 544, maxUs: 2400 };
const tone: WaveformDecoding = { kind: 'tone', minHz: 31, maxHz: 4000 };

/** Pulses rising at `firstUs`, every `periodUs`, each `highUs` HIGH. */
const pulses = (firstUs: number, count: number, periodUs: number, highUs: number): RawChange[] =>
  Array.from({ length: count }, (_, k) => [
    { atUs: firstUs + k * periodUs, state: 'HIGH' as const },
    { atUs: firstUs + k * periodUs + highUs, state: 'LOW' as const },
  ]).flat();
const low = (atUs: number): RawChange => ({ atUs, state: 'LOW' });
const high = (atUs: number): RawChange => ({ atUs, state: 'HIGH' });
const events = (pin: string, changes: RawChange[], endUs: number, decoding?: WaveformDecoding) =>
  decodePin(pin, 'INPUT', changes, endUs, decoding).map(({ state, fromUs, toUs }) => [state, fromUs, toUs]);

describe('decodePin', () => {
  it('gives every change of a pin without a waveform as an exact event, after its state at setup()', () => {
    expect(events('D13', [low(2.5), high(5.5625), low(20_014.0625)], 30_000)).toEqual([
      [{ kind: 'input', pullup: false }, 0, 0],
      [{ kind: 'low' }, 2.5, 2.5],
      [{ kind: 'high' }, 5.5625, 5.5625],
      [{ kind: 'low' }, 20_014.0625, 20_014.0625],
    ]);
    expect(decodePin('D3', 'INPUT_PULLUP', [], 10, undefined)).toEqual([{ pin: 'D3', state: { kind: 'input', pullup: true }, fromUs: 0, toUs: 0 }]);
  });

  it('reads a Timer0 PWM run as its duty on the 256 scale, started within one period before its first rise and after the LOW', () => {
    const changes = [low(3), ...pulses(600, 5, 1024, 512)];
    expect(events('D5', changes, 600 + 4 * 1024 + 700, pwm)).toEqual([
      [{ kind: 'input', pullup: false }, 0, 0],
      [{ kind: 'low' }, 3, 3],
      [{ kind: 'pwm', duty: 128 }, 3, 600],
    ]);
    // The run's start window is one period (+4 µs) before its first rise when the LOW is older than that.
    expect(events('D5', [low(3), ...pulses(30_600, 3, 1024, 308)], 40_000, pwm).slice(2)).toEqual([
      [{ kind: 'pwm', duty: 77 }, 30_600 - 1028, 30_600],
      [{ kind: 'low' }, 30_600 + 2048 + 308, 30_600 + 3072 + 4],
    ]);
  });

  it('times a duty change from the old waveform’s last period to the first rise of the new one', () => {
    const changes = [low(3), ...pulses(600, 4, 1024, 512), ...pulses(4696, 3, 1024, 308)];
    expect(findRuns(changes, pwm)).toEqual([
      { first: 1, last: 9, periodUs: 1024, highUs: 512 },
      { first: 9, last: 13, periodUs: 1024, highUs: 308 },
    ]);
    expect(events('D5', changes, 9000, pwm).slice(2)).toEqual([
      [{ kind: 'pwm', duty: 128 }, 3, 600],
      [{ kind: 'pwm', duty: 77 }, 3672, 4696],
      [{ kind: 'low' }, 7052, 7772],
    ]);
  });

  it('leaves a waveform still running when the recording ends before its next rise was due', () => {
    const changes = [low(3), ...pulses(600, 4, 1024, 512)];
    expect(events('D5', changes, 600 + 3 * 1024 + 900, pwm).at(-1)).toEqual([{ kind: 'pwm', duty: 128 }, 3, 600]);
  });

  it('gives an early fall, an off-schedule rise and a missing fall as the waveform’s stop, exact or within one HIGH time', () => {
    const run = pulses(600, 3, 1024, 512);
    // analogWrite(0) in a HIGH phase: the pin falls 100 µs into it.
    expect(events('D5', [low(3), ...run, high(3672), low(3772)], 9000, pwm).slice(3)).toEqual([[{ kind: 'low' }, 3772, 3772]]);
    // digitalWrite(HIGH) in a LOW phase: a rise before the one due, and no fall.
    expect(events('D5', [low(3), ...run, high(3672), low(4184), high(4400)], 9000, pwm).slice(3)).toEqual([[{ kind: 'high' }, 4400, 4400]]);
    // analogWrite(255) in a HIGH phase: no fall, or one long after: HIGH from the last rise to its fall that did not come.
    expect(events('D5', [low(3), ...run, high(3672)], 9000, pwm).slice(3)).toEqual([[{ kind: 'high' }, 3672, 3672 + 512 + 4]]);
    expect(events('D5', [low(3), ...run, high(3672), low(33_000)], 40_000, pwm).slice(3)).toEqual([
      [{ kind: 'high' }, 3672, 3672 + 512 + 4],
      [{ kind: 'low' }, 33_000, 33_000],
    ]);
  });

  it('reads a tone from a pin that was an input: the exact LOW of its pinMode, then the tone from it', () => {
    // tone(10, 1000, 5): 10 half periods of 500 µs from 509 µs, then the pin stays LOW: stopped after the last fall, before the
    // rise that was due.
    const changes = [low(9.3125), ...pulses(509.3125, 5, 1000, 500)];
    expect(events('D10', changes, 20_000, tone)).toEqual([
      [{ kind: 'input', pullup: false }, 0, 0],
      [{ kind: 'low' }, 9.3125, 9.3125],
      [{ kind: 'tone', hz: 1000 }, 9.3125, 509.3125],
      [{ kind: 'low' }, 5009.3125, 4509.3125 + 1000 + 10],
    ]);
  });

  it('reads a servo pulse as its angle (Servo 1.3.0: 544 + angle · 1856 / 180 µs), its first pulse a frame after attach', () => {
    const changes = [low(2.8125), ...pulses(52_804.8125, 3, 20_003, 1471.4375), ...pulses(52_804.8125 + 3 * 20_003, 3, 20_003, 1007.4375)];
    expect(events('D9', changes, 160_000, servo)).toEqual([
      [{ kind: 'input', pullup: false }, 0, 0],
      [{ kind: 'low' }, 2.8125, 2.8125],
      [{ kind: 'servo', deg: 90 }, 52_804.8125 - 20_003 - 200.03, 52_804.8125],
      [{ kind: 'servo', deg: 45 }, 52_804.8125 + 2 * 20_003, 52_804.8125 + 3 * 20_003],
    ]);
  });

  it('needs MIN_RUN_PERIODS whole periods for a waveform: fewer stay exact edges', () => {
    expect(events('D5', [low(3), ...pulses(600, 2, 1024, 512)], 9000, pwm).slice(1)).toEqual([
      [{ kind: 'low' }, 3, 3],
      [{ kind: 'high' }, 600, 600],
      [{ kind: 'low' }, 1112, 1112],
      [{ kind: 'high' }, 1624, 1624],
      [{ kind: 'low' }, 2136, 2136],
    ]);
  });
});
