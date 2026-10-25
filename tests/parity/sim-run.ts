import { createRunScheduler, createRuntimeServices, type RunWarning } from '../../src/core/capabilities/services';
import { createProgramIO, createVirtualUno, type BoardProfile, type DriverIO, type Kit, type PinState, type VirtualUno } from '../../src/core/hardware';
import { runYbcProgram, type YbcRunOutcome } from '../../src/core/program/ybc-interpreter';
import type { YbcProgramIR } from '../../src/core/program/ybc-ir';
import type { UnoProgramUses } from '../../src/core/program/uno-uses';
import { createVirtualScheduler, WORLD_TICK_MS } from '../../src/core/run/virtual-clock';
import { analogFeed, echoFeed, levelAt, levelTimeline, type ParityInputs } from './inputs';
import { isWaveform, withoutRepeats, type PinEvent, type PinLogicalState, type PrintedLine } from './trace';

// The L1 side of the parity harness (N18 C2): the program's IR in the real interpreter, on the virtual UNO and the module binding,
// under createVirtualScheduler with the board's delay overhead, exactly as RobotRunSession runs it (run/__fixtures__/virtual-run.ts
// is the same wiring). The world is reduced to its time: one advanceTo per 1/120 s tick, from tick 0. The scripted inputs are the
// program's sensors. The harness only listens, and nothing the program sees changes:
//   - each pin change the virtual UNO tells (onChange, after the Arduino call), as a range from the call's start to its end: the
//     simulator does not say when inside its call a pin changes, and the board changes it inside the call;
//   - each Arduino call (its name, pin and range), each line printed and each loop() iteration, with the program time;
//   - each tone's own end, at the call's range + ms (the virtual UNO tells it at the next call, or never when none comes).

export type SimCall = {
  readonly name: keyof DriverIO | 'millis';
  readonly pin: string | null;
  /** The call's number arguments (a tone's hz and ms). */
  readonly args: readonly number[];
  readonly fromUs: number;
  readonly toUs: number;
};

export type SimRun = {
  events: PinEvent[];
  lines: PrintedLine[];
  calls: SimCall[];
  /** The program time (µs) at which each loop() iteration began. */
  loopStartsUs: number[];
  /** Each wait of the program (Arduino's delay()), from its start to the time it resumed, µs. */
  sleeps: { fromUs: number; toUs: number }[];
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
function recording(uno: VirtualUno, nowUs: () => number, calls: SimCall[], tones: ToneRecord[], current: { fromUs: number }): VirtualUno {
  /** Wraps an io call: its first argument is the pin, `null` for millis. */
  const record =
    <A extends unknown[], R>(name: SimCall['name'], real: (...args: A) => R) =>
    (...args: A): R => {
      const fromUs = nowUs();
      current.fromUs = fromUs;
      const result = real(...args);
      const pin = typeof args[0] === 'string' ? args[0] : null;
      calls.push({ name, pin, args: args.filter((arg): arg is number => typeof arg === 'number'), fromUs, toUs: nowUs() });
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
    tone: record('tone', (id: string, hz: number, ms?: number) => {
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
 * Runs `program` for `durationUs` of program time (or until it ends) with the scripted `inputs`, and returns its trace. Events after
 * `durationUs` are left out.
 */
export async function runSimulator(program: SimProgram, inputs: ParityInputs, durationUs: number): Promise<SimRun> {
  const { ir, kit, board, uses } = program;
  const controller = new AbortController();
  const scheduler = createVirtualScheduler({ signal: controller.signal, delayOverheadUs: board.costsUs.delayOverhead });
  const clock = scheduler.programClock;
  const nowUs = () => clock.now() * 1000;
  const lines: PrintedLine[] = [];
  const loopStartsUs: number[] = [];
  const sleeps: { fromUs: number; toUs: number }[] = [];
  const warnings: RunWarning[] = [];
  const budget = scheduler.budget(controller.signal);
  const services = createRuntimeServices({
    signal: controller.signal,
    console: { write: (text) => void lines.push({ atUs: nowUs(), text }) },
    clock,
    sleep: async (ms, signal) => {
      const fromUs = nowUs();
      await scheduler.sleep(ms, signal);
      sleeps.push({ fromUs, toUs: nowUs() });
    },
    scheduler: createRunScheduler(scheduler.timers),
    budget: {
      ...budget,
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

  const told: PinEvent[] = board.pins.map((pin) => ({ pin: pin.id, state: { kind: 'input', pullup: false }, fromUs: 0, toUs: 0 }));
  const calls: SimCall[] = [];
  const tones: ToneRecord[] = [];
  const current = { fromUs: 0 };
  uno.onChange((state, atMs) => void told.push({ pin: state.pin, state: logicalStateOf(state, board.pwmMax), fromUs: Math.min(current.fromUs, atMs * 1000), toUs: atMs * 1000 }));
  const capabilities = createProgramIO(kit, recording(uno, nowUs, calls, tones, current), uses);
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
    events: outputBeforeWaveform(settleTones(told, tones, durationUs)),
    lines: lines.filter((line) => line.atUs <= durationUs),
    calls,
    loopStartsUs,
    sleeps,
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

/**
 * A waveform started on a pin that was an input (Servo.attach, the first tone()) makes the pin an OUTPUT LOW first, on the board
 * as in any pinMode: the simulator's trace gets that LOW, in the same call, so both sides have it (board-trace.ts).
 */
export function outputBeforeWaveform(events: readonly PinEvent[]): PinEvent[] {
  const last = new Map<string, PinLogicalState>();
  const out: PinEvent[] = [];
  for (const event of events) {
    if (isWaveform(event.state) && last.get(event.pin)?.kind === 'input') {
      out.push({ ...event, state: { kind: 'low' } });
    }
    last.set(event.pin, event.state);
    out.push(event);
  }
  return out;
}
