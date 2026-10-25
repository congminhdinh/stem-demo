import { describe, expect, it } from 'vitest';
import type { PointCm } from '../../world/arena/arena-schema';
import { base, ctx } from './__fixtures__/context';
import { feed, type FrameInit } from './__fixtures__/frames';
import { goalReasons } from './reasons';
import { createStayOnLineGoal, LINE_DARK_MAX_REFLECTANCE, MOVING_SPEED_CM_S } from './stay-on-line';
import type { GoalSpec } from './goal';

const spec: GoalSpec<'stay-on-line'> = { ...base, kind: 'stay-on-line', minRatio: 0.8 };

// The tape of the fixture runs along y = 40 (x 30..170), 3 cm wide: y 38.5..41.5.
const onTape: PointCm = [100, 40];
const offTape: PointCm = [100, 80];
const driving = { speedCmS: 10 };
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
    expect(goal.result()).toMatchObject({ passed: false, reasonKey: goalReasons.neverMoved, progress: 0 });
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
        feed(goal, [tick([[100, y]])]);
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
    expect(createStayOnLineGoal(spec, ctx).result()).toEqual({ id: 'goal', passed: false, points: 0, progress: 0, reasonKey: goalReasons.neverMoved });
  });
});
