import type { PaintZone } from '../../world/arena/arena-schema';
import { insidePolygon, zonePolygon } from './geometry';
import { outcome, type Goal, type GoalContext, type GoalResult, type GoalSpec } from './goal';
import { arenaObject, createCarryWatch, createRestWatch, objectOn, objectShape, shapeInsidePolygon, tiltOf } from './object-watch';
import type { GoalObject } from './frame';
import { goalReasons, type GoalReasonKey } from './reasons';
import { assertTickS } from './tick';

// `object-placed` (N19 D2, plan §4.5): at the end of the run the object lies in its zone, put there by the gripper. Its zone is `zone`, or,
// with `zoneByColor`, the zone of the colour the object has in this variant (the variant's arena paints it, variants.ts). Judged on the last
// frame, as `object-in-zone` is; the first of these that applies is why it has not passed (OBJECT_PLACED_REASONS, in order):
//
//   1. out-of-arena           the robot left the arena (for good, at that time; leaving wins over everything);
//   2. object-still-held      the gripper still holds the object;
//   3. object-pushed          (carried) never held, and pushed more than `maxSlideCm` from where it started; or let go, and it slid more than
//      object-never-held      `maxSlideCm` on the floor since (a nudge of up to `maxSlideCm` is allowed). Never held and not pushed either:
//                             object-never-held. Together they are the plan's "pushed cube scores 0": no push or nudge into a zone counts;
//   4. object-wrong-zone      its middle is in another zone: a named one (`paint.zones[].name`) or one of `zoneByColor`; `detail.zoneId`
//                             names it (the one painted on top);
//   5. object-dropped         its middle is outside its zone, and it was let go outside it (`atS` is when);
//   6. object-moved-out       its middle is outside its zone, though it was let go over it;
//   7. object-partly-in-zone  (fully) its middle is in its zone, but not all of its footprint;
//   8. object-tipped          it leans more than `maxTiltDeg` (the frame's `tiltDeg`; a cube on any face stands);
//   9. object-not-at-rest     in the last `restS` of the run it moved more than REST_MOVE_CM, was held, or the robot touched it.
//
// Without `carried` step 3 is skipped and an object never held and not in its zone has not passed with `object-not-in-zone`. The middle of the
// object is in a zone by the point-in-polygon rule of geometry.ts; its footprint is its arena shape at its place and yaw on the frame.

/** Why `object-placed` has not passed, in the order it asks (see the top of this file). */
export const OBJECT_PLACED_REASONS: readonly GoalReasonKey[] = [
  goalReasons.outOfArena,
  goalReasons.objectStillHeld,
  goalReasons.objectPushed,
  goalReasons.objectNeverHeld,
  goalReasons.objectWrongZone,
  goalReasons.objectDropped,
  goalReasons.objectMovedOut,
  goalReasons.objectPartlyInZone,
  goalReasons.objectTipped,
  goalReasons.objectNotAtRest,
];

/** The zone an `object-placed` goal sends its object to in this arena: `zone`, or the zone of the object's colour. Throws when there is none. */
export function placedTargetZone(spec: GoalSpec<'object-placed'>, ctx: Pick<GoalContext, 'arena'>): string {
  if (spec.zone !== undefined) return spec.zone;
  const color = arenaObject(ctx, spec.object).color;
  const entry = Object.entries(spec.zoneByColor ?? {}).find(([key]) => color !== undefined && key.toLowerCase() === color.toLowerCase());
  if (entry === undefined) {
    throw new Error(`The goal "${spec.id}" has no zone for the colour of "${spec.object}" (${color ?? 'none'}): the scenario schema should have refused it.`);
  }
  return entry[1];
}

export function createObjectPlacedGoal(spec: GoalSpec<'object-placed'>, ctx: Pick<GoalContext, 'arena'>): Goal {
  const object = arenaObject(ctx, spec.object);
  const targetId = placedTargetZone(spec, ctx);
  const target = zonePolygon(ctx.arena, targetId);
  // The zones it may end in by mistake, the one painted last first (it lies over the others, so it is what the learner sees there).
  const otherIds = new Set([...(spec.zoneByColor === undefined ? [] : Object.values(spec.zoneByColor))]);
  const others: PaintZone[] = ctx.arena.paint.zones.filter((zone) => zone.id !== targetId && (zone.name !== undefined || otherIds.has(zone.id))).reverse();
  const carry = createCarryWatch(spec.object, spec.maxSlideCm);
  const rest = createRestWatch(spec.object, spec.restS);
  let last: GoalObject | undefined;
  let releasedOverTarget = false;
  let leftAtS: number | undefined;

  type Failure = { reasonKey: GoalReasonKey; atS?: number; zoneId?: string; progress: number };
  const failure = (): Failure | null => {
    if (leftAtS !== undefined) return { reasonKey: goalReasons.outOfArena, atS: leftAtS, progress: 0 };
    if (carry.heldNow) return { reasonKey: goalReasons.objectStillHeld, progress: 0.5 };
    if (spec.carried && !carry.everHeld) {
      return carry.pushedAtS === undefined ? { reasonKey: goalReasons.objectNeverHeld, progress: 0 } : { reasonKey: goalReasons.objectPushed, atS: carry.pushedAtS, progress: 0 };
    }
    if (spec.carried && carry.pushedAtS !== undefined) return { reasonKey: goalReasons.objectPushed, atS: carry.pushedAtS, progress: 0.25 };
    const inTarget = last !== undefined && insidePolygon(target, last.xCm, last.yCm);
    if (!inTarget) {
      const wrong = last === undefined ? undefined : others.find((zone) => insidePolygon(zone.polygonCm, last!.xCm, last!.yCm));
      if (wrong !== undefined) return { reasonKey: goalReasons.objectWrongZone, zoneId: wrong.id, progress: 0.25 };
      if (carry.release === undefined) return { reasonKey: goalReasons.objectNotInZone, progress: 0 };
      return releasedOverTarget ? { reasonKey: goalReasons.objectMovedOut, progress: 0.25 } : { reasonKey: goalReasons.objectDropped, atS: carry.release.tS, progress: 0.25 };
    }
    if (spec.fully && !shapeInsidePolygon(target, objectShape(object, last!))) return { reasonKey: goalReasons.objectPartlyInZone, progress: 0.75 };
    if (tiltOf(last!) > spec.maxTiltDeg) return { reasonKey: goalReasons.objectTipped, progress: 0.75 };
    if (!rest.atRest()) return { reasonKey: goalReasons.objectNotAtRest, progress: 0.75 };
    return null;
  };

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
      last = objectOn(frame, spec.object);
      // Let go on this frame: over its zone or not.
      if (carry.release !== undefined && carry.release.tS === frame.tS) releasedOverTarget = insidePolygon(target, carry.release.xCm, carry.release.yCm);
    },
    result(): GoalResult {
      const failed = failure();
      if (failed === null) return outcome(spec, { passed: true });
      return outcome(spec, {
        passed: false,
        progress: failed.progress,
        reasonKey: failed.reasonKey,
        ...(failed.atS === undefined ? {} : { atS: failed.atS }),
        ...(failed.zoneId === undefined ? {} : { detail: { zoneId: failed.zoneId } }),
      });
    },
  };
}
