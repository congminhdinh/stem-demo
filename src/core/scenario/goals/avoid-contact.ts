import { outcome, type Goal, type GoalSpec } from './goal';
import { goalReasons } from './reasons';
import { createTravelMeter } from './travel';

// `avoid-contact`: fails for good at the first tick on which the robot touches a collider that has the tag; passes otherwise, provided
// the robot has driven. It is a guard goal (travel.ts): a robot that never leaves its place touches nothing, so it passes only after a
// path of MIN_GUARD_TRAVEL_CM; before that it has not passed, with `robot-did-not-move`. A contact is the more telling reason, so it
// comes first: a robot that touched the tag has failed with `contact` however far it went. The goal is judged at the end of the run.
//
// A collider has its kind (`wall`, `box`, `cylinder`, `object`) among its tags next to the ones the arena gives it, so `tag: "wall"`
// means every wall. Touching any other collider is allowed, as is leaving the arena: this goal is about what the robot hits, and a
// robot that falls off the table has missed the goals that need the table. It has not touched anything, so it has not failed this one.

export function createAvoidContactGoal(spec: GoalSpec<'avoid-contact'>): Goal {
  const travel = createTravelMeter();
  let touchedAtS: number | undefined;
  return {
    update(frame, dtS) {
      travel.add(frame, dtS);
      if (touchedAtS !== undefined) return;
      if (frame.contacts.some((contact) => contact.tags.includes(spec.tag))) touchedAtS = frame.tS;
    },
    result() {
      if (touchedAtS !== undefined) return outcome(spec, { passed: false, progress: 0, reasonKey: goalReasons.contact, atS: touchedAtS });
      if (!travel.enough) return outcome(spec, { passed: false, progress: travel.progress, reasonKey: goalReasons.robotDidNotMove });
      return outcome(spec, { passed: true });
    },
  };
}
