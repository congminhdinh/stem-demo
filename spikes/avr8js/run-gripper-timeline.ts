// N19 A3: when each I²C event of the colour helpers happens, from the call, on avr8js (the evidence of the tcs34725-wire driver's
// timeline). node spikes/avr8js/run-gripper-timeline.ts (Node 24 strips the types; spikes/ is outside lint and tsconfig).
// Writes out/gripper-timeline.json and prints it.
//
// It runs sketches/gripper-costs (the helpers between port-write markers on D8, run-gripper.ts's EMU-20 sketch) with the TS TCS34725
// on the bus (twi-device.ts, white light) and again with no device at 0x29, and for each sample of colorBegin and colorFetch lists
// every TWI phase (when the program asked for it and when it completed) and every call the bus made on the device, in µs from the
// marker's rise. The sample reported is the shortest (the one no interrupt landed in), as EMU-20 takes it.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus, loadavg } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AVRTWI, avrInstruction, twiConfig } from 'avr8js';
import { CLOCK_HZ, EmulatedUno, usOfCycles, type RawPinChange } from '../../tests/parity/emulated-uno.ts';
import { parseIntelHex } from '../../tests/parity/intel-hex.ts';
import { timelineIntegral } from './gripper-light.ts';
import { createTcs34725 } from './tcs34725-model.ts';
import { TimedTwiBus, type I2cDevice } from './twi-device.ts';

const spikeRoot = dirname(fileURLToPath(import.meta.url));
const round = (value: number, digits = 4) => Number(value.toFixed(digits));

function compile(name: string): string {
  const sketchDir = join(spikeRoot, 'sketches', name);
  const buildDir = join(spikeRoot, 'build', name);
  mkdirSync(buildDir, { recursive: true });
  const run = spawnSync('arduino-cli', ['compile', '--fqbn', 'arduino:avr:uno', '--build-path', buildDir, sketchDir], { encoding: 'utf8' });
  if (run.status !== 0) {
    throw new Error(`arduino-cli compile failed for ${name}:\n${run.stdout}\n${run.stderr}`);
  }
  return join(buildDir, `${name}.ino.hex`);
}

type DeviceCall = { kind: 'connect' | 'write' | 'read' | 'stop'; cycle: number; byte?: number; read?: boolean; ack?: boolean };

function emulate(hexPath: string, withDevice: boolean) {
  const uno = new EmulatedUno(parseIntelHex(readFileSync(hexPath, 'utf8')));
  const twi = new AVRTWI(uno.cpu, twiConfig, CLOCK_HZ);
  const calls: DeviceCall[] = [];
  const integral = timelineIntegral([{ fromUs: -1e9, light: 'white' }]);
  const model = createTcs34725(integral);
  // The model's time is µs since setup(), as everywhere; the log keeps the cycle of each call.
  const since = (cycle: number) => usOfCycles(cycle - (uno.setupCycle ?? 0));
  const cycleOf = (us: number) => Math.round(us * 16) + (uno.setupCycle ?? 0);
  const logged: I2cDevice = {
    address: model.address,
    connect: (now, read) => {
      const ack = model.connect(now, read);
      calls.push({ kind: 'connect', cycle: cycleOf(now), read, ack });
      return ack;
    },
    write: (now, byte) => {
      const ack = model.write(now, byte);
      calls.push({ kind: 'write', cycle: cycleOf(now), byte, ack });
      return ack;
    },
    read: (now) => {
      const byte = model.read(now);
      calls.push({ kind: 'read', cycle: cycleOf(now), byte });
      return byte;
    },
    stop: (now) => {
      model.stop(now);
      calls.push({ kind: 'stop', cycle: cycleOf(now) });
    },
  };
  const bus = new TimedTwiBus(uno.cpu, twi, since, withDevice ? [logged] : []);
  uno.drive('A3', true);
  const text = () => uno.serial.map(({ byte }) => String.fromCharCode(byte)).join('');
  const { cpu } = uno;
  for (let us = 10_000; !text().includes('#G loop\r\n') && us < 4_000_000; us += 10_000) {
    const end = Math.round(us * 16);
    while (cpu.cycles < end) {
      avrInstruction(cpu);
      cpu.tick();
    }
  }
  return { uno, bus, calls, text: text() };
}

function pulsesOf(changes: readonly RawPinChange[], pin: string): { rise: number; fall: number }[] {
  const out: { rise: number; fall: number }[] = [];
  let rise: number | null = null;
  for (const change of changes) {
    if (change.pin !== pin) continue;
    if (change.state === 'HIGH') rise = change.cycle;
    else if (rise !== null) {
      out.push({ rise, fall: change.cycle });
      rise = null;
    }
  }
  return out;
}

function timelines(run: ReturnType<typeof emulate>, names: readonly string[]) {
  const groups = [...run.text.matchAll(/#G ([^\r\n]*)\r\n/g)].map((match) => ({ cycle: run.uno.serial[match.index]?.cycle ?? 0, name: match[1] ?? '' }));
  const pulses = pulsesOf(run.uno.changes, 'D8');
  const baseline = Math.min(...pulses.filter((p) => groups.filter((g) => g.cycle < p.rise).at(-1)?.name === 'baseline').map((p) => p.fall - p.rise));
  return Object.fromEntries(
    names.map((name) => {
      const own = pulses.filter((p) => groups.filter((g) => g.cycle < p.rise).at(-1)?.name === name);
      const shortest = own.reduce((best, p) => (p.fall - p.rise < best.fall - best.rise ? p : best));
      const rel = (cycle: number) => round(usOfCycles(cycle - shortest.rise), 4);
      const phases = run.bus.transactions
        .filter((t) => t.startCycle >= shortest.rise && t.stopCycle <= shortest.fall)
        .flatMap((t) => t.phases.map((phase) => ({ kind: phase.kind, requestUs: rel(phase.requestCycle), doneUs: rel(phase.doneCycle), busUs: usOfCycles(phase.busCycles), ...(phase.byte === undefined ? {} : { byte: phase.byte }), ...(phase.ack === undefined ? {} : { ack: phase.ack }) })));
      const deviceCalls = run.calls
        .filter((call) => call.cycle >= shortest.rise && call.cycle <= shortest.fall)
        .map((call) => ({ kind: call.kind, atUs: rel(call.cycle), ...(call.byte === undefined ? {} : { byte: call.byte }), ...(call.read === undefined ? {} : { read: call.read }) }));
      return [name, { samples: own.length, baselineCycles: baseline, totalUs: usOfCycles(shortest.fall - shortest.rise - baseline), phases, deviceCalls }];
    }),
  );
}

const started = performance.now();
const hex = compile('gripper-costs');
const names = ['colorBegin', 'colorBegin without its delays', 'colorWrite', 'colorFetch, servos detached', 'colorIs v=4', 'colorRaw v=3'];
const withDevice = timelines(emulate(hex, true), names);
const nack = timelines(emulate(hex, false), names);
const results = {
  takenOn: new Date().toISOString(),
  command: 'node spikes/avr8js/run-gripper-timeline.ts',
  machine: { cpu: cpus()[0]?.model, cores: cpus().length, loadavg: loadavg().map((l) => round(l, 2)), node: process.version },
  note: 'µs from the rise of the D8 marker (the marker pair itself is baselineCycles); phases: requestUs = the TWCR write that asked for it, doneUs = when the bus completed it; deviceCalls: when the bus called the TCS34725 model (connect/write/stop when the byte or STOP ends, read when the byte starts)',
  withDevice,
  nack,
  wallMs: 0,
};
results.wallMs = Math.round(performance.now() - started);
mkdirSync(join(spikeRoot, 'out'), { recursive: true });
writeFileSync(join(spikeRoot, 'out', 'gripper-timeline.json'), `${JSON.stringify(results, null, 2)}\n`);
console.log(JSON.stringify(results, null, 1));
