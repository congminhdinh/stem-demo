import { unoContract } from '../../src/core/compat/uno-contract';
import { GRIPPER_ANGLE, type Kit } from '../../src/core/hardware';
import { allowedDifferences, SERVO_PULSE } from './allowed-differences';
import { runBoard, type BoardRun } from './board-run';
import type { WaveformDecoding } from './board-trace';
import { compareTraces, type Comparison } from './compare';
import { compileFixture, sketchOf, type ParityFixture } from './fixtures';
import { levelTimeline } from './inputs';
import { runSimulator, toneFormsOf, type SimInjection, type SimRun } from './sim-run';

// One parity run (N18 C2): a fixture on the simulator and its HEX on avr8js, for the same virtual time with the same inputs, and
// the comparison of their traces.

/**
 * N19 C2: the claw's widest pulse, at its widest angle (GRIPPER_ANGLE 90°): Servo 1.3.0's 544 + 90 × 1856 / 180 µs, truncated as its
 * ticks are (contract §6.2), 1472 µs.
 */
export const GRIPPER_CLAW_WIDEST_PULSE_US = Math.trunc(SERVO_PULSE.minUs + (GRIPPER_ANGLE.max * (SERVO_PULSE.maxUs - SERVO_PULSE.minUs)) / 180);

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
    } else if (port.driver === 'gripper-servo2') {
      // N19 C2: the gripper's two servos, with the gripper car's servo jitter (waveform-jitter, G0.2 ruling c1). The lift is the second
      // Servo on Timer1 (the sketch declares the claw's first): its first period after Timer1's wrap is a frame and at most the claw's
      // widest pulse longer (servo-first-pulse, timerWrapUs).
      const highUs = allowedDifferences['waveform-jitter'].servo.gripperHighUs;
      if (port.pins.CLAW !== undefined) {
        decodings.set(port.pins.CLAW, { kind: 'servo', ...SERVO_PULSE, highUs });
      }
      if (port.pins.LIFT !== undefined) {
        decodings.set(port.pins.LIFT, { kind: 'servo', ...SERVO_PULSE, highUs, timerWrapExtraUs: GRIPPER_CLAW_WIDEST_PULSE_US });
      }
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

/**
 * Runs `fixture` on both sides. `simulatorOnly` changes what the simulator runs (its program, its inputs) and not the HEX or the
 * board's inputs: the tests that show the harness fails a simulator that drifts.
 */
export async function runParity(
  fixture: ParityFixture,
  hex: string,
  simulatorOnly: Partial<Pick<ParityFixture, 'onStart' | 'forever' | 'inputs'>> & { inject?: SimInjection } = {},
): Promise<ParityRun> {
  const program = compileFixture(fixture);
  const { inject, ...changes } = simulatorOnly;
  const simulated = { ...fixture, ...changes };
  const durationUs = fixture.durationMs * 1000;
  const started = performance.now();
  const simulatedProgram = compileFixture(simulated);
  const sim = await runSimulator(simulatedProgram, simulated.inputs, durationUs, inject);
  const simDone = performance.now();
  const board = runBoard(hex, { kit: program.kit, board: program.board, decodings: decodingsOf(program.kit) }, fixture.inputs, durationUs);
  const boardDone = performance.now();
  const inputChanges = [...levelTimeline(program.kit, fixture.inputs).values()].flat();
  const prints = sketchOf(fixture).includes('Serial.begin(9600);');
  const comparison = compareTraces({ sim, board, inputChanges, durationUs, prints, toneForms: toneFormsOf(simulatedProgram.ir) });
  return { sim, board, comparison, wallMs: { sim: simDone - started, board: boardDone - simDone } };
}
