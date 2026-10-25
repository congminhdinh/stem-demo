import { outcome, type Goal, type GoalSpec } from './goal';
import { goalReasons } from './reasons';

// `avoid-contact`: fails for good at the first tick on which the robot touches a collider that has the tag; passes otherwise.
//
// A collider has its kind (`wall`, `box`, `cylinder`, `object`) among its tags next to the ones the arena gives it, so `tag: "wall"`
// means every wall. Touching any other collider is allowed, as is leaving the arena: this goal is about what the robot hits, and a
// robot that falls off the table has missed the goals that need the table. It has not touched anything, so it has not failed this one.

export function createAvoidContactGoal(spec: GoalSpec<'avoid-contact'>): Goal {
  let touchedAtS: number | undefined;
  return {
    update(frame) {
      if (touchedAtS !== undefined) return;
      if (frame.contacts.some((contact) => contact.tags.includes(spec.tag))) touchedAtS = frame.tS;
    },
    result() {
      if (touchedAtS === undefined) return outcome(spec, { passed: true });
      return outcome(spec, { passed: false, progress: 0, reasonKey: goalReasons.contact, atS: touchedAtS });
    },
  };
}
