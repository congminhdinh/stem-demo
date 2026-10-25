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

  // N18 R5.2a fix round 3 (controller ruling): the goal is judged at the end of the run, on the last frame it was given, not kept once met.
  describe('at the end of the run', () => {
    it('passes a robot that is still stopped in the zone, with the time its stop was complete', () => {
      const goal = createStopInZoneGoal(spec, ctx);
      feed(goal, parked(25)); // stopped from 0 s, complete at 1 s, still stopped at 6 s
      expect(goal.result()).toEqual({ id: 'goal', passed: true, points: 10, progress: 1, atS: 1 });
    });

    it('does not pass a robot that stopped in the zone and drove off: what counts is where it is at the end', () => {
      const goal = createStopInZoneGoal(spec, ctx);
      feed(goal, [...parked(5), nowhere, { ...inside.dock, speedCmS: 30 }]);
      expect(goal.result()).toEqual({ id: 'goal', passed: false, points: 0, progress: 0, reasonKey: goalReasons.notStoppedInZone });
    });

    it('passes a robot that drove off and stopped in the zone again, with the time of its last stop', () => {
      const goal = createStopInZoneGoal(spec, ctx);
      feed(goal, [...parked(5), nowhere, nowhere, ...parked(6)]); // the second stop starts at 1.75 s, complete at 2.75 s
      expect(goal.result()).toMatchObject({ passed: true, atS: 2.75 });
    });

    it('does not pass a run that ends before the stop is complete: one frame short of holdS', () => {
      const goal = createStopInZoneGoal(spec, ctx);
      feed(goal, [nowhere, ...parked(4)]); // stopped from 0.25 s, 0.75 s old at the last frame
      expect(goal.result()).toMatchObject({ passed: false, progress: 0.75, reasonKey: goalReasons.notStoppedInZone });
    });

    it('does not take a robot that creeps through the zone, above maxSpeedCmS, as stopped, however slow (R5.2a review)', () => {
      const goal = createStopInZoneGoal({ ...spec, maxSpeedCmS: 0.5 }, ctx);
      feed(goal, Array.from({ length: 40 }, (_, k) => ({ xCm: 20 + 0.25 * k, yCm: 120, speedCmS: 1 }))); // 10 s at 1 cm/s across the dock
      expect(goal.result()).toMatchObject({ passed: false, progress: 0, reasonKey: goalReasons.notStoppedInZone });
    });
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

    it('fails a robot that had stopped in the zone and then left the arena: it is not stopped in the zone at the end', () => {
      const goal = createStopInZoneGoal(spec, ctx);
      feed(goal, [...parked(5), { ...stopped, outOfArena: true }]);
      expect(goal.result()).toEqual({ id: 'goal', passed: false, points: 0, progress: 0, reasonKey: goalReasons.outOfArena, atS: 1.25 });
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
