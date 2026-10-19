import type { ProjectDocument } from '../circuit/document';
import type { RunSession } from '../run/run-session';
import { peripheralComponentId } from '../simulation/simulate-circuit';
import type { Challenge, CheckResult, InputStep } from './challenge';
import { createGoalTracker } from './goal-tracker';

// One check (N6a S2): runs the learner's program for the challenge's duration, gives it the challenge's inputs
// on time, evaluates the goals on every snapshot (RunSession.subscribe), then stops the run. A run that does not
// start is a failed check, with the reasons the session gave. A run that goes idle meanwhile (the learner pressed
// Stop) or a cancel ends the check without a result: nothing was checked. N17 B4: the run of a check is seeded, so a
// program that draws random numbers draws the same ones in every check, and its goals are deterministic.
//
// N17 B6 (Review Focus 4): a check is judged on time. When one of its timers (an input, the end) comes more than
// CHECK_LATE_LIMIT_MS late, the check is not to be trusted: a hidden tab runs timers about once a second, a stalled machine runs
// them late, and the inputs then reach the run after the moments its goals read. Such a check, and one whose page was hidden
// (`interrupt`, told by the UI), ends as interrupted: no verdict, so it never passes falsely; the learner checks again.

/** The seed of every check's random numbers (N17 B4). */
export const CHECK_RANDOM_SEED = 20261019;

/** How late a timer of a check may come and the check still be judged (N17 B6). A goal's moments leave more room than this. */
export const CHECK_LATE_LIMIT_MS = 250;

/** What a check needs of a run session; RunSession is one, and so is the UI's run store adapter. */
export type CheckSession = Pick<RunSession, 'start' | 'stop' | 'subscribe' | 'getSnapshot' | 'setComponentInput'>;

export type CheckTimers = {
  setTimeout(task: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  now(): number;
};

/** Why a check was interrupted (N17 B6): its page was hidden, or one of its timers came too late. */
export type InterruptReason = 'hidden' | 'late';

export type CheckOutcome =
  | { status: 'checked'; result: CheckResult; started: boolean }
  | { status: 'cancelled' }
  /** N17 B6: the check cannot be trusted, so it has no verdict (not passed): the learner checks again. */
  | { status: 'interrupted'; reason: InterruptReason };

export type CheckRun = {
  done: Promise<CheckOutcome>;
  /** Ends the check without a result, and stops its run. Nothing once the check has ended. */
  cancel(): void;
  /** N17 B6: the page was hidden. Ends the check as interrupted and stops its run. Nothing once the check has ended. */
  interrupt(): void;
};

export type CheckOptions = {
  session: CheckSession;
  document: ProjectDocument;
  challenge: Challenge;
  /** The board of a Yolo:Bit-compatible project (its parts get the `part` inputs); null for a generic one. */
  boardId: string | null;
  timers?: CheckTimers;
};

const defaultTimers: CheckTimers = {
  setTimeout: (task, ms) => setTimeout(task, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  now: () => Date.now(),
};

export function runCheck({ session, document, challenge, boardId, timers = defaultTimers }: CheckOptions): CheckRun {
  const tracker = createGoalTracker(challenge, boardId);
  const handles: unknown[] = [];
  let settle: (outcome: CheckOutcome) => void = () => {};
  const done = new Promise<CheckOutcome>((resolve) => {
    settle = resolve;
  });
  let settled = false;
  let starting = true;
  let startedAt = timers.now();

  const end = () => {
    settled = true;
    handles.forEach((handle) => timers.clearTimeout(handle));
    unsubscribe();
  };
  const finish = (started: boolean) => {
    end();
    settle({ status: 'checked', result: tracker.result(document.program.blocks), started });
  };
  const cancelled = () => {
    end();
    settle({ status: 'cancelled' });
  };
  const interrupted = (reason: InterruptReason) => {
    end();
    settle({ status: 'interrupted', reason });
    session.stop();
  };
  /** Whether a timer due `dueMs` after the start came too late to judge the check by (N17 B6). */
  const tooLate = (dueMs: number) => timers.now() - startedAt - dueMs > CHECK_LATE_LIMIT_MS;

  const unsubscribe = session.subscribe((snapshot) => {
    if (settled) {
      return;
    }
    if (snapshot.status === 'idle') {
      // A failed start stops the run it replaces: that idle is part of starting, not a Stop.
      if (!starting) {
        cancelled();
      }
      return;
    }
    // The snapshot a listener is given may hold an older console; the session's own is brought up to date.
    tracker.observe(session.getSnapshot(), timers.now() - startedAt);
  });

  startedAt = timers.now();
  const start = session.start(document, { seed: CHECK_RANDOM_SEED });
  starting = false;
  if (!start.ok) {
    finish(false);
    return { done, cancel: () => {}, interrupt: () => {} };
  }

  const targetOf = (step: InputStep) => ('part' in step ? (boardId === null ? null : peripheralComponentId(boardId, step.part)) : step.componentId);
  for (const step of challenge.inputScript ?? []) {
    const target = targetOf(step);
    if (target !== null) {
      handles.push(
        timers.setTimeout(() => {
          if (tooLate(step.atMs)) {
            interrupted('late');
            return;
          }
          session.setComponentInput(target, step.input);
        }, step.atMs),
      );
    }
  }
  handles.push(
    timers.setTimeout(() => {
      if (tooLate(challenge.durationMs)) {
        interrupted('late');
        return;
      }
      tracker.observe(session.getSnapshot(), timers.now() - startedAt);
      finish(true);
      session.stop();
    }, challenge.durationMs),
  );

  return {
    done,
    cancel() {
      if (!settled) {
        cancelled();
        session.stop();
      }
    },
    interrupt() {
      if (!settled) {
        interrupted('hidden');
      }
    },
  };
}
