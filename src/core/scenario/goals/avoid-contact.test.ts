import { describe, expect, it } from 'vitest';
import { base, nowhere } from './__fixtures__/context';
import { feed } from './__fixtures__/frames';
import { createAvoidContactGoal } from './avoid-contact';
import { goalReasons } from './reasons';
import type { GoalSpec } from './goal';

const spec: GoalSpec<'avoid-contact'> = { ...base, kind: 'avoid-contact', tag: 'obstacle' };
const wall = { otherId: '#wall-0', tags: ['wall'] };
const block = { otherId: 'block', tags: ['box', 'obstacle', 'jitter'] };
const pole = { otherId: 'pole', tags: ['cylinder', 'obstacle', 'jitter'] };

describe('avoid-contact', () => {
  it('passes while nothing is touched, even before the run starts', () => {
    const goal = createAvoidContactGoal(spec);
    expect(goal.result()).toEqual({ id: 'goal', passed: true, points: 10, progress: 1 });
    feed(goal, [nowhere, nowhere, nowhere]);
    expect(goal.result()).toEqual({ id: 'goal', passed: true, points: 10, progress: 1 });
  });

  it('fails for good at the first contact with a collider that has the tag, with the reason and the time', () => {
    const goal = createAvoidContactGoal(spec);
    feed(goal, [nowhere, { contacts: [block] }, { contacts: [] }, { contacts: [pole] }, nowhere], { dtS: 0.5 });
    expect(goal.result()).toEqual({ id: 'goal', passed: false, points: 0, progress: 0, reasonKey: goalReasons.contact, atS: 0.5 });
  });

  it('fails on a touch that lasts only one tick, and does not pass again when the robot moves away', () => {
    const goal = createAvoidContactGoal(spec);
    feed(goal, [{ contacts: [pole] }, nowhere, nowhere]);
    expect(goal.result()).toMatchObject({ passed: false, atS: 0 });
  });

  it('ignores contact with a collider that does not have the tag', () => {
    const goal = createAvoidContactGoal(spec);
    feed(goal, [{ contacts: [wall] }, { contacts: [wall, { otherId: 'crate', tags: ['object', 'pushable'] }] }]);
    expect(goal.result()).toEqual({ id: 'goal', passed: true, points: 10, progress: 1 });
  });

  it('finds the tag among several colliders touched at once', () => {
    const goal = createAvoidContactGoal(spec);
    feed(goal, [{ contacts: [wall, block] }]);
    expect(goal.result()).toMatchObject({ passed: false, reasonKey: goalReasons.contact, atS: 0 });
  });

  it('knows a collider by its kind as well as by the tags the arena gives it', () => {
    const goal = createAvoidContactGoal({ ...spec, tag: 'wall' });
    feed(goal, [{ contacts: [block] }, { contacts: [wall] }]);
    expect(goal.result()).toMatchObject({ passed: false, atS: 0.25 });
  });

  it('matches the whole tag, not a part of it', () => {
    const goal = createAvoidContactGoal(spec);
    feed(goal, [{ contacts: [{ otherId: 'x', tags: ['obstacles', 'obstac', 'Obstacle', 'my-obstacle'] }] }]);
    expect(goal.result().passed).toBe(true);
  });

  it('is not a spatial goal: leaving the arena without touching anything does not fail it', () => {
    const goal = createAvoidContactGoal(spec);
    feed(goal, [nowhere, { ...nowhere, outOfArena: true }]);
    expect(goal.result()).toMatchObject({ passed: true, points: 10 });
  });
});
