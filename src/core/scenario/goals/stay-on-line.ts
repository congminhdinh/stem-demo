import { createGroundPaint } from '../../world/arena/ground-paint';
import { outcome, type Goal, type GoalContext, type GoalSpec } from './goal';
import { goalReasons } from './reasons';
import { assertTickS } from './tick';
import { createTravelMeter } from './travel';

// `stay-on-line`: the share of the ticks the robot is moving on which one of its line-sensor spots is over the tape, from the start of
// the run to the end. It passes when the share is at least `minRatio`, provided the robot has driven: it is a guard goal (travel.ts), so
// below MIN_GUARD_TRAVEL_CM of path it has not passed, with `robot-did-not-move`, whatever the ratio.
//
//   - A tick is one `update`; the goal counts ticks, not seconds, so a ratio such as 17 of 20 is exact and compares with `minRatio`
//     without rounding (a quotient of two whole numbers is the double nearest the true ratio, as is the author's literal).
//   - Moving is a speed above MOVING_SPEED_CM_S: the ticks of a robot at rest, before it starts or after it stops, are not counted
//     either way. From the first tick, though: a robot that wanders off before it reaches the tape has those ticks against it.
//   - A spot is over the tape when the floor under its centre is dark: `groundReflectanceAt` (the paint, as the sensor sees it) of the
//     point is at most LINE_DARK_MAX_REFLECTANCE. The tape reads exactly 0 and a floor or a zone of ordinary colours reads well above
//     the threshold. A spot beyond the edge of the ground reads dark too, but no tape is there, so it does not count.
//   - A robot with no line-sensor spots on the floor is off the tape on every tick it moves. With no tick above the moving speed the
//     ratio is 0 (a robot that crawls below 1 cm/s is never counted on the tape). The ratio is the whole run's and moves up and down,
//     so the goal is read after the last frame.

/** A robot moves faster than this, cm/s. */
export const MOVING_SPEED_CM_S = 1;
/** The floor under a spot is tape when its reflectance (0 black .. 1 white) is at most this. */
export const LINE_DARK_MAX_REFLECTANCE = 0.25;

export function createStayOnLineGoal(spec: GoalSpec<'stay-on-line'>, ctx: Pick<GoalContext, 'arena'>): Goal {
  const paint = createGroundPaint(ctx.arena);
  const [widthCm, depthCm] = ctx.arena.ground.sizeCm;
  const overTape = (x: number, y: number): boolean =>
    x >= 0 && x <= widthCm && y >= 0 && y <= depthCm && paint.groundReflectanceAt(x, y, 0) <= LINE_DARK_MAX_REFLECTANCE;
  const travel = createTravelMeter();
  let movingTicks = 0;
  let onTapeTicks = 0;
  let leftAtS: number | undefined;
  return {
    update(frame, dtS) {
      assertTickS(dtS);
      travel.add(frame, dtS);
      if (leftAtS !== undefined) return;
      if (frame.outOfArena) {
        leftAtS = frame.tS;
        return;
      }
      if (!(frame.robot.speedCmS > MOVING_SPEED_CM_S)) return;
      movingTicks += 1;
      if ((frame.robot.lineSpotsCm ?? []).some(([x, y]) => overTape(x, y))) onTapeTicks += 1;
    },
    result() {
      if (leftAtS !== undefined) return outcome(spec, { passed: false, progress: 0, reasonKey: goalReasons.outOfArena, atS: leftAtS });
      const ratio = movingTicks === 0 ? 0 : onTapeTicks / movingTicks;
      const progress = Math.min(travel.progress, ratio / spec.minRatio);
      if (!travel.enough) return outcome(spec, { passed: false, progress, reasonKey: goalReasons.robotDidNotMove });
      if (ratio >= spec.minRatio) return outcome(spec, { passed: true });
      return outcome(spec, { passed: false, progress, reasonKey: goalReasons.offLine });
    },
  };
}
