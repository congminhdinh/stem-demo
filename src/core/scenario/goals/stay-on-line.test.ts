import { describe, expect, it } from 'vitest';
import type { PointCm } from '../../world/arena/arena-schema';
import { base, ctx } from './__fixtures__/context';
import { feed, type FrameInit } from './__fixtures__/frames';
import { goalReasons } from './reasons';
import { createStayOnLineGoal, LINE_DARK_MAX_REFLECTANCE } from './stay-on-line';
import { MIN_GUARD_TRAVEL_CM } from './travel';
import type { GoalSpec } from './goal';

const spec: GoalSpec<'stay-on-line'> = { ...base, kind: 'stay-on-line', minRatio: 0.8 };

// The tape of the fixture runs along y = 40 (x 30..170), 3 cm wide: y 38.5..41.5.
const onTape: PointCm = [100, 40];
const offTape: PointCm = [100, 80];
/** The ticks of `feed`, s. */
const DT_S = 0.25;

type Leg = { spots: readonly PointCm[]; speedCmS?: number; extra?: FrameInit };
/**
 * The frames of a robot that drives along +x from x 30, y 40, at each leg's speed (40 cm/s by default: 10 cm a tick, so three ticks get it
 * farther from its start than the least distance a guard goal needs), with the line-sensor spots each leg gives. The goal reads where the
 * robot is for its reach and the spots for the tape.
 */
function along(legs: readonly Leg[], fromXCm = 30): FrameInit[] {
  let x = fromXCm;
  return legs.map(({ spots, speedCmS = 40, extra = {} }) => {
    const frame: FrameInit = { xCm: x, yCm: 40, speedCmS, lineSpotsCm: spots, ...extra };
    x += speedCmS * DT_S;
    return frame;
  });
}
const legs = (count: number, leg: Leg): Leg[] => Array.from({ length: count }, () => leg);
/** `on` ticks with a spot on the tape and `off` ticks without, all at the same speed. */
const drive = (on: number, off: number): FrameInit[] => along([...legs(on, { spots: [onTape] }), ...legs(off, { spots: [offTape] })]);

describe('stay-on-line', () => {
  it('passes when at least minRatio of the distance driven has a spot over the tape', () => {
    const goal = createStayOnLineGoal(spec, ctx);
    feed(goal, drive(19, 1));
    expect(goal.result()).toEqual({ id: 'goal', passed: true, points: 10, progress: 1 });
  });

  it('passes at exactly minRatio and fails one tick below it', () => {
    const exactly = createStayOnLineGoal(spec, ctx); // 160 of 200 cm = 0.8
    feed(exactly, drive(16, 4));
    expect(exactly.result()).toMatchObject({ passed: true, points: 10 });
    const below = createStayOnLineGoal(spec, ctx); // 150 of 200 cm
    feed(below, drive(15, 5));
    expect(below.result()).toMatchObject({ passed: false, points: 0, reasonKey: goalReasons.offLine });
  });

  // Ticks of the same length: the ratio of two sums of whole centimetres is the double nearest the true ratio, as is the author's literal.
  it.each([
    [0.28, 7, 25],
    [0.55, 55, 100],
    [0.68, 51, 75],
    [0.85, 17, 20],
    [1 / 3, 1, 3],
  ])('is exact at the ratio: minRatio %f with %i of %i equal ticks on the tape passes', (minRatio, on, total) => {
    const goal = createStayOnLineGoal({ ...spec, minRatio }, ctx);
    feed(goal, drive(on, total - on));
    expect(goal.result().passed).toBe(true);
  });

  it('fails one tick below the ratio of those', () => {
    const goal = createStayOnLineGoal({ ...spec, minRatio: 0.28 }, ctx);
    feed(goal, drive(6, 19));
    expect(goal.result()).toMatchObject({ passed: false, reasonKey: goalReasons.offLine });
  });

  // N18 R5.2a fix round 1 (controller ruling): the share is of the distance, Σ speed·dt on the tape over Σ speed·dt, not of the ticks.
  describe('weights every tick by the distance driven on it', () => {
    it('4 ticks of 10 cm on the tape and 4 of 2.5 cm off it is 0.8; 4 of 5 cm off it is 2/3', () => {
      const atRatio = createStayOnLineGoal(spec, ctx);
      feed(atRatio, along([...legs(4, { spots: [onTape] }), ...legs(4, { spots: [offTape], speedCmS: 10 })]));
      expect(atRatio.result()).toMatchObject({ passed: true });
      const under = createStayOnLineGoal(spec, ctx);
      feed(under, along([...legs(4, { spots: [onTape] }), ...legs(4, { spots: [offTape], speedCmS: 20 })]));
      expect(under.result()).toMatchObject({ passed: false, reasonKey: goalReasons.offLine });
      expect(under.result().progress).toBeCloseTo(2 / 3 / 0.8, 12);
    });

    it('is not bought by crawling on the tape: 12 s at 2 cm/s on it, then a 50 cm dash off it, is 24 of 74 cm', () => {
      const goal = createStayOnLineGoal(spec, ctx);
      feed(goal, along([...legs(48, { spots: [onTape], speedCmS: 2 }), ...legs(4, { spots: [offTape], speedCmS: 50 })]));
      // Counted by ticks it would be 48 of 52, 0.92.
      expect(goal.result()).toMatchObject({ passed: false, reasonKey: goalReasons.offLine });
      expect(goal.result().progress).toBeCloseTo(24 / 74 / 0.8, 12);
    });

    it('counts a slow drive by the little distance it covers, however slow', () => {
      const goal = createStayOnLineGoal(spec, ctx);
      feed(goal, along(legs(100, { spots: [onTape], speedCmS: 1 }))); // 25 cm at 1 cm/s, all on the tape
      expect(goal.result()).toEqual({ id: 'goal', passed: true, points: 10, progress: 1 });
    });

    it('counts a robot at rest neither way: its ticks drive no distance', () => {
      const goal = createStayOnLineGoal(spec, ctx);
      feed(goal, [...along(legs(10, { spots: [offTape], speedCmS: 0 })), ...drive(8, 2)]);
      expect(goal.result()).toMatchObject({ passed: true });
    });

    it('takes no distance from a speed that is not a positive number', () => {
      const goal = createStayOnLineGoal(spec, ctx);
      const bad = [Number.NaN, Number.POSITIVE_INFINITY, -40].map((speedCmS) => ({ xCm: 30, yCm: 40, speedCmS, lineSpotsCm: [offTape] }));
      feed(goal, [...bad, ...drive(10, 0)]);
      expect(goal.result()).toMatchObject({ passed: true });
    });
  });

  it('counts from the start of the run: distance driven before the robot reaches the tape is off the tape', () => {
    const goal = createStayOnLineGoal(spec, ctx);
    feed(goal, drive(0, 3).concat(along(legs(9, { spots: [onTape] }), 60))); // 90 of 120 cm = 0.75
    expect(goal.result()).toMatchObject({ passed: false, progress: 0.75 / 0.8 });
  });

  it('is on the tape when any one spot is, however many spots there are', () => {
    const goal = createStayOnLineGoal(spec, ctx);
    feed(goal, along([{ spots: [offTape, onTape, offTape] }, { spots: [[60, 80], onTape] }, { spots: [offTape, [60, 80]] }]));
    expect(goal.result().progress).toBeCloseTo(2 / 3 / 0.8, 12);
  });

  it('is off the tape for a robot without line sensors or without a spot on the floor', () => {
    const goal = createStayOnLineGoal(spec, ctx);
    feed(goal, [...along([{ spots: [] }]), { xCm: 40, yCm: 40, speedCmS: 40 }, ...along([{ spots: [] }], 50)]);
    expect(goal.result()).toMatchObject({ passed: false, progress: 0, reasonKey: goalReasons.offLine });
  });

  it('shows the ratio against the one asked for as its progress', () => {
    const goal = createStayOnLineGoal(spec, ctx);
    feed(goal, drive(12, 8)); // 0.6 of 0.8
    expect(goal.result().progress).toBeCloseTo(0.75, 12);
  });

  it('follows the ratio of the whole run, up and down', () => {
    const goal = createStayOnLineGoal(spec, ctx);
    feed(goal, drive(10, 0));
    expect(goal.result().passed).toBe(true);
    feed(goal, along(legs(5, { spots: [offTape] }), 130), { fromS: 10 }); // 100 of 150 cm
    expect(goal.result().passed).toBe(false);
    feed(goal, along(legs(10, { spots: [onTape] }), 180), { fromS: 20 }); // 200 of 250 cm
    expect(goal.result().passed).toBe(true);
  });

  describe('the tape', () => {
    /** A drive of 25 cm (two frames, 100 cm/s) with the one spot at y. */
    const at = (y: number) => {
      const goal = createStayOnLineGoal(spec, ctx);
      feed(goal, along(legs(2, { spots: [[100, y]], speedCmS: 100 })));
      return goal.result().passed;
    };

    it('is what is dark under the middle of a spot: the edge of the tape is on it, a hair beyond is not', () => {
      expect([at(38.5), at(40), at(41.5)]).toEqual([true, true, true]);
      expect([at(38.4), at(41.6)]).toEqual([false, false]);
    });

    it('is not a light zone painted over the floor', () => {
      const goal = createStayOnLineGoal(spec, ctx);
      feed(goal, along([{ spots: [[150, 80]] }, { spots: [[100, 80]] }, { spots: [[170, 30]] }])); // the floor, the gate zone, the cp-a zone
      expect(goal.result().progress).toBe(0);
    });

    it('is not what lies beyond the edge of the ground, which reads dark too', () => {
      const goal = createStayOnLineGoal(spec, ctx);
      feed(goal, along([{ spots: [[-5, 40]] }, { spots: [[210, 40]] }, { spots: [[100, -1]] }, { spots: [[100, 161]] }]));
      expect(goal.result()).toMatchObject({ passed: false, progress: 0 });
    });

    it('is a dark threshold well below the floor and above the tape', () => {
      expect(LINE_DARK_MAX_REFLECTANCE).toBe(0.25);
    });
  });

  describe('when the robot leaves the arena', () => {
    it('fails for good with the reason, whatever the ratio', () => {
      const goal = createStayOnLineGoal(spec, ctx);
      const frames = drive(31, 0);
      frames[10] = { ...frames[10], outOfArena: true };
      feed(goal, frames, { dtS: 0.5 });
      expect(goal.result()).toEqual({ id: 'goal', passed: false, points: 0, progress: 0, reasonKey: goalReasons.outOfArena, atS: 5 });
    });
  });

  it('has no run to judge before the first tick', () => {
    expect(createStayOnLineGoal(spec, ctx).result()).toEqual({ id: 'goal', passed: false, points: 0, progress: 0, reasonKey: goalReasons.robotDidNotMove });
  });

  // The guard (controller ruling, net reach since R5.2a fix round 1): a goal met by not leaving the tape cannot be met by not leaving the spot.
  describe('the least distance from the start', () => {
    it('is 20 cm', () => {
      expect(MIN_GUARD_TRAVEL_CM).toBe(20);
    });

    it('fails a robot that stands still on the tape, with robot-did-not-move', () => {
      const goal = createStayOnLineGoal(spec, ctx);
      feed(goal, along(legs(40, { spots: [onTape], speedCmS: 0 })));
      expect(goal.result()).toEqual({ id: 'goal', passed: false, points: 0, progress: 0, reasonKey: goalReasons.robotDidNotMove });
    });

    it('fails a robot that drives 1 m back and forth on the tape without getting 20 cm from its start', () => {
      const goal = createStayOnLineGoal(spec, ctx);
      feed(goal, Array.from({ length: 10 }, (_, k) => ({ xCm: k % 2 === 0 ? 100 : 115, yCm: 40, speedCmS: 40, lineSpotsCm: [onTape] })));
      expect(goal.result()).toEqual({ id: 'goal', passed: false, points: 0, progress: 0.75, reasonKey: goalReasons.robotDidNotMove });
    });

    it('passes a robot that drives 25 cm along the tape, at a ratio of 1', () => {
      const goal = createStayOnLineGoal(spec, ctx);
      feed(goal, along(legs(11, { spots: [onTape], speedCmS: 10 }))); // 2.5 cm a tick: the 11th frame is 25 cm from the first
      expect(goal.result()).toEqual({ id: 'goal', passed: true, points: 10, progress: 1 });
    });

    it('fails a robot that gets 19 cm from its start on the tape, at a ratio of 1, and shows how far it got', () => {
      const goal = createStayOnLineGoal(spec, ctx);
      feed(goal, along(legs(9, { spots: [onTape], speedCmS: 9.5 }))); // 2.375 cm a tick: the 9th frame is 19 cm from the first
      expect(goal.result()).toEqual({ id: 'goal', passed: false, points: 0, progress: 19 / 20, reasonKey: goalReasons.robotDidNotMove });
    });

    it('passes at exactly 20 cm, and is not cheated by the rounding of two positions', () => {
      const exact = createStayOnLineGoal(spec, ctx);
      feed(exact, along(legs(3, { spots: [onTape] })));
      expect(exact.result().passed).toBe(true);
      const rounded = createStayOnLineGoal(spec, ctx); // 32.3 − 12.3 is 19.999999999999996
      feed(rounded, [
        { xCm: 12.3, yCm: 40, speedCmS: 40, lineSpotsCm: [onTape] },
        { xCm: 32.3, yCm: 40, speedCmS: 40, lineSpotsCm: [onTape] },
      ]);
      expect(rounded.result().passed).toBe(true);
    });

    it('is checked before the ratio: a robot that did not get far enough and was off the tape fails for the distance', () => {
      const goal = createStayOnLineGoal(spec, ctx);
      feed(goal, along(legs(2, { spots: [offTape] }))); // 10 cm from the start, none on the tape
      expect(goal.result()).toMatchObject({ passed: false, progress: 0, reasonKey: goalReasons.robotDidNotMove });
    });

    it('does not count the fall when the robot leaves the arena: that goal has failed for the arena', () => {
      const goal = createStayOnLineGoal(spec, ctx);
      feed(goal, along([{ spots: [onTape], speedCmS: 100 }, { spots: [onTape], speedCmS: 100, extra: { outOfArena: true } }]));
      expect(goal.result()).toMatchObject({ passed: false, reasonKey: goalReasons.outOfArena });
    });

    it('refuses a tick that is negative or not a number', () => {
      expect(() => feed(createStayOnLineGoal(spec, ctx), drive(1, 0), { dtS: -0.25 })).toThrow(RangeError);
      expect(() => feed(createStayOnLineGoal(spec, ctx), drive(1, 0), { dtS: Number.NaN })).toThrow(RangeError);
    });
  });
});
