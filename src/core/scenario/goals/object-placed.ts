import { sameColor, type PaintZone } from '../../world/arena/arena-schema';
import { insidePolygon, zonePolygon } from './geometry';
import { outcome, type Goal, type GoalContext, type GoalResult, type GoalSpec } from './goal';
import type { GoalObject } from './frame';
import {
  arenaObject,
  createCarryWatch,
  createRestWatch,
  firstFailure,
  judgeStep,
  objectOn,
  objectShape,
  reasonsOf,
  shapeInsidePolygon,
  tiltOf,
  type CarryWatch,
  type RestWatch,
} from './object-watch';
import { goalReasons } from './reasons';
import { assertTickS } from './tick';

// `object-placed` (N19 D2, plan §4.5): at the end of the run the object lies in its zone, put there by the gripper. Its zone is `zone`, or,
// with `zoneByColor`, the zone of the colour the object has in this variant (the variant's arena paints it, variants.ts). Judged on the last
// frame, as `object-in-zone` is; the first of these steps that fails is why it has not passed (OBJECT_PLACED_REASONS is their order):
//
//   1. out-of-arena           the robot left the arena (for good, at that time; leaving wins over everything);
//   2. object-still-held      the gripper still holds the object;
//   3. object-pushed          (carried) never carried, and pushed more than `maxSlideCm` from where it started; or carried, and it slid
//      object-never-held      more than `maxSlideCm` on the floor since it was let go (a nudge of up to `maxSlideCm` is allowed). Never carried
//                             and not pushed either: object-never-held. Carried means let go after a grip that lifted it `minCarryLiftCm` and
//                             took it `minCarryCm` while it was up (object-watch.ts): any other grip is no carry, so a push and then a pinch,
//                             or a lift in place, is a push. Together they are the plan's "pushed cube scores 0": no push into a zone counts;
//   4. object-wrong-zone      its middle is in another zone: a named one (`paint.zones[].name`) or one of `zoneByColor`; `detail.zoneId`
//                             names it (the one painted on top);
//   5. object-dropped         its middle is outside its zone, and it was let go outside it (`atS` is when);
//   6. object-moved-out       its middle is outside its zone, though it was let go over it;
//      object-not-in-zone     (without `carried` only) its middle is outside its zone and it was never let go: N18's reason;
//   7. object-partly-in-zone  (fully) its middle is in its zone, but not all of its footprint;
//   8. object-tipped          it leans more than `maxTiltDeg` (the frame's `tiltDeg`; a cube on any face stands);
//   9. object-not-at-rest     in the last `restS` of the run it moved more than REST_MOVE_CM, was held, or the robot touched it.
//
// The middle of the object is in a zone by the point-in-polygon rule of geometry.ts; its footprint is its arena shape at its place and yaw.

/** What the steps judge: the goal's state on the last frame. */
type PlacedView = {
  readonly spec: GoalSpec<'object-placed'>;
  readonly leftAtS: number | undefined;
  readonly carry: CarryWatch;
  readonly rest: RestWatch;
  readonly last: GoalObject | undefined;
  readonly inTarget: boolean;
  readonly wrongZoneId: string | undefined;
  readonly releasedOverTarget: boolean;
  readonly fullyInTarget: () => boolean;
};

const PLACED_STEPS = [
  judgeStep<PlacedView>([goalReasons.outOfArena], (v) => (v.leftAtS === undefined ? null : { reasonKey: goalReasons.outOfArena, atS: v.leftAtS, progress: 0 })),
  judgeStep<PlacedView>([goalReasons.objectStillHeld], (v) => (v.carry.heldNow ? { reasonKey: goalReasons.objectStillHeld, progress: 0.5 } : null)),
  judgeStep<PlacedView>([goalReasons.objectPushed, goalReasons.objectNeverHeld], (v) => {
    if (!v.spec.carried) return null;
    const pushed = v.carry.pushedAtS === undefined ? null : { reasonKey: goalReasons.objectPushed, atS: v.carry.pushedAtS };
    if (!v.carry.carried) return pushed === null ? { reasonKey: goalReasons.objectNeverHeld, progress: 0 } : { ...pushed, progress: 0 };
    return pushed === null ? null : { ...pushed, progress: 0.25 };
  }),
  judgeStep<PlacedView>([goalReasons.objectWrongZone], (v) =>
    v.inTarget || v.wrongZoneId === undefined ? null : { reasonKey: goalReasons.objectWrongZone, zoneId: v.wrongZoneId, progress: 0.25 },
  ),
  judgeStep<PlacedView>([goalReasons.objectDropped], (v) =>
    v.inTarget || v.carry.release === undefined || v.releasedOverTarget ? null : { reasonKey: goalReasons.objectDropped, atS: v.carry.release.tS, progress: 0.25 },
  ),
  judgeStep<PlacedView>([goalReasons.objectMovedOut, goalReasons.objectNotInZone], (v) =>
    v.inTarget ? null : v.carry.release === undefined ? { reasonKey: goalReasons.objectNotInZone, progress: 0 } : { reasonKey: goalReasons.objectMovedOut, progress: 0.25 },
  ),
  judgeStep<PlacedView>([goalReasons.objectPartlyInZone], (v) => (v.spec.fully && !v.fullyInTarget() ? { reasonKey: goalReasons.objectPartlyInZone, progress: 0.75 } : null)),
  judgeStep<PlacedView>([goalReasons.objectTipped], (v) => (tiltOf(v.last!) > v.spec.maxTiltDeg ? { reasonKey: goalReasons.objectTipped, progress: 0.75 } : null)),
  judgeStep<PlacedView>([goalReasons.objectNotAtRest], (v) => (v.rest.atRest() ? null : { reasonKey: goalReasons.objectNotAtRest, progress: 0.75 })),
];

/** Why `object-placed` has not passed, in the order its steps are tried (see the top of this file). */
export const OBJECT_PLACED_REASONS = reasonsOf(PLACED_STEPS);

/** The zone an `object-placed` goal sends an object of `color` to: `zone`, or the zone of that colour (any case); undefined when none. */
export function placedZoneFor(spec: GoalSpec<'object-placed'>, color: string | undefined): string | undefined {
  if (spec.zone !== undefined) return spec.zone;
  return Object.entries(spec.zoneByColor ?? {}).find(([key]) => sameColor(key, color))?.[1];
}

/** The zone an `object-placed` goal sends its object to in this arena (the variant's colours). Throws when there is none. */
export function placedTargetZone(spec: GoalSpec<'object-placed'>, ctx: Pick<GoalContext, 'arena'>): string {
  const color = arenaObject(ctx, spec.object).color;
  const zone = placedZoneFor(spec, color);
  if (zone === undefined) {
    throw new Error(`The goal "${spec.id}" has no zone for the colour of "${spec.object}" (${color ?? 'none'}): the scenario schema should have refused it.`);
  }
  return zone;
}

export function createObjectPlacedGoal(spec: GoalSpec<'object-placed'>, ctx: Pick<GoalContext, 'arena'>): Goal {
  const object = arenaObject(ctx, spec.object);
  const targetId = placedTargetZone(spec, ctx);
  const target = zonePolygon(ctx.arena, targetId);
  // The zones it may end in by mistake, the one painted last first (it lies over the others, so it is what the learner sees there).
  const otherIds = new Set([...(spec.zoneByColor === undefined ? [] : Object.values(spec.zoneByColor))]);
  const others: PaintZone[] = ctx.arena.paint.zones.filter((zone) => zone.id !== targetId && (zone.name !== undefined || otherIds.has(zone.id))).reverse();
  const carry = createCarryWatch(spec.object, spec);
  const rest = createRestWatch(spec.object, spec.restS);
  let last: GoalObject | undefined;
  let releasedOverTarget = false;
  let leftAtS: number | undefined;

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
      const at = last;
      const inTarget = at !== undefined && insidePolygon(target, at.xCm, at.yCm);
      const view: PlacedView = {
        spec,
        leftAtS,
        carry,
        rest,
        last: at,
        inTarget,
        wrongZoneId: inTarget || at === undefined ? undefined : others.find((zone) => insidePolygon(zone.polygonCm, at.xCm, at.yCm))?.id,
        releasedOverTarget,
        fullyInTarget: () => shapeInsidePolygon(target, objectShape(object, at!)),
      };
      const failed = firstFailure(PLACED_STEPS, view);
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
