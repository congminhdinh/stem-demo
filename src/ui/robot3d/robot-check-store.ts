import { createStore } from 'zustand/vanilla';
import type { ProjectDocument } from '../../core/circuit/document';
import type { RobotRunSnapshot } from '../../core/run/robot-run-session';
import { RobotCheckError, type CheckMode, type CheckProgress, type RobotCheck } from '../../core/scenario/check-robot';
import type { RobotCheckResult } from '../../core/scenario/check-result';
import { scenarioMaxScore, type Scenario } from '../../core/scenario/scenario';
import type { ScoreState } from '../../core/world/snapshot';
import type { VariantOutcome } from './check-report';
import type { CheckLeft, RobotRunStore, ShownRound } from './robot-run-store';

// Kiểm tra in the robot lab (N18 R6.3, robot plan §4.6). The check itself is R6.2's checkRobot: every round (variant) of the scenario, one
// after the other, judged on its ticks. This store runs one from the lab:
//
//   - Start: the editor writes its workspace into the document (`flushProgram`, BlocklyPanel `saveNow`), the host is told the check begins
//     (`host.begin`: the bridge's beginCheck sends the pending project-changed, the checked program, and holds the edits made meanwhile), the
//     lab is held (`setLocked`: the blocks, the run's controls, the robot's button; R4.8's teleop and tools take the same lock), then the
//     check of that document starts.
//   - Speeds: Nhanh by default (N18 final fix I1: a check at 1× of lesson 4 takes six minutes), or the speed the learner chose last
//     (`memory`, the tab's sessionStorage: check-speed-memory.ts). 1× and 4× show the check's run in the lab's view (the run store's
//     `attach`): every animation frame drives it, so a hidden tab (no frames) pauses it and the result is the same (Review Focus 2). The run is attached once it has a world (its first round started),
//     so a check that cannot start (the program does not compile) shows no run and the host hears none, as a Run that cannot start. "Nhanh" is headless: checkRobot drives itself, the view stays as it
//     was under a progress view, and the host hears no run (lab-embed-contract §2: run-started / run-stopped only when the lab shows the run).
//   - Progress: "Lượt k/N" and the simulated time of the round (`running`), from the check's own progress.
//   - End: the last round's world stays in view with that round and the check's score of it; the report (the result, each round's end and
//     the document it checked) is kept for the panel and "Xem lại"; the result goes to the host (`host.result`: the bridge's
//     robotCheckResult, which sends the pending project-changed first), then, in a finally, `host.end` (endCheck: the edits held during the
//     check go out after the check-result) and the lab is let go. A check at 1× or 4× says its run stopped before its result is sent.
//     A run the learner had going is stopped when the check begins (what it left is shown under a fast check's progress).
//   - Cancel: no result, nothing kept in view, nothing for the host but the end (as a cancelled check of App.tsx sends nothing). "Dừng kiểm
//     tra" stands where Kiểm tra stood, so a cancel within CANCEL_GUARD_MS of the start is taken for the second click of a double click and
//     ignored; `abort` (the lab going away) is not.
//   - A check that cannot be made (the program does not compile, a world that cannot be built: RobotCheckError) says why as a Run that cannot
//     start does (the run store's start failure: the message over the view, the warnings on the blocks), and sends no result. Anything else
//     that throws (a bug of the lab, a result the bridge refuses to send) ends the check with `failure`: the learner is told it did not
//     complete and nothing reached the lesson, and no result is shown as if it had. Whatever throws, the host is told the check ended.
//   - Replay ("Xem lại"): a round of the last check, run again in the lab's session as that variant's check run, at 1× from its start
//     (the run store's `replay`): determinism makes it the same run, so nothing was recorded.

/** How long after a start a cancel is the second click of a double click on Kiểm tra (the stop stands where it was), ms. */
export const CANCEL_GUARD_MS = 400;

/** The speeds a check is offered at: shown at 1× or 4×, or fast (headless, not shown). */
export const CHECK_SPEEDS = ['1x', '4x', 'fast'] as const;
export type CheckSpeed = (typeof CHECK_SPEEDS)[number];

/**
 * N18 final fix I1: the speed a check runs at until the learner chooses another. Fast (headless) gives the result 1× and 4× give, by
 * construction (Review Focus 2), and "Xem lại" shows any of its rounds at 1×.
 */
export const DEFAULT_CHECK_SPEED: CheckSpeed = 'fast';

/** Where the learner's choice of speed is kept for the next lab (check-speed-memory.ts: the tab's sessionStorage). */
export type CheckSpeedMemory = {
  /** The speed chosen last, or DEFAULT_CHECK_SPEED when none is kept. */
  read(): CheckSpeed;
  /** Keeps a choice; never throws. */
  write(speed: CheckSpeed): void;
};

/** How a speed runs: the check's mode and its multiplier of real time. */
const runOf: Readonly<Record<CheckSpeed, { mode: CheckMode; factor: number }>> = {
  '1x': { mode: 'realtime', factor: 1 },
  '4x': { mode: 'realtime', factor: 4 },
  fast: { mode: 'headless', factor: 1 },
};

/** What the host is told of a check (the bridge: beginCheck, robotCheckResult, endCheck). Each is optional: a lab opened alone has no host. */
export type CheckHost = {
  begin?(): void;
  result?(result: RobotCheckResult): void;
  end?(): void;
};

/** Makes the check of `project` (checkRobot with the lab's scenario, kit and catalogs). */
export type CreateCheck = (project: ProjectDocument, mode: CheckMode, speed: number, onProgress: (progress: CheckProgress) => void) => RobotCheck;

/** A round of a check as it ended, with its last snapshot (the world the view keeps, and a replay ends in). */
export type CheckedRound = VariantOutcome & { readonly snapshot: RobotRunSnapshot };

/** The last check, for the result panel and its replays. */
export type CheckRecord = { result: RobotCheckResult; variants: readonly CheckedRound[]; document: ProjectDocument };

export type RobotCheckState = {
  /** The speed the next check runs at. */
  speed: CheckSpeed;
  /** The check running now: its speed, the round it is in ("Lượt index + 1 / count"), its simulated time and the rounds that ended. */
  running: { speed: CheckSpeed; index: number; count: number; tS: number; timeLimitS: number; ended: readonly CheckedRound[] } | null;
  /** The last check that gave a result, until another starts or the learner closes it. */
  report: CheckRecord | null;
  /** The last check did not complete because something other than the learner's program failed (its English detail); nothing was sent. */
  failure: { detail: string } | null;
  setSpeed(speed: CheckSpeed): void;
  /** Checks the lab's document (see the top of this file). Nothing while a check runs or the lab is held. */
  start(): Promise<void>;
  /** The learner's "Dừng kiểm tra": ends the running check without a result, unless the check started under CANCEL_GUARD_MS ago. */
  cancel(): void;
  /** Ends the running check without a result, at once (the lab goes away). */
  abort(): void;
  /** Runs the round `index` of the last check again, at 1× from its start. */
  replay(index: number): Promise<void>;
  /** Forgets the last check's report or failure. */
  dismiss(): void;
};

export type RobotCheckStoreOptions = {
  runStore: RobotRunStore;
  scenario: Scenario;
  createCheck: CreateCheck;
  /** The lab's project document now. */
  document(): ProjectDocument;
  /** Writes the latest edits of the blocks into the document (BlocklyPanel `saveNow`). */
  flushProgram(): void;
  /** The host, read when a check starts (the lab's props may change). */
  host(): CheckHost | undefined;
  /** The clock of the cancel guard, ms; `performance.now` by default. */
  now?: () => number;
  /** N18 final fix I1: the learner's speed, read when the store is made and written at each choice; by default none is kept (fast). */
  memory?: CheckSpeedMemory;
};

/** How far a running check has got, 0..1: the rounds that ended, and the part of the running one its simulated time has reached. */
export function checkFraction(running: NonNullable<RobotCheckState['running']>): number {
  const part = running.ended.length > running.index ? 1 : Math.min(1, running.tS / running.timeLimitS);
  return Math.min(1, (running.index + part) / running.count);
}

/** The check's score of a round, as the HUD shows it once that round's run is over. */
const scoreOf = (scenario: Scenario, round: CheckedRound): ScoreState => ({
  points: round.score,
  maxScore: scenarioMaxScore(scenario) ?? null,
  goals: round.goals.map((goal) => ({ ...goal })),
});

const detailOf = (error: unknown) => (error instanceof Error ? `${error.name}: ${error.message}` : String(error));

export function createRobotCheckStore({ runStore, scenario, createCheck, document, flushProgram, host, now = () => performance.now(), memory }: RobotCheckStoreOptions) {
  return createStore<RobotCheckState>()((set, get) => {
    /** The running check, to cancel it, and when it started. */
    let current: RobotCheck | null = null;
    let startedAt = 0;

    return {
      speed: memory?.read() ?? DEFAULT_CHECK_SPEED,
      running: null,
      report: null,
      failure: null,

      setSpeed(speed) {
        if (!CHECK_SPEEDS.includes(speed)) {
          throw new RangeError(`A check runs at ${CHECK_SPEEDS.join(', ')}, not ${String(speed)}.`);
        }
        if (get().running === null) {
          set({ speed });
          memory?.write(speed);
        }
      },

      async start() {
        if (get().running !== null || runStore.getState().locked) {
          return;
        }
        const speed = get().speed;
        const { mode, factor } = runOf[speed];
        const count = scenario.variants.count;
        const ended: CheckedRound[] = [];
        const shown = mode === 'realtime';
        startedAt = now();
        set({ running: { speed, index: 0, count, tS: 0, timeLimitS: scenario.timeLimitS, ended }, report: null, failure: null });
        const onProgress = (progress: CheckProgress) => {
          const running = get().running;
          if (running === null) return;
          if (progress.kind === 'variant-started') {
            set({ running: { ...running, index: progress.index, count: progress.count, tS: 0 } });
            if (shown) runStore.getState().setRound({ index: progress.index, count: progress.count, score: null });
          } else if (progress.kind === 'time') {
            set({ running: { ...running, index: progress.index, tS: progress.tS } });
          } else {
            const round: CheckedRound = {
              index: progress.index,
              passed: progress.variant.passed,
              score: progress.variant.score,
              timeBonus: progress.timeBonus,
              goals: progress.goals,
              end: progress.end,
              ...(progress.snapshot.endContact === undefined ? {} : { endContact: progress.snapshot.endContact }),
              error: progress.error,
              snapshot: progress.snapshot,
            };
            ended.push(round);
            set({ running: { ...running, ended: [...ended] } });
            if (shown) runStore.getState().setRound({ index: progress.index, count: progress.count, score: scoreOf(scenario, round) });
          }
        };
        let told: CheckHost | undefined;
        /** The detach of the check's run once the view shows it (attached from a subscription, hence a holder). */
        const shownRun: { detach: ((left: CheckLeft) => void) | null } = { detach: null };
        let stopWatching = () => {};
        try {
          flushProgram();
          const checked = document();
          told = host();
          // Everything from here is in the try: whatever throws, the finally tells the host the check ended (its endCheck).
          told?.begin?.();
          // The learner's own run ends here, a fast check's too: nothing of it goes on under the check, and nothing an earlier run or check
          // left stays in view (with no run, Reset clears what was held).
          runStore.getState().stop();
          void runStore.getState().resetRobot();
          runStore.getState().setLocked(true);
          const check = createCheck(checked, mode, factor, onProgress);
          current = check;
          if (shown) {
            // Shown once its first round has a world: a check that cannot start shows no run, and the host hears none.
            const view = { getSnapshot: check.run.getSnapshot, subscribe: check.run.subscribe, frame: (wallMs: number, at: number) => check.frame(wallMs, at) };
            const watch = (snapshot: RobotRunSnapshot) => {
              if (shownRun.detach === null && current === check && snapshot.status !== 'idle') {
                shownRun.detach = runStore.getState().attach(view, factor);
              }
            };
            stopWatching = check.run.subscribe(watch);
            watch(check.run.getSnapshot());
          }
          const result = await check.result;
          stopWatching();
          const last = ended.at(-1);
          const left = result === null || last === undefined ? null : { held: last.snapshot, round: { index: last.index, count: result.variants.length, score: scoreOf(scenario, last) } };
          const { detach } = shownRun;
          shownRun.detach = null;
          if (detach !== null) {
            detach(left);
          } else if (left !== null && left.held !== null) {
            runStore.getState().hold(left.held, left.round);
          }
          if (result !== null) {
            // Sent first: a result the lesson did not get is not shown as if it had (the catch says the check did not complete).
            told?.result?.(result);
            set({ report: { result, variants: [...ended], document: checked } });
          }
        } catch (error) {
          if (error instanceof RobotCheckError) {
            runStore.getState().showFailure({ ok: false, reason: error.reason, diagnostics: [...error.diagnostics] });
          } else {
            console.error('The robot check could not be completed.', error);
            set({ failure: { detail: detailOf(error) } });
          }
        } finally {
          stopWatching();
          current = null;
          shownRun.detach?.(null);
          shownRun.detach = null;
          set({ running: null });
          told?.end?.();
          runStore.getState().setLocked(false);
        }
      },

      cancel() {
        if (current !== null && now() - startedAt >= CANCEL_GUARD_MS) {
          current.cancel();
        }
      },

      abort() {
        current?.cancel();
      },

      async replay(index) {
        const report = get().report;
        const round = report?.variants[index];
        if (report === null || round === undefined || get().running !== null) {
          return;
        }
        const shownRound: ShownRound = { index, count: report.result.variants.length, score: scoreOf(scenario, round) };
        await runStore.getState().replay(report.document, shownRound);
      },

      dismiss() {
        set({ report: null, failure: null });
      },
    };
  });
}

export type RobotCheckStore = ReturnType<typeof createRobotCheckStore>;
