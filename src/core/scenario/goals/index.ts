import { createAvoidContactGoal } from './avoid-contact';
import { createCheckpointsGoal } from './checkpoints-in-order';
import { createFinishWithinGoal } from './finish-within';
import type { Goal, GoalContext } from './goal';
import { createObjectInZoneGoal } from './object-in-zone';
import { createReachZoneGoal } from './reach-zone';
import { createServoAngleGoal } from './servo-angle';
import { createStayOnLineGoal } from './stay-on-line';
import { createStopInZoneGoal } from './stop-in-zone';
import { createUsesBlockGoal } from './uses-block';
import type { RobotGoalSpec } from '../scenario-schema';

// The goal library of the robot lab (N18 R6.1): `createGoal(spec, ctx)` makes the evaluator of one goal of a scenario. See goal.ts for
// what every kind follows, and the file of each kind for its own rules. R6.2 makes one per goal for each variant, feeds them the
// frames of the run (R3.5 turns a world snapshot into a `GoalFrame`) and adds the points up.

export type { GoalFrame, GoalContact, GoalFootprint, GoalPose } from './frame';
export type { Goal, GoalContext, GoalResult, GoalSpec } from './goal';
export { goalReasonKeys, goalReasons, type GoalReasonKey } from './reasons';

/**
 * The evaluator of a goal. Throws for a goal that cannot be made: a zone or object the arena does not have (the scenario schema has
 * checked them, so it is a bug of the caller), or a context without what the kind needs (`program` for uses-block,
 * `othersPassedAtS` for finish-within).
 */
export function createGoal(spec: RobotGoalSpec, ctx: GoalContext): Goal {
  switch (spec.kind) {
    case 'reach-zone':
      return createReachZoneGoal(spec, ctx);
    case 'checkpoints-in-order':
      return createCheckpointsGoal(spec, ctx);
    case 'stay-on-line':
      return createStayOnLineGoal(spec, ctx);
    case 'avoid-contact':
      return createAvoidContactGoal(spec);
    case 'object-in-zone':
      return createObjectInZoneGoal(spec, ctx);
    case 'stop-in-zone':
      return createStopInZoneGoal(spec, ctx);
    case 'servo-angle':
      return createServoAngleGoal(spec, ctx);
    case 'finish-within':
      return createFinishWithinGoal(spec, ctx);
    case 'uses-block':
      return createUsesBlockGoal(spec, ctx);
    default:
      throw new Error(`unknown goal kind "${(spec as { kind?: unknown }).kind}"; the kinds are the ones of the scenario schema.`);
  }
}
