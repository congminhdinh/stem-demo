import { describe, expect, it } from 'vitest';
import { base, ctx, inside, nowhere } from './__fixtures__/context';
import { feed } from './__fixtures__/frames';
import { goalReasons } from './reasons';
import { createStopInZoneGoal } from './stop-in-zone';
import type { GoalSpec } from './goal';

const spec: GoalSpec<'stop-in-zone'> = { ...base, kind: 'stop-in-zone', zone: 'dock', maxSpeedCmS: 2, holdS: 1 };
const stopped = { ...inside.dock, speedCmS: 0 };
const parked = (n: number) => Array.from({ length: n }, () => stopped);

describe('stop-in-zone', () => {
  describe('the hold', () => {
    it('passes on the frame that is holdS after the first frame of the stop, not before', () => {
      const goal = createStopInZoneGoal(spec, ctx);
      // frames 0.25 s apart, the first at t = 5: the stop holds from 5 s, so it is 1 s old at 6 s, the 5th frame
      feed(goal, parked(4), { fromS: 5 });
      expect(goal.result()).toEqual({ id: 'goal', passed: false, points: 0, progress: 0.75, reasonKey: goalReasons.notStoppedInZone });
      feed(goal, parked(1), { fromS: 6 });
      expect(goal.result()).toEqual({ id: 'goal', passed: true, points: 10, progress: 1, atS: 6 });
    });

    it('does not credit the tick that ends on the first frame: a hold of one tick takes two frames', () => {
      const goal = createStopInZoneGoal({ ...spec, holdS: 0.25 }, ctx);
      feed(goal, parked(1), { fromS: 1 });
      expect(goal.result().passed).toBe(false);
      feed(goal, parked(1), { fromS: 1.25 });
      expect(goal.result()).toMatchObject({ passed: true, atS: 1.25 });
    });

    it('rounds nothing to a stop that is exactly as long as asked: ten ticks of 0.1 s are a second', () => {
      const goal = createStopInZoneGoal(spec, ctx);
      feed(goal, parked(11), { dtS: 0.1 });
      expect(goal.result()).toMatchObject({ passed: true });
    });

    it('starts over when the robot goes faster than the limit, for one frame', () => {
      const goal = createStopInZoneGoal(spec, ctx);
      feed(goal, [...parked(4), { ...inside.dock, speedCmS: 2.5 }, ...parked(4)]); // the second stop is 4 frames old at 2 s
      expect(goal.result()).toMatchObject({ passed: false, progress: 0.75 });
      feed(goal, parked(1), { fromS: 2.25 });
      expect(goal.result()).toMatchObject({ passed: true, atS: 2.25 });
    });

    it('starts over when the robot leaves the zone, for one frame', () => {
      const goal = createStopInZoneGoal(spec, ctx);
      feed(goal, [...parked(4), nowhere, ...parked(4)]);
      expect(goal.result()).toMatchObject({ passed: false, progress: 0.75 });
      feed(goal, parked(1), { fromS: 2.25 });
      expect(goal.result()).toMatchObject({ passed: true, atS: 2.25 });
    });

    it('shows no progress when the stop is broken', () => {
      const goal = createStopInZoneGoal(spec, ctx);
      feed(goal, [...parked(3), nowhere]);
      expect(goal.result().progress).toBe(0);
    });
  });

  describe('the limits', () => {
    it('takes a speed equal to maxSpeedCmS as stopped and a hair above it as moving', () => {
      const run = (speedCmS: number) => {
        const goal = createStopInZoneGoal({ ...spec, holdS: 0.25 }, ctx);
        feed(goal, [{ ...inside.dock, speedCmS }, { ...inside.dock, speedCmS }]);
        return goal.result().passed;
      };
      expect([run(0), run(2)]).toEqual([true, true]);
      expect([run(2.0001), run(5)]).toEqual([false, false]);
    });

    it('wants the middle of the robot in the zone, with the zone edges of the paint', () => {
      const run = (xCm: number, yCm: number) => {
        const goal = createStopInZoneGoal({ ...spec, holdS: 0.25 }, ctx); // dock: x 10..50, y 100..140
        feed(goal, [{ xCm, yCm }, { xCm, yCm }]);
        return goal.result().passed;
      };
      expect([run(10, 120), run(30, 100)]).toEqual([true, true]);
      expect([run(50, 120), run(30, 140), run(54, 120)]).toEqual([false, false, false]);
    });
  });

  it('keeps a pass: the robot may drive off after it', () => {
    const goal = createStopInZoneGoal(spec, ctx);
    feed(goal, [...parked(5), nowhere, { ...inside.dock, speedCmS: 30 }]);
    expect(goal.result()).toEqual({ id: 'goal', passed: true, points: 10, progress: 1, atS: 1 });
  });

  it('does not pass a robot that crosses the zone without stopping, and says it did not stop', () => {
    const goal = createStopInZoneGoal(spec, ctx);
    feed(goal, [nowhere, { ...inside.dock, speedCmS: 20 }, { ...inside.dock, speedCmS: 20 }, nowhere]);
    expect(goal.result()).toMatchObject({ passed: false, progress: 0, reasonKey: goalReasons.notStoppedInZone });
  });

  describe('when the robot leaves the arena', () => {
    it('fails for good with the reason', () => {
      const goal = createStopInZoneGoal(spec, ctx);
      feed(goal, [...parked(2), { ...stopped, outOfArena: true }, ...parked(10)]);
      expect(goal.result()).toEqual({ id: 'goal', passed: false, points: 0, progress: 0, reasonKey: goalReasons.outOfArena, atS: 0.5 });
    });

    it('keeps a pass', () => {
      const goal = createStopInZoneGoal(spec, ctx);
      feed(goal, [...parked(5), { ...stopped, outOfArena: true }]);
      expect(goal.result()).toMatchObject({ passed: true, atS: 1 });
    });
  });

  it('refuses a tick that is negative or not a number', () => {
    const goal = createStopInZoneGoal(spec, ctx);
    expect(() => feed(goal, [stopped], { dtS: -1 })).toThrow(RangeError);
    expect(() => feed(goal, [stopped], { dtS: Number.NaN })).toThrow(RangeError);
  });

  it('refuses a zone the arena does not have', () => {
    expect(() => createStopInZoneGoal({ ...spec, zone: 'moon' }, ctx)).toThrow('no zone "moon"');
  });
});
