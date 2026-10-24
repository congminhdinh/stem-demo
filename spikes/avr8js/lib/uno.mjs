// R0.4 spike: compile an UNO sketch with arduino-cli and run the HEX in avr8js on Node.
// Evidence only (spikes/ is outside lint and tsconfig). Every number this prints comes from the
// emulated cycle counter: µs = cycles / 16 (ATmega328P at 16 MHz).

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ADCMuxInputType,
  AVRADC,
  AVRIOPort,
  AVRTimer,
  AVRUSART,
  CPU,
  PinState,
  adcConfig,
  avrInstruction,
  portBConfig,
  portCConfig,
  portDConfig,
  timer0Config,
  timer1Config,
  timer2Config,
  usart0Config,
} from 'avr8js';

export const CLOCK_HZ = 16_000_000;
export const CYCLES_PER_US = CLOCK_HZ / 1_000_000;
export const usOf = (cycles) => cycles / CYCLES_PER_US;
export const cyclesOf = (us) => Math.round(us * CYCLES_PER_US);

const here = dirname(fileURLToPath(import.meta.url));
export const spikeRoot = resolve(here, '..');
export const FQBN = 'arduino:avr:uno';

/** UNO pin name → ATmega328P port and bit (D0–D7 = PD0–7, D8–D13 = PB0–5, A0–A5 = PC0–5). */
export const UNO_PINS = Object.fromEntries([
  ...Array.from({ length: 8 }, (_, bit) => [`D${bit}`, { port: 'D', bit }]),
  ...Array.from({ length: 6 }, (_, bit) => [`D${bit + 8}`, { port: 'B', bit }]),
  ...Array.from({ length: 6 }, (_, bit) => [`A${bit}`, { port: 'C', bit }]),
]);

/**
 * Compiles `sketches/<name>/<name>.ino` with arduino-cli and returns the HEX path and the size lines.
 * `extraArgs` lets a sketch be compiled with build properties (never needed by the shipped sketches).
 */
export function compileSketch(name, extraArgs = []) {
  const sketchDir = join(spikeRoot, 'sketches', name);
  const buildDir = join(spikeRoot, 'build', name);
  mkdirSync(buildDir, { recursive: true });
  const run = spawnSync('arduino-cli', ['compile', '--fqbn', FQBN, '--build-path', buildDir, '--warnings', 'default', ...extraArgs, sketchDir], {
    encoding: 'utf8',
  });
  // arduino-cli prints the sizes on stdout, and the low-memory warning and errors on stderr.
  const stdout = `${run.stdout}\n${run.stderr}`.replace(/\x1b\[[0-9;]*m/g, '');
  const ok = run.status === 0 && !/Error during build/.test(stdout);
  if (!ok && !extraArgs.length) {
    throw new Error(`arduino-cli compile failed for ${name}:\n${stdout}`);
  }
  const flash = /Sketch uses (\d+) bytes \((\d+)%\) of program storage space\. Maximum is (\d+) bytes\./.exec(stdout);
  const ram = /Global variables use (\d+) bytes \((\d+)%\) of dynamic memory, leaving (\d+) bytes for local variables\. Maximum is (\d+) bytes\./.exec(stdout);
  return {
    ok,
    hexPath: join(buildDir, `${basename(sketchDir)}.ino.hex`),
    stdout: stdout.trim(),
    size: {
      flashBytes: flash ? Number(flash[1]) : null,
      flashPercent: flash ? Number(flash[2]) : null,
      flashMax: flash ? Number(flash[3]) : null,
      ramBytes: ram ? Number(ram[1]) : null,
      ramPercent: ram ? Number(ram[2]) : null,
      ramMax: ram ? Number(ram[4]) : null,
      lowMemoryWarning: /Low memory available/.test(stdout),
      notEnoughMemory: /Not enough memory|data section exceeds/.test(stdout),
    },
  };
}

/** Intel HEX → program memory image (32 KB flash of the ATmega328P). */
export function loadHex(path) {
  const flash = new Uint8Array(0x8000);
  let upper = 0;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    if (!line.startsWith(':')) continue;
    const bytes = Buffer.from(line.slice(1), 'hex');
    const count = bytes[0];
    const address = (bytes[1] << 8) | bytes[2];
    const type = bytes[3];
    if (type === 0) {
      flash.set(bytes.subarray(4, 4 + count), upper + address);
    } else if (type === 4) {
      upper = ((bytes[4] << 8) | bytes[5]) << 16;
    } else if (type === 1) {
      break;
    }
  }
  return new Uint16Array(flash.buffer);
}

const stateName = (state) => ['LOW', 'HIGH', 'INPUT', 'INPUT_PULLUP'][state];

/**
 * One emulated UNO: CPU + Timer0/1/2 + ports B/C/D + USART0 + ADC, as avr8js 0.21.1 provides them.
 * Records every change of a pin's state (LOW/HIGH/INPUT/INPUT_PULLUP, as `AVRIOPort.pinState` reports it)
 * and every byte the USART starts to send, each with its cycle.
 */
export class EmulatedUno {
  constructor(hexPath) {
    this.cpu = new CPU(loadHex(hexPath));
    this.timers = [new AVRTimer(this.cpu, timer0Config), new AVRTimer(this.cpu, timer1Config), new AVRTimer(this.cpu, timer2Config)];
    this.ports = { B: new AVRIOPort(this.cpu, portBConfig), C: new AVRIOPort(this.cpu, portCConfig), D: new AVRIOPort(this.cpu, portDConfig) };
    this.usart = new AVRUSART(this.cpu, usart0Config, CLOCK_HZ);
    this.adc = new AVRADC(this.cpu, adcConfig);
    /** @type {{ cycle: number, pin: string, state: string }[]} */
    this.trace = [];
    /** @type {{ cycle: number, byte: number }[]} */
    this.serial = [];
    this.pinListeners = [];
    this.adcVolts = new Map();
    this.adcReads = [];
    this.adc.onADCRead = (input) => {
      const channel = input.type === ADCMuxInputType.SingleEnded ? input.channel : -1;
      const volts = this.adcVolts.get(channel) ?? 0;
      const value = Math.max(0, Math.min(1023, Math.round((volts / 5) * 1023)));
      this.adcReads.push({ cycle: this.cpu.cycles, channel, sampleCycles: this.adc.sampleCycles });
      this.cpu.addClockEvent(() => this.adc.completeADCRead(value), this.adc.sampleCycles);
    };
    const last = {};
    for (const [pin, { port, bit }] of Object.entries(UNO_PINS)) {
      last[pin] = stateName(this.ports[port].pinState(bit));
    }
    for (const [portName, port] of Object.entries(this.ports)) {
      port.addListener(() => {
        for (const [pin, where] of Object.entries(UNO_PINS)) {
          if (where.port !== portName) continue;
          const state = stateName(port.pinState(where.bit));
          if (state !== last[pin]) {
            last[pin] = state;
            const event = { cycle: this.cpu.cycles, pin, state };
            this.trace.push(event);
            for (const listener of this.pinListeners) listener(event);
          }
        }
      });
    }
    this.usart.onByteTransmit = (byte) => this.serial.push({ cycle: this.cpu.cycles, byte });
  }

  /** Calls `listener` on every recorded pin change. */
  onPin(listener) {
    this.pinListeners.push(listener);
  }

  /** Drives an input pin from outside (an echo, a button). Recorded in the trace as `in:HIGH` / `in:LOW`. */
  drive(pin, high) {
    const { port, bit } = UNO_PINS[pin];
    this.ports[port].setPin(bit, high);
    this.trace.push({ cycle: this.cpu.cycles, pin, state: high ? 'in:HIGH' : 'in:LOW' });
  }

  /** Runs `fn` after `us` emulated microseconds from now. */
  after(us, fn) {
    this.cpu.addClockEvent(fn, cyclesOf(us));
  }

  setAnalog(pin, volts) {
    this.adcVolts.set(Number(pin.slice(1)), volts);
  }

  /** Runs until `us` emulated microseconds since reset. */
  runUntilUs(us) {
    const end = cyclesOf(us);
    const { cpu } = this;
    while (cpu.cycles < end) {
      avrInstruction(cpu);
      cpu.tick();
    }
  }

  /** Serial output as lines, each with the cycle at which its first byte started to send. */
  serialLines() {
    const lines = [];
    let text = '';
    let start = null;
    for (const { cycle, byte } of this.serial) {
      if (start === null) start = cycle;
      if (byte === 10) {
        lines.push({ cycle: start, text: text.replace(/\r$/, '') });
        text = '';
        start = null;
      } else {
        text += String.fromCharCode(byte);
      }
    }
    return lines;
  }

  /** Labels the sketch printed as `#G <name>\n`, each with the cycle of its `#`, wherever they fall in the byte stream. */
  serialGroups() {
    const text = this.serial.map(({ byte }) => String.fromCharCode(byte)).join('');
    const groups = [];
    for (const match of text.matchAll(/#G ([^\r\n]*)/g)) {
      groups.push({ cycle: this.serial[match.index].cycle, text: match[1] });
    }
    return groups;
  }

  /** The trace of one pin. */
  pinTrace(pin) {
    return this.trace.filter((event) => event.pin === pin);
  }
}

/** Rising and falling edges of an output pin as [{ rise, fall }] cycle pairs (complete pulses only). */
export function pulses(events, high = 'HIGH') {
  const out = [];
  let rise = null;
  for (const { cycle, state } of events) {
    if (state === high) {
      rise = cycle;
    } else if (rise !== null) {
      out.push({ rise, fall: cycle });
      rise = null;
    }
  }
  return out;
}

export const round = (value, digits = 3) => Number(value.toFixed(digits));

export function stats(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return {
    n: sorted.length,
    min: sorted[0],
    median: sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2,
    max: sorted[sorted.length - 1],
  };
}

/** Pin trace as printable rows: µs since reset, pin, state. */
export function traceRows(events, limit = Infinity) {
  return events.slice(0, limit).map(({ cycle, pin, state }) => `${usOf(cycle).toFixed(4).padStart(14)} µs  ${pin.padEnd(4)} ${state}`);
}

/** The tool and library versions the evidence was taken with. */
export function toolchain() {
  const cli = execFileSync('arduino-cli', ['version'], { encoding: 'utf8' }).trim();
  const cores = execFileSync('arduino-cli', ['core', 'list'], { encoding: 'utf8' }).trim();
  const libs = execFileSync('arduino-cli', ['lib', 'list'], { encoding: 'utf8' }).trim();
  const avr8js = JSON.parse(readFileSync(resolve(spikeRoot, '../../node_modules/avr8js/package.json'), 'utf8')).version;
  return { arduinoCli: cli, cores, libs, avr8js, node: process.version, platform: `${process.platform} ${process.arch}` };
}

/**
 * What one pin did in a window [fromUs, toUs): a constant level, or a pulse train with its median period,
 * high time, frequency and duty (high time / period). Only complete periods inside the window count.
 */
export function summarize(trace, pin, fromUs, toUs) {
  const from = cyclesOf(fromUs);
  const to = cyclesOf(toUs);
  const events = trace.filter((event) => event.pin === pin);
  const before = events.filter((event) => event.cycle < from);
  const startState = before.length ? before[before.length - 1].state : 'INPUT';
  const inside = events.filter((event) => event.cycle >= from && event.cycle < to);
  if (inside.length === 0) {
    return { pin, fromUs, toUs, level: startState };
  }
  const rises = inside.filter((event) => event.state === 'HIGH' || event.state === 'in:HIGH').map((event) => event.cycle);
  const highs = pulses(inside.map((event) => ({ ...event, state: event.state.replace('in:', '') })));
  const periods = rises.slice(1).map((cycle, index) => cycle - rises[index]);
  if (periods.length < 2) {
    return { pin, fromUs, toUs, level: 'CHANGES', transitions: inside.map(({ cycle, state }) => ({ us: usOf(cycle), state })) };
  }
  const period = stats(periods);
  const high = stats(highs.map(({ rise, fall }) => fall - rise));
  return {
    pin,
    fromUs,
    toUs,
    level: 'PULSES',
    periods: period.n,
    periodUs: { min: usOf(period.min), median: usOf(period.median), max: usOf(period.max) },
    highUs: { min: usOf(high.min), median: usOf(high.median), max: usOf(high.max) },
    frequencyHz: round(1e6 / usOf(period.median), 3),
    duty: round(high.median / period.median, 5),
  };
}

/** |measured − expected| ≤ 1 % of expected (the R0.4 acceptance). */
export const within1Percent = (measured, expected) => Math.abs(measured - expected) <= Math.abs(expected) * 0.01;

export { avrInstruction };
