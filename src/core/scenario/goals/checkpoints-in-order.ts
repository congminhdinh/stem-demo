import { zonePolygon, insidePolygon } from './geometry';
import { outcome, type Goal, type GoalContext, type GoalSpec } from './goal';
import { goalReasons } from './reasons';
import { assertTickS } from './tick';

// `checkpoints-in-order`: the zones must be entered in the order they are listed.
//
// What counts is an entry: the middle of the robot is in the zone on this frame and was not on the one before (on the first frame, it
// was nowhere before). Staying in a zone is not entering it again. Each frame, the zone that is next on the list is counted if it was
// entered, and so on down the list for zones entered on the same frame. A zone listed twice in a row takes two entries.
//
// The scenario schema refuses a route whose zones overlap (scenario-schema.ts), so two zones of a route are not entered at one instant
// except by a jump across a frame. A goal made by hand over zones that do overlap is still judged in a fixed way, and the tests hold it:
// the zones entered on one frame count in the order they are listed, and one the robot was already in is not entered again.
//
// A zone entered before the ones that come first is not counted. It does not spoil the route: the robot can go on and come back to it.
// Entering a zone that was already counted is harmless. When the route is never done, `checkpoint-out-of-order` is the reason if any
// zone was entered out of order (its `atS` is the first such entry), and `checkpoint-missed` if the robot just did not go through them.
// `progress` is the share of the list counted.

export function createCheckpointsGoal(spec: GoalSpec<'checkpoints-in-order'>, ctx: Pick<GoalContext, 'arena'>): Goal {
  const zones = spec.zones;
  const polygons = new Map(zones.map((id) => [id, zonePolygon(ctx.arena, id)] as const));
  const wasInside = new Map<string, boolean>();
  let next = 0;
  let outOfOrderAtS: number | undefined;
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
      const entered = new Set<string>();
      for (const [id, polygon] of polygons) {
        const inside = insidePolygon(polygon, frame.robot.xCm, frame.robot.yCm);
        if (inside && wasInside.get(id) !== true) entered.add(id);
        wasInside.set(id, inside);
      }
      const used = new Set<string>();
      while (next < zones.length && entered.has(zones[next]!) && !used.has(zones[next]!)) {
        used.add(zones[next]!);
        next += 1;
      }
      if (next === zones.length) {
        passedAtS = frame.tS;
        return;
      }
      if (outOfOrderAtS === undefined) {
        const counted = new Set(zones.slice(0, next));
        for (const id of entered) {
          if (!counted.has(id)) {
            outOfOrderAtS = frame.tS;
            break;
          }
        }
      }
    },
    result() {
      if (passedAtS !== undefined) return outcome(spec, { passed: true, atS: passedAtS });
      const progress = next / zones.length;
      if (leftAtS !== undefined) return outcome(spec, { passed: false, progress, reasonKey: goalReasons.outOfArena, atS: leftAtS });
      if (outOfOrderAtS !== undefined) {
        return outcome(spec, { passed: false, progress, reasonKey: goalReasons.checkpointOutOfOrder, atS: outOfOrderAtS });
      }
      return outcome(spec, { passed: false, progress, reasonKey: goalReasons.checkpointMissed });
    },
  };
}
