import type { ComponentInput } from '../simulation/simulate-circuit';

// A challenge (N6a S2): what a lab asks of the learner's program, checked by running it. It is plain data
// of the template (src/samples/challenges.ts), never of the project document, and it knows nothing of a
// host, a lesson or a score: the standalone lab checks with it as an embedded one does (spec §7).
//
// N17 B6: a goal "at a moment" (`atMs`) reads what the run showed at that moment, the last snapshot at or before it, so a state set
// earlier that stayed counts and one that came and went between two moments does not. The labs of N17 B6 put each moment after the
// scripted input it waits for. A check whose page is hidden is interrupted, never judged; one whose timers come more than
// CHECK_LATENESS_LIMIT_MS (check-run.ts) late is too. A visible tab late by less than that is judged, and an input that came late
// can move what a goal reads (an accepted cost of not interrupting a busy but visible tab; Review Focus 4).

/** What one goal looks for in the run, or in the program. */
export type GoalSpec =
  /**
   * The board's 5×5 display shows `frame` at some moment of the check, at or after `fromMs`. With `colour` ('#rrggbb', N17 B1)
   * every lit light must also be that colour; without it only lit and dark are compared, as before.
   */
  | { kind: 'display-shows'; frame: string; fromMs?: number; colour?: string }
  /**
   * N17 B6: at each of the moments `atMs` (two or more, in order) the whole display is lit in one colour, and no two of those
   * colours are the same: a rainbow that turns on every press. Colours are compared as '#rrggbb' codes.
   */
  | { kind: 'display-colours-differ'; atMs: readonly number[] }
  /**
   * N17 B6: at or after `fromMs` the display shows every character of `text` in full, one after the other, as a scrolling text (or
   * a still character) shows it; lit and dark only. A character is counted when the display turns to it, so "00" needs two.
   */
  | { kind: 'display-scrolls'; text: string; fromMs?: number }
  /** N17 B6: at the moment `atMs` at least one light of the display is on (the number a dice shows, whatever it is). */
  | { kind: 'display-lit'; atMs: number }
  /** N17 B6: at the moment `atMs` the servo `componentId` (a circuit component) stands at `angle` degrees. */
  | { kind: 'servo-angle'; componentId: string; angle: number; atMs: number }
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
