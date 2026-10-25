import { zonePolygon, insidePolygon } from './geometry';
import { outcome, type Goal, type GoalContext, type GoalSpec } from './goal';
import { createHold } from './hold';
import { goalReasons } from './reasons';
import { assertTickS } from './tick';

// `stop-in-zone`: passes once the middle of the robot has been in the zone, at a speed of at most `maxSpeedCmS`, for `holdS` seconds
// in a row (hold.ts says how a hold is timed: `holdS` between the first frame of the stop and the frame that completes it). Leaving
// the zone, or going faster for a single frame, starts the count again. A pass is kept: the robot may drive off.

export function createStopInZoneGoal(spec: GoalSpec<'stop-in-zone'>, ctx: Pick<GoalContext, 'arena'>): Goal {
  const zone = zonePolygon(ctx.arena, spec.zone);
  const hold = createHold(spec.holdS);
  let passedAtS: number | undefined;
  let leftAtS: number | undefined;
  return {
    update(frame, dtS) {
      assertTickS(dtS);
      if (passedAtS !== undefined || leftAtS !== undefined) return;
      if (frame.outOfArena) {
        leftAtS = frame.tS;
        return;
      }
      const stopped = frame.robot.speedCmS <= spec.maxSpeedCmS && insidePolygon(zone, frame.robot.xCm, frame.robot.yCm);
      if (hold.tick(stopped, dtS)) passedAtS = frame.tS;
    },
    result() {
      if (passedAtS !== undefined) return outcome(spec, { passed: true, atS: passedAtS });
      if (leftAtS !== undefined) return outcome(spec, { passed: false, progress: 0, reasonKey: goalReasons.outOfArena, atS: leftAtS });
      return outcome(spec, { passed: false, progress: hold.progress, reasonKey: goalReasons.notStoppedInZone });
    },
  };
}
