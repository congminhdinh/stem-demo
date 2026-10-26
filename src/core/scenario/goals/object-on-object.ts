import { outcome, type Goal, type GoalContext, type GoalResult, type GoalSpec } from './goal';
import type { GoalObject } from './frame';
import {
  arenaObject,
  createCarryWatch,
  createRestWatch,
  firstFailure,
  floorDistanceCm,
  isHeld,
  judgeStep,
  LENGTH_EPSILON_CM,
  objectHeightCm,
  objectOn,
  reasonsOf,
  STACK_MAX_SLIDE_CM,
  tiltOf,
  type CarryWatch,
  type RestWatch,
} from './object-watch';
import { goalReasons } from './reasons';
import { assertTickS } from './tick';

// `object-on-object` (N19 D2, plan §4.5): at the end of the run `top` rests on `bottom`, stacked there by the gripper. Judged on the last
// frame; the first of these steps that fails is why it has not passed (OBJECT_ON_OBJECT_REASONS is their order):
//
//   1. out-of-arena         the robot left the arena (for good, at that time);
//   2. object-still-held    the gripper holds either object;
//   3. object-pushed        (carried) as `object-placed`, with a slide of STACK_MAX_SLIDE_CM, `minCarryLiftCm` and `minCarryCm`: the top was never carried
//      object-never-held    and was pushed, or it slid more than that since it was let go; never carried and not pushed: object-never-held;
//   4. object-not-stacked   the middle of the top is not at the height of the bottom's top face plus half its own height, within
//                           STACK_Z_TOLERANCE_CM (either height unknown is not stacked): it lies beside it, or fell off;
//   5. stack-off-centre     on it, but its middle is more than `maxOffsetCm` from the bottom's, on the floor;
//   6. object-tipped        the top leans more than `maxTiltDeg`;
//   7. object-not-at-rest   in the last `restS` of the run the top moved more than REST_MOVE_CM, was held, or the robot touched it.
//
// The heights are the arena's (a box's third size, a cylinder's height): a base lying on its side is not what the lesson stacks on.

/** How far the top's middle may be from the height it has resting on the bottom, cm (plan §4.5: ±0.8). */
export const STACK_Z_TOLERANCE_CM = 0.8;

/** What the steps judge: the goal's state on the last frame. */
type StackView = {
  readonly spec: GoalSpec<'object-on-object'>;
  readonly leftAtS: number | undefined;
  readonly carry: CarryWatch;
  readonly rest: RestWatch;
  readonly bottomHeld: boolean;
  readonly top: GoalObject | undefined;
  readonly bottom: GoalObject | undefined;
  /** The height of the top's middle above the bottom's when it rests on it, cm. */
  readonly restingRiseCm: number;
};

const STACK_STEPS = [
  judgeStep<StackView>([goalReasons.outOfArena], (v) => (v.leftAtS === undefined ? null : { reasonKey: goalReasons.outOfArena, atS: v.leftAtS, progress: 0 })),
  judgeStep<StackView>([goalReasons.objectStillHeld], (v) => (v.carry.heldNow || v.bottomHeld ? { reasonKey: goalReasons.objectStillHeld, progress: 0.5 } : null)),
  judgeStep<StackView>([goalReasons.objectPushed, goalReasons.objectNeverHeld], (v) => {
    if (!v.spec.carried) return null;
    const pushed = v.carry.pushedAtS === undefined ? null : { reasonKey: goalReasons.objectPushed, atS: v.carry.pushedAtS };
    if (!v.carry.carried) return pushed === null ? { reasonKey: goalReasons.objectNeverHeld, progress: 0 } : { ...pushed, progress: 0 };
    return pushed === null ? null : { ...pushed, progress: 0.25 };
  }),
  judgeStep<StackView>([goalReasons.objectNotStacked], (v) => {
    const onTop = v.top?.zCm !== undefined && v.bottom?.zCm !== undefined && Math.abs(v.top.zCm - (v.bottom.zCm + v.restingRiseCm)) <= STACK_Z_TOLERANCE_CM + LENGTH_EPSILON_CM;
    return onTop ? null : { reasonKey: goalReasons.objectNotStacked, progress: 0.25 };
  }),
  judgeStep<StackView>([goalReasons.stackOffCentre], (v) =>
    floorDistanceCm(v.top!, v.bottom!) > v.spec.maxOffsetCm + LENGTH_EPSILON_CM ? { reasonKey: goalReasons.stackOffCentre, progress: 0.5 } : null,
  ),
  judgeStep<StackView>([goalReasons.objectTipped], (v) => (tiltOf(v.top!) > v.spec.maxTiltDeg ? { reasonKey: goalReasons.objectTipped, progress: 0.75 } : null)),
  judgeStep<StackView>([goalReasons.objectNotAtRest], (v) => (v.rest.atRest() ? null : { reasonKey: goalReasons.objectNotAtRest, progress: 0.75 })),
];

/** Why `object-on-object` has not passed, in the order its steps are tried (see the top of this file). */
export const OBJECT_ON_OBJECT_REASONS = reasonsOf(STACK_STEPS);

export function createObjectOnObjectGoal(spec: GoalSpec<'object-on-object'>, ctx: Pick<GoalContext, 'arena'>): Goal {
  const restingRiseCm = (objectHeightCm(arenaObject(ctx, spec.bottom)) + objectHeightCm(arenaObject(ctx, spec.top))) / 2;
  const carry = createCarryWatch(spec.top, { maxSlideCm: STACK_MAX_SLIDE_CM, minCarryLiftCm: spec.minCarryLiftCm, minCarryCm: spec.minCarryCm });
  const rest = createRestWatch(spec.top, spec.restS);
  let top: GoalObject | undefined;
  let bottom: GoalObject | undefined;
  let bottomHeld = false;
  let leftAtS: number | undefined;

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
      const failed = firstFailure(STACK_STEPS, { spec, leftAtS, carry, rest, bottomHeld, top, bottom, restingRiseCm });
      if (failed === null) return outcome(spec, { passed: true });
      return outcome(spec, { passed: false, progress: failed.progress, reasonKey: failed.reasonKey, ...(failed.atS === undefined ? {} : { atS: failed.atS }) });
    },
  };
}
