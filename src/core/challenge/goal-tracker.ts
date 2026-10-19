import { hexColourOf } from '../capabilities/frame';
import type { RunSnapshot } from '../run/run-session';
import { scrollFrame } from '../simulation/peripherals/display';
import { glyphs } from '../simulation/peripherals/font';
import { buzzerPartId, displayPartId } from '../simulation/peripherals/onboard-capabilities';
import { peripheralComponentId } from '../simulation/simulate-circuit';
import { parseFrame, type Challenge, type CheckResult, type Goal } from './challenge';
import { runningBlockTypes } from './running-blocks';

// Evaluates the goals of a challenge over the snapshots of one run (N6a S2). Pure: it is told every snapshot
// with the time since the run started, and the program at the end; it never starts, stops or waits for anything
// (check-run.ts does). A goal that looks at the run passes as soon as it has seen what it looks for.
// N17 B6: a goal "at a moment" keeps the snapshot that was showing at each of its moments (the last one at or before it) and is
// judged on those at the end.

export type GoalTracker = {
  /** One snapshot of the run, `atMs` after it started. Idle snapshots (no simulation) are ignored. */
  observe(snapshot: RunSnapshot, atMs: number): void;
  /** Every goal's verdict; `program` is the run's `document.program.blocks`, for `uses-block`. */
  result(program: unknown): CheckResult;
};

/** What showed at a moment: a snapshot, null before the run showed anything, undefined while the moment has not come. */
type Seen = RunSnapshot | null | undefined;

type GoalState = { goal: Goal; passed: boolean; count: number; last: unknown; moments: readonly number[]; seen: Seen[] };

/** The moments a goal is judged at (N17 B6); none for a goal that is judged as the run goes. */
function momentsOf(goal: Goal): readonly number[] {
  switch (goal.kind) {
    case 'display-colours-differ':
      return goal.atMs;
    case 'display-lit':
    case 'servo-angle':
      return [goal.atMs];
    default:
      return [];
  }
}

/** The 25 lights as lit (1) and dark (0), or null for a display that never showed a frame (it is dark). */
const litPattern = (pixels: readonly (string | null)[] | undefined): string =>
  Array.from({ length: 25 }, (_, index) => (pixels?.[index] ? '1' : '0')).join('');

/** The pattern of `character` shown in full, as a scroll's step 0 or a still character shows it; null for one the display lacks. */
const glyphPattern = (character: string): string | null => (glyphs.has(character) ? litPattern(scrollFrame([character], 0).pixels) : null);

/** `boardId`: the board of a Yolo:Bit-compatible run, whose display and buzzer the goals read; null for a generic run. */
export function createGoalTracker(challenge: Challenge, boardId: string | null): GoalTracker {
  const states: GoalState[] = challenge.goals.map((goal) => {
    const moments = momentsOf(goal);
    return { goal, passed: false, count: 0, last: undefined, moments, seen: moments.map(() => undefined) };
  });
  const display = boardId === null ? null : peripheralComponentId(boardId, displayPartId);
  const buzzer = boardId === null ? null : peripheralComponentId(boardId, buzzerPartId);
  /** The latest snapshot observed, and when. */
  let previous: { snapshot: RunSnapshot; atMs: number } | null = null;

  const pixelsOf = (snapshot: RunSnapshot | null) => (display === null ? undefined : snapshot?.simulation?.components[display]?.frame?.pixels);

  const observeGoal = (state: GoalState, snapshot: RunSnapshot, atMs: number) => {
    const components = snapshot.simulation?.components ?? {};
    const { goal } = state;
    switch (goal.kind) {
      case 'display-shows': {
        const target = parseFrame(goal.frame);
        // N17 B1: a goal that names a colour compares it too; a colour that is not a '#rrggbb' code never matches.
        const colour = goal.colour === undefined ? undefined : hexColourOf(goal.colour);
        if (display === null || target === null || colour === null || atMs < (goal.fromMs ?? 0)) {
          return;
        }
        // A display that never showed anything is dark.
        const pixels = components[display]?.frame?.pixels;
        const shows = target.every((wanted, index) => {
          const pixel = pixels?.[index] ?? null;
          return wanted ? pixel !== null && (colour === undefined || hexColourOf(pixel) === colour) : pixel === null;
        });
        if (shows) {
          state.passed = true;
        }
        return;
      }
      case 'display-scrolls': {
        // N17 B6: a character counts when the display turns to it, at or after fromMs; the next one is looked for after it.
        if (display === null) {
          return;
        }
        const pattern = litPattern(components[display]?.frame?.pixels);
        const wanted = [...goal.text][state.count];
        if (pattern !== state.last && atMs >= (goal.fromMs ?? 0) && wanted !== undefined && glyphPattern(wanted) === pattern) {
          state.count += 1;
          state.passed = state.count === [...goal.text].length;
        }
        state.last = pattern;
        return;
      }
      case 'led-lit':
        if (components[goal.componentId]?.lit === true) {
          state.passed = true;
        }
        return;
      case 'led-blinks': {
        const lit = components[goal.componentId]?.lit === true;
        if (lit !== (state.last === true)) {
          state.count += 1;
          state.passed = state.count >= goal.minToggles;
        }
        state.last = lit;
        return;
      }
      case 'buzzer-played': {
        const hz = buzzer === null ? undefined : components[buzzer]?.hz;
        if (hz !== undefined && hz !== state.last) {
          state.count += 1;
          state.passed = state.count >= goal.minNotes;
        }
        state.last = hz;
        return;
      }
      case 'console-contains':
        if (snapshot.console?.lines.some((line) => line.includes(goal.text))) {
          state.passed = true;
        }
        return;
      case 'display-colours-differ':
      case 'display-lit':
      case 'servo-angle':
      case 'uses-block':
        return;
    }
  };

  /** Keeps, for every moment that has passed, what was showing then: the latest snapshot before `atMs`. */
  const sampleBefore = (atMs: number, orAt: boolean) => {
    for (const state of states) {
      state.moments.forEach((moment, index) => {
        if (state.seen[index] === undefined && (moment < atMs || (orAt && moment === atMs))) {
          state.seen[index] = previous?.snapshot ?? null;
        }
      });
    }
  };

  /** The verdict of a goal judged at its moments (N17 B6). A moment the check never reached fails it. */
  const judgeMoments = (goal: Goal, seen: readonly Seen[]): boolean => {
    if (seen.some((snapshot) => snapshot === undefined)) {
      return false;
    }
    const shown = seen as readonly (RunSnapshot | null)[];
    switch (goal.kind) {
      case 'display-colours-differ': {
        // The one colour the whole display is lit in at each moment, or null.
        const fills = shown.map((snapshot) => {
          const pixels = pixelsOf(snapshot);
          const first = hexColourOf(pixels?.[0]);
          return first !== null && pixels?.length === 25 && pixels.every((pixel) => hexColourOf(pixel) === first) ? first : null;
        });
        return fills.length >= 2 && fills.every((colour) => colour !== null) && new Set(fills).size === fills.length;
      }
      case 'display-lit':
        return display !== null && (pixelsOf(shown[0] ?? null)?.some((pixel) => pixel !== null) ?? false);
      case 'servo-angle':
        return shown[0]?.simulation?.components[goal.componentId]?.angle === goal.angle;
      default:
        return false;
    }
  };

  return {
    observe(snapshot, atMs) {
      if (snapshot.simulation === null) {
        return;
      }
      sampleBefore(atMs, false);
      for (const state of states) {
        observeGoal(state, snapshot, atMs);
      }
      previous = { snapshot, atMs };
    },
    result(program) {
      // A moment at the last snapshot's time reads that snapshot (the display as it is at that moment).
      if (previous !== null) {
        sampleBefore(previous.atMs, true);
      }
      const running = runningBlockTypes(program);
      const goals = states.map(({ goal, passed, moments, seen }) => ({
        id: goal.id,
        label: goal.label,
        passed: goal.kind === 'uses-block' ? running.has(goal.blockType) : moments.length > 0 ? judgeMoments(goal, seen) : passed,
      }));
      return { passed: goals.length > 0 && goals.every((goal) => goal.passed), goals };
    },
  };
}
