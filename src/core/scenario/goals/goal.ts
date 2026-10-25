import type { Arena } from '../../world/arena/arena-schema';
import type { RobotGoalSpec, Scenario } from '../scenario-schema';
import type { GoalFrame } from './frame';
import type { GoalReasonKey } from './reasons';

// The goal library (N18 R6.1, robot plan §4.6 and §R6.1): each kind of goal of a scenario is judged by a small evaluator that is fed
// the run one tick at a time and tells how it is doing at any moment. R6.2 builds one per goal per variant and adds the points up;
// R6.3 shows `reasonKey` and `atS`.
//
// What every kind follows:
//   - Pure arithmetic on `GoalFrame`s (frame.ts), no clock, no randomness: the same frames give the same results on every engine.
//   - `result()` is the judgement of the run so far, as if it ended now, and changes nothing. A goal that passes once stays passed
//     (reach-zone, checkpoints-in-order, stop-in-zone, servo-angle, with or without a zone). A goal that is about the end
//     (object-in-zone, stay-on-line) and one that is about not doing something (avoid-contact) follow the run, so they are read
//     after the last frame.
//   - Points are all or nothing: `points` is the spec's when the goal has passed and 0 otherwise. `progress` (0..1) is for the UI only.
//   - A goal that has not passed says why with a `reasonKey` (reasons.ts); one that has passed has none. `atS` is the simulated time
//     of the event that settled it (the pass, or the contact, or the moment the robot left the arena) and is left out when no event did.
//   - avoid-contact and stay-on-line are guard goals (travel.ts): a robot that never drives would meet them, so they pass only once the
//     robot has been MIN_GUARD_TRAVEL_CM from its start (net reach, not path length); before that they have not passed, with
//     `robot-did-not-move`.
//   - The robot "being somewhere" means the middle of its body (`robot.xCm`, `yCm`) in the zone's polygon, by the point-in-polygon rule of
//     geometry.ts (the paint's arithmetic and edge rule; what a sensor reads there can be tape or a later zone instead).
//   - Every tick is checked the same way, on the first line of `update`: `dtS` is a finite time of 0 s or more or it is a RangeError (tick.ts).
//   - The robot leaving the arena (`frame.outOfArena`) ends the goals that have not passed: they fail for good with `out-of-arena`, at the
//     time it left. A pass is kept. That is every kind but two: finish-within, which only compares the scorer's time with its limit, and
//     uses-block, which is the program alone. On a frame that is both out of the arena and in a zone (or touching a collider), leaving wins.

/** The outcome of a goal. */
export type GoalResult = {
  readonly id: string;
  readonly passed: boolean;
  /** The spec's points when passed, else 0. */
  readonly points: number;
  /** How far the goal is from being met, 0..1: 1 when passed. For the UI; it never earns points. */
  readonly progress: number;
  /** Why the goal is not met: a key of the UI's messages (reasons.ts). Present exactly when the goal has not passed. */
  readonly reasonKey?: GoalReasonKey;
  /** The simulated time, in seconds, of the event that settled the goal. */
  readonly atS?: number;
};

export type Goal = {
  /** The next tick: the world as it is after the step, and the length of the step in seconds. Ticks are fed in time order. */
  update(frame: GoalFrame, dtS: number): void;
  /** The judgement of the run so far. */
  result(): GoalResult;
};

/** What a goal may need besides its spec. A kind throws when it is made without what it needs. */
export type GoalContext = {
  /** The arena the run is in (a variant's arena has the same paint and objects as the scenario's). */
  readonly arena: Arena;
  /** The scenario the goal belongs to. No kind reads it yet. */
  readonly scenario: Scenario;
  /** The learner's program as a Blockly workspace in JSON; `uses-block` reads it. */
  readonly program?: unknown;
  /**
   * `finish-within`: the simulated time at which the last of the other goals passed, or null while one of them has not. The scorer
   * (R6.2) knows the other goals; this goal only compares the time it answers with its own limit.
   */
  readonly othersPassedAtS?: () => number | null;
};

/** The spec of one kind of goal. */
export type GoalSpec<K extends RobotGoalSpec['kind']> = Extract<RobotGoalSpec, { kind: K }>;

type Met = { readonly passed: true; readonly atS?: number };
type NotMet = { readonly passed: false; readonly progress: number; readonly reasonKey: GoalReasonKey; readonly atS?: number };

/** Builds a result: the points follow from `passed`, a goal that has passed has no reason, and every goal that has not has one. */
export function outcome(spec: Pick<RobotGoalSpec, 'id' | 'points'>, o: Met | NotMet): GoalResult {
  if (o.passed) {
    return { id: spec.id, passed: true, points: spec.points, progress: 1, ...(o.atS === undefined ? {} : { atS: o.atS }) };
  }
  const progress = Number.isFinite(o.progress) ? Math.min(1, Math.max(0, o.progress)) : 0;
  return { id: spec.id, passed: false, points: 0, progress, reasonKey: o.reasonKey, ...(o.atS === undefined ? {} : { atS: o.atS }) };
}
