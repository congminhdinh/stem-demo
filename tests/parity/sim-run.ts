import { createRunScheduler, createRuntimeServices, type RunWarning } from '../../src/core/capabilities/services';
import { createProgramIO, createVirtualUno, type BoardProfile, type DriverIO, type Kit, type PinState, type VirtualUno } from '../../src/core/hardware';
import { runYbcProgram, type YbcRunOutcome } from '../../src/core/program/ybc-interpreter';
import type { YbcProgramIR } from '../../src/core/program/ybc-ir';
import type { UnoProgramUses } from '../../src/core/program/uno-uses';
import { createVirtualScheduler, WORLD_TICK_MS } from '../../src/core/run/virtual-clock';
import { allowedDifferences } from './allowed-differences';
import { createTcs34725 } from '../../src/core/hardware/devices/tcs34725';
import { analogFeed, colorIntegral, echoFeed, levelAt, levelTimeline, type ParityInputs } from './inputs';
import { isWaveform, withoutRepeats, type PinEvent, type PinLogicalState, type PrintedLine } from './trace';

// The L1 side of the parity harness (N18 C2): the program's IR in the real interpreter, on the virtual UNO and the module binding,
// under createVirtualScheduler with the board's delay overhead, exactly as RobotRunSession runs it (run/__fixtures__/virtual-run.ts
// is the same wiring). The world is reduced to its time: one advanceTo per 1/120 s tick, from tick 0. The scripted inputs are the
// program's sensors. The harness only listens, and nothing the program sees changes:
//   - each pin change the virtual UNO tells (onChange, after the Arduino call), as a range from the call's start to its end: the
//     simulator does not say when inside its call a pin changes, and the board changes it inside the call;
//   - each Arduino call (its name, pin and range), each line printed (with the start of its print statement, and whether it prints
//     a join), each wait and each loop() iteration, with the program time;
//   - each tone's own end, at the call's range + ms (the virtual UNO tells it at the next call, or never when none comes).

export type SimCall = {
  readonly name: keyof DriverIO | 'millis';
  readonly pin: string | null;
  /** The call's number arguments (a tone's hz and ms). */
  readonly args: readonly number[];
  /** What a read returned (millis, digitalRead, analogRead, pulseIn). */
  readonly result?: number;
  /** The block of the statement the call belongs to. */
  readonly blockId: string;
  readonly fromUs: number;
  readonly toUs: number;
};

/** A printed line, with the program time its print statement began and whether it prints a join (allowed difference `join-by-parts`). */
export type SimLine = PrintedLine & { readonly statementUs: number; readonly join: boolean };

export type SimRun = {
  events: PinEvent[];
  lines: SimLine[];
  calls: SimCall[];
  /** The program time (µs) at which each loop() iteration began. */
  loopStartsUs: number[];
  /** Each wait of the program (Arduino's delay()), from its start to the time it resumed, µs. */
  sleeps: { fromUs: number; toUs: number }[];
  /** The program time of each IR node the simulator charged NODE_US for (the budget's work and step). */
  nodesUs: number[];
  outcome: YbcRunOutcome | undefined;
  warnings: RunWarning[];
  /** The program clock when the run was stopped. */
  endUs: number;
};

export type SimProgram = { ir: YbcProgramIR; kit: Kit; board: BoardProfile; uses: UnoProgramUses };

/** The state the world would see on a pin (PinState), as the harness's common trace names it. */
export function logicalStateOf(state: PinState, pwmMax: number): PinLogicalState {
  if (state.mode !== 'OUTPUT') {
    return { kind: 'input', pullup: state.mode === 'INPUT_PULLUP' };
  }
  if (state.toneHz !== null) {
    return { kind: 'tone', hz: state.toneHz };
  }
  if (state.servoDeg !== null) {
    return { kind: 'servo', deg: state.servoDeg };
  }
  if (state.duty === 0) {
    return { kind: 'low' };
  }
  return state.duty === pwmMax ? { kind: 'high' } : { kind: 'pwm', duty: state.duty };
}

/** A tone with a duration the program started: it ends `ms` after its call, unless a call ends it first. */
export type ToneRecord = { pin: string; endFromUs: number; endToUs: number; settledByCall: boolean };

/**
 * The virtual UNO of a run with its io and millis wrapped to record each call and its range (the onChange listener reads the call
 * under way), and when each tone ends by itself.
 */
function recording(
  uno: VirtualUno,
  nowUs: () => number,
  calls: SimCall[],
  tones: ToneRecord[],
  current: { fromUs: number; name: SimCall['name'] | null },
  statement: { blockId: string },
  inject: SimInjection,
): VirtualUno {
  let toneCalls = 0;
  /** Wraps an io call: its first argument is the pin, `null` for millis, delayMicroseconds and compute. */
  const record =
    <A extends unknown[], R>(name: SimCall['name'], real: (...args: A) => R) =>
    (...args: A): R => {
      const fromUs = nowUs();
      current.fromUs = fromUs;
      current.name = name;
      const result = real(...args);
      const pin = typeof args[0] === 'string' ? args[0] : null;
      const numbers = args.filter((arg): arg is number => typeof arg === 'number');
      calls.push({ name, pin, args: numbers, ...(typeof result === 'number' ? { result } : {}), blockId: statement.blockId, fromUs, toUs: nowUs() });
      if (name === 'tone' && inject.afterToneUs && (!inject.nth || inject.nth === toneCalls)) {
        uno.io.compute(inject.afterToneUs); // an injected drift right after the call, not part of it
      }
      return result;
    };
  const playing = (id: string) => tones.find((tone) => tone.pin === id && !tone.settledByCall && tone.endToUs > nowUs());
  const real = uno.io;
  const io: DriverIO = {
    ...real,
    pinMode: record('pinMode', real.pinMode),
    digitalWrite: record('digitalWrite', real.digitalWrite),
    digitalRead: record('digitalRead', real.digitalRead),
    analogRead: record('analogRead', real.analogRead),
    pwmWrite: record('pwmWrite', real.pwmWrite),
    servoWrite: record('servoWrite', real.servoWrite),
    pulseIn: record('pulseIn', real.pulseIn),
    delayMicroseconds: record('delayMicroseconds', real.delayMicroseconds),
    compute: record('compute', real.compute),
    tone: record('tone', (id: string, hz: number, ms?: number) => {
      toneCalls += 1;
      if (inject.inToneUs && (!inject.nth || inject.nth === toneCalls)) {
        real.compute(inject.inToneUs); // an injected drift inside the call
      }
      const before = playing(id);
      const fromUs = nowUs();
      real.tone(id, hz, ms);
      if ((uno.pins().find((pin) => pin.pin === id)?.toneHz ?? null) !== null) {
        if (before) {
          before.settledByCall = true;
        }
        if (ms !== undefined && ms > 0) {
          tones.push({ pin: id, endFromUs: fromUs + ms * 1000, endToUs: nowUs() + ms * 1000, settledByCall: false });
        }
      }
    }),
    noTone: record('noTone', (id: string) => {
      const before = playing(id);
      if (before) {
        before.settledByCall = true;
      }
      real.noTone(id);
    }),
  };
  return { ...uno, io, millis: record('millis', uno.millis) };
}

/**
 * A drift put into the simulator only, for the tests that show the harness catches one: `inToneUs` more charged inside the `nth` tone()
 * call (every one when 0), `afterToneUs` more right after it.
 */
export type SimInjection = { readonly nth?: number; readonly inToneUs?: number; readonly afterToneUs?: number };

/**
 * Runs `program` for `durationUs` of program time (or until it ends) with the scripted `inputs`, and returns its trace. Events after
 * `durationUs` are left out.
 */
export async function runSimulator(program: SimProgram, inputs: ParityInputs, durationUs: number, inject: SimInjection = {}): Promise<SimRun> {
  const { ir, kit, board, uses } = program;
  const controller = new AbortController();
  const scheduler = createVirtualScheduler({ signal: controller.signal, delayOverheadUs: board.costsUs.delayOverhead });
  const clock = scheduler.programClock;
  const nowUs = () => clock.now() * 1000;
  const lines: SimLine[] = [];
  const joins = printsOfJoins(ir);
  /** The block of the statement under way and when it began (services.trace, told as each statement starts). */
  const statement = { blockId: '', atUs: 0 };
  const loopStartsUs: number[] = [];
  const sleeps: { fromUs: number; toUs: number }[] = [];
  const nodesUs: number[] = [];
  const warnings: RunWarning[] = [];
  const budget = scheduler.budget(controller.signal);
  const services = createRuntimeServices({
    signal: controller.signal,
    console: { write: (text) => void lines.push({ atUs: nowUs(), text, statementUs: statement.atUs, join: joins.has(statement.blockId) }) },
    trace: (blockId) => {
      statement.blockId = blockId;
      statement.atUs = nowUs();
    },
    clock,
    sleep: async (ms, signal) => {
      const fromUs = nowUs();
      await scheduler.sleep(ms, signal);
      sleeps.push({ fromUs, toUs: nowUs() });
    },
    scheduler: createRunScheduler(scheduler.timers),
    budget: {
      ...budget,
      work() {
        nodesUs.push(nowUs());
        budget.work();
      },
      step() {
        nodesUs.push(nowUs());
        return budget.step();
      },
      loopIteration() {
        loopStartsUs.push(nowUs());
        budget.loopIteration();
      },
    },
    warn: (warning) => void warnings.push(warning),
  });

  const uno = createVirtualUno(board, clock);
  for (const [pin, changes] of levelTimeline(kit, inputs)) {
    uno.attachDigitalSource(pin, () => levelAt(changes, nowUs()));
  }
  const analog = analogFeed(inputs.analog ?? []);
  for (const pin of new Set((inputs.analog ?? []).flatMap((group) => group.pins))) {
    uno.attachAnalogSource(pin, () => analog.next(pin));
  }
  if (inputs.echoes) {
    const echoes = echoFeed(inputs.echoes);
    uno.attachPulseSource(inputs.echoes.echo, () => echoes.next() ?? 0);
  }
  // N19 C2: the colour sensor on the bus, under the scripted light (none: an empty bus).
  if (inputs.colors && !inputs.colors.absent) {
    const device = createTcs34725(colorIntegral(inputs.colors));
    uno.attachWireDevice(device.address, device);
  }

  const told: PinEvent[] = board.pins.map((pin) => ({ pin: pin.id, state: { kind: 'input', pullup: false }, fromUs: 0, toUs: 0 }));
  const calls: SimCall[] = [];
  const tones: ToneRecord[] = [];
  const current: { fromUs: number; name: SimCall['name'] | null } = { fromUs: 0, name: null };
  /** The call that told each event: an analogWrite, an attach or a tone on an input pin is an OUTPUT LOW first. */
  const toldBy = new Map<PinEvent, SimCall['name'] | null>();
  uno.onChange((state, atMs) => {
    const event: PinEvent = { pin: state.pin, state: logicalStateOf(state, board.pwmMax), fromUs: Math.min(current.fromUs, atMs * 1000), toUs: atMs * 1000 };
    toldBy.set(event, current.name);
    told.push(event);
  });
  const capabilities = createProgramIO(kit, recording(uno, nowUs, calls, tones, current, statement, inject), uses);
  const { done } = runYbcProgram(ir, capabilities, services);
  let outcome: YbcRunOutcome | undefined;
  void done.then((settled) => void (outcome = settled));

  for (let tick = 0; tick * WORLD_TICK_MS * 1000 <= durationUs && outcome === undefined; tick++) {
    await scheduler.advanceTo((tick * 1000) / 120);
    await Promise.resolve();
  }
  const endUs = nowUs();
  controller.abort();
  await done.catch(() => undefined);

  return {
    events: outputLowFirst(settleTones(told, tones, durationUs), (event) => toldBy.get(event) ?? null),
    lines: lines.filter((line) => line.atUs <= durationUs),
    calls,
    loopStartsUs,
    sleeps,
    nodesUs,
    outcome,
    warnings,
    endUs,
  };
}

/**
 * Puts the end of each tone that ran out by itself at its own time. The virtual UNO tells it at the next call (a LOW then), not at
 * all when that call starts a new tone on the pin (its state goes from one tone to the next), and never when no call comes after it
 * (a program that ended, or waits, while the tone plays).
 */
export function settleTones(events: readonly PinEvent[], tones: readonly ToneRecord[], durationUs: number): PinEvent[] {
  const timed = [...events];
  for (const tone of tones.filter((candidate) => !candidate.settledByCall)) {
    const next = timed.findIndex((event) => event.pin === tone.pin && event.toUs >= tone.endToUs);
    const end: PinEvent = { pin: tone.pin, state: { kind: 'low' }, fromUs: tone.endFromUs, toUs: tone.endToUs };
    if (next >= 0 && timed[next]?.state.kind === 'low') {
      timed[next] = end;
    } else if (next >= 0 || tone.endFromUs <= durationUs) {
      timed.push(end);
    }
  }
  return withoutRepeats(timed.filter((event) => event.fromUs <= durationUs).sort((a, b) => a.toUs - b.toUs));
}

/** The calls that begin with pinMode(pin, OUTPUT) on the board: analogWrite (the pwmWrite helper), Servo.attach, tone(). */
const OUTPUT_FIRST: ReadonlySet<SimCall['name'] | null> = new Set(['pwmWrite', 'servoWrite', 'tone']);

/**
 * Allowed difference `output-low-first`: an analogWrite, a Servo.attach or a first tone() on a pin that was an input makes it an OUTPUT
 * LOW first on the board (their pinMode), then HIGH, PWM or the waveform. The simulator's trace gets that LOW at the start of the call,
 * within what the call does before its pinMode, so both sides have it (board-trace.ts) and the call is timed from it.
 */
export function outputLowFirst(events: readonly PinEvent[], callOf: (event: PinEvent) => SimCall['name'] | null): PinEvent[] {
  const beforePinModeUs = allowedDifferences['output-low-first'].beforePinModeUs;
  const last = new Map<string, PinLogicalState>();
  const out: PinEvent[] = [];
  for (const event of events) {
    const fromInput = last.get(event.pin)?.kind === 'input';
    if (fromInput && event.state.kind !== 'low' && event.state.kind !== 'input' && (isWaveform(event.state) || OUTPUT_FIRST.has(callOf(event)))) {
      out.push({ ...event, state: { kind: 'low' }, toUs: Math.min(event.toUs, event.fromUs + beforePinModeUs) });
    }
    last.set(event.pin, event.state);
    out.push(event);
  }
  return out;
}

/**
 * How the sketch writes the frequency of each buzzer.tone statement of `ir`, by its block (allowed difference `tone-fold`): `runtime`
 * when it reads the robot, or reads only variables every assignment of which reads it (-flto cannot fold the call); `literal` when it
 * is made of numbers, or of variables only ever set to numbers (it may fold it); `variable` otherwise (either).
 */
export type ToneForm = 'literal' | 'runtime' | 'variable';

type Node = { kind?: unknown; op?: unknown; args?: unknown[]; blockId?: unknown; variable?: unknown; value?: unknown };

const nodesOf = (node: unknown, found: Node[] = []): Node[] => {
  if (Array.isArray(node)) {
    node.forEach((item) => nodesOf(item, found));
  } else if (node !== null && typeof node === 'object') {
    found.push(node as Node);
    Object.values(node).forEach((value) => nodesOf(value, found));
  }
  return found;
};

export function toneFormsOf(ir: YbcProgramIR): Map<string, ToneForm> {
  const all = nodesOf([ir.onStart, ir.forever]);
  // What each variable is set to: a count up sets its variable to a count, which is neither.
  const assigned = new Map<string, ToneForm[]>();
  for (const node of all) {
    if ((node.kind === 'set' || node.kind === 'countUp') && typeof node.variable === 'string') {
      const forms = assigned.get(node.variable) ?? [];
      forms.push(node.kind === 'countUp' ? 'variable' : formOf(node.value, new Map()));
      assigned.set(node.variable, forms);
    }
  }
  const variables = new Map<string, ToneForm>(
    [...assigned].map(([variable, forms]) => [variable, forms.every((form) => form === 'runtime') ? 'runtime' : forms.every((form) => form === 'literal') ? 'literal' : 'variable']),
  );
  const forms = new Map<string, ToneForm>();
  for (const node of all) {
    if (node.kind === 'call' && node.op === 'buzzer.tone' && typeof node.blockId === 'string') {
      forms.set(node.blockId, formOf(node.args?.[0], variables));
    }
  }
  return forms;
}

/** The form of an expression: a read makes it `runtime`; variables take the form of what they are set to (unknown: `variable`). */
function formOf(expression: unknown, variables: ReadonlyMap<string, ToneForm>): ToneForm {
  const nodes = nodesOf(expression);
  if (nodes.some((node) => node.kind === 'read')) {
    return 'runtime';
  }
  const used = nodes.filter((node) => node.kind === 'variable').map((node) => variables.get(String(node.variable)) ?? 'variable');
  return used.length === 0 || used.every((form) => form === 'literal') ? 'literal' : used.every((form) => form === 'runtime') ? 'runtime' : 'variable';
}

/** The blocks of the print statements of `ir` that print a join. */
export function printsOfJoins(ir: YbcProgramIR): Set<string> {
  const found = new Set<string>();
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(walk);
    } else if (node !== null && typeof node === 'object') {
      const record = node as { kind?: unknown; value?: { kind?: unknown }; blockId?: unknown };
      if (record.kind === 'print' && record.value?.kind === 'join' && typeof record.blockId === 'string') {
        found.add(record.blockId);
      }
      Object.values(node).forEach(walk);
    }
  };
  walk([ir.onStart, ir.forever]);
  return found;
}
