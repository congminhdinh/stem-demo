import { unoContract } from '../../src/core/compat/uno-contract';
import type { Kit } from '../../src/core/hardware';
import { allowedDifferences } from './allowed-differences';
import { runBoard, type BoardRun } from './board-run';
import type { WaveformDecoding } from './board-trace';
import { compareTraces, type Comparison } from './compare';
import { compileFixture, type ParityFixture } from './fixtures';
import { levelTimeline } from './inputs';
import { runSimulator, type SimRun } from './sim-run';

// One parity run (N18 C2): a fixture on the simulator and its HEX on avr8js, for the same virtual time with the same inputs, and
// the comparison of their traces.

/** Servo 1.3.0 (contract §6.2, ARD-13): 544 µs at 0°, 2400 µs at 180°, a frame every 20 ms (REFRESH_INTERVAL). */
export const SERVO_PULSE = { minUs: 544, maxUs: 2400, frameUs: 20_000 } as const;

/** Which pins of the kit carry a waveform, and how the board decoder reads it (board-trace.ts). */
export function decodingsOf(kit: Kit): Map<string, WaveformDecoding> {
  const decodings = new Map<string, WaveformDecoding>();
  const timer0 = allowedDifferences['timer0-duty'];
  for (const port of kit.ports) {
    if (port.driver === 'hbridge-en-in1-in2') {
      const en = port.pins.EN;
      const pwm = unoContract.board.pwmPins.find((candidate) => candidate.pin === en);
      if (en !== undefined && pwm) {
        decodings.set(en, { kind: 'pwm', periodUs: 1e6 / pwm.frequencyHz, scale: pwm.timer === timer0.timer ? timer0.scale : timer0.otherScale });
      }
    } else if (port.driver === 'servo-lib' && port.pins.PIN !== undefined) {
      decodings.set(port.pins.PIN, { kind: 'servo', ...SERVO_PULSE });
    } else if (port.driver === 'buzzer-tone' && port.pins.PIN !== undefined) {
      decodings.set(port.pins.PIN, { kind: 'tone', minHz: unoContract.constants.TONE_MIN_HZ, maxHz: unoContract.constants.TONE_MAX_HZ });
    }
  }
  return decodings;
}

export type ParityRun = {
  sim: SimRun;
  board: BoardRun;
  comparison: Comparison;
  /** Wall time of each side, ms. */
  wallMs: { sim: number; board: number };
};

export async function runParity(fixture: ParityFixture, hex: string): Promise<ParityRun> {
  const program = compileFixture(fixture);
  const durationUs = fixture.durationMs * 1000;
  const started = performance.now();
  const sim = await runSimulator(program, fixture.inputs, durationUs);
  const simDone = performance.now();
  const board = runBoard(hex, { kit: program.kit, board: program.board, decodings: decodingsOf(program.kit) }, fixture.inputs, durationUs);
  const boardDone = performance.now();
  const inputChanges = [...levelTimeline(program.kit, fixture.inputs).values()].flat();
  const motorEnablePins = new Set(program.kit.ports.filter((port) => port.driver === 'hbridge-en-in1-in2').flatMap((port) => (port.pins.EN ? [port.pins.EN] : [])));
  const comparison = compareTraces({ sim, board, inputChanges, durationUs, motorEnablePins });
  return { sim, board, comparison, wallMs: { sim: simDone - started, board: boardDone - simDone } };
}
