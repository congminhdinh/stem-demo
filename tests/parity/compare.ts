import { unoContract } from '../../src/core/compat/uno-contract';
import { allowedDifferences as allowed, intervalRule, type AllowedDifferenceId } from './allowed-differences';
import type { LevelChange } from './inputs';
import type { SimCall, SimLine, ToneForm } from './sim-run';
import { describeState, isExact, type PinEvent, type PinLogicalState, type PrintedLine } from './trace';

// The comparison of the two traces (N18 C2, ADR 0003 §7 condition 1): the events of every pin, one by one, and the lines printed;
// then, for each pin event and each line, the interval from the anchor it depends on, on both sides.
//
// An anchor is a moment both sides know: the start of setup(), an earlier event the board shows exactly, or a scripted input change
// (the same µs on both). An event depends on the last exact event before it, unless the program read an input pin after that pin
// last changed and before the event: then on that change (an LED that follows a button answers the press). Each side's event is a
// range (the simulator's call, the board's timer period), so an interval is a range too; the deviation is how far the board's
// range lies from the simulator's (0 when they meet).
//
// What may differ, part by part of the interval on the simulator (allowed-differences.ts): its waits (delay, pulseIn) ±1 %; its
// Arduino calls shorter on the board by up to the call-cost share, its node costs and loop() minimums shorter by all of them; the
// board longer by the interrupts on its calls and statements and by the Serial time the simulator does not charge. A line printed
// leaves the USART between its print and the end of its §7 cost, or right after the line before it has gone out.

export type IntervalCheck = {
  readonly what: string;
  readonly anchor: string;
  /** The simulator's interval, its longest. */
  readonly spanUs: number;
  /** Of it: the waits, the Arduino calls, the node costs (µs). */
  readonly waitUs: number;
  readonly callUs: number;
  readonly nodeUs: number;
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
  readonly lineChecks: IntervalCheck[];
  /** The largest |deviation| of any pin interval, µs. */
  readonly maxDeviationUs: number;
  /** The largest |deviation| / span of a pin interval of 1 ms or more. */
  readonly maxLongShare: number;
  /** The same over the intervals without a printed line in them (the simulator charges no Serial time yet, contract §7). */
  readonly maxLongShareWithoutSerial: number;
  /** The largest |deviation| of a line's start on the USART, µs. */
  readonly maxLineDeviationUs: number;
};

type Range = { readonly fromUs: number; readonly toUs: number };

export type CompareInput = {
  readonly sim: {
    events: readonly PinEvent[];
    lines: readonly SimLine[];
    calls: readonly SimCall[];
    loopStartsUs: readonly number[];
    sleeps: readonly Range[];
    nodesUs: readonly number[];
  };
  readonly board: { events: readonly PinEvent[]; lines: readonly PrintedLine[]; serialDoneUs: number; unfinishedLine: string };
  readonly inputChanges: readonly LevelChange[];
  readonly durationUs: number;
  /** The sketch begins setup() with Serial.begin(9600) (it prints). */
  readonly prints: boolean;
  /** How the sketch writes each tone()'s frequency, by the statement's block (allowed difference `tone-fold`). */
  readonly toneForms?: ReadonlyMap<string, ToneForm>;
};

type Pair = {
  readonly what: string;
  readonly pin: string;
  readonly sim: Range & { state: PinLogicalState };
  readonly board: Range;
  readonly exact: boolean;
  readonly widenedBy?: AllowedDifferenceId;
  /** The period of the tone that ended by itself here (allowed difference `tone-duration`). */
  readonly toneEndPeriodUs?: number;
};
type Anchor = { readonly name: string; readonly sim: Range; readonly board: Range };

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
const bytesOf = (text: string) => utf8.encode(text).length + 2;

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
  let delayUs = 0;
  return lines.map((line) => {
    // The board prints the line later by the Serial time of the lines before it (the simulator charges none).
    const atUs = line.atUs + delayUs;
    const bytes = bytesOf(line.text);
    const pending = Math.max(0, Math.ceil((busyUntilUs - atUs) / frameUs));
    const waitUs = Math.max(0, pending + bytes - capacity) * frameUs;
    busyUntilUs = Math.max(busyUntilUs, atUs) + bytes * frameUs;
    const us = serialLineUs(line.text) + waitUs;
    delayUs += us;
    return us;
  });
}

/** The first instant (µs from setup()) at which millis() gives `value`, by the board's model (contract §4.3): n + floor(3n / 125). */
export function millisInstantUs(value: number): number {
  const { overflowUs, fractPerOverflow, fractMax } = unoContract.millis;
  let n = 0;
  while (n + Math.floor((fractPerOverflow * n) / fractMax) < value) {
    n += 1;
  }
  return n * overflowUs;
}

/**
 * What the contract charges this tone() call (contract §4.4 toneUs, as the virtual UNO does): its frequency's band, on a silent pin or
 * on the one that plays; a tone() on another pin while one plays (which does nothing, ARD-03) the table's tone cost.
 */
function contractToneUs(call: SimCall, events: readonly PinEvent[]): number {
  const hz = call.args[0] ?? 0;
  const bands = unoContract.toneUs.bands;
  const band = bands.filter((candidate) => hz >= candidate.fromHz).at(-1) ?? (bands[0] as (typeof bands)[number]);
  const lastBefore = new Map<string, PinEvent>();
  for (const event of events) {
    if (event.toUs <= call.fromUs) {
      lastBefore.set(event.pin, event);
    }
  }
  const playing = [...lastBefore.values()].find((event) => event.state.kind === 'tone');
  return playing === undefined ? band.silentUs : playing.pin === call.pin ? band.playingUs : unoContract.costsUs.tone;
}

const intersect = (a: Range, b: Range): Range => {
  const from = Math.max(a.fromUs, b.fromUs);
  return { fromUs: from, toUs: Math.max(from, Math.min(a.toUs, b.toUs)) };
};
const length = (range: Range) => range.toUs - range.fromUs;
/** How far range `board` lies from range `sim`: 0 when they meet, positive when the board's is later. */
const gap = (board: Range, sim: Range) => (board.fromUs > sim.toUs ? board.fromUs - sim.toUs : board.toUs < sim.fromUs ? board.toUs - sim.fromUs : 0);

export function compareTraces(input: CompareInput): Comparison {
  const { sim, board } = input;
  const problems: string[] = [];

  // --- Serial values ---------------------------------------------------------------------------------------------------------
  const simText = sim.lines.map((line) => line.text);
  const boardText = board.lines.map((line) => line.text);
  if (JSON.stringify(simText) !== JSON.stringify(boardText)) {
    problems.push(`Serial: the simulator printed ${JSON.stringify(simText)}, the board ${JSON.stringify(boardText)}`);
  }
  if (board.unfinishedLine !== '' || board.serialDoneUs > input.durationUs) {
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
      // Servo 1.3.0's first pulse after attach() (allowed difference `servo-first-pulse`): timed from the pin's LOW, and only for the
      // simulator's servo of its attach call.
      const before = shown[index - 1];
      if (event.state.kind === 'servo' && before?.state.kind === 'low' && shown[index - 2]?.state.kind === 'input') {
        const rule = allowed['servo-first-pulse'];
        const limitUs = rule.firstPulseAfterAttachUs + rule.slackUs;
        if (seen.toUs - before.toUs > limitUs) {
          problems.push(`${pin}: the first servo pulse came ${(seen.toUs - before.toUs).toFixed(1)} µs after attach(), more than ${limitUs} µs`);
        }
        const attach = sim.calls.find((call) => call.name === 'servoWrite' && call.pin === pin);
        if (!attach || attach.fromUs !== event.fromUs || attach.toUs !== event.toUs) {
          problems.push(`${pin}: the simulator’s first servo event (${event.fromUs}…${event.toUs} µs) is not its attach call`);
        }
        range = { fromUs: before.fromUs, toUs: seen.toUs };
        widenedBy = 'servo-first-pulse';
      }
      // A tone that ran out by itself (no tone() or noTone() call ends it): the board stops after its last whole half period.
      const previous = own[index - 1]?.state;
      const byItself = event.state.kind === 'low' && previous?.kind === 'tone' && !sim.calls.some((call) => (call.name === 'tone' || call.name === 'noTone') && call.pin === pin && call.fromUs <= event.toUs && call.toUs >= event.fromUs);
      pairs.push({
        what: `${pin} ${describeState(event.state)}`,
        pin,
        sim: event,
        board: range,
        exact: isExact(seen) && range === seen,
        ...(widenedBy ? { widenedBy } : {}),
        ...(byItself && previous?.kind === 'tone' ? { toneEndPeriodUs: 1e6 / previous.hz } : {}),
      });
    });
  }

  // --- Anchors ---------------------------------------------------------------------------------------------------------------
  pairs.sort((a, b) => a.sim.toUs - b.sim.toUs);
  const exactAnchors: Anchor[] = [{ name: 'setup()', sim: { fromUs: 0, toUs: 0 }, board: { fromUs: 0, toUs: 0 } }];
  const inputs = [...input.inputChanges].filter((change) => change.atUs > 0).sort((a, b) => a.atUs - b.atUs);
  const reads = sim.calls.filter((call) => call.name === 'digitalRead');
  /**
   * Whether the program was waiting on `change`: it read the pin before the change and again after it, before `toUs`, with no
   * delay() between the two reads (it polled the pin, so its next step follows the change, not its own pace).
   */
  const polled = (change: LevelChange, toUs: number) => {
    const own = reads.filter((call) => call.pin === change.pin);
    const before = own.filter((call) => call.toUs <= change.atUs).at(-1);
    const after = own.find((call) => call.fromUs >= change.atUs && call.toUs <= toUs);
    return before !== undefined && after !== undefined && !sim.sleeps.some((sleep) => sleep.fromUs >= before.toUs && sleep.toUs <= after.fromUs);
  };
  // The moments millis() turned to a value the program polled for (allowed difference `millis-origin`): two reads with no
  // delay() between them, the second one higher. Both sides compute millis() from the same model, from the start of setup() on the
  // simulator and from Timer0's start, a few µs before it, on the board.
  const millisCalls = sim.calls.filter((call) => call.name === 'millis' && call.result !== undefined);
  const origin = allowed['millis-origin'];
  const timeAnchors: Anchor[] = millisCalls.flatMap((call, index) => {
    const before = millisCalls[index - 1];
    if (!before || (call.result ?? 0) <= (before.result ?? 0) || sim.sleeps.some((sleep) => sleep.fromUs >= before.toUs && sleep.toUs <= call.fromUs)) {
      return [];
    }
    const atUs = millisInstantUs(call.result ?? 0);
    return [{ name: `millis() = ${String(call.result)}`, sim: { fromUs: atUs, toUs: atUs }, board: { fromUs: atUs - origin.timer0BeforeSetupUs, toUs: atUs } }];
  });
  /**
   * The anchor an event at `toUs` depends on: the last exact one before it, or a later input change or millis() value the program
   * polled for (its next step follows that moment, not its own pace).
   */
  const anchorOf = (toUs: number, exactBefore: Anchor): Anchor => {
    const changes: Anchor[] = inputs
      .filter((change) => change.atUs > exactBefore.sim.toUs && change.atUs <= toUs && polled(change, toUs))
      .map((change) => ({ name: `${change.pin} ${change.level ? 'HIGH' : 'LOW'} (input)`, sim: { fromUs: change.atUs, toUs: change.atUs }, board: { fromUs: change.atUs, toUs: change.atUs } }));
    const ticks = timeAnchors.filter((anchor) => anchor.sim.toUs > exactBefore.sim.toUs && anchor.sim.toUs <= toUs);
    return [exactBefore, ...changes, ...ticks].reduce((latest, anchor) => (anchor.sim.toUs > latest.sim.toUs ? anchor : latest));
  };
  const lineAllowances = serialLineAllowances(sim.lines);
  const context: Context = { input, lineAllowances };

  const checks: IntervalCheck[] = [];
  for (const pair of pairs) {
    const exactBefore = exactAnchors.filter((anchor) => anchor.sim.toUs <= pair.sim.toUs).at(-1) as Anchor;
    const check = checkInterval(pair.what, pair.sim, pair.board, anchorOf(pair.sim.toUs, exactBefore), context, { exact: pair.exact, widenedBy: pair.widenedBy, toneEndPeriodUs: pair.toneEndPeriodUs });
    checks.push(check);
    if (!check.ok) {
      problems.push(describeProblem(check));
    }
    if (pair.exact) {
      exactAnchors.push({ name: pair.what, sim: pair.sim, board: pair.board });
    }
  }

  // --- Serial lines on the USART ---------------------------------------------------------------------------------------------
  const lineChecks: IntervalCheck[] = [];
  if (simText.length === boardText.length) {
    const frameUs = allowed['usart-frame'].frameUs;
    sim.lines.forEach((line, index) => {
      const shown = board.lines[index] as PrintedLine;
      const before = board.lines[index - 1];
      // The first byte leaves between the print (its statement's start for a join: join-by-parts) and the end of its §7 cost.
      const from = line.join ? line.statementUs : line.atUs;
      const simRange = { fromUs: from, toUs: line.atUs + serialLineUs(line.text) };
      // Anchored before its print begins: what the program did after it cannot move it.
      const exactBefore = exactAnchors.filter((anchor) => anchor.sim.toUs <= simRange.fromUs).at(-1) as Anchor;
      const what = `line ${index + 1} ${JSON.stringify(line.text)}`;
      const check = checkInterval(what, simRange, { fromUs: shown.atUs, toUs: shown.atUs }, anchorOf(simRange.fromUs, exactBefore), context, {
        exact: true,
        ownLine: index,
        join: line.join,
      });
      // Or it waited for the line before it to go out (usart-frame, tx-queue): it starts as that line ends, ±1 % of that line's
      // frames, and its print was not later than the board's start allows.
      let result = check;
      if (before && !check.ok && check.deviationUs >= -check.belowUs) {
        const framesUs = bytesOf(before.text) * frameUs;
        const deviationUs = shown.atUs - (before.atUs + framesUs);
        const allowedUs = intervalRule.waitShare * framesUs;
        result = {
          what,
          anchor: `line ${index} on the USART`,
          spanUs: framesUs,
          waitUs: framesUs,
          callUs: 0,
          nodeUs: 0,
          deviationUs,
          belowUs: allowedUs,
          aboveUs: allowedUs,
          applied: ['interval', 'usart-frame', 'tx-queue'],
          ok: Math.abs(deviationUs) <= allowedUs,
        };
      }
      lineChecks.push(result);
      if (!result.ok) {
        problems.push(describeProblem(result));
      }
    });
  }

  const long = checks.filter((check) => check.spanUs >= intervalRule.longFromUs);
  const share = (selected: readonly IntervalCheck[]) => Math.max(0, ...selected.map((check) => Math.abs(check.deviationUs) / check.spanUs));
  return {
    problems,
    checks,
    lineChecks,
    maxDeviationUs: Math.max(0, ...checks.map((check) => Math.abs(check.deviationUs))),
    maxLongShare: share(long),
    maxLongShareWithoutSerial: share(long.filter((check) => !check.applied.includes('serial-time'))),
    maxLineDeviationUs: Math.max(0, ...lineChecks.map((check) => Math.abs(check.deviationUs))),
  };
}

const describeProblem = (check: IntervalCheck) =>
  `${check.what}: ${check.deviationUs.toFixed(2)} µs from ${check.anchor} over ${check.spanUs.toFixed(2)} µs (waits ${check.waitUs.toFixed(2)}, calls ${check.callUs.toFixed(2)}, nodes ${check.nodeUs.toFixed(2)}), allowed −${check.belowUs.toFixed(2)}…+${check.aboveUs.toFixed(2)} (${check.applied.join(', ')})`;

type Context = { readonly input: CompareInput; readonly lineAllowances: readonly number[] };

/**
 * The check of one interval: from `anchor` to an event the simulator puts in `simRange` and the board in `boardRange`. The allowance
 * is built from what the simulator did in the interval's widest window, part by part.
 */
export function checkInterval(
  what: string,
  simRange: Range,
  boardRange: Range,
  anchor: Anchor,
  context: Context,
  options: { exact: boolean; widenedBy?: AllowedDifferenceId | undefined; ownLine?: number; join?: boolean; toneEndPeriodUs?: number | undefined },
): IntervalCheck {
  const { input, lineAllowances } = context;
  const sim = { fromUs: simRange.fromUs - anchor.sim.toUs, toUs: simRange.toUs - anchor.sim.fromUs };
  const board = { fromUs: boardRange.fromUs - anchor.board.toUs, toUs: boardRange.toUs - anchor.board.fromUs };
  const window = { fromUs: anchor.sim.fromUs, toUs: simRange.toUs };
  const spanUs = length(window);
  const applied: IntervalCheck['applied'][number][] = ['interval'];

  // The simulator's interval, part by part.
  const waitUs =
    input.sim.sleeps.reduce((sum, sleep) => sum + length(intersect(sleep, window)), 0) +
    input.sim.calls.filter((call) => call.name === 'pulseIn').reduce((sum, call) => sum + length(intersect(call, window)), 0);
  const inWindow = (call: SimCall) => length(intersect(call, window));
  const callUs = input.sim.calls.filter((call) => call.name !== 'pulseIn').reduce((sum, call) => sum + inWindow(call), 0);
  const toneCalls = input.sim.calls.filter((call) => call.name === 'tone' && inWindow(call) > 0);
  const toneUs = toneCalls.reduce((sum, call) => sum + inWindow(call), 0);
  const nodeUs = input.sim.nodesUs.filter((atUs) => atUs >= window.fromUs && atUs < window.toUs).length * allowed['call-costs'].nodeUs;
  const loopUs = allowed['loop-min-us'].simUsPerIteration;
  const loops = input.sim.loopStartsUs.filter((atUs) => atUs > window.fromUs - loopUs && atUs < window.toUs).length;

  let belowUs = intervalRule.waitShare * waitUs;
  let aboveUs = intervalRule.waitShare * waitUs;
  if (callUs > toneUs || nodeUs > 0) {
    belowUs += allowed['call-costs'].fasterShare * (callUs - toneUs) + nodeUs;
    applied.push('call-costs');
  }
  // tone(): by how the sketch writes its frequency (a variable may be either), of the contract's band cost for the call, on a silent
  // or a playing pin: never of what the simulator charged.
  if (toneCalls.length > 0) {
    const fold = allowed['tone-fold'];
    for (const call of toneCalls) {
      const form = input.toneForms?.get(call.blockId) ?? 'variable';
      const expectedUs = contractToneUs(call, input.sim.events);
      const share = inWindow(call) / Math.max(length(call), Number.EPSILON);
      belowUs += share * (form === 'runtime' ? expectedUs * fold.runtime.fasterShare : Math.max(0, expectedUs - fold.literal.floorUs));
      aboveUs += share * expectedUs * (form === 'literal' ? fold.literal.slowerShare : fold.runtime.slowerShare);
    }
    applied.push('tone-fold');
  }
  if (loops > 0) {
    belowUs += loops * loopUs;
    applied.push('loop-min-us');
  }

  // Interrupts: their load on the calls and statements, and one run of each source that runs in the interval.
  const isr = allowed['isr-load'];
  const servoOn = input.sim.events.some((event) => event.state.kind === 'servo' && event.toUs < window.toUs);
  const tones = input.sim.events.flatMap((event, index, all) => {
    if (event.state.kind !== 'tone') {
      return [];
    }
    const untilUs = all.slice(index + 1).find((next) => next.pin === event.pin)?.fromUs ?? Infinity;
    return length(intersect({ fromUs: event.fromUs, toUs: untilUs }, window)) > 0 ? [event.state.hz] : [];
  });
  const load = isr.timer0Share + (servoOn ? isr.servoShare : 0) + tones.reduce((sum, hz) => sum + hz * isr.toneSharePerHz, 0);
  aboveUs += load * (callUs + nodeUs) + isr.timer0IsrUs + (servoOn ? isr.servoFrameUs : 0) + (tones.length > 0 ? isr.toneIsrUs : 0);
  applied.push('isr-load');

  // Serial: the lines printed in the window before this event (and Serial.begin, at the start of setup()).
  let serialUs = input.prints && window.fromUs === 0 ? allowed['serial-time'].beginUs : 0;
  input.sim.lines.forEach((line, index) => {
    const earlier = options.ownLine === undefined ? line.atUs < window.toUs : index < options.ownLine;
    if (earlier && line.atUs >= window.fromUs) {
      serialUs += lineAllowances[index] ?? 0;
    }
  });
  if (serialUs > 0) {
    aboveUs += serialUs;
    applied.push('serial-time');
  }
  if (options.join) {
    applied.push('join-by-parts');
  }
  if (!options.exact) {
    applied.push('waveform-phase');
  }
  if (options.toneEndPeriodUs !== undefined) {
    // floor(2 · hz · ms / 1000) half periods: the board's tone may end up to one period before the simulator's.
    belowUs += options.toneEndPeriodUs;
    applied.push('tone-duration');
  }
  if (options.widenedBy) {
    applied.push(options.widenedBy);
  }

  const deviationUs = gap(board, sim);
  return { what, anchor: anchor.name, spanUs, waitUs, callUs, nodeUs, deviationUs, belowUs, aboveUs, applied, ok: deviationUs >= -belowUs && deviationUs <= aboveUs };
}
