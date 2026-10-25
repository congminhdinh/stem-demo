import { describe, expect, it } from 'vitest';
import type { PointCm } from '../../world/arena/arena-schema';
import { base, ctx } from './__fixtures__/context';
import { feed, type FrameInit } from './__fixtures__/frames';
import { goalReasons } from './reasons';
import { createStayOnLineGoal, LINE_DARK_MAX_REFLECTANCE, MOVING_SPEED_CM_S } from './stay-on-line';
import { MIN_GUARD_TRAVEL_CM } from './travel';
import type { GoalSpec } from './goal';

const spec: GoalSpec<'stay-on-line'> = { ...base, kind: 'stay-on-line', minRatio: 0.8 };

// The tape of the fixture runs along y = 40 (x 30..170), 3 cm wide: y 38.5..41.5.
const onTape: PointCm = [100, 40];
const offTape: PointCm = [100, 80];
// 40 cm/s over the 0.25 s ticks of `feed` is 10 cm a tick: three ticks are more than the least path a guard goal needs.
const driving = { speedCmS: 40 };
const tick = (spots: readonly PointCm[], extra: FrameInit = {}): FrameInit => ({ ...driving, lineSpotsCm: spots, ...extra });
/** `on` ticks with a spot on the tape and `off` ticks without, all moving. */
const drive = (on: number, off: number): FrameInit[] => [
  ...Array.from({ length: on }, () => tick([onTape])),
  ...Array.from({ length: off }, () => tick([offTape])),
];

describe('stay-on-line', () => {
  it('passes when at least minRatio of the moving ticks have a spot over the tape', () => {
    const goal = createStayOnLineGoal(spec, ctx);
    feed(goal, drive(19, 1));
    expect(goal.result()).toEqual({ id: 'goal', passed: true, points: 10, progress: 1 });
  });

  it('passes at exactly minRatio and fails one tick below it', () => {
    const exactly = createStayOnLineGoal(spec, ctx); // 16 of 20 = 0.8
    feed(exactly, drive(16, 4));
    expect(exactly.result()).toMatchObject({ passed: true, points: 10 });
    const below = createStayOnLineGoal(spec, ctx); // 15 of 20
    feed(below, drive(15, 5));
    expect(below.result()).toMatchObject({ passed: false, points: 0, reasonKey: goalReasons.offLine });
  });

  // 0.28 * 25 is 7.000000000000001 in doubles: a test of `on >= minRatio * total` would fail a run that is exactly at the ratio.
  it.each([
    [0.28, 7, 25],
    [0.55, 55, 100],
    [0.68, 51, 75],
    [0.85, 17, 20],
    [1 / 3, 1, 3],
  ])('is exact at the ratio: minRatio %f with %i of %i ticks on the tape passes', (minRatio, on, total) => {
    const goal = createStayOnLineGoal({ ...spec, minRatio }, ctx);
    feed(goal, drive(on, total - on));
    expect(goal.result().passed).toBe(true);
  });

  it('fails one tick below the ratio of those', () => {
    const goal = createStayOnLineGoal({ ...spec, minRatio: 0.28 }, ctx);
    feed(goal, drive(6, 19));
    expect(goal.result()).toMatchObject({ passed: false, reasonKey: goalReasons.offLine });
  });

  it('counts only ticks that are moving: a robot is moving above 1 cm/s', () => {
    expect(MOVING_SPEED_CM_S).toBe(1);
    const goal = createStayOnLineGoal(spec, ctx);
    // 10 ticks at rest off the tape, 4 at exactly 1 cm/s off the tape: none counts
    feed(goal, [...Array.from({ length: 10 }, () => tick([offTape], { speedCmS: 0 })), ...Array.from({ length: 4 }, () => tick([offTape], { speedCmS: 1 }))]);
    expect(goal.result()).toMatchObject({ passed: false, reasonKey: goalReasons.robotDidNotMove, progress: 0 });
    feed(goal, drive(8, 2), { fromS: 10 }); // then 10 moving ticks, 8 on the tape
    expect(goal.result()).toMatchObject({ passed: true });
    feed(goal, [tick([offTape], { speedCmS: 1.01 })], { fromS: 20 }); // 8 of 11 = 0.727: just above 1 cm/s counts
    expect(goal.result()).toMatchObject({ passed: false, reasonKey: goalReasons.offLine });
  });

  it('counts from the start of the run: ticks before the robot reaches the tape are off the tape', () => {
    const goal = createStayOnLineGoal(spec, ctx);
    feed(goal, [...drive(0, 3), ...drive(9, 0)]); // 9 of 12 = 0.75
    expect(goal.result()).toMatchObject({ passed: false, progress: 0.75 / 0.8 });
  });

  it('is on the tape when any one spot is, however many spots there are', () => {
    const goal = createStayOnLineGoal(spec, ctx);
    feed(goal, [tick([offTape, onTape, offTape]), tick([[60, 80], onTape]), tick([offTape, [60, 80]])]);
    expect(goal.result().progress).toBeCloseTo(2 / 3 / 0.8, 12);
  });

  it('is off the tape for a robot without line sensors or without a spot on the floor', () => {
    const goal = createStayOnLineGoal(spec, ctx);
    feed(goal, [tick([]), { ...driving }, tick([])]);
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
    feed(goal, drive(0, 5), { fromS: 10 }); // 10 of 15
    expect(goal.result().passed).toBe(false);
    feed(goal, drive(10, 0), { fromS: 20 }); // 20 of 25
    expect(goal.result().passed).toBe(true);
  });

  describe('the tape', () => {
    it('is what is dark under the middle of a spot: the edge of the tape is on it, a hair beyond is not', () => {
      const at = (y: number) => {
        const goal = createStayOnLineGoal(spec, ctx);
        feed(goal, [tick([[100, y]], { speedCmS: 100 })]); // one tick of 25 cm
        return goal.result().passed;
      };
      expect([at(38.5), at(40), at(41.5)]).toEqual([true, true, true]);
      expect([at(38.4), at(41.6)]).toEqual([false, false]);
    });

    it('is not a light zone painted over the floor', () => {
      const goal = createStayOnLineGoal(spec, ctx);
      feed(goal, [tick([[150, 80]]), tick([[100, 80]]), tick([[170, 30]])]); // the floor, the gate zone, the cp-a zone
      expect(goal.result().progress).toBe(0);
    });

    it('is not what lies beyond the edge of the ground, which reads dark too', () => {
      const goal = createStayOnLineGoal(spec, ctx);
      feed(goal, [tick([[-5, 40]]), tick([[210, 40]]), tick([[100, -1]]), tick([[100, 161]])]);
      expect(goal.result()).toMatchObject({ passed: false, progress: 0 });
    });

    it('is a dark threshold well below the floor and above the tape', () => {
      expect(LINE_DARK_MAX_REFLECTANCE).toBe(0.25);
    });
  });

  describe('when the robot leaves the arena', () => {
    it('fails for good with the reason, whatever the ratio', () => {
      const goal = createStayOnLineGoal(spec, ctx);
      feed(goal, [...drive(10, 0), tick([onTape], { outOfArena: true }), ...drive(20, 0)], { dtS: 0.5 });
      expect(goal.result()).toEqual({ id: 'goal', passed: false, points: 0, progress: 0, reasonKey: goalReasons.outOfArena, atS: 5 });
    });
  });

  it('has no run to judge before the first tick', () => {
    expect(createStayOnLineGoal(spec, ctx).result()).toEqual({ id: 'goal', passed: false, points: 0, progress: 0, reasonKey: goalReasons.robotDidNotMove });
  });

  it('counts a robot that crawls below the moving speed as never on the tape, however far it goes', () => {
    const goal = createStayOnLineGoal(spec, ctx);
    feed(goal, Array.from({ length: 100 }, () => tick([onTape], { speedCmS: 1 })), { dtS: 0.25 }); // 25 cm at 1 cm/s
    expect(goal.result()).toMatchObject({ passed: false, progress: 0, reasonKey: goalReasons.offLine });
  });

  // The guard (controller ruling): a goal that is met by not leaving the tape cannot be met by not leaving the spot.
  describe('the least path', () => {
    it('is 20 cm', () => {
      expect(MIN_GUARD_TRAVEL_CM).toBe(20);
    });

    it('fails a robot that stands still on the tape, with robot-did-not-move', () => {
      const goal = createStayOnLineGoal(spec, ctx);
      feed(goal, Array.from({ length: 40 }, () => tick([onTape], { speedCmS: 0 })));
      expect(goal.result()).toEqual({ id: 'goal', passed: false, points: 0, progress: 0, reasonKey: goalReasons.robotDidNotMove });
    });

    it('passes a robot that drives 25 cm on the tape, at a ratio of 1', () => {
      const goal = createStayOnLineGoal(spec, ctx);
      feed(goal, Array.from({ length: 10 }, () => tick([onTape], { speedCmS: 10 }))); // 10 ticks of 2.5 cm
      expect(goal.result()).toEqual({ id: 'goal', passed: true, points: 10, progress: 1 });
    });

    it('fails a robot that drives 19 cm on the tape, at a ratio of 1, and shows how far it got', () => {
      const goal = createStayOnLineGoal(spec, ctx);
      feed(goal, Array.from({ length: 8 }, () => tick([onTape], { speedCmS: 9.5 }))); // 8 ticks of 2.375 cm
      expect(goal.result()).toEqual({ id: 'goal', passed: false, points: 0, progress: 19 / 20, reasonKey: goalReasons.robotDidNotMove });
    });

    it('passes at exactly 20 cm, and is not cheated by the rounding of a long sum', () => {
      const exact = createStayOnLineGoal(spec, ctx);
      feed(exact, Array.from({ length: 8 }, () => tick([onTape], { speedCmS: 10 })));
      expect(exact.result().passed).toBe(true);
      const long = createStayOnLineGoal(spec, ctx); // 100 ticks of 0.2 cm add up to 19.99999999999996
      feed(long, Array.from({ length: 100 }, () => tick([onTape], { speedCmS: 2 })), { dtS: 0.1 });
      expect(long.result().passed).toBe(true);
    });

    it('is checked before the ratio: a robot that drove too little and was off the tape fails for the distance', () => {
      const goal = createStayOnLineGoal(spec, ctx);
      feed(goal, Array.from({ length: 4 }, () => tick([offTape], { speedCmS: 10 }))); // 10 cm, none on the tape
      expect(goal.result()).toMatchObject({ passed: false, progress: 0, reasonKey: goalReasons.robotDidNotMove });
    });

    it('does not count the fall when the robot leaves the arena: that goal has failed for the arena', () => {
      const goal = createStayOnLineGoal(spec, ctx);
      feed(goal, [tick([onTape], { speedCmS: 100 }), tick([onTape], { speedCmS: 100, outOfArena: true })]);
      expect(goal.result()).toMatchObject({ passed: false, reasonKey: goalReasons.outOfArena });
    });

    it('refuses a tick that is negative or not a number', () => {
      expect(() => feed(createStayOnLineGoal(spec, ctx), [tick([onTape])], { dtS: -0.25 })).toThrow(RangeError);
      expect(() => feed(createStayOnLineGoal(spec, ctx), [tick([onTape])], { dtS: Number.NaN })).toThrow(RangeError);
    });
  });
});
