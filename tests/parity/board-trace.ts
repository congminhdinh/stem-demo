import type { RawPinState } from './emulated-uno';
import type { PinEvent, PinLogicalState } from './trace';

// The L2e side's trace (N18 C2): the edges avr8js recorded on one pin, read back into the harness's events (trace.ts). A pin that
// carries no waveform (an H-bridge IN pin, an LED, a trigger) gives one exact event per edge. A pin the kit drives with a timer is
// also searched for its waveform: a run of at least MIN_RUN_PERIODS periods of the same length and the same HIGH time is one
// waveform event (PWM of a duty, a servo angle, a tone).
//
// When does the change happen? The hardware shows it at the timer's next period, after the call (allowed difference
// `waveform-phase`: contract §5.1, §6.2, §6.3), so a waveform's start or stop is a time range:
//   - a waveform starts within one period before its first rising edge, and after the event before it; the output edges in
//     between are its lead-in, not events of their own. A pin leaving INPUT (the pinMode inside Servo.attach or tone()) is an
//     exact LOW: the simulator's trace gets the same LOW (sim-run.ts), since the board's pin is an output before any waveform;
//   - a waveform that stops LOW stopped between its last regular falling edge and the rising edge that did not come; one that
//     stops HIGH, between its last rising edge and the falling edge that did not come; an early edge is an exact stop.
// The duty of a PWM run is its HIGH time over its period on the timer's scale: 255, or 256 on Timer0, where avr8js gives v/256
// (allowed difference `timer0-duty`). A servo's angle inverts Servo 1.3.0's pulse, 544 + angle × 1856 / 180 µs (contract §6.2).

export type RawChange = { readonly atUs: number; readonly state: RawPinState };

export type WaveformDecoding =
  | { readonly kind: 'pwm'; readonly periodUs: number; readonly scale: number }
  | { readonly kind: 'servo'; readonly frameUs: number; readonly minUs: number; readonly maxUs: number }
  | { readonly kind: 'tone'; readonly minHz: number; readonly maxHz: number };

/** A waveform is found from this many whole periods on (three rising edges): fewer cannot show a period. */
export const MIN_RUN_PERIODS = 2;

/** How far a period or a HIGH time may wander inside one run: hardware PWM is exact, interrupts make servo and tone pulses jitter. */
export function jitterUs(decoding: WaveformDecoding, periodUs: number): { period: number; high: number } {
  switch (decoding.kind) {
    case 'pwm':
      return { period: 4, high: 4 };
    case 'servo':
      return { period: Math.max(8, periodUs * 0.01), high: 4 };
    case 'tone':
      return { period: Math.max(8, periodUs * 0.01), high: Math.max(8, periodUs * 0.01) };
  }
}

function regular(decoding: WaveformDecoding, periodUs: number, highUs: number): boolean {
  if (!(highUs > 0 && highUs < periodUs)) {
    return false;
  }
  switch (decoding.kind) {
    case 'pwm':
      return Math.abs(periodUs - decoding.periodUs) <= jitterUs(decoding, periodUs).period;
    case 'servo':
      return Math.abs(periodUs - decoding.frameUs) <= decoding.frameUs * 0.01 && highUs >= decoding.minUs - 4 && highUs <= decoding.maxUs + 4;
    case 'tone':
      return periodUs >= (1e6 / decoding.maxHz) * 0.99 && periodUs <= (1e6 / decoding.minHz) * 1.01 && Math.abs(highUs - periodUs / 2) <= jitterUs(decoding, periodUs).high;
  }
}

const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? (sorted[middle] ?? 0) : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
};

const isOutput = (state: RawPinState | undefined) => state === 'LOW' || state === 'HIGH';

const levelState = (state: RawPinState): PinLogicalState =>
  isOutput(state) ? { kind: state === 'HIGH' ? 'high' : 'low' } : { kind: 'input', pullup: state === 'INPUT_PULLUP' };

function waveformState(decoding: WaveformDecoding, periodUs: number, highUs: number): PinLogicalState {
  switch (decoding.kind) {
    case 'pwm':
      return { kind: 'pwm', duty: Math.round((highUs / periodUs) * decoding.scale) };
    case 'servo':
      return { kind: 'servo', deg: Math.round(((highUs - decoding.minUs) * 180) / (decoding.maxUs - decoding.minUs)) };
    case 'tone':
      return { kind: 'tone', hz: 1e6 / periodUs };
  }
}

/** A run of steady periods: `first` and `last` index the rising edges that begin its first period and end its last one. */
export type Run = { readonly first: number; readonly last: number; readonly periodUs: number; readonly highUs: number };

/** The runs of regular, steady periods among the changes of a pin. */
export function findRuns(changes: readonly RawChange[], decoding: WaveformDecoding): Run[] {
  const periods: { rise: number; next: number; periodUs: number; highUs: number }[] = [];
  for (let rise = 1; rise + 2 < changes.length; rise++) {
    const [before, start, fall, next] = [changes[rise - 1], changes[rise], changes[rise + 1], changes[rise + 2]];
    if (before?.state === 'LOW' && start?.state === 'HIGH' && fall?.state === 'LOW' && next?.state === 'HIGH') {
      periods.push({ rise, next: rise + 2, periodUs: next.atUs - start.atUs, highUs: fall.atUs - start.atUs });
    }
  }
  const runs: Run[] = [];
  let chain: typeof periods = [];
  const close = () => {
    const head = chain[0];
    const tail = chain.at(-1);
    if (head && tail && chain.length >= MIN_RUN_PERIODS) {
      runs.push({ first: head.rise, last: tail.next, periodUs: median(chain.map((p) => p.periodUs)), highUs: median(chain.map((p) => p.highUs)) });
    }
    chain = [];
  };
  for (const period of periods) {
    if (!regular(decoding, period.periodUs, period.highUs)) {
      close();
      continue;
    }
    const head = chain[0];
    const jitter = jitterUs(decoding, period.periodUs);
    const continues =
      head !== undefined &&
      chain.at(-1)?.next === period.rise &&
      Math.abs(period.periodUs - head.periodUs) <= jitter.period &&
      Math.abs(period.highUs - head.highUs) <= jitter.high;
    if (!continues) {
      close();
    }
    chain.push(period);
  }
  close();
  return runs;
}

/**
 * The events of one pin from its recorded changes (µs from setup(), in order) and the state it had when setup() began. `endUs` is
 * how far the recording goes: a waveform still running then has no stop. Without `decoding`, every change is an exact event.
 */
export function decodePin(pin: string, initial: RawPinState, changes: readonly RawChange[], endUs: number, decoding?: WaveformDecoding): PinEvent[] {
  const events: PinEvent[] = [{ pin, state: levelState(initial), fromUs: 0, toUs: 0 }];
  const stateBefore = (index: number): RawPinState => (index > 0 ? (changes[index - 1]?.state ?? initial) : initial);
  let index = 0;
  /** The time of the last change an earlier event owns: a waveform cannot have started before it. */
  let settledUs = 0;
  const exactUpTo = (end: number) => {
    for (; index < end; index++) {
      const change = changes[index];
      if (change) {
        events.push({ pin, state: levelState(change.state), fromUs: change.atUs, toUs: change.atUs });
        settledUs = change.atUs;
      }
    }
  };
  if (!decoding) {
    exactUpTo(changes.length);
    return events;
  }

  const runs = findRuns(changes, decoding);
  for (const [k, run] of runs.entries()) {
    const at = (i: number) => changes[i]?.atUs ?? 0;
    const jitter = jitterUs(decoding, run.periodUs);
    const firstRiseUs = at(run.first);
    const windowUs = firstRiseUs - run.periodUs - jitter.period;
    // The lead-in: output edges after an output state, within one period before the first rise.
    let leadIn = run.first;
    while (leadIn > index && at(leadIn - 1) > windowUs && isOutput(stateBefore(leadIn - 1))) {
      leadIn--;
    }
    exactUpTo(leadIn);
    events.push({ pin, state: waveformState(decoding, run.periodUs, run.highUs), fromUs: Math.max(settledUs, windowUs), toUs: firstRiseUs });

    const lastRiseUs = at(run.last);
    index = run.last + 1;
    // The waveform could have changed at any time during its last period.
    settledUs = lastRiseUs - run.periodUs;
    const next = runs[k + 1];
    if (next && at(next.first) - lastRiseUs <= next.periodUs + run.periodUs + jitter.period) {
      continue; // the next waveform follows at once: its start is this one's stop
    }
    settledUs = lastRiseUs;
    const fall = changes[run.last + 1];
    const highEndUs = lastRiseUs + run.highUs + jitter.high;
    const lateOrNone = fall === undefined ? endUs > highEndUs : fall.atUs > highEndUs;
    if (fall?.state !== 'LOW' || fall.atUs > highEndUs) {
      // No fall on time after the last rise: the waveform stopped HIGH (the change after it, if any, is an event of its own).
      if (lateOrNone) {
        events.push({ pin, state: { kind: 'high' }, fromUs: lastRiseUs, toUs: highEndUs });
        settledUs = highEndUs;
      }
      continue;
    }
    if (fall.atUs < lastRiseUs + run.highUs - jitter.high) {
      continue; // an early fall: an exact LOW
    }
    // The last pulse ended on time. What came instead of the next rise says how the waveform stopped.
    const after = changes[run.last + 2];
    const riseDueUs = lastRiseUs + run.periodUs;
    index = run.last + 2;
    settledUs = fall.atUs;
    if (after === undefined) {
      if (endUs > riseDueUs + jitter.period) {
        events.push({ pin, state: { kind: 'low' }, fromUs: fall.atUs, toUs: riseDueUs + jitter.period });
      }
      continue; // otherwise still running when the recording ends
    }
    if (after.state === 'HIGH' && after.atUs < riseDueUs + jitter.period) {
      continue; // a rise before the one due: it stopped HIGH, exactly then (the rise is an exact HIGH)
    }
    events.push({ pin, state: { kind: 'low' }, fromUs: fall.atUs, toUs: Math.min(riseDueUs + jitter.period, after.atUs) });
  }
  exactUpTo(changes.length);
  return events;
}
