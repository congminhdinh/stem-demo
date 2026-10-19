import { hexColourOf } from '../capabilities/frame';
import type { RunSnapshot } from '../run/run-session';
import { buzzerPartId, displayPartId } from '../simulation/peripherals/onboard-capabilities';
import { peripheralComponentId } from '../simulation/simulate-circuit';
import { parseFrame, type Challenge, type CheckResult, type Goal } from './challenge';
import { runningBlockTypes } from './running-blocks';

// Evaluates the goals of a challenge over the snapshots of one run (N6a S2). Pure: it is told every snapshot
// with the time since the run started, and the program at the end; it never starts, stops or waits for anything
// (check-run.ts does). A goal that looks at the run passes as soon as it has seen what it looks for.

export type GoalTracker = {
  /** One snapshot of the run, `atMs` after it started. Idle snapshots (no simulation) are ignored. */
  observe(snapshot: RunSnapshot, atMs: number): void;
  /** Every goal's verdict; `program` is the run's `document.program.blocks`, for `uses-block`. */
  result(program: unknown): CheckResult;
};

type GoalState = { goal: Goal; passed: boolean; count: number; last: unknown };

/** `boardId`: the board of a Yolo:Bit-compatible run, whose display and buzzer the goals read; null for a generic run. */
export function createGoalTracker(challenge: Challenge, boardId: string | null): GoalTracker {
  const states: GoalState[] = challenge.goals.map((goal) => ({ goal, passed: false, count: 0, last: undefined }));
  const display = boardId === null ? null : peripheralComponentId(boardId, displayPartId);
  const buzzer = boardId === null ? null : peripheralComponentId(boardId, buzzerPartId);

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
      case 'uses-block':
        return;
    }
  };

  return {
    observe(snapshot, atMs) {
      if (snapshot.simulation === null) {
        return;
      }
      for (const state of states) {
        observeGoal(state, snapshot, atMs);
      }
    },
    result(program) {
      const running = runningBlockTypes(program);
      const goals = states.map(({ goal, passed }) => ({
        id: goal.id,
        label: goal.label,
        passed: goal.kind === 'uses-block' ? running.has(goal.blockType) : passed,
      }));
      return { passed: goals.length > 0 && goals.every((goal) => goal.passed), goals };
    },
  };
}
