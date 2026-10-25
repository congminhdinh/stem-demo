import { createGroundPaint } from '../../world/arena/ground-paint';
import { outcome, type Goal, type GoalContext, type GoalSpec } from './goal';
import { goalReasons } from './reasons';
import { assertTickS } from './tick';
import { createReachMeter } from './travel';

// `stay-on-line`: the share of the distance the robot drives with one of its line-sensor spots over the tape, from the start of the run to
// the end. It passes when the share is at least `minRatio`, provided the robot has got somewhere: it is a guard goal (travel.ts), so a
// robot that never gets MIN_GUARD_TRAVEL_CM from its start has not passed, with `robot-did-not-move`, whatever the share.
//
//   - The share is of the distance, not of the ticks (N18 R5.2a fix round 1, controller ruling): each frame adds `robot.speedCmS · dtS`
//     (the drive's speed, frame.ts, held over the tick) to the distance driven, and to the distance on the tape when a spot is over it.
//     A robot cannot buy the share by crawling on the tape and dashing off it; a robot at rest, or spinning in place (speed 0), adds
//     nothing either way; a speed that is not a positive number adds nothing.
//   - Counted from the first frame: a robot that drives somewhere before it reaches the tape has that distance against it.
//   - A spot is over the tape when the floor under its centre is dark: `groundReflectanceAt` (the paint, as the sensor sees it) of the
//     point is at most LINE_DARK_MAX_REFLECTANCE. The tape reads exactly 0 and a floor or a zone of ordinary colours reads well above
//     the threshold. A spot beyond the edge of the ground reads dark too, but no tape is there, so it does not count.
//   - A robot with no line-sensor spots on the floor is off the tape wherever it drives. With no distance driven the share is 0. Ticks
//     of the same length at the same speed give a share of two whole multiples, the double nearest the true ratio as the author's
//     literal is, so such a run exactly at the ratio passes. The share is the whole run's and moves up and down, so the goal is read after
//     the last frame.

/** The floor under a spot is tape when its reflectance (0 black .. 1 white) is at most this. */
export const LINE_DARK_MAX_REFLECTANCE = 0.25;

export function createStayOnLineGoal(spec: GoalSpec<'stay-on-line'>, ctx: Pick<GoalContext, 'arena'>): Goal {
  const paint = createGroundPaint(ctx.arena);
  const [widthCm, depthCm] = ctx.arena.ground.sizeCm;
  const overTape = (x: number, y: number): boolean =>
    x >= 0 && x <= widthCm && y >= 0 && y <= depthCm && paint.groundReflectanceAt(x, y, 0) <= LINE_DARK_MAX_REFLECTANCE;
  const reach = createReachMeter();
  let drivenCm = 0;
  let onTapeCm = 0;
  let leftAtS: number | undefined;
  return {
    update(frame, dtS) {
      assertTickS(dtS);
      reach.add(frame, dtS);
      if (leftAtS !== undefined) return;
      if (frame.outOfArena) {
        leftAtS = frame.tS;
        return;
      }
      const speed = frame.robot.speedCmS;
      if (!(speed > 0 && Number.isFinite(speed))) return;
      const cm = speed * dtS;
      drivenCm += cm;
      if ((frame.robot.lineSpotsCm ?? []).some(([x, y]) => overTape(x, y))) onTapeCm += cm;
    },
    result() {
      if (leftAtS !== undefined) return outcome(spec, { passed: false, progress: 0, reasonKey: goalReasons.outOfArena, atS: leftAtS });
      const ratio = drivenCm === 0 ? 0 : onTapeCm / drivenCm;
      const progress = Math.min(reach.progress, ratio / spec.minRatio);
      if (!reach.enough) return outcome(spec, { passed: false, progress, reasonKey: goalReasons.robotDidNotMove });
      if (ratio >= spec.minRatio) return outcome(spec, { passed: true });
      return outcome(spec, { passed: false, progress, reasonKey: goalReasons.offLine });
    },
  };
}
