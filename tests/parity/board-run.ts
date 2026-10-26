import type { BoardProfile, Kit } from '../../src/core/hardware';
import { decodePin, type RawChange, type WaveformDecoding } from './board-trace';
import { cyclesOfUs, EmulatedUno, usOfCycles, type RawPinState } from './emulated-uno';
import { adcValueOf, analogFeed, echoFeed, levelTimeline, recordedColorSensor, type ColorBusEvent, type ParityInputs } from './inputs';
import { parseIntelHex } from './intel-hex';
import type { PinEvent, PrintedLine } from './trace';

// The L2e side of the parity harness (N18 C2): the fixture's HEX on the emulated UNO, with the scripted inputs at the same µs from
// the start of setup() as the simulator gets them, for `recordUs` from the start of setup() and no further (the CPU runs in steps of
// SETUP_STEP_US until setup() starts, then to its end; a change or a byte past it is dropped), then the recorded edges read back into
// events (board-trace.ts) and the USART's bytes into lines.

export type BoardRun = {
  /** Every pin's events, in time order per pin. */
  events: PinEvent[];
  /** Each line the USART sent, at the time its first byte started (µs from setup()). */
  lines: PrintedLine[];
  /** The bytes of a line the USART had not finished when the recording ended ('' when none). */
  unfinishedLine: string;
  /** When the last byte the program printed has left the USART, in µs from setup(); 0 when it printed nothing. */
  serialDoneUs: number;
  /** µs from reset to the start of setup(). */
  setupStartUs: number;
  /** N19 C2: every call the timed TWI made on the colour sensor, µs from the start of setup() (none without `inputs.colors`). */
  colorBus: ColorBusEvent[];
};

/** What a cycle counter reads before setup() at most: init() ends within a few hundred µs of reset (ADR 0003 §3.9). */
const SETUP_DEADLINE_US = 100_000;
/** The step of the CPU until setup() starts: it never runs more than this past it before the recording is bounded. */
const SETUP_STEP_US = 50;

export function runBoard(
  hex: string,
  setting: { kit: Kit; board: BoardProfile; decodings: ReadonlyMap<string, WaveformDecoding> },
  inputs: ParityInputs,
  recordUs: number,
): BoardRun {
  const { kit, board, decodings } = setting;
  const uno = new EmulatedUno(parseIntelHex(hex));

  // Digital levels: the levels at 0 from reset on (nothing reads them before setup()), the changes from setup() on.
  const timeline = levelTimeline(kit, inputs);
  for (const [pin, changes] of timeline) {
    for (const change of changes.filter((c) => c.atUs === 0)) {
      uno.drive(pin, change.level === 1);
    }
  }
  uno.onSetup(() => {
    const start = uno.cpu.cycles;
    for (const [pin, changes] of timeline) {
      for (const change of changes.filter((c) => c.atUs > 0)) {
        uno.at(start + cyclesOfUs(change.atUs), () => uno.drive(pin, change.level === 1));
      }
    }
  });

  const groups = inputs.analog ?? [];
  const analog = analogFeed(groups);
  uno.analogValue = (pin) => (groups.some((group) => group.pins.includes(pin)) ? adcValueOf(analog.next(pin), board.adcMax) : 0);

  if (inputs.echoes) {
    const { trig, echo } = inputs.echoes;
    const echoes = echoFeed(inputs.echoes);
    let trigState: RawPinState = 'INPUT';
    uno.onPin((change) => {
      if (change.pin !== trig) {
        return;
      }
      const falls = trigState === 'HIGH' && change.state === 'LOW';
      trigState = change.state;
      const reading = falls ? echoes.next() : null;
      if (reading && reading.widthUs > 0) {
        const rise = change.cycle + cyclesOfUs(reading.waitUs);
        uno.at(rise, () => uno.drive(echo, true));
        uno.at(rise + cyclesOfUs(reading.widthUs), () => uno.drive(echo, false));
      }
    });
  }

  // N19 C2: the TWI with its timed bus, and the colour sensor on it under the scripted light (none: an empty bus, every address NACKed).
  const colorBus: ColorBusEvent[] = [];
  if (inputs.colors) {
    const device = inputs.colors.absent ? null : recordedColorSensor(inputs.colors, colorBus);
    uno.attachI2c(new Map(device ? [[device.address, device]] : []));
  }

  while (uno.setupCycle === null && uno.cpu.cycles < cyclesOfUs(SETUP_DEADLINE_US)) {
    uno.runUntil(uno.cpu.cycles + cyclesOfUs(SETUP_STEP_US));
  }
  const setupCycle = uno.setupCycle;
  if (setupCycle === null) {
    throw new Error(`setup() did not start within ${SETUP_DEADLINE_US} µs of reset`);
  }
  const endCycle = setupCycle + cyclesOfUs(recordUs);
  uno.runUntil(endCycle);
  const sinceSetup = (cycle: number) => usOfCycles(cycle - setupCycle);
  const recorded = uno.changes.filter((change) => change.cycle <= endCycle);
  const sent = uno.serial.filter((byte) => byte.cycle <= endCycle);

  const events: PinEvent[] = [];
  for (const { id: pin } of board.pins) {
    const own = recorded.filter((change) => change.pin === pin);
    const initial = own.filter((change) => change.cycle <= setupCycle).at(-1)?.state ?? 'INPUT';
    const changes: RawChange[] = own.filter((change) => change.cycle > setupCycle).map((change) => ({ atUs: sinceSetup(change.cycle), state: change.state }));
    events.push(...decodePin(pin, initial, changes, recordUs, decodings.get(pin)));
  }

  const lines: PrintedLine[] = [];
  let bytes: number[] = [];
  let lineStart: number | null = null;
  for (const { cycle, byte } of sent) {
    lineStart ??= cycle;
    if (byte === 0x0a) {
      lines.push({ atUs: sinceSetup(lineStart), text: new TextDecoder().decode(Uint8Array.from(bytes)).replace(/\r$/, '') });
      bytes = [];
      lineStart = null;
    } else {
      bytes.push(byte);
    }
  }
  const last = sent.at(-1);
  return {
    events,
    lines,
    unfinishedLine: new TextDecoder().decode(Uint8Array.from(bytes)),
    serialDoneUs: last ? sinceSetup(last.cycle + uno.serialFrameCycles) : 0,
    setupStartUs: usOfCycles(setupCycle),
    colorBus,
  };
}
