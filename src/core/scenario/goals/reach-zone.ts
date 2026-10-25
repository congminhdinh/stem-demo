import { zonePolygon, insidePolygon } from './geometry';
import { outcome, type Goal, type GoalContext, type GoalSpec } from './goal';
import { goalReasons } from './reasons';
import { assertTickS } from './tick';

// `reach-zone`: passes the first time the middle of the robot is inside the zone, and stays passed (the robot may drive on).

export function createReachZoneGoal(spec: GoalSpec<'reach-zone'>, ctx: Pick<GoalContext, 'arena'>): Goal {
  const zone = zonePolygon(ctx.arena, spec.zone);
  let reachedAtS: number | undefined;
  let leftAtS: number | undefined;
  return {
    update(frame, dtS) {
      assertTickS(dtS);
      if (reachedAtS !== undefined || leftAtS !== undefined) return;
      if (frame.outOfArena) {
        leftAtS = frame.tS;
      } else if (insidePolygon(zone, frame.robot.xCm, frame.robot.yCm)) {
        reachedAtS = frame.tS;
      }
    },
    result() {
      if (reachedAtS !== undefined) return outcome(spec, { passed: true, atS: reachedAtS });
      if (leftAtS !== undefined) return outcome(spec, { passed: false, progress: 0, reasonKey: goalReasons.outOfArena, atS: leftAtS });
      return outcome(spec, { passed: false, progress: 0, reasonKey: goalReasons.zoneNotReached });
    },
  };
}
