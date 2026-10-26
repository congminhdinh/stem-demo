// N19 G0.2: the I²C / TCS34725 parity spike and the gripper cost evidence. node spikes/avr8js/run-gripper.ts
// (Node 24 strips the types; spikes/ is outside lint and tsconfig.) Writes out/gripper-results.json and
// out/traces/gripper-twi.txt, prints the verdict. Every time comes from avr8js's cycle counter (µs = cycles / 16).
//
// 1. Compiles sketches/gripper-forms and sketches/gripper-costs with arduino-cli (--warnings all): sizes, warnings (CC-06).
// 2. Runs gripper-forms on avr8js 0.21.1 with the TS TCS34725 (tcs34725-model.ts) on the bus (twi-device.ts), under scripted
//    light (gripper-light.ts) and a scripted IR level, and again with no device at 0x29 (NACK). Checks (EMU-19): every printed
//    reading and class against the TS model and COLOR_RULES; each TWI phase's bus time against the datasheet; every transaction
//    (START → STOP) against the TS model within ±1 %; the servo pulses of each gripperSet; both servos framed together on Timer1.
// 3. Runs gripper-costs the same two ways: µs per call, the shortest of N samples minus the baseline (EMU-20).
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus, loadavg } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AVRTWI, avrInstruction, twiConfig } from 'avr8js';
import { CLOCK_HZ, cyclesOfUs, EmulatedUno, usOfCycles, type RawPinChange } from '../../tests/parity/emulated-uno.ts';
import { parseIntelHex } from '../../tests/parity/intel-hex.ts';
import { classifyColor, COLOR_NAMES, colorRulesCpp } from './color-rules.ts';
import { irradianceOf, timelineIntegral, type LightSegment, type SpikeLight } from './gripper-light.ts';
import { createTcs34725, TCS_STEP_US, type Rgbc, type Tcs34725 } from './tcs34725-model.ts';
import { PHASE_SCL_PERIODS, TimedTwiBus, transactionBusCycles, type TwiTransaction } from './twi-device.ts';

const spikeRoot = dirname(fileURLToPath(import.meta.url));
const FQBN = 'arduino:avr:uno';
const round = (value: number, digits = 4) => Number(value.toFixed(digits));
const median = (values: readonly number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? (sorted[middle] ?? 0) : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
};

// --- 1. Compile -------------------------------------------------------------------------------------------------------------

type Compiled = { hexPath: string; command: string; flashBytes: number; flashPercent: number; ramBytes: number; ramPercent: number; ramMax: number; warnings: string[]; sketchWarnings: string[] };

function compile(name: string): Compiled {
  const sketchDir = join(spikeRoot, 'sketches', name);
  const buildDir = join(spikeRoot, 'build', name);
  mkdirSync(buildDir, { recursive: true });
  const args = ['compile', '--fqbn', FQBN, '--warnings', 'all', '--clean', '--build-path', buildDir, sketchDir];
  const run = spawnSync('arduino-cli', args, { encoding: 'utf8' });
  // eslint-disable-next-line no-control-regex -- arduino-cli colours its output
  const out = `${run.stdout}\n${run.stderr}`.replace(/\x1b\[[0-9;]*m/g, '');
  if (run.status !== 0) {
    throw new Error(`arduino-cli compile failed for ${name}:\n${out}`);
  }
  const flash = /Sketch uses (\d+) bytes \((\d+)%\) of program storage space/.exec(out);
  const ram = /Global variables use (\d+) bytes \((\d+)%\) of dynamic memory, leaving \d+ bytes for local variables\. Maximum is (\d+) bytes/.exec(out);
  const warnings = out.split('\n').filter((line) => line.includes('warning:'));
  return {
    hexPath: join(buildDir, `${name}.ino.hex`),
    command: `arduino-cli ${args.join(' ').replaceAll(spikeRoot, 'spikes/avr8js')}`,
    flashBytes: Number(flash?.[1]),
    flashPercent: Number(flash?.[2]),
    ramBytes: Number(ram?.[1]),
    ramPercent: Number(ram?.[2]),
    ramMax: Number(ram?.[3]),
    warnings: warnings.map((line) => line.replace(/^.*\/(cores|libraries)\//, '$1/').replace(spikeRoot, 'spikes/avr8js')),
    sketchWarnings: warnings.filter((line) => !line.includes('/cores/arduino/')),
  };
}

/** RAM of the .bss/.data symbols of the ELF that come from Wire (Wire.cpp, twi.c), by avr-nm. */
function wireRamBytes(name: string): { bytes: number; symbols: Record<string, number> } {
  const tools = execFileSync('find', [`${process.env.HOME}/Library/Arduino15/packages/arduino/tools/avr-gcc`, '-name', 'avr-nm', '-type', 'f'], { encoding: 'utf8' }).trim().split('\n')[0] ?? 'avr-nm';
  const elf = join(spikeRoot, 'build', name, `${name}.ino.elf`);
  const listing = execFileSync(tools, ['-S', '-C', '--size-sort', elf], { encoding: 'utf8' });
  const symbols: Record<string, number> = {};
  for (const line of listing.split('\n')) {
    const [, size, kind, symbol] = /^[0-9a-f]+ ([0-9a-f]+) ([bBdD]) (.+)$/.exec(line) ?? [];
    if (size && kind && symbol && /twi_|TwoWire|Wire\b/.test(symbol)) {
      symbols[symbol] = Number.parseInt(size, 16);
    }
  }
  return { bytes: Object.values(symbols).reduce((a, b) => a + b, 0), symbols };
}

// --- 2. Emulate -------------------------------------------------------------------------------------------------------------

type LevelScript = readonly { pin: string; atUs: number; high: boolean }[];
/** An interrupt service routine that ran: its vector's word address, from its entry to the end of its RETI. */
type IsrSpan = { readonly vector: number; readonly fromCycle: number; readonly toCycle: number };
/** ATmega328P vectors (datasheet 7810D Table 11-1) by word address, the ones these sketches use. */
const VECTOR_NAMES: Readonly<Record<number, string>> = { 0x16: 'TIMER1_COMPA (Servo)', 0x20: 'TIMER0_OVF (millis)', 0x24: 'USART_RX', 0x26: 'USART_UDRE (Serial TX)', 0x28: 'USART_TX', 0x30: 'TWI' };
const TWI_VECTOR = 0x30;
const SERVO_VECTOR = 0x16;
const RETI = 0x9518;

type Emulation = { uno: EmulatedUno; bus: TimedTwiBus; device: Tcs34725 | null; setupCycle: number; text: string; wallMs: number; windows: { fromUs: number; toUs: number }[]; isrs: IsrSpan[] };

/** Runs `hexPath` with the TCS34725 under `light` at 0x29 (or an empty bus) until `done(text)` or `maxUs` from setup(). */
function emulate(hexPath: string, options: { device: boolean; light: readonly LightSegment[]; levels?: LevelScript; maxUs: number; done: (text: string) => boolean; keepStopInterrupt?: boolean }): Emulation {
  const started = performance.now();
  const uno = new EmulatedUno(parseIntelHex(readFileSync(hexPath, 'utf8')));
  const twi = new AVRTWI(uno.cpu, twiConfig, CLOCK_HZ);
  const sinceSetup = (cycle: number) => usOfCycles(cycle - (uno.setupCycle ?? 0));
  const windows: { fromUs: number; toUs: number }[] = [];
  const integral = timelineIntegral(options.light);
  const device = options.device
    ? createTcs34725((fromUs, toUs) => {
        windows.push({ fromUs, toUs });
        return integral(fromUs, toUs);
      })
    : null;
  const bus = new TimedTwiBus(uno.cpu, twi, sinceSetup, device ? [device] : [], { keepStopInterrupt: options.keepStopInterrupt ?? false });
  for (const level of options.levels ?? []) {
    if (level.atUs === 0) {
      uno.drive(level.pin, level.high);
    }
  }
  uno.onSetup(() => {
    const start = uno.cpu.cycles;
    for (const level of options.levels ?? []) {
      if (level.atUs > 0) {
        uno.at(start + cyclesOfUs(level.atUs), () => uno.drive(level.pin, level.high));
      }
    }
  });
  const text = () => uno.serial.map(({ byte }) => String.fromCharCode(byte)).join('');
  // EmulatedUno.runUntil's loop, recording each interrupt it serves (Arduino ISRs do not nest: an entry, then its RETI).
  const isrs: IsrSpan[] = [];
  let isr: { vector: number; fromCycle: number } | null = null;
  const { cpu } = uno;
  const runUntil = (end: number) => {
    while (cpu.cycles < end) {
      const reti = isr !== null && cpu.progMem[cpu.pc] === RETI;
      avrInstruction(cpu);
      if (reti && isr !== null) {
        isrs.push({ vector: isr.vector, fromCycle: isr.fromCycle, toCycle: cpu.cycles });
        isr = null;
      }
      const before = cpu.cycles;
      cpu.tick();
      if (isr === null && cpu.pc > 0 && cpu.pc < 0x34) {
        isr = { vector: cpu.pc, fromCycle: before };
      }
    }
  };
  for (let us = 10_000; uno.setupCycle === null || usOfCycles(uno.cpu.cycles - uno.setupCycle) < options.maxUs; us += 10_000) {
    runUntil(cyclesOfUs(us));
    if (options.done(text())) {
      break;
    }
  }
  if (uno.setupCycle === null) {
    throw new Error('setup() never started');
  }
  return { uno, bus, device, setupCycle: uno.setupCycle, text: Buffer.from(uno.serial.map(({ byte }) => byte)).toString('utf8'), wallMs: Math.round(performance.now() - started), windows, isrs };
}

/** The lines of each "#S name" section. */
function sectionsOf(text: string): Record<string, string[]> {
  const sections: Record<string, string[]> = {};
  for (const match of text.matchAll(/#S ([a-z]+)\r\n([\s\S]*?)(?=#S |$)/g)) {
    sections[match[1] ?? ''] = (match[2] ?? '').split('\r\n').filter((line) => line !== '');
  }
  return sections;
}

/** Complete HIGH pulses of a pin: rise and fall cycles. */
function pulsesOf(changes: readonly RawPinChange[], pin: string): { rise: number; fall: number }[] {
  const out: { rise: number; fall: number }[] = [];
  let rise: number | null = null;
  for (const change of changes) {
    if (change.pin !== pin) {
      continue;
    }
    if (change.state === 'HIGH') {
      rise = change.cycle;
    } else if (rise !== null) {
      out.push({ rise, fall: change.cycle });
      rise = null;
    }
  }
  return out;
}

// --- The scripted inputs of gripper-forms (its comments say the same) -------------------------------------------------------

const LIGHTS: readonly SpikeLight[] = ['red', 'green', 'blue', 'yellow', 'white', 'black', 'none'];
const LIGHT_FROM_US = 1_500_000;
const LIGHT_US = 250_000;
const FORMS_LIGHT: LightSegment[] = [{ fromUs: -1e9, light: 'none' }, ...LIGHTS.map((light, k) => ({ fromUs: LIGHT_FROM_US + k * LIGHT_US, light }))];
const FORMS_LEVELS: LevelScript = [
  { pin: 'A3', atUs: 0, high: true },
  { pin: 'A3', atUs: 1_050_000, high: false },
];
/** Servo 1.3.0: write(a) = writeMicroseconds(map(a, 0, 180, 544, 2400)), integer division (contract §6.2). */
const servoUs = (angle: number) => 544 + Math.trunc((angle * (2400 - 544)) / 180);
const clampGrip = (angle: number) => Math.min(90, Math.max(0, angle));
/** gripperSet calls of the "grip" section: at millis(), servo, angle asked. */
const GRIP_CALLS = [
  { ms: 0, pin: 'D9', angle: 0, setup: true },
  { ms: 0, pin: 'D10', angle: 90, setup: true },
  { ms: 200, pin: 'D9', angle: 80 },
  { ms: 320, pin: 'D10', angle: 0 },
  { ms: 440, pin: 'D9', angle: 120 },
  { ms: 560, pin: 'D10', angle: -10 },
  { ms: 680, pin: 'D10', angle: 45 },
  { ms: 800, pin: 'D9', angle: 0 },
] as const;

/** What a pure window of each light gives, by the TS model alone (a fresh device, ATIME 0xEB, gain 4×, one whole window). */
function modelReading(light: SpikeLight): Rgbc {
  const device = createTcs34725(timelineIntegral([{ fromUs: -1e9, light }]));
  const write = (t: number, bytes: number[]) => {
    device.connect(t, false);
    for (const byte of bytes) {
      device.write(t, byte);
    }
    device.stop(t);
  };
  write(0, [0x81, 0xeb]);
  write(0, [0x8f, 0x01]);
  write(0, [0x80, 0x03]);
  return device.peek(2 * TCS_STEP_US + 21 * TCS_STEP_US).data;
}

type ServoRun = { fromUs: number; toUs: number; pulses: number; widthUs: { min: number; median: number; max: number } };

/** Pulses grouped into runs of the same width (±3 µs of the run's median so far); the first pulse after attach starts a run. */
function servoRuns(pulses: readonly { rise: number; fall: number }[], since: (cycle: number) => number): ServoRun[] {
  const runs: { from: number; to: number; widths: number[] }[] = [];
  for (const { rise, fall } of pulses) {
    const width = usOfCycles(fall - rise);
    const last = runs.at(-1);
    if (last && Math.abs(width - median(last.widths)) <= 3) {
      last.widths.push(width);
      last.to = since(rise);
    } else {
      runs.push({ from: since(rise), to: since(rise), widths: [width] });
    }
  }
  return runs.map((run) => ({ fromUs: round(run.from, 2), toUs: round(run.to, 2), pulses: run.widths.length, widthUs: { min: Math.min(...run.widths), median: median(run.widths), max: Math.max(...run.widths) } }));
}

type TransactionRow = {
  shape: string;
  startUs: number;
  durationUs: number;
  busModelUs: number;
  busMeasuredUs: number;
  cpuUs: number;
  /** Largest lateness of a phase's completion past its bus time, cycles: the event waits for the instruction under way and any
   * interrupt entry (2 + 4 cycles at most). */
  phaseLateCycles: number;
  /** The phases' bus times add up to the datasheet model of the transaction. */
  phasesMatchModel: boolean;
  /** Time other interrupts (not TWI) ran inside the transaction, µs, and which. */
  otherIsrUs: number;
  otherIsrs: string[];
  bytes: readonly number[];
};

/** The instruction under way (4 cycles at most on the ATmega328P) and an interrupt entry (2 cycles in avr8js). */
const PHASE_LATE_MAX_CYCLES = 6;

function overlapCycles(spans: readonly IsrSpan[], from: number, to: number, skip: number): { cycles: number; vectors: number[] } {
  let cycles = 0;
  const vectors: number[] = [];
  for (const span of spans) {
    if (span.vector === skip || span.toCycle <= from || span.fromCycle >= to) {
      continue;
    }
    cycles += Math.min(to, span.toCycle) - Math.max(from, span.fromCycle);
    vectors.push(span.vector);
  }
  return { cycles, vectors };
}

function transactionRows(transactions: readonly TwiTransaction[], since: (cycle: number) => number, sclCycles: number, isrs: readonly IsrSpan[]): TransactionRow[] {
  return transactions.map((t) => {
    const busMeasured = t.phases.reduce((sum, phase) => sum + (phase.doneCycle - phase.requestCycle), 0);
    const late = Math.max(...t.phases.map((phase) => phase.doneCycle - phase.requestCycle - phase.busCycles));
    const early = Math.min(...t.phases.map((phase) => phase.doneCycle - phase.requestCycle - phase.busCycles));
    if (early < 0) {
      throw new Error(`A TWI phase completed ${early} cycles before its bus time`);
    }
    const other = overlapCycles(isrs, t.startCycle, t.stopCycle, TWI_VECTOR);
    return {
      shape: `${t.read ? 'R' : 'W'}${t.acked ? t.bytes.length : '-nack'}`,
      startUs: round(since(t.startCycle), 4),
      durationUs: usOfCycles(t.stopCycle - t.startCycle),
      busModelUs: usOfCycles(transactionBusCycles(t.bytes.length, sclCycles, t.acked)),
      busMeasuredUs: usOfCycles(busMeasured),
      cpuUs: usOfCycles(t.stopCycle - t.startCycle - busMeasured),
      phaseLateCycles: late,
      phasesMatchModel: t.phases.reduce((sum, phase) => sum + phase.busCycles, 0) === transactionBusCycles(t.bytes.length, sclCycles, t.acked),
      otherIsrUs: usOfCycles(other.cycles),
      otherIsrs: [...new Set(other.vectors.map((v) => VECTOR_NAMES[v] ?? `vector 0x${v.toString(16)}`))],
      bytes: t.bytes,
    };
  });
}

/**
 * Per shape: the TS model of a transaction is its datasheet bus time plus the CPU's service time of that shape when nothing
 * interrupts it (the shortest seen). Every transaction no other interrupt ran in must be within ±1 % of it; in the others, the
 * excess must be no more than the time those interrupts ran (the harness's isr-load) plus 1 %.
 */
function transactionTiming(rows: readonly TransactionRow[]) {
  const shapes = [...new Set(rows.map((row) => row.shape))];
  return Object.fromEntries(
    shapes.map((shape) => {
      const own = rows.filter((row) => row.shape === shape);
      const busModelUs = own[0]?.busModelUs ?? 0;
      const cpuRefUs = Math.min(...own.map((row) => row.cpuUs));
      const modelUs = busModelUs + cpuRefUs;
      const deviation = (row: TransactionRow) => (row.durationUs - modelUs) / modelUs;
      const quiet = own.filter((row) => row.otherIsrUs === 0);
      const busy = own.filter((row) => row.otherIsrUs > 0);
      const worst = [...own].sort((a, b) => deviation(b) - deviation(a))[0];
      const residual = (row: TransactionRow) => (row.durationUs - modelUs - row.otherIsrUs) / modelUs;
      return [
        shape,
        {
          count: own.length,
          busModelUs,
          busMeasuredEqualsModel: own.every((row) => row.phasesMatchModel && row.phaseLateCycles <= PHASE_LATE_MAX_CYCLES),
          maxPhaseLateCycles: Math.max(...own.map((row) => row.phaseLateCycles)),
          cpuRefUs,
          modelUs,
          busShareOfModel: round(busModelUs / modelUs, 4),
          durationUs: { min: Math.min(...own.map((row) => row.durationUs)), median: median(own.map((row) => row.durationUs)), max: Math.max(...own.map((row) => row.durationUs)) },
          maxDeviationPercent: round(100 * Math.max(...own.map(deviation)), 3),
          quiet: { count: quiet.length, maxDeviationPercent: quiet.length ? round(100 * Math.max(...quiet.map(deviation)), 3) : null },
          withOtherIsr: {
            count: busy.length,
            maxDeviationPercent: busy.length ? round(100 * Math.max(...busy.map(deviation)), 3) : null,
            maxOtherIsrUs: busy.length ? Math.max(...busy.map((row) => row.otherIsrUs)) : null,
            maxResidualPercent: busy.length ? round(100 * Math.max(...busy.map(residual)), 3) : null,
            isrs: [...new Set(busy.flatMap((row) => row.otherIsrs))].sort(),
          },
          within1Percent: quiet.every((row) => deviation(row) <= 0.01 && deviation(row) >= -1e-12) && busy.every((row) => residual(row) <= 0.01 && deviation(row) >= -1e-12),
          worst: worst ? { startUs: worst.startUs, durationUs: worst.durationUs, otherIsrUs: worst.otherIsrUs, otherIsrs: worst.otherIsrs } : null,
        },
      ];
    }),
  );
}

function runForms(compiled: Compiled, withDevice: boolean) {
  const run = emulate(compiled.hexPath, { device: withDevice, light: FORMS_LIGHT, levels: FORMS_LEVELS, maxUs: 3_600_000, done: (text) => /#S end\r\n[01]\r\n/.test(text) });
  const since = (cycle: number) => usOfCycles(cycle - run.setupCycle);
  const sections = sectionsOf(run.text);
  const scl = run.bus.sclCycles();

  // Serial: what each section printed against the TS side.
  const expectedColour = LIGHTS.flatMap((light) => {
    const reading = withDevice ? modelReading(light) : { c: 0, r: 0, g: 0, b: 0 };
    const colour = classifyColor(reading);
    return [`${reading.c} ${reading.r} ${reading.g} ${reading.b}`, COLOR_NAMES.map((_, n) => (n === colour ? '1' : '0')).join('')];
  });
  const expected: Record<string, string[]> = {
    id: withDevice ? ['68', '1', '235', '1'] : ['0', '0', '0', '0'],
    ir: ['0', '1'],
    color: expectedColour,
    end: ['0'],
  };
  const serialChecks = Object.fromEntries(Object.entries(expected).map(([name, lines]) => [name, JSON.stringify(sections[name]) === JSON.stringify(lines)]));
  const classes = LIGHTS.map((light, k) => {
    const printed = sections.color?.[2 * k + 1] ?? '';
    const reading = withDevice ? modelReading(light) : { c: 0, r: 0, g: 0, b: 0 };
    return { light, printedRaw: sections.color?.[2 * k] ?? null, printedIs: printed, hexClass: COLOR_NAMES[printed.indexOf('1')] ?? null, tsClass: COLOR_NAMES[classifyColor(reading)], irradiancePerS: irradianceOf(light), modelReading: reading };
  });

  // TWI: each transaction's content and timing.
  const rows = transactionRows(run.bus.transactions, since, scl, run.isrs);
  const shapes = rows.map((row) => row.shape);
  const fetch = withDevice ? ['W1', 'R8'] : ['W-nack'];
  const read8 = withDevice ? ['W1', 'R1'] : ['W-nack'];
  const expectedShapes = [...Array(4).fill(withDevice ? 'W2' : 'W-nack'), ...Array(4).fill(read8).flat(), ...Array(LIGHTS.length * 11).fill(fetch).flat()];
  const firstWrites = rows.slice(0, 4).map((row) => row.bytes);
  // Every 8-byte read took its data from a window that ran wholly in the light of its segment (the windows the model integrated).
  const aen = withDevice ? rows.find((row) => row.bytes.join() === '128,3') : undefined;
  const readsInPureWindows = !withDevice
    ? null
    : rows
        .filter((row) => row.shape === 'R8')
        .every((row) => {
          const window = run.windows.filter((w) => w.toUs <= row.startUs).at(-1);
          const segment = FORMS_LIGHT.filter((s) => s.fromUs <= row.startUs).at(-1);
          return window !== undefined && segment !== undefined && window.fromUs >= segment.fromUs;
        });
  // When colorFetch's eight data bytes are read, from the START of its command write: the simulator reads them all at one
  // instant, so a window that ends inside this span can give C from one window and R G B from the next (shadow registers).
  const fetchOffsets = run.bus.transactions.flatMap((t, i) => {
    const next = run.bus.transactions[i + 1];
    if (!(t.acked && !t.read && t.bytes.length === 1 && t.bytes[0] === 0xb4 && next?.read && next.acked)) {
      return [];
    }
    return [{ readStart: next.startCycle - t.startCycle, bytes: next.phases.filter((phase) => phase.kind === 'read').map((phase) => phase.requestCycle - t.startCycle), stop: next.stopCycle - t.startCycle }];
  });
  const spanOf = (pick: (f: (typeof fetchOffsets)[number]) => number) => {
    const values = fetchOffsets.map(pick).map(usOfCycles);
    return values.length ? { min: Math.min(...values), max: Math.max(...values) } : null;
  };
  const fetchTiming = {
    fetches: fetchOffsets.length,
    readStartUs: spanOf((f) => f.readStart),
    byteReadUs: Array.from({ length: 8 }, (_, k) => spanOf((f) => f.bytes[k] ?? 0)),
    stopUs: spanOf((f) => f.stop),
  };
  const enableWrite = run.bus.transactions.find((tr) => tr.bytes.join() === '128,3')?.phases.filter((phase) => phase.kind === 'write').at(-1);
  const firstWindowAfterEnableUs = enableWrite && run.windows[0] ? round(run.windows[0].toUs - since(enableWrite.doneCycle), 4) : null;
  const windowSchedule = run.windows.slice(0, 3).map((w) => ({ fromUs: round(w.fromUs, 4), toUs: round(w.toUs, 4) }));

  // Servos: pulse widths of each gripperSet, and both framed together on Timer1.
  const d9 = pulsesOf(run.uno.changes, 'D9');
  const d10 = pulsesOf(run.uno.changes, 'D10');
  const runs = { D9: servoRuns(d9, since), D10: servoRuns(d10, since) };
  const expectedWidths = (pin: string) => {
    const widths = GRIP_CALLS.filter((call) => call.pin === pin).map((call) => servoUs(clampGrip(call.angle)));
    return widths.filter((width, index) => index === 0 || width !== widths[index - 1]);
  };
  const widthChecks = Object.fromEntries(
    (['D9', 'D10'] as const).map((pin) => {
      // A run of one pulse is the first after attach() (servo-first-pulse) or a pulse an interrupt stretched (below); the
      // commanded widths are the runs of several pulses, with a repeated width merged (a stretched pulse splits its run).
      const got = runs[pin]
        .filter((r) => r.pulses > 1)
        .map((r) => Math.round(r.widthUs.median))
        .filter((width, index, all) => index === 0 || width !== all[index - 1]);
      return [pin, { expected: expectedWidths(pin), got, exact: JSON.stringify(got) === JSON.stringify(expectedWidths(pin)) }];
    }),
  );
  // Every pulse against the commanded width nearest it: the ones more than 1 µs off, and the interrupt that ran when it should
  // have ended (or started): the Servo ISR waits for any ISR under way, and writes the pin about 10 µs after its entry (its
  // prologue), so an ISR that ended up to 16 µs before the late edge is the one that held it.
  const pulseJitter = Object.fromEntries(
    (['D9', 'D10'] as const).map((pin) => {
      const pulses = pin === 'D9' ? d9 : d10;
      const commanded = [...new Set(GRIP_CALLS.filter((call) => call.pin === pin).map((call) => servoUs(clampGrip(call.angle))))];
      const off = pulses
        .filter((p) => since(p.rise) > 100_000)
        .map((p) => {
          const width = usOfCycles(p.fall - p.rise);
          const nominal = commanded.reduce((best, w) => (Math.abs(w - width) < Math.abs(best - width) ? w : best), commanded[0] ?? 0);
          const deviation = width - nominal;
          const at = deviation > 0 ? p.fall : p.rise;
          const blocking = run.isrs.filter((span) => span.vector !== SERVO_VECTOR && span.fromCycle < at && span.toCycle >= at - cyclesOfUs(Math.abs(deviation) + 16));
          return { riseUs: round(since(p.rise), 4), widthUs: width, nominalUs: nominal, deviationUs: round(deviation, 4), blockedBy: [...new Set(blocking.map((span) => VECTOR_NAMES[span.vector] ?? `vector 0x${span.vector.toString(16)}`))] };
        })
        .filter((p) => Math.abs(p.deviationUs) > 1);
      return [pin, { pulsesOffByMoreThan1Us: off.length, maxDeviationUs: off.length ? Math.max(...off.map((p) => Math.abs(p.deviationUs))) : 0, allExplained: off.every((p) => p.blockedBy.length > 0), off }];
    }),
  );
  // Each change shows within a frame of its call (waveform-phase): the run with the new width starts 0…20 ms + 2 ms after millis() reached it.
  const changeTimes = GRIP_CALLS.filter((call) => !('setup' in call)).map((call) => {
    const width = servoUs(clampGrip(call.angle));
    const run = runs[call.pin].find((r) => r.pulses > 1 && Math.round(r.widthUs.median) === width && r.fromUs >= call.ms * 1000 - 2000);
    return { ...call, widthUs: width, runFromUs: run?.fromUs ?? null, lagUs: run ? round(run.fromUs - call.ms * 1000, 2) : null };
  });
  const lagsOk = changeTimes.every((change) => change.lagUs === null ? change.pin === 'D10' && change.angle === -10 : change.lagUs >= -2000 && change.lagUs <= 22_000);
  // Together: every D10 pulse after both are attached rises right as a D9 pulse falls (Servo's ISR ends one channel and starts the next).
  const pairedGaps = d10
    .filter((p) => since(p.rise) > 100_000)
    .map((p) => {
      const before = d9.filter((q) => q.fall <= p.rise).at(-1);
      return before ? usOfCycles(p.rise - before.fall) : Number.POSITIVE_INFINITY;
    });
  const frames = (pulses: readonly { rise: number }[]) => pulses.slice(1).map((p, i) => usOfCycles(p.rise - (pulses[i]?.rise ?? 0))).filter((_, i) => since(pulses[i]?.rise ?? 0) > 100_000);
  const colourFrom = LIGHT_FROM_US;
  const widthDeviation = (pulses: readonly { rise: number; fall: number }[], from: number, to: number) => {
    const inside = pulses.filter((p) => since(p.rise) >= from && since(p.rise) < to).map((p) => usOfCycles(p.fall - p.rise));
    const nominal = median(inside);
    return { pulses: inside.length, nominalUs: nominal, maxAboveUs: round(Math.max(...inside) - nominal, 4), maxBelowUs: round(nominal - Math.min(...inside), 4) };
  };
  const together = {
    pairs: pairedGaps.length,
    d10RiseAfterD9FallUs: { min: Math.min(...pairedGaps), median: median(pairedGaps), max: Math.max(...pairedGaps) },
    framesUs: { D9: { min: Math.min(...frames(d9)), median: median(frames(d9)), max: Math.max(...frames(d9)) }, D10: { min: Math.min(...frames(d10)), median: median(frames(d10)), max: Math.max(...frames(d10)) } },
    // Interrupts of the colour section (TWI, USART) against the quiet servo section: how far a pulse width moved.
    widthJitter: {
      quiet: { D9: widthDeviation(d9, 900_000, 1_450_000), D10: widthDeviation(d10, 900_000, 1_450_000) },
      colour: { D9: widthDeviation(d9, colourFrom, 3_300_000), D10: widthDeviation(d10, colourFrom, 3_300_000) },
    },
  };
  const togetherOk = together.d10RiseAfterD9FallUs.max < 20 && Math.abs(together.framesUs.D9.median - 20_000) / 20_000 < 0.01 && Math.abs(together.framesUs.D10.median - 20_000) / 20_000 < 0.01;

  const timing = transactionTiming(rows);
  const checks = {
    serial: Object.values(serialChecks).every(Boolean),
    classesMatchTs: classes.every((c) => c.hexClass === c.tsClass),
    transactionsAsExpected: JSON.stringify(shapes) === JSON.stringify(expectedShapes),
    colorBeginWrites: JSON.stringify(firstWrites) === JSON.stringify(withDevice ? [[0x81, 0xeb], [0x8f, 0x01], [0x80, 0x01], [0x80, 0x03]] : [[], [], [], []]),
    busTimeIsTheDatasheets: Object.values(timing).every((t) => t.busMeasuredEqualsModel),
    transactionsWithin1Percent: Object.values(timing).every((t) => t.within1Percent),
    readsInPureWindows,
    servoWidthsExact: Object.values(widthChecks).every((c) => c.exact),
    servoJitterExplainedByIsrs: Object.values(pulseJitter).every((j) => j.allExplained),
    servoChangesWithinAFrame: lagsOk,
    servosTogetherOnTimer1: togetherOk,
  };
  return {
    device: withDevice,
    setupStartUs: usOfCycles(run.setupCycle),
    sclCycles: scl,
    sclHz: CLOCK_HZ / scl,
    phaseSclPeriods: PHASE_SCL_PERIODS,
    emulatedUs: round(since(run.uno.cpu.cycles), 1),
    wallMs: run.wallMs,
    sections,
    serialChecks,
    classes,
    transactions: { count: rows.length, timing, fetchTiming },
    aenAtUs: aen?.startUs ?? null,
    firstWindowAfterEnableUs,
    windows: { count: run.windows.length, first: windowSchedule, periodUs: run.windows.length > 1 ? round((run.windows[1]?.fromUs ?? 0) - (run.windows[0]?.fromUs ?? 0), 4) : null },
    devicePeek: run.device ? run.device.peek(since(run.uno.cpu.cycles)) : null,
    servo: { runs, widthChecks, pulseJitter, changeTimes, together },
    isrUs: Object.fromEntries(
      [...new Set(run.isrs.map((span) => span.vector))].sort((a, b) => a - b).map((vector) => {
        const lengths = run.isrs.filter((span) => span.vector === vector).map((span) => usOfCycles(span.toCycle - span.fromCycle));
        return [VECTOR_NAMES[vector] ?? `vector 0x${vector.toString(16)}`, { count: lengths.length, min: Math.min(...lengths), median: median(lengths), max: Math.max(...lengths) }];
      }),
    ),
    checks,
    pass: Object.values(checks).every((value) => value !== false),
    rows,
  };
}

// --- 3. Costs ---------------------------------------------------------------------------------------------------------------

function runCostSketch(compiled: Compiled, withDevice: boolean, keepStopInterrupt = false) {
  const run = emulate(compiled.hexPath, { keepStopInterrupt, device: withDevice, light: [{ fromUs: -1e9, light: 'white' }], levels: [{ pin: 'A3', atUs: 0, high: true }], maxUs: 3_000_000, done: (text) => text.includes('#G loop\r\n') });
  const text = run.uno.serial.map(({ byte }) => String.fromCharCode(byte)).join('');
  const groups = [...text.matchAll(/#G ([^\r\n]*)\r\n/g)].map((match) => ({ cycle: run.uno.serial[match.index]?.cycle ?? 0, name: match[1] ?? '' }));
  const printedAfter = Object.fromEntries([...text.matchAll(/#G (colorClassify[^\r\n]*)\r\n(\d+)\r\n/g)].map((match) => [match[1] ?? '', Number(match[2])]));
  const loopCycle = groups.find((group) => group.name === 'loop')?.cycle ?? Number.POSITIVE_INFINITY;
  const samples = new Map<string, number[]>();
  for (const { rise, fall } of pulsesOf(run.uno.changes, 'D8')) {
    if (rise > loopCycle) {
      continue;
    }
    const name = groups.filter((group) => group.cycle < rise).at(-1)?.name ?? '?';
    samples.set(name, [...(samples.get(name) ?? []), fall - rise]);
  }
  const baseline = Math.min(...(samples.get('baseline') ?? [0]));
  const costs = Object.fromEntries(
    [...samples].map(([name, cycles]) => {
      const net = cycles.map((c) => c - baseline);
      return [name, { samples: net.length, minCycles: Math.min(...net), medianCycles: median(net), maxCycles: Math.max(...net), minUs: usOfCycles(Math.min(...net)), medianUs: usOfCycles(median(net)), maxUs: usOfCycles(Math.max(...net)) }];
    }),
  );
  return { device: withDevice, baselineCycles: baseline, costs, classifyPrinted: printedAfter, wallMs: run.wallMs, transactions: run.bus.transactions.length };
}

// --- Main -------------------------------------------------------------------------------------------------------------------

const started = performance.now();
const forms = compile('gripper-forms');
const costsSketch = compile('gripper-costs');
const formsSource = readFileSync(join(spikeRoot, 'sketches/gripper-forms/gripper-forms.ino'), 'utf8');
const costsSource = readFileSync(join(spikeRoot, 'sketches/gripper-costs/gripper-costs.ino'), 'utf8');
const block = (source: string, begin: string, end: string) => source.slice(source.indexOf(begin) + begin.length, source.indexOf(end));
const rulesInSketch = block(formsSource, 'the runner checks this copy)\n', '// COLOR_RULES end').trim();
const helpers = (source: string) => block(source, '// GRIPPER HELPERS begin', '// GRIPPER HELPERS end').split('\n').slice(1).join('\n');

const formsWithDevice = runForms(forms, true);
const formsNack = runForms(forms, false);
const costsWithDevice = runCostSketch(costsSketch, true);
const costsNack = runCostSketch(costsSketch, false);
// What avr8js's TWINT after a STOP would add if the bus left it in place (one more TWI interrupt per transaction).
const costsAvr8jsStop = runCostSketch(costsSketch, true, true);

const us = (run: ReturnType<typeof runCostSketch>, name: string) => {
  const cost = run.costs[name];
  if (!cost) {
    throw new Error(`No samples for ${name}`);
  }
  return cost.minUs;
};
// The board profile's delayOverhead (contract §4.4): what the simulator adds to each delay(ms) it charges as ms × 1000.
const DELAY_OVERHEAD_US = 8.5625;
const gripperSetVariants = ['gripperSet claw v=45', 'gripperSet lift v=45', 'gripperSet claw v=120 (clamped to 90)', 'gripperSet lift v=-5 (clamped to 0)'];
const classifyNames = Object.keys(costsWithDevice.costs).filter((name) => name.startsWith('colorClassify'));
const costTable = {
  gripperSet: { us: Math.max(...gripperSetVariants.map((name) => us(costsWithDevice, name))), variantsUs: Object.fromEntries(gripperSetVariants.map((name) => [name, us(costsWithDevice, name)])), servoWriteUs: us(costsWithDevice, 'Servo.write claw v=45'), servoWrite120Us: us(costsWithDevice, 'Servo.write claw v=120') },
  colorFetch: { us: us(costsWithDevice, 'colorFetch, servos detached'), servosAttached: costsWithDevice.costs['colorFetch, servos attached'], servosDetached: costsWithDevice.costs['colorFetch, servos detached'] },
  colorFetchNack: { us: us(costsNack, 'colorFetch, servos detached'), servosAttached: costsNack.costs['colorFetch, servos attached'] },
  colorBegin: {
    us: round(us(costsWithDevice, 'colorBegin') - 57_000 - 2 * DELAY_OVERHEAD_US, 4),
    rule: 'colorBegin (min of 4) − 57000 − 2 × delayOverhead (8.5625): what the simulator adds for delay(3) and delay(54)',
    totalUs: us(costsWithDevice, 'colorBegin'),
    withoutDelaysCopyUs: us(costsWithDevice, 'colorBegin without its delays'),
    minusMeasuredDelaysUs: round(us(costsWithDevice, 'colorBegin') - us(costsWithDevice, 'delay v=3') - us(costsWithDevice, 'delay v=54'), 4),
    delay3Us: us(costsWithDevice, 'delay v=3'),
    delay54Us: us(costsWithDevice, 'delay v=54'),
  },
  colorBeginNack: { us: round(us(costsNack, 'colorBegin') - 57_000 - 2 * DELAY_OVERHEAD_US, 4), totalUs: us(costsNack, 'colorBegin'), withoutDelaysCopyUs: us(costsNack, 'colorBegin without its delays') },
  colorWrite: { us: us(costsWithDevice, 'colorWrite'), nackUs: us(costsNack, 'colorWrite') },
  avr8jsStopInterrupt: {
    reason: 'avr8js 0.21.1 completeStop() sets TWINT; the datasheet sets none after a STOP. twi-device.ts clears it; this is what leaving it would add.',
    colorFetchUs: us(costsAvr8jsStop, 'colorFetch, servos detached'),
    colorFetchExtraUs: round(us(costsAvr8jsStop, 'colorFetch, servos detached') - us(costsWithDevice, 'colorFetch, servos detached'), 4),
    colorWriteExtraUs: round(us(costsAvr8jsStop, 'colorWrite') - us(costsWithDevice, 'colorWrite'), 4),
  },
  digitalReadA3: { us: us(costsWithDevice, 'digitalRead A3'), irDetectUs: us(costsWithDevice, 'ir detect A3 (digitalRead == LOW)'), a1Us: us(costsWithDevice, 'digitalRead A1 (as EMU-08)'), d4Us: us(costsWithDevice, 'digitalRead D4 (as EMU-08)') },
  colorIs: { us: us(costsWithDevice, 'colorIs v=4'), nackUs: us(costsNack, 'colorIs v=4') },
  colorRaw: { us: us(costsWithDevice, 'colorRaw v=3'), nackUs: us(costsNack, 'colorRaw v=3') },
  colorClassify: {
    longestUs: Math.max(...classifyNames.map((name) => us(costsWithDevice, name))),
    byReading: Object.fromEntries(classifyNames.map((name) => [name, { us: us(costsWithDevice, name), printedClass: COLOR_NAMES[costsWithDevice.classifyPrinted[name] ?? -1] ?? null }])),
  },
};
const classifyExpected: Record<string, string> = {
  'colorClassify red': 'red',
  'colorClassify green': 'green',
  'colorClassify blue': 'blue',
  'colorClassify yellow': 'yellow',
  'colorClassify white': 'white',
  'colorClassify black': 'black',
  'colorClassify none': 'unknown',
  'colorClassify zeros (NACK)': 'unknown',
  'colorClassify grey (no rule)': 'unknown',
};
const wire = wireRamBytes('gripper-forms');
const wireLicense = (() => {
  const dir = `${process.env.HOME}/Library/Arduino15/packages/arduino/hardware/avr/1.8.8/libraries/Wire`;
  const properties = readFileSync(`${dir}/library.properties`, 'utf8');
  const header = readFileSync(`${dir}/src/Wire.cpp`, 'utf8');
  return {
    path: '~/Library/Arduino15/packages/arduino/hardware/avr/1.8.8/libraries/Wire',
    version: /version=(.*)/.exec(properties)?.[1] ?? null,
    license: /GNU Lesser General Public\s+License[^\n]*\n[^\n]*version ([\d.]+)/.exec(header) ? 'LGPL-2.1-or-later' : null,
    sha256: Object.fromEntries(
      ['library.properties', 'src/Wire.cpp', 'src/Wire.h', 'src/utility/twi.c', 'src/utility/twi.h'].map((file) => [file, createHash('sha256').update(readFileSync(`${dir}/${file}`)).digest('hex')]),
    ),
    headerQuote: 'This library is free software; you can redistribute it and/or modify it under the terms of the GNU Lesser General Public License as published by the Free Software Foundation; either version 2.1 of the License, or (at your option) any later version.',
  };
})();

// The ledger entries for task A5 (contract §14, uno-contract.ts `entry` form), written from the numbers above, never by hand.
const fd = formsWithDevice;
const fn = formsNack;
const t = fd.transactions.timing;
const pct = (value: number | null | undefined) => `${String(value)} %`;
const evidence = {
  'EMU-19': {
    kind: 'EMU',
    source: `avr8js ${String(JSON.parse(readFileSync(join(spikeRoot, '../../node_modules/avr8js/package.json'), 'utf8')).version)} on Node ${process.version.slice(1)} (${String(cpus()[0]?.model)}); HEX built by arduino-cli 1.5.1 for arduino:avr:uno (arduino:avr@1.8.8, Servo 1.3.0, Wire 1.0); the TWI through spikes/avr8js/twi-device.ts (each phase completes after its bus time from TWBR, datasheet 7810D §21.5.2) to the TS TCS34725 of spikes/avr8js/tcs34725-model.ts; node spikes/avr8js/run-gripper.ts (N19 G0.2, spikes/avr8js/out/gripper-results.json)`,
    action: 'sketches/gripper-forms: gripperSet(gripperClaw / gripperLift) on D9 / D10 with 80, 0, 120, -10, 45, 0 after attach + write(0) / write(90); (digitalRead(A3) == LOW) with A3 scripted HIGH then LOW; colorBegin(), then colorRaw(3, 0, 1, 2) and colorIs(0..6) under seven scripted lights of 250 ms (red, green, blue, yellow, white, black, none), read 150 ms into each; ID, STATUS, ATIME, CONTROL read back; the same HEX with no device at 0x29',
    observed: [
      `every line as the TS side: C R G B ${fd.classes.map((c) => `${c.light} ${String(c.printedRaw)}`).join(', ')}; colorIs one 1 at the TS class of each (red, green, blue, yellow, white, black, unknown); ID 68, STATUS 1, ATIME 235, CONTROL 1; IR 0 then 1; Wire timeout flag 0`,
      `no device: every reading 0 0 0 0 and colorIs(6) only, ID 0, every transaction SLA+W NACK + STOP (${fn.transactions.count}), no timeout`,
      `SCL ${fd.sclHz} Hz (TWBR 72, ${fd.sclCycles} cycles): every phase completes ${fd.sclCycles} × (1 START, 9 a byte, 1 STOP) cycles after its TWCR write, ≤ ${Math.max(...Object.values(t).map((x) => x.maxPhaseLateCycles))} cycles later (the instruction under way and an interrupt entry)`,
      `transactions (START → STOP) against bus time + the CPU's uninterrupted service: W2 ${t.W2?.modelUs} µs, W1 ${t.W1?.modelUs}, R1 ${t.R1?.modelUs}, R8 ${t.R8?.modelUs}, NACK ${fn.transactions.timing['W-nack']?.modelUs} (bus ${t.R8?.busShareOfModel} of R8); with no other interrupt in them ≤ ${pct(Math.max(...[...Object.values(t), ...Object.values(fn.transactions.timing)].map((x) => x.quiet.maxDeviationPercent ?? 0)))} longer; with one, up to ${pct(t.W1?.maxDeviationPercent)} longer, never by more than the Servo, Timer0 and USART interrupts that ran in them`,
      `windows every ${fd.windows.periodUs} µs (2.4 ms Init + 50.4 ms), the first ending ${fd.firstWindowAfterEnableUs} µs after the ENABLE byte with AEN was written; every 8-byte read from a window wholly in its light; the eight data bytes read ${fd.transactions.fetchTiming.byteReadUs[0]?.min}…${fd.transactions.fetchTiming.byteReadUs[7]?.max} µs after the command write's START`,
      `servo pulses 544 / 1368 / 1472 / 544 µs (claw) and 1472 / 544 / 1008 µs (lift), 120 → 1472 and -10 → 544, each from the next frame; both on Timer1, the lift's pulse rising ${fd.servo.together.d10RiseAfterD9FallUs.median} µs after the claw's falls, frames ${fd.servo.together.framesUs.D9.median} µs; a pulse ${Math.max(fd.servo.pulseJitter.D9?.maxDeviationUs ?? 0, fd.servo.pulseJitter.D10?.maxDeviationUs ?? 0, fn.servo.pulseJitter.D10?.maxDeviationUs ?? 0)} µs long at most when a TWI or Timer0 interrupt held the Servo interrupt (TWI interrupt ≤ ${fd.isrUs.TWI?.max} µs: twi_stop() waits for the STOP inside it)`,
      `avr8js sets TWINT after a STOP, the datasheet does not (§21.6): twi-device.ts clears it (left in place: +${costTable.avr8jsStopInterrupt.colorWriteExtraUs} µs a transaction, +${costTable.avr8jsStopInterrupt.colorFetchExtraUs} µs a colorFetch)`,
    ].join('; '),
    establishes: ['range', 'default', 'clamp', 'round', 'block', 'yield', 'return', 'error', 'content'],
  },
  'EMU-20': {
    kind: 'EMU',
    source: 'as EMU-19 (node spikes/avr8js/run-gripper.ts)',
    action: 'sketches/gripper-costs: each helper call between port-write markers, 8 samples (colorFetch 32, colorBegin 4), shortest minus the baseline; the TCS34725 on the bus under white light, and the same HEX with no device at 0x29',
    observed: [
      `gripperSet ${Object.values(costTable.gripperSet.variantsUs).join(' / ')} µs (claw 45, lift 45, 120 clamped, -5 clamped; Servo.write 45 ${costTable.gripperSet.servoWriteUs}, 120 ${costTable.gripperSet.servoWrite120Us})`,
      `digitalRead(A3) ${costTable.digitalReadA3.us} µs (A1 ${costTable.digitalReadA3.a1Us}, D4 ${costTable.digitalReadA3.d4Us}), (digitalRead(A3) == LOW) ${costTable.digitalReadA3.irDetectUs}`,
      `colorFetch ${costTable.colorFetch.us} µs (median ${costTable.colorFetch.servosDetached?.medianUs}, max ${costTable.colorFetch.servosDetached?.maxUs}; with both servos ${costTable.colorFetch.servosAttached?.minUs}…${costTable.colorFetch.servosAttached?.maxUs}), NACK ${costTable.colorFetchNack.us}`,
      `colorBegin ${costTable.colorBegin.totalUs} µs = ${costTable.colorBegin.us} + delay(3) + delay(54) as the simulator charges them (its statements without the delays ${costTable.colorBegin.withoutDelaysCopyUs}); NACK ${costTable.colorBeginNack.totalUs} (${costTable.colorBeginNack.us})`,
      `one register write ${costTable.colorWrite.us} µs (NACK ${costTable.colorWrite.nackUs}); colorClassify ${Math.min(...Object.values(costTable.colorClassify.byReading).map((x) => x.us).filter((x) => x > 20))}…${costTable.colorClassify.longestUs} µs by the rule that matches (zeros ${costTable.colorClassify.byReading['colorClassify zeros (NACK)']?.us}); colorIs(4) on white ${costTable.colorIs.us} (NACK ${costTable.colorIs.nackUs}), colorRaw(3) ${costTable.colorRaw.us} (NACK ${costTable.colorRaw.nackUs})`,
    ].join('; '),
    establishes: ['block'],
  },
  'CC-06': {
    kind: 'CC',
    source: 'arduino-cli 1.5.1 compile --fqbn arduino:avr:uno --warnings all (arduino:avr@1.8.8, avr-gcc 7.3.0-atmel3.6.1-arduino7, Servo 1.3.0, Wire 1.0)',
    action: 'Compiled sketches/gripper-forms and sketches/gripper-costs with --warnings all; avr-nm -S of gripper-forms.ino.elf',
    observed: `Both compile; no warning from the sketches, Wire or Servo (only the core's new.cpp, ${forms.warnings.length}); gripper-forms ${forms.flashBytes} B flash (${forms.flashPercent} %), ${forms.ramBytes} B RAM (${forms.ramPercent} %); gripper-costs ${costsSketch.flashBytes} B (${costsSketch.flashPercent} %), ${costsSketch.ramBytes} B (${costsSketch.ramPercent} %); Wire's RAM ${wire.bytes} B (five 32 B buffers, its state, the TwoWire object and vtable); COLOR_RULES in PROGMEM`,
    establishes: ['call', 'import', 'module'],
  },
};

const results = {
  evidence,
  takenOn: new Date().toISOString(),
  command: 'node spikes/avr8js/run-gripper.ts',
  machine: { cpu: cpus()[0]?.model, cores: cpus().length, loadavg: loadavg().map((l) => round(l, 2)), node: process.version, platform: `${process.platform} ${process.arch}` },
  toolchain: {
    arduinoCli: execFileSync('arduino-cli', ['version'], { encoding: 'utf8' }).trim(),
    cores: execFileSync('arduino-cli', ['core', 'list'], { encoding: 'utf8' }).trim(),
    libs: execFileSync('arduino-cli', ['lib', 'list'], { encoding: 'utf8' }).trim(),
    avr8js: JSON.parse(readFileSync(join(spikeRoot, '../../node_modules/avr8js/package.json'), 'utf8')).version,
  },
  compile: { forms: { ...forms, hexPath: undefined }, costs: { ...costsSketch, hexPath: undefined }, wireRam: wire },
  wire: wireLicense,
  colorRules: { sketchCopyMatchesTs: rulesInSketch === colorRulesCpp(), helpersIdentical: helpers(formsSource) === helpers(costsSource) },
  forms: { withDevice: { ...formsWithDevice, rows: undefined }, nack: { ...formsNack, rows: undefined } },
  costs: { table: costTable, classifyAsExpected: Object.entries(classifyExpected).every(([name, colour]) => costTable.colorClassify.byReading[name]?.printedClass === colour), withDevice: costsWithDevice, nack: costsNack },
  totalWallMs: 0,
};
results.totalWallMs = Math.round(performance.now() - started);

const out = join(spikeRoot, 'out');
mkdirSync(join(out, 'traces'), { recursive: true });
writeFileSync(join(out, 'gripper-results.json'), `${JSON.stringify(results, null, 2)}\n`);
const traceLine = (row: TransactionRow) =>
  `${row.startUs.toFixed(4).padStart(14)} µs  ${row.shape.padEnd(7)} ${row.durationUs.toFixed(4).padStart(10)} µs (bus ${row.busModelUs.toFixed(1)}, cpu ${row.cpuUs.toFixed(4)})  ${row.bytes.map((b) => b.toString(16).padStart(2, '0')).join(' ')}`;
writeFileSync(
  join(out, 'traces', 'gripper-twi.txt'),
  [`# gripper-forms with the TCS34725 (µs from setup(); START → STOP; data bytes hex)`, ...formsWithDevice.rows.map(traceLine), `# gripper-forms with no device at 0x29`, ...formsNack.rows.map(traceLine), ''].join('\n'),
);

console.log(
  JSON.stringify(
    {
      formsWithDevice: formsWithDevice.checks,
      formsNack: formsNack.checks,
      colorRules: results.colorRules,
      classifyAsExpected: results.costs.classifyAsExpected,
      sizes: { forms: [forms.flashBytes, forms.ramBytes, forms.ramPercent], costs: [costsSketch.flashBytes, costsSketch.ramBytes, costsSketch.ramPercent], wireRamBytes: wire.bytes, sketchWarnings: forms.sketchWarnings.length + costsSketch.sketchWarnings.length },
      costs: {
        gripperSet: costTable.gripperSet.us,
        colorFetch: costTable.colorFetch.us,
        colorFetchNack: costTable.colorFetchNack.us,
        colorBegin: costTable.colorBegin.us,
        colorBeginNack: costTable.colorBeginNack.us,
        digitalReadA3: costTable.digitalReadA3.us,
        colorIs: costTable.colorIs.us,
        colorRaw: costTable.colorRaw.us,
        colorClassifyLongest: costTable.colorClassify.longestUs,
      },
      totalWallMs: results.totalWallMs,
    },
    null,
    2,
  ),
);
