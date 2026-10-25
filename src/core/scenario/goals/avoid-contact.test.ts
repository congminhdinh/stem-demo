import { describe, expect, it } from 'vitest';
import { base, nowhere } from './__fixtures__/context';
import { feed, type FrameInit } from './__fixtures__/frames';
import { createAvoidContactGoal } from './avoid-contact';
import { goalReasons } from './reasons';
import type { GoalSpec } from './goal';

const spec: GoalSpec<'avoid-contact'> = { ...base, kind: 'avoid-contact', tag: 'obstacle' };
const wall = { otherId: '#wall-0', tags: ['wall'] };
const block = { otherId: 'block', tags: ['box', 'obstacle', 'jitter'] };
const pole = { otherId: 'pole', tags: ['cylinder', 'obstacle', 'jitter'] };

// 40 cm/s over the 0.25 s ticks of `feed` is 10 cm a tick. `cruise` drives along +x from `nowhere`, so its third frame is 20 cm from the
// first: the least distance from the start a guard goal needs (net reach, R5.2a fix round 1). A lone `cruising` frame stays at `nowhere`.
const cruising: FrameInit = { ...nowhere, speedCmS: 40 };
const cruise = (ticks: number, extra: FrameInit = {}): FrameInit[] =>
  Array.from({ length: ticks }, (_, k) => ({ ...cruising, xCm: nowhere.xCm + 10 * k, ...extra }));

describe('avoid-contact', () => {
  it('passes a robot that has driven and has touched nothing', () => {
    const goal = createAvoidContactGoal(spec);
    feed(goal, cruise(5));
    expect(goal.result()).toEqual({ id: 'goal', passed: true, points: 10, progress: 1 });
  });

  it('fails for good at the first contact with a collider that has the tag, with the reason and the time', () => {
    const goal = createAvoidContactGoal(spec);
    feed(goal, [cruising, { ...cruising, contacts: [block] }, { ...cruising, contacts: [] }, { ...cruising, contacts: [pole] }, cruising], { dtS: 0.5 });
    expect(goal.result()).toEqual({ id: 'goal', passed: false, points: 0, progress: 0, reasonKey: goalReasons.contact, atS: 0.5 });
  });

  it('fails on a touch that lasts only one tick, and does not pass again when the robot moves away', () => {
    const goal = createAvoidContactGoal(spec);
    feed(goal, [{ ...cruising, contacts: [pole] }, ...cruise(10)]);
    expect(goal.result()).toMatchObject({ passed: false, atS: 0 });
  });

  it('says contact, not that the robot did not move, when a robot that has hardly moved touched the tag', () => {
    const goal = createAvoidContactGoal(spec);
    feed(goal, [{ ...nowhere, contacts: [block] }]);
    expect(goal.result()).toEqual({ id: 'goal', passed: false, points: 0, progress: 0, reasonKey: goalReasons.contact, atS: 0 });
  });

  it('ignores contact with a collider that does not have the tag', () => {
    const goal = createAvoidContactGoal(spec);
    feed(goal, cruise(3, { contacts: [wall, { otherId: 'crate', tags: ['object', 'pushable'] }] }));
    expect(goal.result()).toEqual({ id: 'goal', passed: true, points: 10, progress: 1 });
  });

  it('finds the tag among several colliders touched at once', () => {
    const goal = createAvoidContactGoal(spec);
    feed(goal, [{ ...cruising, contacts: [wall, block] }]);
    expect(goal.result()).toMatchObject({ passed: false, reasonKey: goalReasons.contact, atS: 0 });
  });

  it('knows a collider by its kind as well as by the tags the arena gives it', () => {
    const goal = createAvoidContactGoal({ ...spec, tag: 'wall' });
    feed(goal, [{ ...cruising, contacts: [block] }, { ...cruising, contacts: [wall] }]);
    expect(goal.result()).toMatchObject({ passed: false, atS: 0.25 });
  });

  it('matches the whole tag, not a part of it', () => {
    const goal = createAvoidContactGoal(spec);
    feed(goal, cruise(3, { contacts: [{ otherId: 'x', tags: ['obstacles', 'obstac', 'Obstacle', 'my-obstacle'] }] }));
    expect(goal.result().passed).toBe(true);
  });

  describe('when the robot leaves the arena', () => {
    it('fails for good, at the time it left, with the reason: a robot that falls off the table has crashed', () => {
      const goal = createAvoidContactGoal(spec);
      feed(goal, [...cruise(2), { ...cruising, outOfArena: true }, ...cruise(10)], { dtS: 0.5 });
      expect(goal.result()).toEqual({ id: 'goal', passed: false, points: 0, progress: 0, reasonKey: goalReasons.outOfArena, atS: 1 });
    });

    it('fails a robot that left the arena before it had driven the least path', () => {
      const goal = createAvoidContactGoal(spec);
      feed(goal, [{ ...nowhere, outOfArena: true }]);
      expect(goal.result()).toMatchObject({ passed: false, reasonKey: goalReasons.outOfArena, atS: 0 });
    });

    it('keeps the contact when the robot touched the tag before it left', () => {
      const goal = createAvoidContactGoal(spec);
      feed(goal, [cruising, { ...cruising, contacts: [block] }, { ...cruising, outOfArena: true }], { dtS: 0.5 });
      expect(goal.result()).toMatchObject({ passed: false, reasonKey: goalReasons.contact, atS: 0.5 });
    });

    it('keeps leaving the arena as the reason when the robot touched the tag after it', () => {
      const goal = createAvoidContactGoal(spec);
      feed(goal, [cruising, { ...cruising, outOfArena: true }, { ...cruising, contacts: [block] }], { dtS: 0.5 });
      expect(goal.result()).toMatchObject({ passed: false, reasonKey: goalReasons.outOfArena, atS: 0.5 });
    });

    it('says leaving the arena on a frame that is also a contact', () => {
      const goal = createAvoidContactGoal(spec);
      feed(goal, [{ ...cruising, outOfArena: true, contacts: [block] }]);
      expect(goal.result()).toMatchObject({ reasonKey: goalReasons.outOfArena, atS: 0 });
    });
  });

  // The guard (controller ruling; net reach since R5.2a fix round 1): a robot that touches nothing because it never left its place, or
  // only wandered about it, has not earned the goal.
  describe('the least distance from the start', () => {
    it('fails a robot that stands still, with robot-did-not-move', () => {
      const goal = createAvoidContactGoal(spec);
      feed(goal, Array.from({ length: 40 }, () => ({ ...nowhere, speedCmS: 0 })));
      expect(goal.result()).toEqual({ id: 'goal', passed: false, points: 0, progress: 0, reasonKey: goalReasons.robotDidNotMove });
    });

    it('has not passed before the first frame', () => {
      expect(createAvoidContactGoal(spec).result()).toEqual({ id: 'goal', passed: false, points: 0, progress: 0, reasonKey: goalReasons.robotDidNotMove });
    });

    it('passes a robot that gets 25 cm from its start and fails one that gets 19 cm', () => {
      const far = createAvoidContactGoal(spec);
      feed(far, Array.from({ length: 11 }, (_, k) => ({ ...nowhere, xCm: nowhere.xCm + 2.5 * k, speedCmS: 10 })));
      expect(far.result()).toEqual({ id: 'goal', passed: true, points: 10, progress: 1 });
      const short = createAvoidContactGoal(spec);
      feed(short, Array.from({ length: 9 }, (_, k) => ({ ...nowhere, xCm: nowhere.xCm + 2.375 * k, speedCmS: 9.5 })));
      expect(short.result()).toEqual({ id: 'goal', passed: false, points: 0, progress: 19 / 20, reasonKey: goalReasons.robotDidNotMove });
    });

    it('passes at exactly 20 cm', () => {
      const goal = createAvoidContactGoal(spec);
      feed(goal, cruise(3));
      expect(goal.result().passed).toBe(true);
    });

    it('fails a robot that drives a long path without getting 20 cm away: back and forth, or wiggling on the spot', () => {
      const wiggle = createAvoidContactGoal(spec);
      feed(wiggle, Array.from({ length: 200 }, (_, k) => ({ ...nowhere, xCm: nowhere.xCm + (k % 2 === 0 ? 0 : 18), yCm: nowhere.yCm + (k % 4 < 2 ? 0 : 5), speedCmS: 72 })));
      expect(wiggle.result()).toMatchObject({ passed: false, reasonKey: goalReasons.robotDidNotMove });
      expect(wiggle.result().progress).toBeCloseTo(Math.hypot(18, 5) / 20, 12);
    });

    it('refuses a tick that is negative or not a number', () => {
      expect(() => feed(createAvoidContactGoal(spec), [cruising], { dtS: -0.25 })).toThrow(RangeError);
      expect(() => feed(createAvoidContactGoal(spec), [cruising], { dtS: Number.NaN })).toThrow(RangeError);
    });
  });
});
