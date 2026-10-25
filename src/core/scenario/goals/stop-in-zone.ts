import { zonePolygon, insidePolygon } from './geometry';
import { outcome, type Goal, type GoalContext, type GoalSpec } from './goal';
import { createHold } from './hold';
import { goalReasons } from './reasons';
import { assertTickS } from './tick';

// `stop-in-zone`: the robot is stopped in the zone at the end of the run (N18 R5.2a fix round 3, controller ruling; it was kept once met).
// It passes when, on the last frame the goal was given, the middle of the robot has been in the zone at a speed of at most `maxSpeedCmS`
// for the last `holdS` seconds in a row (hold.ts says how a hold is timed: `holdS` between the first frame of the stop and the frame that
// completes it). Leaving the zone, or going faster for a single frame, starts the count again, so a robot that stopped and drove on has
// not passed, and one that creeps through the zone above the limit never does.
//
// The end of the run is the last frame fed: `result()` is the judgement as if the run ended there, as for `object-in-zone` and the guard
// goals. A run the check ends early (a contact of the scenario's `endOnContact`, R6.2) passes it only if the robot had already been stopped
// in the zone for `holdS` on that frame. `atS` is when the stop that is still going on was complete. Leaving the arena fails it for good.

export function createStopInZoneGoal(spec: GoalSpec<'stop-in-zone'>, ctx: Pick<GoalContext, 'arena'>): Goal {
  const zone = zonePolygon(ctx.arena, spec.zone);
  const hold = createHold(spec.holdS);
  /** When the current stop was complete, while it goes on; undefined while the robot is not (yet) stopped long enough. */
  let completeAtS: number | undefined;
  let leftAtS: number | undefined;
  return {
    update(frame, dtS) {
      assertTickS(dtS);
      if (leftAtS !== undefined) return;
      if (frame.outOfArena) {
        leftAtS = frame.tS;
        return;
      }
      const stopped = frame.robot.speedCmS <= spec.maxSpeedCmS && insidePolygon(zone, frame.robot.xCm, frame.robot.yCm);
      if (!hold.tick(stopped, dtS)) completeAtS = undefined;
      else completeAtS ??= frame.tS;
    },
    result() {
      if (leftAtS !== undefined) return outcome(spec, { passed: false, progress: 0, reasonKey: goalReasons.outOfArena, atS: leftAtS });
      if (completeAtS !== undefined) return outcome(spec, { passed: true, atS: completeAtS });
      return outcome(spec, { passed: false, progress: hold.progress, reasonKey: goalReasons.notStoppedInZone });
    },
  };
}
