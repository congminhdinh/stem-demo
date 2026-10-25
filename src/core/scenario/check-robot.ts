import type { ProjectDocument } from '../circuit/document';
import type { DeviceRegistry } from '../devices/registry';
import type { BoardProfile } from '../hardware/board';
import type { Kit } from '../hardware/kit';
import { productionProfiles } from '../profiles';
import type { ProfileCatalog } from '../profiles/profile';
import { createBlockPackCatalog, type BlockPackCatalog } from '../program/block-packs';
import { compileUnoProject } from '../program/compile-uno-program';
import {
  createRobotRunSession,
  robotKitCatalog,
  toRunDiagnostic,
  type RobotRunEnd,
  type RobotRunError,
  type RobotRunSession,
  type RobotRunSnapshot,
  type RobotStartFailureReason,
} from '../run/robot-run-session';
import type { RunDiagnostic } from '../run/run-session';
import type { RobotCheckResult, RobotVariantResult } from './check-result';
import type { GoalResult } from './goals';
import { hashProgramIr } from './program-hash';
import { scenarioMaxScore, type Scenario } from './scenario';
import { checkResultOf, createScenarioScorer, programErrorScore, type CheckedVariant, type ScenarioScorer } from './scoring';
import { variantSeed } from './variants';

// A check of the robot lab (N18 R6.2, robot plan §4.6, §4.7): the learner's project in every variant of the scenario, one after the other
// (variant i with its seed, `variantSeed`), each a run of a RobotRunSession of its own with the check's scorer (scoring.ts), then one
// `RobotCheckResult` for the host bridge (R6.3 sends it: `beginCheck`, `robotCheckResult`, `endCheck`).
//
//   - A variant runs until the scenario ends it (its time limit, a contact of `endOnContact`) or it ends in an error. Its score, verdict and
//     goals are the scorer's at that end; its simulated time is the world's, in whole ms. A variant that ends in an error (a fault of the
//     program, or of the simulation) scores 0 and fails, every goal with `program-error` (scoring.ts `programErrorScore`, R6.2 fix round 1):
//     the world stands still at the error, and what it froze must not pass.
//   - Headless: the check drives each variant itself (`runUntil`, a second of simulated time at a time, telling its progress after each).
//     Realtime: the caller drives it with its frames (`frame(wallMs)` from requestAnimationFrame, at `speed`) and draws `run`'s snapshots.
//     The mode only decides who calls the ticks: the ticks, and so the result, are the same (Review Focus 2, check-robot.determinism.test.ts).
//   - `cancel()` ends the check without a result: `result` resolves null, as a cancelled check of App.tsx gives no verdict and sends nothing.
//     It is the only way to get null.
//   - A check that cannot be made rejects `result` with a RobotCheckError: the program does not compile, or is for another kit (the start's
//     reason and diagnostics, as Run gives them), or a variant's world or scorer cannot be made. The host is sent nothing then: there is no
//     result to send.
//   - `onProgress` is the caller's: one that throws is ignored, and the check goes on. `frame` rejects (never throws) a time or a speed that
//     is not one.
//   - Once `result` settles the check's run is stopped (its world freed); the last world of every variant is in its `variant-ended` progress.
// The sandbox has no score: it is not checked here (R6.3 sends its plain `{ passed, goals: [] }`).

export type CheckMode = 'realtime' | 'headless';

export type CheckRobotOptions = {
  mode: CheckMode;
  /** Realtime: the speed `frame` runs at unless it is given one; 1 by default. A number above 0. */
  speed?: number;
  /** The scenario's kit, its board and the device registry, as the lab's RobotRunSession takes them. */
  kit: Kit;
  board: BoardProfile;
  registry: DeviceRegistry;
  profiles?: ProfileCatalog;
  packs?: BlockPackCatalog;
  /** The language of the goals' labels in the result; Vietnamese by default, as `lab=robot` speaks. */
  locale?: 'vi' | 'en';
  /** Told each progress as it happens, before the iterable has it. */
  onProgress?: (progress: CheckProgress) => void;
  /** The wall clock of the session's housekeeping yields (RobotRunSessionOptions.wallNow). */
  wallNow?: () => number;
};

/** What a check tells while it runs (`index` is the variant's, 0..count − 1). */
export type CheckProgress =
  /** A variant starts: "Lượt index + 1 / count". */
  | { kind: 'variant-started'; index: number; count: number; seed: number }
  /** The variant's simulated time reached a whole second (realtime: as its frames go by), s; `timeLimitS` is the scenario's. */
  | { kind: 'time'; index: number; tS: number; timeLimitS: number }
  /**
   * A variant ended: its line of the result, its goals (with their reasons and times, for "the robot hit the wall at 12.4 s in round 2"),
   * how the scenario ended it (null for a program fault, then `error` says which), and its last snapshot.
   */
  | {
      kind: 'variant-ended';
      index: number;
      count: number;
      variant: RobotVariantResult;
      goals: readonly GoalResult[];
      end: RobotRunEnd | null;
      error: RobotRunError | null;
      snapshot: RobotRunSnapshot;
    };

export type RobotCheck = {
  /** Every progress of the check in order, then done when the check settles. Each iteration starts from the first. */
  progress: AsyncIterable<CheckProgress>;
  /** The result; null when the check was cancelled. Rejects with a RobotCheckError when it cannot be made. */
  result: Promise<RobotCheckResult | null>;
  /** Ends the check without a result. Nothing once it settled. */
  cancel(): void;
  /** Realtime: one frame of the page, `wallMs` long, at `speed` (the options' by default). Headless: nothing. */
  frame(wallMs: number, speed?: number): Promise<void>;
  /** The check's run, for a view: its snapshots. Idle once the check settled. */
  readonly run: Pick<RobotRunSession, 'getSnapshot' | 'subscribe'>;
};

/** Why a check has no result although it was not cancelled. */
export type RobotCheckFailureReason = Exclude<RobotStartFailureReason, 'superseded' | 'idle'>;

/** A check that could not be made: why, the diagnostics of the start or of the simulation, and the variant (null before any ran). */
export class RobotCheckError extends Error {
  readonly reason: RobotCheckFailureReason;
  readonly diagnostics: readonly RunDiagnostic[];
  readonly variantIndex: number | null;

  constructor(reason: RobotCheckFailureReason, diagnostics: readonly RunDiagnostic[], variantIndex: number | null) {
    super(`The robot check could not be made (${reason}${variantIndex === null ? '' : `, variant ${variantIndex}`}): ${diagnostics.map((diagnostic) => diagnostic.message).join('; ') || 'no diagnostic'}`);
    this.name = 'RobotCheckError';
    this.reason = reason;
    this.diagnostics = diagnostics;
    this.variantIndex = variantIndex;
  }
}

/** Headless: the simulated time of one `runUntil`, s; a progress is told after each. */
const HEADLESS_STEP_S = 1;

/** Whether a variant's run has ended: the scenario ended it, it failed, or it was stopped (a cancel). */
const ended = (snapshot: RobotRunSnapshot) => snapshot.status === 'idle' || snapshot.status === 'error' || snapshot.end !== undefined;

/**
 * Checks `project` in every variant of `scenario` (see the top of this file). Throws a RangeError for a scenario without a score (the
 * sandbox) and a speed that is not a number above 0.
 */
export function checkRobot(project: ProjectDocument, scenario: Scenario, opts: CheckRobotOptions): RobotCheck {
  if (scenarioMaxScore(scenario) === undefined) {
    throw new RangeError(`Scenario "${scenario.key}" has no score to check: its check sends { passed, goals: [] }.`);
  }
  const defaultSpeed = opts.speed ?? 1;
  if (!(Number.isFinite(defaultSpeed) && defaultSpeed > 0)) {
    throw new RangeError(`A check runs at a speed above 0, not ${defaultSpeed}.`);
  }
  const { mode, kit, board, registry } = opts;
  const profiles = opts.profiles ?? productionProfiles;
  const packs = opts.packs ?? createBlockPackCatalog(registry);
  const count = scenario.variants.count;

  const log = createProgressLog<CheckProgress>();
  const tell = (progress: CheckProgress) => {
    try {
      opts.onProgress?.(progress);
    } catch {
      // The listener is the caller's: what it does wrong never stops the check.
    }
    log.push(progress);
  };

  /** The scorer of each variant's run: the session makes one per start. */
  const scorers = new Map<number, ScenarioScorer>();
  /**
   * The simulated time of the last frame the running variant's scorer judged, s: the world's time, which a snapshot does not always show (a
   * finished run at rest publishes none, robot-run-session.ts). The progress reads it.
   */
  let judgedS = 0;
  /** The running variant, and the last whole second its progress told; null between variants. */
  let telling: { index: number; second: number } | null = null;
  /** Tells each whole second the running variant's world reached since the last time. */
  const tellTime = () => {
    if (telling === null) return;
    const whole = Math.floor(judgedS);
    for (let second = telling.second + 1; second <= whole; second++) {
      tell({ kind: 'time', index: telling.index, tS: second, timeLimitS: scenario.timeLimitS });
    }
    telling.second = Math.max(telling.second, whole);
  };
  const session = createRobotRunSession({
    scenario,
    kit,
    board,
    registry,
    profiles,
    packs,
    ...(opts.wallNow === undefined ? {} : { wallNow: opts.wallNow }),
    scorer: (run) => {
      const scorer = createScenarioScorer(run);
      scorers.set(run.variantIndex, scorer);
      judgedS = 0;
      return {
        update(frame, dtS) {
          judgedS = frame.tS;
          scorer.update(frame, dtS);
        },
        score: () => scorer.score(),
        end: (end) => scorer.end(end),
      };
    },
  });

  let cancelled = false;
  let settled = false;

  /** Headless: the variant's ticks, a second at a time, until it ends; each whole second reached is told. */
  const runHeadless = async () => {
    for (let step = 1; ; step++) {
      // The last step asks for more than the limit: the tick past it ends the run.
      await session.runUntil(Math.min(step * HEADLESS_STEP_S, scenario.timeLimitS + HEADLESS_STEP_S));
      if (cancelled || ended(session.getSnapshot())) return;
      tellTime();
    }
  };

  /**
   * Realtime: waits while the caller's frames drive the variant, until it ends (the end is always published). The seconds are told by
   * `frame`, from the judged frames, since a resting robot's frames publish no snapshot.
   */
  const runRealtime = () =>
    new Promise<void>((resolve) => {
      const watch = (snapshot: RobotRunSnapshot) => {
        if (cancelled || ended(snapshot)) {
          unsubscribe();
          resolve();
        }
      };
      const unsubscribe = session.subscribe(watch);
      watch(session.getSnapshot());
    });

  const check = async (): Promise<RobotCheckResult | null> => {
    // The program's hash, from the compile the session makes too (the same rules, the same kit).
    const compiled = compileUnoProject(project, { registry, profiles, packs, kits: robotKitCatalog(kit, board) });
    if (!compiled.ok) {
      throw new RobotCheckError(compiled.reason, compiled.diagnostics.map(toRunDiagnostic), null);
    }
    const programHash = hashProgramIr(compiled.ir);
    const variants: CheckedVariant[] = [];
    for (let index = 0; index < count; index++) {
      if (cancelled) return null;
      const seed = variantSeed(scenario, index);
      tell({ kind: 'variant-started', index, count, seed });
      const started = await session.start(project, index, { check: true });
      if (cancelled) return null;
      if (!started.ok) {
        if (started.reason === 'superseded' || started.reason === 'idle') return null;
        throw new RobotCheckError(started.reason, started.diagnostics, index);
      }
      // A start that ran made the variant's scorer.
      const variantScorer = scorers.get(index)!;
      telling = { index, second: 0 };
      await (mode === 'headless' ? runHeadless() : runRealtime());
      // The seconds of the frame that ended the run, which may come here before its `frame` call returns.
      if (!cancelled) tellTime();
      telling = null;
      const snapshot = session.getSnapshot();
      if (cancelled || snapshot.world === null) return null;
      // A run that ended in an error scores 0, every goal failed (see the top of this file); the scorer is not asked.
      const score = snapshot.status === 'error' ? programErrorScore(scenario, judgedS) : variantScorer.result();
      // The world's time at the end: the last frame judged (the world stays at it once the run ended).
      const simTimeMs = Math.round(judgedS * 1000);
      variants.push({ seed, simTimeMs, score });
      tell({
        kind: 'variant-ended',
        index,
        count,
        variant: { seed, passed: score.passed, score: score.points, simTimeMs },
        goals: score.goals,
        end: snapshot.end ?? null,
        error: snapshot.error,
        snapshot,
      });
    }
    if (cancelled) return null;
    return checkResultOf(scenario, variants, programHash, opts.locale ?? 'vi');
  };

  // In a microtask: `cancel` and `frame` exist before anything runs, and a cancel in the same turn gives null before any work.
  const result = Promise.resolve()
    .then(check)
    .finally(() => {
      settled = true;
      session.stop();
      log.close();
    });

  return {
    progress: log.iterable,
    result,
    cancel() {
      if (settled || cancelled) return;
      cancelled = true;
      session.stop();
    },
    frame(wallMs, speed = defaultSpeed) {
      if (!(Number.isFinite(wallMs) && wallMs >= 0) || !(Number.isFinite(speed) && speed > 0)) {
        return Promise.reject(new RangeError(`A frame is a time of 0 ms or more at a speed above 0, not ${wallMs} ms at ${speed}×.`));
      }
      if (mode !== 'realtime' || settled || cancelled) return Promise.resolve();
      return session.advance(wallMs, speed).then(() => {
        // The run may have ended in this frame: its last seconds are told before its end.
        if (!cancelled) tellTime();
      });
    },
    run: { getSnapshot: () => session.getSnapshot(), subscribe: (listener) => session.subscribe(listener) },
  };
}

/** A log of what happened, read as an async iterable: each iteration replays it from the first item, then waits for more until it closes. */
function createProgressLog<T>(): { push(item: T): void; close(): void; iterable: AsyncIterable<T> } {
  const items: T[] = [];
  let closed = false;
  let waiting: (() => void)[] = [];
  const wake = () => {
    const woken = waiting;
    waiting = [];
    for (const resolve of woken) resolve();
  };
  return {
    push(item) {
      if (closed) return;
      items.push(item);
      wake();
    },
    close() {
      closed = true;
      wake();
    },
    iterable: {
      [Symbol.asyncIterator]() {
        let next = 0;
        let left = false;
        return {
          async next(): Promise<IteratorResult<T>> {
            while (!left && next >= items.length && !closed) {
              await new Promise<void>((resolve) => waiting.push(resolve));
            }
            return !left && next < items.length ? { value: items[next++]!, done: false } : { value: undefined, done: true };
          },
          async return(): Promise<IteratorResult<T>> {
            left = true;
            return { value: undefined, done: true };
          },
        };
      },
    },
  };
}
