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
    // The run's start window is one period (+0.5 µs, waveform-jitter) before its first rise when the LOW is older than that.
    expect(events('D5', [low(3), ...pulses(30_600, 3, 1024, 308)], 40_000, pwm).slice(2)).toEqual([
      [{ kind: 'pwm', duty: 77 }, 30_600 - 1024.5, 30_600],
      [{ kind: 'low' }, 30_600 + 2048 + 308, 30_600 + 3072 + 0.5],
    ]);
  });

  it('starts a waveform from a steady HIGH up to two periods before its first rise: its first period shows only a fall', () => {
    // negate-drive's D6: HIGH (duty 255), then analogWrite(6, 179) at 60 399 µs; the timer sets the pin at 60 412.75 (no edge), clears
    // it at its compare (61 128.75) and sets it again at 61 436.75, the first rise.
    const changes = [low(12.9375), high(30_269.875), low(61_128.75), ...pulses(61_436.75, 3, 1024, 716)];
    expect(events('D6', changes, 64_000, pwm).slice(3)).toEqual([[{ kind: 'pwm', duty: 179 }, 61_436.75 - 2048 - 0.5, 61_436.75]]);
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
      [{ kind: 'low' }, 7052, 7768.5],
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
    expect(events('D5', [low(3), ...run, high(3672)], 9000, pwm).slice(3)).toEqual([[{ kind: 'high' }, 3672, 3672 + 512 + 0.5]]);
    expect(events('D5', [low(3), ...run, high(3672), low(33_000)], 40_000, pwm).slice(3)).toEqual([
      [{ kind: 'high' }, 3672, 3672 + 512 + 0.5],
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

  it('reads one or two pulses on the buzzer’s pin as a short tone (tone-duration: 31 Hz for 40 ms is one pulse), its frequency twice its pulse or its period', () => {
    // tone(10, 31, 40): floor(2 · 31 · 40 / 1000) = 2 half periods, one pulse of 16 128 µs; stopped before the rise due a period on
    // (its jitter 1 %: 322.56 µs).
    expect(events('D10', [low(9.3125), ...pulses(26.9375, 1, 32_256, 16_128)], 90_000, tone)).toEqual([
      [{ kind: 'input', pullup: false }, 0, 0],
      [{ kind: 'low' }, 9.3125, 9.3125],
      [{ kind: 'tone', hz: 1e6 / 32_256 }, 9.3125, 26.9375],
      [{ kind: 'low' }, 26.9375 + 16_128, 26.9375 + 32_256 + 322.56],
    ]);
    const twoPulses = events('D10', [low(9.3125), ...pulses(26.9375, 2, 16_640, 8_320)], 90_000, tone);
    expect(twoPulses[2]).toEqual([{ kind: 'tone', hz: 1e6 / 16_640 }, 9.3125, 26.9375]);
    expect(twoPulses[3]?.slice(0, 2)).toEqual([{ kind: 'low' }, 26.9375 + 16_640 + 8_320]);
  });

  it('lets a tone follow a tone at once when its first rise comes within half a period of the last fall, else gives the LOW between', () => {
    // 1000 Hz for 5 ms, then 440 Hz (period 2272 µs) rising 600 µs after the last fall: within 1136 µs, so no LOW between.
    const lastFallUs = 509.3125 + 4000 + 500;
    const then = (gapUs: number) => events('D10', [low(9.3125), ...pulses(509.3125, 5, 1000, 500), ...pulses(lastFallUs + gapUs, 6, 2272, 1136)], 90_000, tone);
    expect(then(600).slice(2, 4)).toEqual([
      [{ kind: 'tone', hz: 1000 }, 9.3125, 509.3125],
      [{ kind: 'tone', hz: 1e6 / 2272 }, lastFallUs - 1500, lastFallUs + 600],
    ]);
    // 5 ms of LOW between: the first tone stopped after its last fall, the second started within a period (and 1 %) of its first rise.
    expect(then(5000).slice(3, 5).map((event) => event.slice(0, 2))).toEqual([
      [{ kind: 'low' }, lastFallUs],
      [{ kind: 'tone', hz: 1e6 / 2272 }, lastFallUs + 5000 - 2272 - 22.72],
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
