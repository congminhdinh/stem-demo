import { zonePolygon, insidePolygon } from './geometry';
import { outcome, type Goal, type GoalContext, type GoalSpec } from './goal';
import { goalReasons } from './reasons';
import { assertTickS } from './tick';

// `object-in-zone`: the middle of the object is inside the zone at the end of the run. The state of the last frame is what counts, so
// an object that was in the zone and has been pushed out again does not pass, and one pushed in at the last moment does. An object the
// frame does not have is nowhere.

export function createObjectInZoneGoal(spec: GoalSpec<'object-in-zone'>, ctx: Pick<GoalContext, 'arena'>): Goal {
  const zone = zonePolygon(ctx.arena, spec.zone);
  if (!ctx.arena.objects.some((object) => object.id === spec.object)) {
    const ids = ctx.arena.objects.map((object) => object.id);
    throw new Error(`There is no object "${spec.object}" in the arena (${ids.length > 0 ? `objects: ${ids.join(', ')}` : 'the arena has no objects'}).`);
  }
  let inZone = false;
  let leftAtS: number | undefined;
  return {
    update(frame, dtS) {
      assertTickS(dtS);
      if (leftAtS !== undefined) return;
      if (frame.outOfArena) {
        leftAtS = frame.tS;
        return;
      }
      const pose = Object.hasOwn(frame.objects, spec.object) ? frame.objects[spec.object] : undefined;
      inZone = pose !== undefined && insidePolygon(zone, pose.xCm, pose.yCm);
    },
    result() {
      if (leftAtS !== undefined) return outcome(spec, { passed: false, progress: 0, reasonKey: goalReasons.outOfArena, atS: leftAtS });
      if (inZone) return outcome(spec, { passed: true });
      return outcome(spec, { passed: false, progress: 0, reasonKey: goalReasons.objectNotInZone });
    },
  };
}
