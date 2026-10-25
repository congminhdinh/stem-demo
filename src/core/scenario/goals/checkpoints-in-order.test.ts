import { describe, expect, it } from 'vitest';
import { parseArena } from '../../world/arena/arena-schema';
import { base, ctx, inside, nowhere } from './__fixtures__/context';
import { feed } from './__fixtures__/frames';
import { createCheckpointsGoal } from './checkpoints-in-order';
import { goalReasons } from './reasons';
import type { GoalSpec } from './goal';

const route: GoalSpec<'checkpoints-in-order'> = { ...base, kind: 'checkpoints-in-order', zones: ['cp-a', 'cp-b', 'dock'] };
const goalFor = (zones: string[]) => createCheckpointsGoal({ ...route, zones }, ctx);
// The scenario schema refuses a route over zones that overlap; a goal made by hand over them is still judged in a fixed way.
const overlapping = parseArena({
  ground: { sizeCm: [100, 100], color: '#ffffff' },
  paint: {
    zones: [
      { id: 'a', kind: 'checkpoint', polygonCm: [[10, 10], [40, 10], [40, 40], [10, 40]], color: '#ffff00' },
      { id: 'b', kind: 'checkpoint', polygonCm: [[30, 30], [60, 30], [60, 60], [30, 60]], color: '#00ffff' },
    ],
  },
});

describe('checkpoints-in-order', () => {
  it('passes when the zones are entered in the given order, at the time of the last', () => {
    const goal = createCheckpointsGoal({ ...route, points: 20 }, ctx);
    feed(goal, [nowhere, inside['cp-a'], nowhere, inside['cp-b'], nowhere, inside.dock], { dtS: 1 });
    expect(goal.result()).toEqual({ id: 'goal', passed: true, points: 20, progress: 1, atS: 5 });
  });

  it('shows how far along the route the robot is', () => {
    const goal = createCheckpointsGoal(route, ctx);
    expect(goal.result()).toMatchObject({ progress: 0, reasonKey: goalReasons.checkpointMissed });
    feed(goal, [inside['cp-a']]);
    expect(goal.result().progress).toBeCloseTo(1 / 3, 12);
    feed(goal, [nowhere, inside['cp-b']], { fromS: 1 });
    expect(goal.result().progress).toBeCloseTo(2 / 3, 12);
  });

  it('says a checkpoint was missed when the robot just did not go on', () => {
    const goal = createCheckpointsGoal(route, ctx);
    feed(goal, [inside['cp-a'], nowhere, inside['cp-b'], nowhere]);
    expect(goal.result()).toEqual({ id: 'goal', passed: false, points: 0, progress: 2 / 3, reasonKey: goalReasons.checkpointMissed });
  });

  describe('a zone entered before the ones that come first', () => {
    it('does not count, and fails with the reason and the time of that entry when the route is never done', () => {
      const goal = createCheckpointsGoal(route, ctx);
      // the dock first; then cp-a and cp-b in order, and never the dock again
      feed(goal, [inside.dock, nowhere, inside['cp-a'], nowhere, inside['cp-b']], { dtS: 1 });
      expect(goal.result()).toEqual({ id: 'goal', passed: false, points: 0, progress: 2 / 3, reasonKey: goalReasons.checkpointOutOfOrder, atS: 0 });
    });

    it('counts the zone when the robot comes back to it after the others', () => {
      const goal = createCheckpointsGoal(route, ctx);
      feed(goal, [inside.dock, nowhere, inside['cp-a'], nowhere, inside['cp-b'], nowhere, inside.dock], { dtS: 1 });
      expect(goal.result()).toEqual({ id: 'goal', passed: true, points: 10, progress: 1, atS: 6 });
    });

    it('does not count a zone the robot is already in when the zone before it is entered: it has to enter it again', () => {
      // a and b overlap in x 30..40, y 30..40
      const goal = createCheckpointsGoal({ ...route, zones: ['a', 'b'] }, { ...ctx, arena: overlapping });
      feed(goal, [{ xCm: 80, yCm: 80 }, { xCm: 50, yCm: 50 }, { xCm: 35, yCm: 35 }], { dtS: 1 }); // out, in b only, in a and b
      expect(goal.result()).toEqual({ id: 'goal', passed: false, points: 0, progress: 0.5, reasonKey: goalReasons.checkpointOutOfOrder, atS: 1 });
      feed(goal, [{ xCm: 80, yCm: 80 }, { xCm: 50, yCm: 50 }], { dtS: 1, fromS: 3 }); // out, back in b
      expect(goal.result()).toMatchObject({ passed: true, progress: 1, atS: 4 });
    });

    it('is out of order when the second zone comes first and the first never does', () => {
      const goal = createCheckpointsGoal(route, ctx);
      feed(goal, [inside['cp-b'], nowhere, inside['cp-b']], { dtS: 1 });
      expect(goal.result()).toEqual({ id: 'goal', passed: false, points: 0, progress: 0, reasonKey: goalReasons.checkpointOutOfOrder, atS: 0 });
    });

    it('keeps the time of the first out-of-order entry', () => {
      const goal = createCheckpointsGoal(route, ctx);
      feed(goal, [nowhere, inside.dock, nowhere, inside['cp-b'], nowhere], { dtS: 1 });
      expect(goal.result().atS).toBe(1);
    });

    it('flags a zone that comes later than the next one, not only the last', () => {
      const goal = createCheckpointsGoal(route, ctx);
      feed(goal, [inside['cp-a'], inside.dock, nowhere]); // after cp-a the next is cp-b: the dock is later than that
      expect(goal.result()).toMatchObject({ reasonKey: goalReasons.checkpointOutOfOrder, atS: 0.25 });
    });
  });

  it('does not mind a zone that was already counted being entered again', () => {
    const goal = createCheckpointsGoal(route, ctx);
    feed(goal, [inside['cp-a'], nowhere, inside['cp-a'], nowhere, inside['cp-b'], inside['cp-a'], nowhere, inside.dock], { dtS: 1 });
    expect(goal.result()).toMatchObject({ passed: true, atS: 7 });
  });

  it('does not flag a zone that is already counted when it is entered again while the route goes on', () => {
    const goal = createCheckpointsGoal(route, ctx);
    feed(goal, [inside['cp-a'], nowhere, inside['cp-a'], nowhere]);
    expect(goal.result()).toMatchObject({ reasonKey: goalReasons.checkpointMissed });
    expect(goal.result().atS).toBeUndefined();
  });

  it('counts a start inside the first zone as entering it', () => {
    const goal = goalFor(['start', 'dock']);
    feed(goal, [inside.start, nowhere, inside.dock]);
    expect(goal.result()).toMatchObject({ passed: true, atS: 0.5 });
  });

  it('asks for two visits to a zone that is listed twice, one entry each', () => {
    const goal = goalFor(['cp-a', 'dock', 'cp-a']);
    feed(goal, [inside['cp-a'], inside['cp-a'], nowhere, inside.dock]);
    expect(goal.result()).toMatchObject({ passed: false, progress: 2 / 3 });
    feed(goal, [nowhere, inside['cp-a']], { fromS: 1 });
    expect(goal.result()).toMatchObject({ passed: true, progress: 1, atS: 1.25 });
  });

  it('does not take two entries to one when a zone is listed twice in a row', () => {
    const goal = goalFor(['dock', 'dock']);
    feed(goal, [inside.dock, inside.dock]);
    expect(goal.result()).toMatchObject({ passed: false, progress: 0.5 });
    feed(goal, [nowhere, inside.dock], { fromS: 0.5 });
    expect(goal.result()).toMatchObject({ passed: true });
  });

  it('counts zones that overlap and are entered at one instant in the order they are listed', () => {
    const overlap = { xCm: 35, yCm: 35 };
    const inOrder = createCheckpointsGoal({ ...route, zones: ['a', 'b'] }, { ...ctx, arena: overlapping });
    feed(inOrder, [{ xCm: 80, yCm: 80 }, overlap]);
    expect(inOrder.result()).toMatchObject({ passed: true, atS: 0.25 });
    const reversed = createCheckpointsGoal({ ...route, zones: ['b', 'a'] }, { ...ctx, arena: overlapping });
    feed(reversed, [{ xCm: 80, yCm: 80 }, overlap]);
    expect(reversed.result()).toMatchObject({ passed: true, atS: 0.25 });
  });

  it('works for a route of one zone', () => {
    const goal = goalFor(['gate']);
    feed(goal, [nowhere, inside.gate]);
    expect(goal.result()).toMatchObject({ passed: true, atS: 0.25 });
  });

  describe('when the robot leaves the arena', () => {
    it('fails for good with the reason, even if the route would be done after', () => {
      const goal = createCheckpointsGoal(route, ctx);
      feed(goal, [inside['cp-a'], { ...nowhere, outOfArena: true }, inside['cp-b'], inside.dock], { dtS: 1 });
      expect(goal.result()).toEqual({ id: 'goal', passed: false, points: 0, progress: 1 / 3, reasonKey: goalReasons.outOfArena, atS: 1 });
    });

    it('keeps a pass', () => {
      const goal = goalFor(['dock']);
      feed(goal, [inside.dock, { ...nowhere, outOfArena: true }]);
      expect(goal.result()).toMatchObject({ passed: true });
    });
  });

  it('refuses a zone the arena does not have, in any position', () => {
    expect(() => goalFor(['cp-a', 'moon'])).toThrow('no zone "moon"');
  });
});
