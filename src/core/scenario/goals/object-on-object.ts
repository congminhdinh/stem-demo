import { outcome, type Goal, type GoalContext, type GoalResult, type GoalSpec } from './goal';
import type { GoalObject } from './frame';
import {
  arenaObject,
  createCarryWatch,
  createRestWatch,
  floorDistanceCm,
  isHeld,
  LENGTH_EPSILON_CM,
  objectHeightCm,
  objectOn,
  STACK_MAX_SLIDE_CM,
  tiltOf,
} from './object-watch';
import { goalReasons, type GoalReasonKey } from './reasons';
import { assertTickS } from './tick';

// `object-on-object` (N19 D2, plan §4.5): at the end of the run `top` rests on `bottom`, stacked there by the gripper. Judged on the last
// frame; the first of these that applies is why it has not passed (OBJECT_ON_OBJECT_REASONS, in order):
//
//   1. out-of-arena         the robot left the arena (for good, at that time);
//   2. object-still-held    the gripper holds either object;
//   3. object-pushed        (carried) as `object-placed` with a slide of STACK_MAX_SLIDE_CM: the top was never held and was pushed, or it
//      object-never-held    slid more than that since it was let go; never held and not pushed: object-never-held;
//   4. object-not-stacked   the middle of the top is not at the height of the bottom's top face plus half its own height, within
//                           STACK_Z_TOLERANCE_CM (either height unknown is not stacked): it lies beside it, or fell off;
//   5. stack-off-centre     on it, but its middle is more than `maxOffsetCm` from the bottom's, on the floor;
//   6. object-tipped        the top leans more than `maxTiltDeg`;
//   7. object-not-at-rest   in the last `restS` of the run the top moved more than REST_MOVE_CM, was held, or the robot touched it.
//
// The heights are the arena's (a box's third size, a cylinder's height): a base lying on its side is not what the lesson stacks on.

/** How far the top's middle may be from the height it has resting on the bottom, cm (plan §4.5: ±0.8). */
export const STACK_Z_TOLERANCE_CM = 0.8;

/** Why `object-on-object` has not passed, in the order it asks (see the top of this file). */
export const OBJECT_ON_OBJECT_REASONS: readonly GoalReasonKey[] = [
  goalReasons.outOfArena,
  goalReasons.objectStillHeld,
  goalReasons.objectPushed,
  goalReasons.objectNeverHeld,
  goalReasons.objectNotStacked,
  goalReasons.stackOffCentre,
  goalReasons.objectTipped,
  goalReasons.objectNotAtRest,
];

export function createObjectOnObjectGoal(spec: GoalSpec<'object-on-object'>, ctx: Pick<GoalContext, 'arena'>): Goal {
  const topHalfCm = objectHeightCm(arenaObject(ctx, spec.top)) / 2;
  const bottomHalfCm = objectHeightCm(arenaObject(ctx, spec.bottom)) / 2;
  const carry = createCarryWatch(spec.top, STACK_MAX_SLIDE_CM);
  const rest = createRestWatch(spec.top, spec.restS);
  let top: GoalObject | undefined;
  let bottom: GoalObject | undefined;
  let bottomHeld = false;
  let leftAtS: number | undefined;

  type Failure = { reasonKey: GoalReasonKey; atS?: number; progress: number };
  const failure = (): Failure | null => {
    if (leftAtS !== undefined) return { reasonKey: goalReasons.outOfArena, atS: leftAtS, progress: 0 };
    if (carry.heldNow || bottomHeld) return { reasonKey: goalReasons.objectStillHeld, progress: 0.5 };
    if (spec.carried && !carry.everHeld) {
      return carry.pushedAtS === undefined ? { reasonKey: goalReasons.objectNeverHeld, progress: 0 } : { reasonKey: goalReasons.objectPushed, atS: carry.pushedAtS, progress: 0 };
    }
    if (spec.carried && carry.pushedAtS !== undefined) return { reasonKey: goalReasons.objectPushed, atS: carry.pushedAtS, progress: 0.25 };
    const onTop =
      top?.zCm !== undefined && bottom?.zCm !== undefined && Math.abs(top.zCm - (bottom.zCm + bottomHalfCm + topHalfCm)) <= STACK_Z_TOLERANCE_CM + LENGTH_EPSILON_CM;
    if (!onTop) return { reasonKey: goalReasons.objectNotStacked, progress: 0.25 };
    if (floorDistanceCm(top!, bottom!) > spec.maxOffsetCm + LENGTH_EPSILON_CM) return { reasonKey: goalReasons.stackOffCentre, progress: 0.5 };
    if (tiltOf(top!) > spec.maxTiltDeg) return { reasonKey: goalReasons.objectTipped, progress: 0.75 };
    if (!rest.atRest()) return { reasonKey: goalReasons.objectNotAtRest, progress: 0.75 };
    return null;
  };

  return {
    update(frame, dtS) {
      assertTickS(dtS);
      if (leftAtS !== undefined) return;
      if (frame.outOfArena) {
        leftAtS = frame.tS;
        return;
      }
      carry.update(frame);
      rest.update(frame, dtS);
      top = objectOn(frame, spec.top);
      bottom = objectOn(frame, spec.bottom);
      bottomHeld = isHeld(frame, spec.bottom);
    },
    result(): GoalResult {
      const failed = failure();
      if (failed === null) return outcome(spec, { passed: true });
      return outcome(spec, { passed: false, progress: failed.progress, reasonKey: failed.reasonKey, ...(failed.atS === undefined ? {} : { atS: failed.atS }) });
    },
  };
}
