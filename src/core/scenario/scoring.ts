import type { RobotRunEnd, RobotScorer, RobotScorerFactory } from '../run/robot-run-session';
import type { Arena } from '../world/arena/arena-schema';
import type { ScoreState } from '../world/snapshot';
import { ROBOT_ENGINE, type RobotCheckResult } from './check-result';
import { createGoal, goalReasons, type Goal, type GoalFrame, type GoalReasonKey, type GoalResult } from './goals';
import { SCENARIO_MAX_SCORE, scenarioMaxScore, type RobotGoalSpec, type Scenario } from './scenario';

// The score of a robot run and of a check (N18 R6.2, robot plan §4.6, controller rulings). The goals (R6.1) judge each run; this adds them up.
//
// One run (one variant), `createScenarioScorer`: a goal of the library for each goal of the scenario, fed every frame of the run (the
// session's scorer seam: tick 0 with a tick of 0 s, then every tick after its step). After each frame it knows whether every goal but the
// finish-within ones passes, judged as if the run ended there, and when the current streak of such frames began:
//   - `finish-within` asks for that time (`othersPassedAtS`): the start of the FINAL streak in which the other goals all passed together,
//     null while one of them has not. A goal that passes and fails again (an object pushed out of its zone, a guard goal that a contact
//     spoils) resets it, so a first moment that did not last never counts. Its "others" are every goal that is not a finish-within.
//   - The time bonus (`scoring.timeBonusMax`) is earned only when every goal passed, finish-within included, and falls linearly with that
//     same time `tFinish`, the start of the final streak in which every goal passed (within a streak of the others finish-within cannot
//     change, so it is the others' streak): `floor(timeBonusMax × max(0, 1 − tFinish / timeLimitS))`, whole points (`timeBonus`).
//   - The run's score (`variantScore`): the points of the goals that passed (all or nothing, R6.1) plus the bonus, clamped to
//     0..SCENARIO_MAX_SCORE (100).
//   - At the end (`end`, told by the session when the scenario ended the run): a contact end cuts short a hold or a stop that had not
//     happened yet (`stop-in-zone`, `servo-angle`): such a goal fails with `run-ended-contact` at the time of the end, unless it had already
//     failed by leaving the arena. Every other goal keeps its own end rules (R6.1), and a time-limit end changes nothing.
//
// A check (`checkResultOf`) of N variants: it passes when every goal passed in every variant; a goal passed when it passed in every variant;
// its score is the LOWEST of its variants' scores (robustness first, as for `passed`); its simulated time is its longest variant's.
//
// Every number here comes from the frames' simulated times and the scenario: no wall clock, nothing that depends on how fast the run was
// driven. The same frames give the same score on every engine.

/**
 * The reason of a hold or a stop that a contact end cut short (controller ruling for R6.2: given by the scorer, no goal reads contacts for
 * it). R5.2a adds it to the goal library's list (`goalReasons.runEndedContact`, goals/reasons.ts); until it merges it is written here,
 * and messages.ts has its words in vi and en.
 */
export const RUN_ENDED_CONTACT_REASON = 'robot.goal.reason.run-ended-contact' as string as GoalReasonKey;

/** A bonus this close below a whole point is that point: 10 × (1 − 54/60) is 0.9999999999999998 in doubles. */
export const TIME_BONUS_EPSILON = 1e-9;

/** The time bonus of a run that passed every goal by `finishedAtS` (see the top of this file): whole points, 0..timeBonusMax. */
export function timeBonus(timeBonusMax: number, finishedAtS: number, timeLimitS: number): number {
  const earned = (timeBonusMax * (timeLimitS - finishedAtS)) / timeLimitS;
  return Math.min(timeBonusMax, Math.max(0, Math.floor(earned + TIME_BONUS_EPSILON)));
}

/**
 * The score of one run: the points of the goals that passed, plus the time bonus when every goal passed (finished at `finishedAtS`, the start
 * of the final streak in which they all passed), clamped to 0..SCENARIO_MAX_SCORE. 0 for the sandbox, which has no score.
 */
export function variantScore(scenario: Pick<Scenario, 'key' | 'goals' | 'scoring' | 'timeLimitS'>, goals: readonly GoalResult[], finishedAtS: number | null): number {
  if (scenarioMaxScore(scenario) === undefined) return 0;
  const points = goals.reduce((sum, goal) => sum + (goal.passed ? goal.points : 0), 0);
  const allPassed = goals.length > 0 && goals.every((goal) => goal.passed);
  const bonus = allPassed && finishedAtS !== null ? timeBonus(scenario.scoring.timeBonusMax ?? 0, finishedAtS, scenario.timeLimitS) : 0;
  return Math.min(SCENARIO_MAX_SCORE, Math.max(0, points + bonus));
}

/** The score of a check: the lowest of its variants' scores. A check has at least one variant. */
export function checkScore(variantScores: readonly number[]): number {
  if (variantScores.length === 0) {
    throw new RangeError('A check scores at least one variant.');
  }
  return Math.min(...variantScores);
}

/** The score of one run so far, or at its end. */
export type RunScore = {
  /** Each goal's result, in scenario order (with the end rules once the run ended). */
  readonly goals: readonly GoalResult[];
  /** Every goal passed. */
  readonly passed: boolean;
  /** The start of the final streak in which every goal passed; null unless every goal passes now. */
  readonly finishedAtS: number | null;
  /** The time bonus earned: 0 unless every goal passed. */
  readonly timeBonus: number;
  /** `variantScore`: the points of the goals that passed plus the time bonus, 0..maxScore. */
  readonly points: number;
  /** The scenario's top score; null for the sandbox. */
  readonly maxScore: number | null;
};

/** The scorer of one run: the session's seam (`update`, `score`, `end`) and the run's whole score (`result`). */
export type ScenarioScorer = Required<RobotScorer> & {
  result(): RunScore;
};

/** The kinds that hold a state for a while, which an end on a contact cuts short (see the top of this file). */
const HOLD_KINDS: ReadonlySet<RobotGoalSpec['kind']> = new Set(['stop-in-zone', 'servo-angle']);

/** The scorer of one run of `scenario` in `arena` (the variant's), for the learner's `program` (a Blockly workspace, which uses-block reads). */
export function createScenarioScorer(run: { scenario: Scenario; arena: Arena; program: unknown }): ScenarioScorer {
  const { scenario, arena, program } = run;
  const maxScore = scenarioMaxScore(scenario) ?? null;
  /** The start of the current streak in which every goal but the finish-within ones passed; null while one of them has not. */
  let othersSinceS: number | null = null;
  let contactEnd: RobotRunEnd | null = null;
  const othersPassedAtS = () => othersSinceS;
  const goals: { spec: RobotGoalSpec; goal: Goal }[] = scenario.goals.map((spec) => ({
    spec,
    goal: createGoal(spec, { arena, scenario, program, othersPassedAtS }),
  }));
  const others = goals.filter(({ spec }) => spec.kind !== 'finish-within');
  const finishes = goals.filter(({ spec }) => spec.kind === 'finish-within');

  /** A goal's result with the end rules (see the top of this file). */
  const judged = ({ spec, goal }: { spec: RobotGoalSpec; goal: Goal }): GoalResult => {
    const result = goal.result();
    if (contactEnd === null || result.passed || !HOLD_KINDS.has(spec.kind) || result.reasonKey === goalReasons.outOfArena) {
      return result;
    }
    return { ...result, reasonKey: RUN_ENDED_CONTACT_REASON, atS: contactEnd.atS };
  };

  const result = (): RunScore => {
    const results = goals.map(judged);
    const passed = results.length > 0 && results.every((goal) => goal.passed);
    const finishedAtS = passed ? othersSinceS : null;
    const points = variantScore(scenario, results, finishedAtS);
    const bonus = passed && finishedAtS !== null ? timeBonus(scenario.scoring.timeBonusMax ?? 0, finishedAtS, scenario.timeLimitS) : 0;
    return { goals: results, passed, finishedAtS, timeBonus: bonus, points, maxScore };
  };

  return {
    update(frame: GoalFrame, dtS: number) {
      for (const { goal } of others) goal.update(frame, dtS);
      if (others.every(({ goal }) => goal.result().passed)) {
        othersSinceS ??= frame.tS;
      } else {
        othersSinceS = null;
      }
      for (const { goal } of finishes) goal.update(frame, dtS);
    },
    score(): ScoreState {
      const { points, goals: results } = result();
      return { points, maxScore, goals: results.map((goal) => ({ ...goal })) };
    },
    end(end: RobotRunEnd) {
      if (end.reason === 'contact') contactEnd = { ...end };
    },
    result,
  };
}

/** The session's scorer factory for a scenario's runs: `createScenarioScorer` for each start and reset. */
export const scenarioScorer: RobotScorerFactory = ({ scenario, arena, program }) => createScenarioScorer({ scenario, arena, program });

/** One variant of a check as `checkResultOf` reads it: its seed, its simulated time and its run's score at the end. */
export type CheckedVariant = { readonly seed: number; readonly simTimeMs: number; readonly score: RunScore };

/**
 * The result of a check (see the top of this file), in the language of `locale` for the goals' labels: `RobotCheckResult` (check-result.ts),
 * which the host bridge sends. Throws a RangeError for what is not a check of `scenario`: no variant, a variant whose goals are not the
 * scenario's in its order, or a scenario without a score (the sandbox sends no score).
 */
export function checkResultOf(scenario: Scenario, variants: readonly CheckedVariant[], programHash: string, locale: 'vi' | 'en'): RobotCheckResult {
  if (scenarioMaxScore(scenario) === undefined) {
    throw new RangeError(`Scenario "${scenario.key}" has no score: its check sends { passed, goals: [] }.`);
  }
  if (variants.length === 0) {
    throw new RangeError('A check has at least one variant.');
  }
  const ids = scenario.goals.map((goal) => goal.id).join(',');
  for (const variant of variants) {
    if (variant.score.goals.map((goal) => goal.id).join(',') !== ids) {
      throw new RangeError(`Variant ${variant.seed} has the goals ${variant.score.goals.map((goal) => goal.id).join(', ')}, not the scenario's ${ids}.`);
    }
  }
  const goals = scenario.goals.map((spec, index) => ({
    id: spec.id,
    label: spec.label[locale],
    passed: variants.every((variant) => variant.score.goals[index]!.passed),
  }));
  return {
    passed: goals.every((goal) => goal.passed),
    goals,
    score: checkScore(variants.map((variant) => variant.score.points)),
    maxScore: SCENARIO_MAX_SCORE,
    simTimeMs: Math.max(...variants.map((variant) => variant.simTimeMs)),
    variants: variants.map((variant) => ({ seed: variant.seed, passed: variant.score.passed, score: variant.score.points, simTimeMs: variant.simTimeMs })),
    engine: ROBOT_ENGINE,
    scenarioVersion: scenario.version,
    programHash,
  };
}
