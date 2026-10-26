import { allowedDifferences } from './allowed-differences';
import type { RawPinState } from './emulated-uno';
import type { PinEvent, PinLogicalState } from './trace';

// The L2e side's trace (N18 C2): the edges avr8js recorded on one pin, read back into the harness's events (trace.ts). A pin that
// carries no waveform (an H-bridge IN pin, an LED, a trigger) gives one exact event per edge. A pin the kit drives with a timer is
// also searched for its waveform: a run of at least MIN_RUN_PERIODS periods of the same length and the same HIGH time is one
// waveform event (PWM of a duty, a servo angle, a tone).
//
// When does the change happen? The hardware shows it at the timer's next period, after the call (allowed difference
// `waveform-phase`: contract §5.1, §6.2, §6.3), so a waveform's start or stop is a time range:
//   - a waveform starts within one period before its first rising edge (two from a steady HIGH, whose first period shows only its
//     fall), and after the event before it; the output edges in between are its lead-in, not events of their own. A pin leaving INPUT (the pinMode inside Servo.attach or tone()) is an
//     exact LOW: the simulator's trace gets the same LOW (sim-run.ts), since the board's pin is an output before any waveform;
//   - a waveform that stops LOW stopped between its last regular falling edge and the rising edge that did not come; one that
//     stops HIGH, between its last rising edge and the falling edge that did not come; an early edge is an exact stop.
// The duty of a PWM run is its HIGH time over its period on the timer's scale: 255, or 256 on Timer0, where avr8js gives v/256
// (allowed difference `timer0-duty`). A servo's angle inverts Servo 1.3.0's pulse, 544 + angle × 1856 / 180 µs (contract §6.2).

export type RawChange = { readonly atUs: number; readonly state: RawPinState };

export type WaveformDecoding =
  | { readonly kind: 'pwm'; readonly periodUs: number; readonly scale: number }
  /**
   * N19 C2: `highUs`, a servo's own HIGH-time jitter (waveform-jitter: 6 µs on the gripper car, whose TWI interrupt holds the Servo's).
   * `timerWrapExtraUs` (servo-first-pulse, timerWrapUs): this servo is not the first on Timer1, so it may pulse once at Timer1's first wrap
   * after attach(), and that first period is a frame and at most this much longer (the widest pulse the servos before it can send). Absent:
   * no such pulse is joined to a run (a single servo, the rover's).
   */
  | {
      readonly kind: 'servo';
      readonly frameUs: number;
      readonly minUs: number;
      readonly maxUs: number;
      readonly highUs?: number;
      readonly timerWrapExtraUs?: number;
    }
  | { readonly kind: 'tone'; readonly minHz: number; readonly maxHz: number };

const wander = allowedDifferences['waveform-jitter'];
const firstServoPulse = allowedDifferences['servo-first-pulse'];

/** A waveform is found from this many whole periods on (three rising edges): fewer cannot show a period (waveform-jitter). */
export const MIN_RUN_PERIODS = wander.minRunPeriods;

/** How far a period or a HIGH time may wander inside one run (allowed difference `waveform-jitter`). */
export function jitterUs(decoding: WaveformDecoding, periodUs: number): { period: number; high: number } {
  switch (decoding.kind) {
    case 'pwm':
      return { period: wander.pwm.periodUs, high: wander.pwm.highUs };
    case 'servo':
      return { period: Math.max(wander.servo.periodMinUs, periodUs * wander.servo.frameShare), high: decoding.highUs ?? wander.servo.highUs };
    case 'tone': {
      const us = Math.max(wander.tone.minUs, periodUs * wander.tone.share);
      return { period: us, high: us };
    }
  }
}

function regular(decoding: WaveformDecoding, periodUs: number, highUs: number): boolean {
  if (!(highUs > 0 && highUs < periodUs)) {
    return false;
  }
  switch (decoding.kind) {
    case 'pwm':
      return Math.abs(periodUs - decoding.periodUs) <= jitterUs(decoding, periodUs).period;
    case 'servo': {
      const slack = wander.servo.widthSlackUs;
      return Math.abs(periodUs - decoding.frameUs) <= decoding.frameUs * wander.servo.frameShare && highUs >= decoding.minUs - slack && highUs <= decoding.maxUs + slack;
    }
    case 'tone': {
      const share = wander.tone.share;
      return periodUs >= (1e6 / decoding.maxHz) * (1 - share) && periodUs <= (1e6 / decoding.minHz) * (1 + share) && Math.abs(highUs - periodUs / 2) <= jitterUs(decoding, periodUs).high;
    }
  }
}

/** N19 C2: a servo's first period after a pulse at Timer1's wrap: a frame, up to `extraUs` (the pulse of the servo before it) longer. */
function regularFirstFrame(decoding: WaveformDecoding, periodUs: number, highUs: number, extraUs: number): boolean {
  if (decoding.kind !== 'servo' || !(highUs > 0 && highUs < periodUs)) {
    return false;
  }
  const share = wander.servo.frameShare;
  return periodUs >= decoding.frameUs * (1 - share) && periodUs <= decoding.frameUs * (1 + share) + extraUs && highUs >= decoding.minUs - wander.servo.widthSlackUs && highUs <= decoding.maxUs + wander.servo.widthSlackUs;
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

/**
 * The index of the rise of a servo's first pulse after attach() among the changes of a pin: the HIGH right after the LOW that ends its INPUT
 * (attach() sets the pin OUTPUT, LOW), when its state at setup() or the change before that LOW is INPUT; -1 when there is none.
 */
function firstPulseAfterAttach(changes: readonly RawChange[], initial: RawPinState): number {
  for (let index = 0; index + 1 < changes.length; index++) {
    const before = index > 0 ? changes[index - 1]?.state : initial;
    if (changes[index]?.state === 'LOW' && (before === 'INPUT' || before === 'INPUT_PULLUP') && changes[index + 1]?.state === 'HIGH') {
      return index + 1;
    }
  }
  return -1;
}

/**
 * The runs of regular, steady periods among the changes of a pin (`initial`: its state at setup()). A run's periods keep the length and
 * the HIGH time of its first within waveform-jitter; for a servo whose run begins with the first pulse after attach(), that pulse joins the
 * run when its width is within servo-first-pulse's firstWidthUs of the next one's, and the run's later periods are held to that next one.
 */
export function findRuns(changes: readonly RawChange[], decoding: WaveformDecoding, initial: RawPinState = 'INPUT'): Run[] {
  const attachRise = decoding.kind === 'servo' ? firstPulseAfterAttach(changes, initial) : -1;
  // N19 C2 (servo-first-pulse, timerWrapUs): a servo that is not the first on Timer1 (its decoding says by how much: timerWrapExtraUs)
  // pulses once at Timer1's first wrap after attach(), and its first period is longer by the pulse of the servo before it. Only such a
  // decoding, and only a first pulse at that wrap, get the longer first period: a single servo (the rover's) has neither.
  const wrapExtraUs = decoding.kind === 'servo' ? (decoding.timerWrapExtraUs ?? 0) : 0;
  const attachLowUs = attachRise > 0 ? (changes[attachRise - 1]?.atUs ?? 0) : 0;
  const atTimerWrap =
    wrapExtraUs > 0 && attachRise > 0 && Math.abs((changes[attachRise]?.atUs ?? 0) - attachLowUs - firstServoPulse.timerWrapUs) <= firstServoPulse.slackUs;
  const firstFrameExtraUs = atTimerWrap ? wrapExtraUs : 0;
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
    const longFirstFrame = period.rise === attachRise && firstFrameExtraUs > 0 && regularFirstFrame(decoding, period.periodUs, period.highUs, firstFrameExtraUs);
    if (!regular(decoding, period.periodUs, period.highUs) && !longFirstFrame) {
      close();
      continue;
    }
    const head = chain[0];
    const jitter = jitterUs(decoding, period.periodUs);
    const fromAttach = head !== undefined && head.rise === attachRise;
    // The steady pulses are held to the first of them: after the pulse of attach(), the one that follows it.
    const reference = fromAttach && chain.length >= 2 ? chain[1] : head;
    const highAllowanceUs = fromAttach && chain.length === 1 ? firstServoPulse.firstWidthUs : jitter.high;
    // The first frame after a pulse at Timer1's wrap is longer by the pulse before it (N19 C2): the next period is held to the frame.
    const periodAllowanceUs = fromAttach && chain.length === 1 ? jitter.period + firstFrameExtraUs : jitter.period;
    const continues =
      reference !== undefined &&
      chain.at(-1)?.next === period.rise &&
      Math.abs(period.periodUs - reference.periodUs) <= periodAllowanceUs &&
      Math.abs(period.highUs - reference.highUs) <= highAllowanceUs;
    if (!continues) {
      close();
    }
    chain.push(period);
  }
  close();
  return decoding.kind === 'tone' ? [...runs, ...shortTones(changes, runs, decoding)].sort((a, b) => a.first - b.first) : runs;
}

/**
 * A tone too short for a run (allowed difference `tone-duration`: floor(2 · hz · ms / 1000) half periods, so 31 Hz for 40 ms is one
 * pulse): one or two pulses on the buzzer's pin, which nothing but tone() drives HIGH, each a half period long, the second a period
 * after the first. Its frequency is its period, or twice its pulse.
 */
function shortTones(changes: readonly RawChange[], runs: readonly Run[], decoding: Extract<WaveformDecoding, { kind: 'tone' }>): Run[] {
  const share = wander.tone.share;
  // A pulse right before a run (its lead-in: an irregular first toggle) or right after one belongs to that run.
  const inRun = (index: number) => runs.some((run) => (index >= run.first && index <= run.last + 1) || index + 2 === run.first || index - 1 === run.last + 1);
  const pulses: { rise: number; highUs: number }[] = [];
  for (let rise = 1; rise + 1 < changes.length; rise++) {
    const [before, start, fall] = [changes[rise - 1], changes[rise], changes[rise + 1]];
    const highUs = (fall?.atUs ?? 0) - (start?.atUs ?? 0);
    const halfUs = (fromHz: number) => 1e6 / (2 * fromHz);
    if (before?.state === 'LOW' && start?.state === 'HIGH' && fall?.state === 'LOW' && !inRun(rise) && highUs >= halfUs(decoding.maxHz) * (1 - share) && highUs <= halfUs(decoding.minHz) * (1 + share)) {
      pulses.push({ rise, highUs });
    }
  }
  const found: Run[] = [];
  for (let k = 0; k < pulses.length; k++) {
    const first = pulses[k] as (typeof pulses)[number];
    const second = pulses[k + 1];
    const periodUs = second ? (changes[second.rise]?.atUs ?? 0) - (changes[first.rise]?.atUs ?? 0) : 0;
    const wanders = jitterUs(decoding, 2 * first.highUs);
    if (second && second.rise === first.rise + 2 && Math.abs(periodUs - 2 * first.highUs) <= wanders.period && Math.abs(second.highUs - first.highUs) <= wanders.high) {
      found.push({ first: first.rise, last: second.rise, periodUs, highUs: (first.highUs + second.highUs) / 2 });
      k += 1;
    } else {
      found.push({ first: first.rise, last: first.rise, periodUs: 2 * first.highUs, highUs: first.highUs });
    }
  }
  return found;
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

  const runs = findRuns(changes, decoding, initial);
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
    // From a steady HIGH the waveform's first period shows no rise (the pin is HIGH already when the timer sets it), only its fall:
    // the first whole period is the second one, so the waveform began up to two periods before its first rise.
    const fromHigh = stateBefore(leadIn) === 'HIGH' && leadIn < run.first;
    const startUs = fromHigh ? windowUs - run.periodUs : windowUs;
    events.push({ pin, state: waveformState(decoding, run.periodUs, run.highUs), fromUs: Math.max(settledUs, startUs), toUs: firstRiseUs });

    const lastRiseUs = at(run.last);
    index = run.last + 1;
    // The waveform could have changed at any time during its last period.
    settledUs = lastRiseUs - run.periodUs;
    const next = runs[k + 1];
    // The next waveform follows at once: its start is this one's stop. A tone toggles on, so its next rise comes within half a
    // period (of either tone) of the last fall; a timer PWM or servo, within a period of each.
    const follows =
      next !== undefined &&
      (decoding.kind === 'tone' && changes[run.last + 1]?.state === 'LOW' && next.first === run.last + 2
        ? at(next.first) - at(run.last + 1) <= Math.max(run.periodUs, next.periodUs) / 2 + jitter.period
        : at(next.first) - lastRiseUs <= next.periodUs + run.periodUs + jitter.period);
    if (follows) {
      continue;
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
