import { outcome, type Goal, type GoalSpec } from './goal';
import { goalReasons, type GoalReasonKey } from './reasons';
import { assertTickS } from './tick';
import { createReachMeter } from './travel';

// `avoid-contact`: fails for good at the first tick on which the robot touches a collider that has the tag, or leaves the arena, whichever
// comes first; passes otherwise, provided the robot has driven. A robot that falls off the table has crashed, so it has not avoided
// anything: `out-of-arena`, at the time it left, like the goals that depend on where things are. On a frame that is both a contact and out
// of the arena, leaving wins. After the first of the two the goal does not change.
//
// It is also a guard goal (travel.ts): a robot that never leaves its place touches nothing, so it passes only once it has been
// MIN_GUARD_TRAVEL_CM from its start (net reach, not the length of its path); before that it has not passed, with `robot-did-not-move`. A failure of its own (contact, out of the arena) is the
// more telling reason, so it comes first. The goal is judged at the end of the run.
//
// A collider has its kind (`wall`, `box`, `cylinder`, `object`) among its tags next to the ones the arena gives it, so `tag: "wall"`
// means every wall. Touching any other collider is allowed.

export function createAvoidContactGoal(spec: GoalSpec<'avoid-contact'>): Goal {
  const reach = createReachMeter();
  let failed: { readonly reasonKey: GoalReasonKey; readonly atS: number } | undefined;
  return {
    update(frame, dtS) {
      assertTickS(dtS);
      reach.add(frame, dtS);
      if (failed !== undefined) return;
      if (frame.outOfArena) {
        failed = { reasonKey: goalReasons.outOfArena, atS: frame.tS };
      } else if (frame.contacts.some((contact) => contact.tags.includes(spec.tag))) {
        failed = { reasonKey: goalReasons.contact, atS: frame.tS };
      }
    },
    result() {
      if (failed !== undefined) return outcome(spec, { passed: false, progress: 0, reasonKey: failed.reasonKey, atS: failed.atS });
      if (!reach.enough) return outcome(spec, { passed: false, progress: reach.progress, reasonKey: goalReasons.robotDidNotMove });
      return outcome(spec, { passed: true });
    },
  };
}
