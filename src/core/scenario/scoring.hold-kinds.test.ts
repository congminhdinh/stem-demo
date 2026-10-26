import { describe, expect, it } from 'vitest';
import { frameAt, type FrameInit } from './goals/__fixtures__/frames';
import { carryTo, cubeAt, heldAt, scenario } from './goals/__fixtures__/pick-place';
import { goalReasons } from './goals';
import { createScenarioScorer } from './scoring';

// N19 D4, D2 review M8 (plan §4.5): what an end on a contact (endOnContact, every gripper lesson's walls) does to the pick-and-place goals. A
// contact end cuts short a state a goal must hold for a while, and such a goal fails with run-ended-contact (scoring.ts, R6.2); a goal's
// score and verdict never change, only the reason the learner reads.
//   - object-held IS a hold (`holdS`, hold.ts), like stop-in-zone's: a grab the crash cut short reads run-ended-contact, not "not grasped".
//   - object-placed and object-on-object are judged on the last frame: where the object is (pushed, in the wrong zone, dropped, still held,
//     off the base, tipped) is what the learner must read, and stays. Only their rest (`restS`, object-not-at-rest), the part a contact end
//     can cut short, reads run-ended-contact.

const scorerOf = () => createScenarioScorer({ scenario, arena: scenario.arena, program: {} });
const goalsOf = (scorer: ReturnType<typeof scorerOf>) => Object.fromEntries(scorer.result().goals.map((goal) => [goal.id, goal]));
/** Feeds the frames 0.25 s apart, from 0. */
function feed(scorer: ReturnType<typeof scorerOf>, frames: readonly FrameInit[]): void {
  frames.forEach((init, k) => scorer.update(frameAt({ tS: k * 0.25, ...init }), k === 0 ? 0 : 0.25));
}

describe('a contact end and the pick-and-place goals (D2 review M8)', () => {
  it('a grab the contact cut short (held 0.25 s of 0.5 s, lifted) fails with run-ended-contact at the end; without the contact it is "not grasped"', () => {
    const frames = [cubeAt(85, 60), heldAt(85, 60, 2), heldAt(85, 60, 5)];
    const ended = scorerOf();
    feed(ended, frames);
    ended.end({ reason: 'contact', atS: 0.5, tag: 'wall' });
    expect(goalsOf(ended)['grab-cube']).toMatchObject({ passed: false, points: 0, reasonKey: goalReasons.runEndedContact, atS: 0.5 });
    const timedOut = scorerOf();
    feed(timedOut, frames);
    timedOut.end({ reason: 'time-limit', atS: 0.5 });
    expect(goalsOf(timedOut)['grab-cube']).toMatchObject({ passed: false, points: 0, reasonKey: goalReasons.objectNotGrasped });
  });

  it('a grab that passed before the contact keeps its points', () => {
    const scorer = scorerOf();
    feed(scorer, [cubeAt(85, 60), heldAt(85, 60, 5), heldAt(85, 60, 5), heldAt(85, 60, 5), heldAt(90, 60, 5)]);
    scorer.end({ reason: 'contact', atS: 1, tag: 'wall' });
    expect(goalsOf(scorer)['grab-cube']).toMatchObject({ id: 'grab-cube', passed: true, points: 20 });
  });

  it('a cube let go in the drop zone 0.25 s before the contact (not yet at rest for 0.5 s) reads run-ended-contact; at rest, it passes', () => {
    // carryTo lets the cube go at 1.25 s: cut at 1.5 s it has had 0.25 s of its rest.
    const cut = scorerOf();
    feed(cut, carryTo(130, 60).slice(0, 7));
    cut.end({ reason: 'contact', atS: 1.5, tag: 'wall' });
    expect(goalsOf(cut)['place-cube']).toMatchObject({ passed: false, points: 0, reasonKey: goalReasons.runEndedContact, atS: 1.5 });
    const rested = scorerOf();
    feed(rested, carryTo(130, 60));
    rested.end({ reason: 'contact', atS: 2, tag: 'wall' });
    expect(goalsOf(rested)['place-cube']).toMatchObject({ passed: true, points: 20 });
  });

  it('keeps every other reason of the place goals at a contact end: the cube still held, pushed, in the wrong zone, not stacked', () => {
    const held = scorerOf();
    feed(held, [cubeAt(85, 60), heldAt(85, 60, 5), heldAt(130, 60, 5)]);
    held.end({ reason: 'contact', atS: 0.5, tag: 'wall' });
    expect(goalsOf(held)['place-cube']).toMatchObject({ passed: false, reasonKey: goalReasons.objectStillHeld });
    expect(goalsOf(held)['stack-cube']).toMatchObject({ passed: false, reasonKey: goalReasons.objectStillHeld });
    // Pushed 45 cm on the floor into the drop zone, never lifted.
    const pushed = scorerOf();
    feed(pushed, [cubeAt(85, 60), cubeAt(100, 60), cubeAt(115, 60), cubeAt(130, 60), cubeAt(130, 60), cubeAt(130, 60)]);
    pushed.end({ reason: 'contact', atS: 1.25, tag: 'wall' });
    expect(goalsOf(pushed)['place-cube']).toMatchObject({ passed: false, reasonKey: goalReasons.objectPushed });
    // Carried to the green zone and at rest there: wrong zone for place-cube, not stacked on the base.
    const elsewhere = scorerOf();
    feed(elsewhere, carryTo(175, 60));
    elsewhere.end({ reason: 'contact', atS: 2, tag: 'wall' });
    expect(goalsOf(elsewhere)['place-cube']).toMatchObject({ passed: false, reasonKey: goalReasons.objectWrongZone });
    expect(goalsOf(elsewhere)['stack-cube']).toMatchObject({ passed: false, reasonKey: goalReasons.objectNotStacked });
  });

  it('the guard object-unmoved is judged as it goes, a contact end changes nothing of it', () => {
    const scorer = scorerOf();
    feed(scorer, [cubeAt(85, 60), cubeAt(85, 60, {}, { objects: { base: { xCm: 133, yCm: 100, zCm: 2, yawDeg: 0 } } })]);
    const before = goalsOf(scorer)['base-still'];
    scorer.end({ reason: 'contact', atS: 0.25, tag: 'wall' });
    expect(goalsOf(scorer)['base-still']).toEqual(before);
    expect(before).toMatchObject({ passed: false, reasonKey: goalReasons.objectMoved });
  });
});
