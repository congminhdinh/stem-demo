import { allowedDifferences as allowed, intervalRule, type AllowedDifferenceId } from './allowed-differences';
import type { LevelChange } from './inputs';
import type { SimCall } from './sim-run';
import { describeState, isExact, type PinEvent, type PinLogicalState, type PrintedLine } from './trace';

// The comparison of the two traces (N18 C2, ADR 0003 §7 condition 1): the events of every pin, one by one, and the lines printed;
// then, for each event, the interval since an anchor on both sides.
//
// An anchor is a moment both sides know: the start of setup(), a scripted input change (the same µs on both), or an earlier event
// the board shows exactly. An event's interval is taken from the last such event before it, and from the last input change when
// that is later (an LED that follows a button answers the press, not the event before). Each side's event is a range (the
// simulator's call, the board's timer period), so an interval is a range too; the deviation is how far the board's range lies
// from the simulator's (0 when they meet). It must lie within the interval rule widened by the allowed differences that apply
// (allowed-differences.ts), each named in the check.

export type IntervalCheck = {
  readonly pin: string;
  readonly state: string;
  readonly anchor: string;
  /** The simulator's interval, its longest: the length the shares apply to. */
  readonly spanUs: number;
  readonly deviationUs: number;
  /** The deviation allowed: board shorter by `belowUs`, longer by `aboveUs`. */
  readonly belowUs: number;
  readonly aboveUs: number;
  readonly applied: readonly (AllowedDifferenceId | 'interval')[];
  readonly ok: boolean;
};

export type Comparison = {
  readonly problems: string[];
  readonly checks: IntervalCheck[];
  /** The largest |deviation| of any interval, µs. */
  readonly maxDeviationUs: number;
  /** The largest |deviation| / span of an interval of 1 ms or more. */
  readonly maxLongShare: number;
  /** The same over the intervals without a printed line in them (the simulator charges no Serial time yet, contract §7). */
  readonly maxLongShareWithoutSerial: number;
};

export type CompareInput = {
  readonly sim: {
    events: readonly PinEvent[];
    lines: readonly PrintedLine[];
    calls: readonly SimCall[];
    loopStartsUs: readonly number[];
    sleeps: readonly Range[];
  };
  readonly board: { events: readonly PinEvent[]; lines: readonly PrintedLine[]; serialDoneUs: number };
  readonly inputChanges: readonly LevelChange[];
  readonly durationUs: number;
  /** The EN pins of the kit's H-bridges: a pwmWrite on one is a motorSet (allowed difference `helper-compute`). */
  readonly motorEnablePins: ReadonlySet<string>;
};

type Range = { readonly fromUs: number; readonly toUs: number };
type Pair = { readonly pin: string; readonly sim: PinEvent; readonly board: Range; readonly exact: boolean; readonly widenedBy?: AllowedDifferenceId };

/** Whether the board shows the state the simulator has (the board's duty is already on its timer's scale, board-trace.ts). */
export function sameState(sim: PinLogicalState, board: PinLogicalState): boolean {
  if (sim.kind !== board.kind) {
    return false;
  }
  switch (sim.kind) {
    case 'input':
      return board.kind === 'input' && sim.pullup === board.pullup;
    case 'pwm':
      return board.kind === 'pwm' && sim.duty === board.duty;
    case 'servo':
      return board.kind === 'servo' && sim.deg === board.deg;
    case 'tone':
      return board.kind === 'tone' && Math.abs(board.hz - sim.hz) <= sim.hz * allowed['tone-frequency'].share;
    default:
      return true;
  }
}

const utf8 = new TextEncoder();

/** The board time the contract §7 model gives a printed line at most, without the wait for room in the queue. */
export function serialLineUs(text: string): number {
  const model = allowed['serial-time'];
  let us = model.lineUs;
  for (const byte of utf8.encode(text)) {
    us += byte >= 0x30 && byte <= 0x39 ? model.digitUs : byte === 0x2d ? model.signUs : model.byteUs;
  }
  return us;
}

/** Per printed line, the board time it may take: its §7 cost and the wait when the TX queue (drained one frame per byte) is full. */
export function serialLineAllowances(lines: readonly PrintedLine[]): number[] {
  const frameUs = allowed['usart-frame'].frameUs;
  const capacity = allowed['tx-queue'].bytes;
  let busyUntilUs = 0;
  return lines.map((line) => {
    const bytes = utf8.encode(line.text).length + 2;
    const pending = Math.max(0, Math.ceil((busyUntilUs - line.atUs) / frameUs));
    const waitUs = Math.max(0, pending + bytes - capacity) * frameUs;
    busyUntilUs = Math.max(busyUntilUs, line.atUs) + bytes * frameUs;
    return serialLineUs(line.text) + waitUs;
  });
}

export function compareTraces(input: CompareInput): Comparison {
  const { sim, board } = input;
  const problems: string[] = [];

  // --- Serial values ---------------------------------------------------------------------------------------------------------
  const simText = sim.lines.map((line) => line.text);
  const boardText = board.lines.map((line) => line.text);
  if (JSON.stringify(simText) !== JSON.stringify(boardText)) {
    problems.push(`Serial: the simulator printed ${JSON.stringify(simText)}, the board ${JSON.stringify(boardText)}`);
  }
  if (board.serialDoneUs > input.durationUs) {
    problems.push(`Serial: the board was still sending at the end (${board.serialDoneUs.toFixed(1)} µs > ${input.durationUs} µs): the fixture is too short`);
  }

  // --- Pin events, one by one --------------------------------------------------------------------------------------------------
  const pins = [...new Set([...sim.events, ...board.events].map((event) => event.pin))];
  const pairs: Pair[] = [];
  for (const pin of pins) {
    const own = sim.events.filter((event) => event.pin === pin);
    const shown = board.events.filter((event) => event.pin === pin);
    const describe = (events: readonly PinEvent[]) => events.map((event) => describeState(event.state)).join(', ');
    const agree = own.length === shown.length && own.every((event, index) => sameState(event.state, (shown[index] as PinEvent).state));
    if (!agree) {
      problems.push(`${pin}: the simulator went ${describe(own)}; the board ${describe(shown)}`);
      continue;
    }
    own.forEach((event, index) => {
      const seen = shown[index] as PinEvent;
      if (index === 0) {
        return; // the state at setup(): compared, not timed
      }
      let range: Range = seen;
      let widenedBy: AllowedDifferenceId | undefined;
      // Servo 1.3.0's first pulse after attach() (allowed difference `servo-first-pulse`): from the pin's LOW on.
      const before = shown[index - 1];
      if (event.state.kind === 'servo' && before?.state.kind === 'low' && shown[index - 2]?.state.kind === 'input') {
        const rule = allowed['servo-first-pulse'];
        if (seen.toUs - before.toUs > rule.firstPulseAfterAttachUs + rule.slackUs) {
          problems.push(`${pin}: the first servo pulse came ${(seen.toUs - before.toUs).toFixed(1)} µs after attach(), more than ${rule.firstPulseAfterAttachUs} µs`);
        }
        range = { fromUs: before.fromUs, toUs: seen.toUs };
        widenedBy = 'servo-first-pulse';
      }
      pairs.push({ pin, sim: event, board: range, exact: isExact(seen) && range === seen, ...(widenedBy ? { widenedBy } : {}) });
    });
  }

  // --- Intervals -------------------------------------------------------------------------------------------------------------
  pairs.sort((a, b) => a.sim.toUs - b.sim.toUs);
  const start = { name: 'setup()', sim: { fromUs: 0, toUs: 0 }, board: { fromUs: 0, toUs: 0 } };
  const inputAnchors = [...input.inputChanges]
    .filter((change) => change.atUs > 0)
    .sort((a, b) => a.atUs - b.atUs)
    .map((change) => ({ name: `${change.pin} ${change.level ? 'HIGH' : 'LOW'} (input)`, sim: { fromUs: change.atUs, toUs: change.atUs }, board: { fromUs: change.atUs, toUs: change.atUs } }));
  const lineAllowances = serialLineAllowances(sim.lines);
  const waveforms = sim.events
    .map((event, index, all) => ({ event, untilUs: all.slice(index + 1).find((next) => next.pin === event.pin)?.fromUs ?? Infinity }))
    .filter(({ event }) => event.state.kind === 'tone' || event.state.kind === 'servo');

  const checks: IntervalCheck[] = [];
  let pinAnchor: typeof start = start;
  for (const pair of pairs) {
    const candidates = [pinAnchor];
    const lastInput = inputAnchors.filter((anchor) => anchor.sim.toUs <= pair.sim.toUs).at(-1);
    if (lastInput && lastInput.sim.toUs > pinAnchor.sim.toUs) {
      candidates.push(lastInput);
    }
    const options = candidates.map((anchor) => checkInterval(pair, anchor, { input, lineAllowances, waveforms }));
    // The tightest check that holds: the latest anchor it holds from; otherwise the one it misses by least.
    const excess = (check: IntervalCheck) => Math.max(-check.belowUs - check.deviationUs, check.deviationUs - check.aboveUs);
    const best = options.filter((option) => option.ok).at(-1) ?? options.reduce((a, b) => (excess(a) <= excess(b) ? a : b));
    checks.push(best);
    if (!best.ok) {
      problems.push(
        `${pair.pin} ${best.state}: ${best.deviationUs.toFixed(2)} µs from ${best.anchor} over ${best.spanUs.toFixed(2)} µs, allowed −${best.belowUs.toFixed(2)}…+${best.aboveUs.toFixed(2)} (${best.applied.join(', ')})`,
      );
    }
    if (pair.exact) {
      pinAnchor = { name: `${pair.pin} ${describeState(pair.sim.state)}`, sim: pair.sim, board: pair.board };
    }
  }

  const long = checks.filter((check) => check.spanUs >= intervalRule.longFromUs);
  const share = (selected: readonly IntervalCheck[]) => Math.max(0, ...selected.map((check) => Math.abs(check.deviationUs) / check.spanUs));
  return {
    problems,
    checks,
    maxDeviationUs: Math.max(0, ...checks.map((check) => Math.abs(check.deviationUs))),
    maxLongShare: share(long),
    maxLongShareWithoutSerial: share(long.filter((check) => !check.applied.includes('serial-time'))),
  };
}

function checkInterval(
  pair: Pair,
  anchor: { name: string; sim: Range; board: Range },
  context: { input: CompareInput; lineAllowances: readonly number[]; waveforms: readonly { event: PinEvent; untilUs: number }[] },
): IntervalCheck {
  const { input, lineAllowances, waveforms } = context;
  const sim = { lo: pair.sim.fromUs - anchor.sim.toUs, hi: pair.sim.toUs - anchor.sim.fromUs };
  const board = { lo: pair.board.fromUs - anchor.board.toUs, hi: pair.board.toUs - anchor.board.fromUs };
  const spanUs = sim.hi;
  const fromUs = anchor.sim.fromUs;
  const toUs = pair.sim.toUs;
  const applied: IntervalCheck['applied'][number][] = ['interval'];
  let belowUs: number;
  let aboveUs: number;
  if (spanUs >= intervalRule.longFromUs) {
    belowUs = aboveUs = spanUs * intervalRule.longShare;
  } else {
    belowUs = aboveUs = spanUs * allowed['call-costs'].shortShare;
    applied.push('call-costs');
  }
  const callsIn = (name: SimCall['name']) => input.sim.calls.filter((call) => call.name === name && call.fromUs >= fromUs && call.fromUs < toUs);

  // Interrupts: in a short interval one of each source that runs; in any interval the load of a playing tone on the time the
  // program computes (a delay() runs on micros(), which interrupts do not stretch).
  const isr = allowed['isr-load'];
  const servoOn = waveforms.some(({ event }) => event.state.kind === 'servo' && event.toUs < toUs);
  if (spanUs < intervalRule.longFromUs) {
    aboveUs += isr.timer0IsrUs * (Math.floor(spanUs / isr.timer0PeriodUs) + 1) + (servoOn ? isr.servoFrameUs : 0);
    applied.push('isr-load');
  }
  const intersect = (a: Range, b: Range): Range => {
    const from = Math.max(a.fromUs, b.fromUs);
    return { fromUs: from, toUs: Math.max(from, Math.min(a.toUs, b.toUs)) };
  };
  const length = (range: Range) => range.toUs - range.fromUs;
  for (const { event, untilUs } of waveforms.filter(({ event }) => event.state.kind === 'tone')) {
    const playing = intersect({ fromUs: event.fromUs, toUs: untilUs }, { fromUs, toUs });
    const computingUs = length(playing) - input.sim.sleeps.reduce((sum, sleep) => sum + length(intersect(sleep, playing)), 0);
    if (computingUs <= 0) {
      continue;
    }
    const hz = event.state.kind === 'tone' ? event.state.hz : 0;
    aboveUs += computingUs * hz * isr.toneSharePerHz + (spanUs < intervalRule.longFromUs ? isr.toneIsrUs * (Math.floor((computingUs * 2 * hz) / 1e6) + 1) : 0);
    if (!applied.includes('isr-load')) {
      applied.push('isr-load');
    }
  }

  // Serial lines printed in the interval: the board spends their time, the simulator none.
  const printed = input.sim.lines.flatMap((line, index) => (line.atUs >= fromUs && line.atUs < toUs ? [lineAllowances[index] ?? 0] : []));
  if (printed.length > 0) {
    aboveUs += printed.reduce((sum, us) => sum + us, 0);
    applied.push('serial-time');
  }
  // loop() iterations under way in it: the simulator charges LOOP_MIN_US as each begins, so one that began up to that long before
  // the anchor counts too.
  const loopUs = allowed['loop-min-us'].simUsPerIteration;
  const loops = input.sim.loopStartsUs.filter((atUs) => atUs > fromUs - loopUs && atUs < toUs).length;
  if (loops > 0) {
    belowUs += loops * loopUs;
    applied.push('loop-min-us');
  }
  // motorSet's own arithmetic, which the simulator does not charge.
  const motorSets = callsIn('pwmWrite').filter((call) => call.pin !== null && input.motorEnablePins.has(call.pin)).length;
  if (motorSets > 0) {
    aboveUs += motorSets * allowed['helper-compute'].motorSetUs;
    applied.push('helper-compute');
  }
  // tone() costs by its frequency's prescaler band, the simulator costsUs.tone.
  const toneCalls = callsIn('tone');
  if (toneCalls.length > 0) {
    const rule = allowed['tone-call-cost'];
    for (const call of toneCalls) {
      const hz = call.args[0] ?? 0;
      const band = [...rule.bands].reverse().find((candidate) => hz >= candidate.fromHz) ?? rule.bands[0];
      aboveUs += Math.max(0, band.us - rule.simUs);
      belowUs += Math.max(0, rule.simUs - Math.min(band.us, rule.replacingUs));
    }
    applied.push('tone-call-cost');
  }
  if (!pair.exact) {
    applied.push('waveform-phase');
  }
  if (pair.widenedBy) {
    applied.push(pair.widenedBy);
  }

  // How far the board's range of intervals lies from the simulator's: 0 when they meet.
  const deviationUs = board.lo > sim.hi ? board.lo - sim.hi : board.hi < sim.lo ? board.hi - sim.lo : 0;
  return {
    pin: pair.pin,
    state: describeState(pair.sim.state),
    anchor: anchor.name,
    spanUs,
    deviationUs,
    belowUs,
    aboveUs,
    applied,
    ok: deviationUs >= -belowUs && deviationUs <= aboveUs,
  };
}
