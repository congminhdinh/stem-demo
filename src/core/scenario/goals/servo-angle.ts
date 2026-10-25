import { zonePolygon, insidePolygon } from './geometry';
import { outcome, type Goal, type GoalContext, type GoalSpec } from './goal';
import { createHold } from './hold';
import { goalReasons } from './reasons';
import { assertTickS } from './tick';

// `servo-angle`: the angle of the servo of `role` is in [minDeg, maxDeg], both ends included, and held there for SERVO_HOLD_S in a row
// (hold.ts says how a hold is timed). The half second applies with and without a zone:
//
//   - With `whenInZone`: the angle has to be in range while the middle of the robot is in that zone, the two together for the whole time.
//   - Without: the angle alone, wherever the robot is.
//
// Passing is kept: the servo may move on afterwards, so an angle that was held for half a second at any time has passed, and one that
// is set only on the last tick has not. Leaving the arena before the hold is done ends the goal for good (`out-of-arena`), as for every
// goal that depends on where things are; a pass is kept. A servo the frame has no angle for is out of range.

/** How long a servo is held at its angle. */
export const SERVO_HOLD_S = 0.5;

export function createServoAngleGoal(spec: GoalSpec<'servo-angle'>, ctx: Pick<GoalContext, 'arena'>): Goal {
  const zone = spec.whenInZone === undefined ? undefined : zonePolygon(ctx.arena, spec.whenInZone);
  const hold = createHold(SERVO_HOLD_S);
  let passedAtS: number | undefined;
  let leftAtS: number | undefined;
  const inRange = (servoDeg: Readonly<Record<string, number>>): boolean => {
    const deg = Object.hasOwn(servoDeg, spec.role) ? servoDeg[spec.role] : undefined;
    return deg !== undefined && deg >= spec.minDeg && deg <= spec.maxDeg;
  };
  return {
    update(frame, dtS) {
      assertTickS(dtS);
      if (passedAtS !== undefined || leftAtS !== undefined) return;
      if (frame.outOfArena) {
        leftAtS = frame.tS;
        return;
      }
      const set = inRange(frame.servoDeg) && (zone === undefined || insidePolygon(zone, frame.robot.xCm, frame.robot.yCm));
      if (hold.tick(set, dtS)) passedAtS = frame.tS;
    },
    result() {
      if (passedAtS !== undefined) return outcome(spec, { passed: true, atS: passedAtS });
      if (leftAtS !== undefined) return outcome(spec, { passed: false, progress: 0, reasonKey: goalReasons.outOfArena, atS: leftAtS });
      const reasonKey = zone === undefined ? goalReasons.servoOutOfRange : goalReasons.servoNotSetInZone;
      return outcome(spec, { passed: false, progress: hold.progress, reasonKey });
    },
  };
}
