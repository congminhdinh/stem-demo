import type { ComponentInput } from '../simulation/simulate-circuit';

// A challenge (N6a S2): what a lab asks of the learner's program, checked by running it. It is plain data
// of the template (src/samples/challenges.ts), never of the project document, and it knows nothing of a
// host, a lesson or a score: the standalone lab checks with it as an embedded one does (spec §7).

/** What one goal looks for in the run, or in the program. */
export type GoalSpec =
  /** The board's 5×5 display shows `frame` at some moment of the check, at or after `fromMs`. */
  | { kind: 'display-shows'; frame: string; fromMs?: number }
  /** The circuit component `componentId` (an LED) is lit at some moment. */
  | { kind: 'led-lit'; componentId: string }
  /** The LED `componentId` changes between lit and dark at least `minToggles` times (dark is where it starts). */
  | { kind: 'led-blinks'; componentId: string; minToggles: number }
  /** The board's buzzer starts at least `minNotes` notes: a tone that begins, or changes to another pitch. */
  | { kind: 'buzzer-played'; minNotes: number }
  /** A line the program printed contains `text`. */
  | { kind: 'console-contains'; text: string }
  /** A block of type `blockType` is in the program and runs: inside "on start" or "forever", and enabled. */
  | { kind: 'uses-block'; blockType: string };

/** `label` is what the learner reads (and the host shows): at most 200 characters (stem-lab/v1). */
export type Goal = GoalSpec & { id: string; label: string };

/**
 * A runtime input the check gives the run at `atMs` after it starts: to an onboard part of the board
 * (`part`, e.g. `button-a`, `light`), which becomes `<board id>/<part>`, or to a circuit component
 * (`componentId`, e.g. a push button).
 */
export type InputStep = { atMs: number; input: ComponentInput } & ({ part: string } | { componentId: string });

export type Challenge = {
  goals: readonly Goal[];
  /** How long the check runs the program. */
  durationMs: number;
  /** The inputs of an interactive lab, in any order. */
  inputScript?: readonly InputStep[];
};

export type GoalResult = { id: string; label: string; passed: boolean };

/** `passed` when every goal passed (a challenge without goals never passes). */
export type CheckResult = { passed: boolean; goals: GoalResult[] };

/** The display is 5×5: a frame is five rows of five digits, top to bottom, `:` between rows, 1 lit. */
const framePattern = /^[01]{5}(?::[01]{5}){4}$/;

/** The 25 lights of a frame, row by row (cell x, y is `[y * 5 + x]`), or null when it is not one. */
export function parseFrame(frame: string): boolean[] | null {
  return framePattern.test(frame) ? [...frame.replaceAll(':', '')].map((digit) => digit === '1') : null;
}
