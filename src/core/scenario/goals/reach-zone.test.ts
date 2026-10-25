import { describe, expect, it } from 'vitest';
import { base, ctx, inside, nowhere } from './__fixtures__/context';
import { feed, frameAt } from './__fixtures__/frames';
import { goalReasons } from './reasons';
import { createReachZoneGoal } from './reach-zone';
import type { GoalSpec } from './goal';

const spec: GoalSpec<'reach-zone'> = { ...base, kind: 'reach-zone', zone: 'dock' };

describe('reach-zone', () => {
  it('has not passed before the robot is in the zone, and says why', () => {
    const goal = createReachZoneGoal(spec, ctx);
    expect(goal.result()).toEqual({ id: 'goal', passed: false, points: 0, progress: 0, reasonKey: goalReasons.zoneNotReached });
    feed(goal, [nowhere, inside.start, inside.gate]);
    expect(goal.result()).toEqual({ id: 'goal', passed: false, points: 0, progress: 0, reasonKey: goalReasons.zoneNotReached });
  });

  it('passes the first tick the middle of the robot is in the zone, with the points and the time', () => {
    const goal = createReachZoneGoal({ ...spec, points: 35 }, ctx);
    feed(goal, [nowhere, nowhere, inside.dock], { dtS: 0.5 });
    expect(goal.result()).toEqual({ id: 'goal', passed: true, points: 35, progress: 1, atS: 1 });
  });

  it('keeps a pass when the robot touches the zone and leaves it again', () => {
    const goal = createReachZoneGoal(spec, ctx);
    feed(goal, [nowhere, inside.dock, nowhere, inside.start, nowhere], { dtS: 0.5 });
    expect(goal.result()).toEqual({ id: 'goal', passed: true, points: 10, progress: 1, atS: 0.5 });
  });

  it('passes on the first frame when the robot starts in the zone', () => {
    const goal = createReachZoneGoal(spec, ctx);
    feed(goal, [inside.dock]);
    expect(goal.result().atS).toBe(0);
  });

  it('judges the middle of the robot, not its footprint: a robot that overlaps the zone but whose middle is out has not reached it', () => {
    const goal = createReachZoneGoal(spec, ctx);
    feed(goal, [{ xCm: 54, yCm: 120 }]); // the footprint (radius 10) reaches x 44..64: 6 cm into the zone, the middle 4 cm out
    expect(goal.result().passed).toBe(false);
  });

  it('takes the lower and left edges of the zone in and the upper and right edges out, as the paint does', () => {
    const at = (xCm: number, yCm: number) => {
      const goal = createReachZoneGoal(spec, ctx); // dock: x 10..50, y 100..140
      feed(goal, [{ xCm, yCm }]);
      return goal.result().passed;
    };
    expect([at(10, 120), at(30, 100), at(10, 100)]).toEqual([true, true, true]);
    expect([at(50, 120), at(30, 140), at(50, 140)]).toEqual([false, false, false]);
  });

  describe('when the robot leaves the arena', () => {
    it('fails for good, at the time it left, with the reason', () => {
      const goal = createReachZoneGoal(spec, ctx);
      feed(goal, [nowhere, { ...nowhere, outOfArena: true }, inside.dock, inside.dock], { dtS: 0.5 });
      expect(goal.result()).toEqual({ id: 'goal', passed: false, points: 0, progress: 0, reasonKey: goalReasons.outOfArena, atS: 0.5 });
    });

    it('does not take a pass back', () => {
      const goal = createReachZoneGoal(spec, ctx);
      feed(goal, [inside.dock, { ...nowhere, outOfArena: true }]);
      expect(goal.result()).toMatchObject({ passed: true, points: 10, atS: 0 });
    });

    it('fails a frame that is both out of the arena and in the zone: the robot is not on the ground', () => {
      const goal = createReachZoneGoal(spec, ctx);
      feed(goal, [{ ...inside.dock, outOfArena: true }]);
      expect(goal.result()).toMatchObject({ passed: false, reasonKey: goalReasons.outOfArena });
    });
  });

  it('refuses a zone the arena does not have', () => {
    expect(() => createReachZoneGoal({ ...spec, zone: 'moon' }, ctx)).toThrow('no zone "moon"');
  });

  it('answers the same without being asked: result() changes nothing', () => {
    const goal = createReachZoneGoal(spec, ctx);
    goal.update(frameAt({ ...inside.dock, tS: 3 }), 0.25);
    expect(goal.result()).toEqual(goal.result());
  });
});
