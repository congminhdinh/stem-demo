import { outcome, type Goal, type GoalContext, type GoalSpec } from './goal';
import { createHold } from './hold';
import { arenaObject, isHeld, LENGTH_EPSILON_CM, objectOn, touches } from './object-watch';
import { goalReasons } from './reasons';
import { assertTickS } from './tick';

// `object-held` (N19 D2, plan §4.5): the gripper holds the object for `holdS` in a row (hold.ts times a hold), lifted all that time at least
// `minLiftCm` above where it lay when the gripper took it: the height of its middle (`zCm`) less that height on the last frame before the hold
// began (its bottom rises as much, since the gripper keeps it level). With `minLiftCm` 0 holding is enough, and a frame without a height then
// counts; with more, a frame without a height is not lifted.
//
// Passing is kept: the robot may put the object down afterwards (`object-placed` judges that). Before it passes, why not:
//   - `object-not-reached`: the robot never touched the object and never held it;
//   - `object-not-grasped`: it touched it, or held it for less than `holdS`;
//   - `object-not-lifted`: it held it for `holdS` or more, but never that long as high as asked.
// Leaving the arena before it passes ends the goal for good (`out-of-arena`, at the time), as for every goal that depends on where things are.

export function createObjectHeldGoal(spec: GoalSpec<'object-held'>, ctx: Pick<GoalContext, 'arena'>): Goal {
  arenaObject(ctx, spec.object);
  const lifted = createHold(spec.holdS);
  const held = createHold(spec.holdS);
  let passedAtS: number | undefined;
  let leftAtS: number | undefined;
  let everTouched = false;
  let everHeld = false;
  let heldLongEnough = false;
  /** The height of the object's middle on the last frame it was not held, cm. */
  let restZCm: number | undefined;
  /** The height it was taken from, for the hold that is going on. */
  let takenFromZCm: number | undefined;
  let wasHeld = false;
  return {
    update(frame, dtS) {
      assertTickS(dtS);
      if (passedAtS !== undefined || leftAtS !== undefined) return;
      if (frame.outOfArena) {
        leftAtS = frame.tS;
        return;
      }
      const pose = objectOn(frame, spec.object);
      const holding = pose !== undefined && isHeld(frame, spec.object);
      if (touches(frame, spec.object)) everTouched = true;
      if (holding && !wasHeld) takenFromZCm = restZCm ?? pose.zCm;
      if (!holding) restZCm = pose?.zCm;
      wasHeld = holding;
      everHeld ||= holding;
      const high =
        holding &&
        (spec.minLiftCm <= 0 || (pose.zCm !== undefined && takenFromZCm !== undefined && pose.zCm - takenFromZCm >= spec.minLiftCm - LENGTH_EPSILON_CM));
      if (held.tick(holding, dtS)) heldLongEnough = true;
      if (lifted.tick(high, dtS)) passedAtS = frame.tS;
    },
    result() {
      if (passedAtS !== undefined) return outcome(spec, { passed: true, atS: passedAtS });
      if (leftAtS !== undefined) return outcome(spec, { passed: false, progress: 0, reasonKey: goalReasons.outOfArena, atS: leftAtS });
      const reasonKey = !everHeld
        ? everTouched
          ? goalReasons.objectNotGrasped
          : goalReasons.objectNotReached
        : heldLongEnough && spec.minLiftCm > 0
          ? goalReasons.objectNotLifted
          : goalReasons.objectNotGrasped;
      return outcome(spec, { passed: false, progress: lifted.progress, reasonKey });
    },
  };
}
