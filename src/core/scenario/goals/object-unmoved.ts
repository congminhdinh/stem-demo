import { outcome, type Goal, type GoalContext, type GoalSpec } from './goal';
import type { GoalObject } from './frame';
import { arenaObject, distanceCm, LENGTH_EPSILON_CM, objectOn, tiltOf } from './object-watch';
import { goalReasons, type GoalReasonKey } from './reasons';
import { assertTickS } from './tick';
import { createReachMeter } from './travel';

// `object-unmoved` (N19 D2, plan §4.5): a guard, like avoid-contact. It fails for good on the first frame on which the object is more than
// `maxMoveCm` from where it was on the first frame (in 3D when the frames give its height, so lifting it moves it too; `object-moved`), or
// leans more than `maxTiltDeg` (`object-tipped`), or the robot leaves the arena (`out-of-arena`), each at the time of that frame; leaving wins
// on a frame that is all three. An object the frame does not have, once it had one, has moved.
//
// It is met by doing nothing, so it passes only once the robot has been MIN_GUARD_TRAVEL_CM from its start (travel.ts, net reach); before
// that it has not passed, with `robot-did-not-move`. Its own failure is the more telling reason, so it comes first. Judged at the end of the run.

export function createObjectUnmovedGoal(spec: GoalSpec<'object-unmoved'>, ctx: Pick<GoalContext, 'arena'>): Goal {
  arenaObject(ctx, spec.object);
  const reach = createReachMeter();
  let start: GoalObject | undefined;
  let failed: { readonly reasonKey: GoalReasonKey; readonly atS: number } | undefined;
  return {
    update(frame, dtS) {
      assertTickS(dtS);
      reach.add(frame, dtS);
      if (failed !== undefined) return;
      if (frame.outOfArena) {
        failed = { reasonKey: goalReasons.outOfArena, atS: frame.tS };
        return;
      }
      const pose = objectOn(frame, spec.object);
      if (start === undefined) {
        start = pose;
      } else if (pose === undefined || distanceCm(pose, start) > spec.maxMoveCm + LENGTH_EPSILON_CM) {
        failed = { reasonKey: goalReasons.objectMoved, atS: frame.tS };
        return;
      }
      if (pose !== undefined && tiltOf(pose) > spec.maxTiltDeg) failed = { reasonKey: goalReasons.objectTipped, atS: frame.tS };
    },
    result() {
      if (failed !== undefined) return outcome(spec, { passed: false, progress: 0, reasonKey: failed.reasonKey, atS: failed.atS });
      if (!reach.enough) return outcome(spec, { passed: false, progress: reach.progress, reasonKey: goalReasons.robotDidNotMove });
      return outcome(spec, { passed: true });
    },
  };
}
