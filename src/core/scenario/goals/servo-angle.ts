import { zonePolygon, insidePolygon } from './geometry';
import { outcome, type Goal, type GoalContext, type GoalSpec } from './goal';
import { assertTickS, createHold } from './hold';
import { goalReasons } from './reasons';

// `servo-angle`: the angle of the servo of `role` is in [minDeg, maxDeg], both ends included.
//
//   - With `whenInZone`: it has to be in range while the middle of the robot is in that zone, for SERVO_HOLD_S in a row (hold.ts says how
//     a hold is timed). Passing is kept: the servo may move on afterwards. Leaving the arena before it ends the goal.
//   - Without: the angle on the last frame is what counts, wherever the robot is, so a servo that was right and has been moved again has
//     not passed. Leaving the arena does not end it, since it is not about where the robot is.
//
// A servo the frame has no angle for is out of range.

/** How long a servo is held at its angle in the zone. */
export const SERVO_HOLD_S = 0.5;

export function createServoAngleGoal(spec: GoalSpec<'servo-angle'>, ctx: Pick<GoalContext, 'arena'>): Goal {
  const inRange = (servoDeg: Readonly<Record<string, number>>): boolean => {
    const deg = Object.hasOwn(servoDeg, spec.role) ? servoDeg[spec.role] : undefined;
    return deg !== undefined && deg >= spec.minDeg && deg <= spec.maxDeg;
  };

  if (spec.whenInZone === undefined) {
    let rightNow = false;
    return {
      update(frame) {
        rightNow = inRange(frame.servoDeg);
      },
      result() {
        return rightNow ? outcome(spec, { passed: true }) : outcome(spec, { passed: false, progress: 0, reasonKey: goalReasons.servoOutOfRange });
      },
    };
  }

  const zone = zonePolygon(ctx.arena, spec.whenInZone);
  const hold = createHold(SERVO_HOLD_S);
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
      const set = inRange(frame.servoDeg) && insidePolygon(zone, frame.robot.xCm, frame.robot.yCm);
      if (hold.tick(set, dtS)) passedAtS = frame.tS;
    },
    result() {
      if (passedAtS !== undefined) return outcome(spec, { passed: true, atS: passedAtS });
      if (leftAtS !== undefined) return outcome(spec, { passed: false, progress: 0, reasonKey: goalReasons.outOfArena, atS: leftAtS });
      return outcome(spec, { passed: false, progress: hold.progress, reasonKey: goalReasons.servoNotSetInZone });
    },
  };
}
