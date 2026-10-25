import { describe, expect, it } from 'vitest';
import { base, ctx, inside, nowhere } from './__fixtures__/context';
import { feed } from './__fixtures__/frames';
import { goalReasons } from './reasons';
import { createServoAngleGoal, SERVO_HOLD_S } from './servo-angle';
import type { GoalSpec } from './goal';

const atGate: GoalSpec<'servo-angle'> = { ...base, kind: 'servo-angle', role: 'servo1', minDeg: 80, maxDeg: 100, whenInZone: 'gate' };
const anywhere: GoalSpec<'servo-angle'> = { ...base, kind: 'servo-angle', role: 'servo1', minDeg: 80, maxDeg: 100 };
const open = (deg: number) => ({ ...inside.gate, servoDeg: { servo1: deg } });
const dt = 0.125;

describe('servo-angle in a zone', () => {
  it('holds for half a second', () => {
    expect(SERVO_HOLD_S).toBe(0.5);
  });

  it('passes when the angle is in range for 0.5 s while the robot is in the zone, on the frame that is 0.5 s after the first', () => {
    const goal = createServoAngleGoal(atGate, ctx);
    feed(goal, Array.from({ length: 4 }, () => open(90)), { dtS: dt, fromS: 3 }); // 3, 3.125, 3.25, 3.375 s
    expect(goal.result()).toEqual({ id: 'goal', passed: false, points: 0, progress: 0.75, reasonKey: goalReasons.servoNotSetInZone });
    feed(goal, [open(90)], { dtS: dt, fromS: 3.5 });
    expect(goal.result()).toEqual({ id: 'goal', passed: true, points: 10, progress: 1, atS: 3.5 });
  });

  it('takes both ends of the range as in range', () => {
    const run = (deg: number) => {
      const goal = createServoAngleGoal(atGate, ctx);
      feed(goal, Array.from({ length: 5 }, () => open(deg)), { dtS: dt });
      return goal.result().passed;
    };
    expect([run(80), run(90), run(100)]).toEqual([true, true, true]);
    expect([run(79.99), run(100.01), run(0), run(180)]).toEqual([false, false, false, false]);
  });

  it('starts over when the angle leaves the range for one frame', () => {
    const goal = createServoAngleGoal(atGate, ctx);
    feed(goal, [open(90), open(90), open(90), open(90), open(120), open(90), open(90), open(90), open(90)], { dtS: dt }); // 4 frames since the break
    expect(goal.result()).toMatchObject({ passed: false, progress: 0.75 });
    feed(goal, [open(90)], { dtS: dt, fromS: 9 * dt });
    expect(goal.result()).toMatchObject({ passed: true, atS: 9 * dt });
  });

  it('starts over when the robot leaves the zone for one frame', () => {
    const goal = createServoAngleGoal(atGate, ctx);
    feed(goal, [open(90), open(90), { ...nowhere, servoDeg: { servo1: 90 } }, open(90), open(90), open(90), open(90)], { dtS: dt });
    expect(goal.result()).toMatchObject({ passed: false, progress: 0.75 });
    feed(goal, [open(90)], { dtS: dt, fromS: 7 * dt });
    expect(goal.result()).toMatchObject({ passed: true, atS: 7 * dt });
  });

  it('does not pass for the right angle outside the zone, and says the servo was not set in the zone', () => {
    const goal = createServoAngleGoal(atGate, ctx);
    feed(goal, Array.from({ length: 20 }, () => ({ ...nowhere, servoDeg: { servo1: 90 } })), { dtS: dt });
    expect(goal.result()).toMatchObject({ passed: false, progress: 0, reasonKey: goalReasons.servoNotSetInZone });
  });

  it('does not pass for the zone with the wrong angle', () => {
    const goal = createServoAngleGoal(atGate, ctx);
    feed(goal, Array.from({ length: 20 }, () => open(0)), { dtS: dt });
    expect(goal.result().passed).toBe(false);
  });

  it('keeps a pass when the servo moves again after it', () => {
    const goal = createServoAngleGoal(atGate, ctx);
    feed(goal, [...Array.from({ length: 5 }, () => open(90)), open(0), nowhere], { dtS: dt });
    expect(goal.result()).toMatchObject({ passed: true, atS: 0.5 });
  });

  it('reads the servo of its role only; a servo the frame lacks is out of range', () => {
    const goal = createServoAngleGoal(atGate, ctx);
    feed(goal, Array.from({ length: 6 }, () => ({ ...inside.gate, servoDeg: { servo2: 90 } })), { dtS: dt });
    expect(goal.result().passed).toBe(false);
    feed(goal, Array.from({ length: 6 }, () => ({ ...inside.gate })), { dtS: dt, fromS: 1 });
    expect(goal.result().passed).toBe(false);
  });

  describe('when the robot leaves the arena', () => {
    it('fails for good with the reason', () => {
      const goal = createServoAngleGoal(atGate, ctx);
      feed(goal, [open(90), { ...open(90), outOfArena: true }, ...Array.from({ length: 8 }, () => open(90))], { dtS: dt });
      expect(goal.result()).toEqual({ id: 'goal', passed: false, points: 0, progress: 0, reasonKey: goalReasons.outOfArena, atS: dt });
    });
  });

  it('refuses a zone the arena does not have, and a tick that is not a time', () => {
    expect(() => createServoAngleGoal({ ...atGate, whenInZone: 'moon' }, ctx)).toThrow('no zone "moon"');
    expect(() => feed(createServoAngleGoal(atGate, ctx), [open(90)], { dtS: -0.1 })).toThrow(RangeError);
  });
});

describe('servo-angle without a zone', () => {
  // The 0.5 s of the hold applies here as well: the angle has to be held, wherever the robot is.
  const at = (deg: number, xCm = 100, yCm = 80) => ({ xCm, yCm, servoDeg: { servo1: deg } });
  const held = (deg: number, ticks: number) => Array.from({ length: ticks }, () => at(deg));

  it('passes when the angle is in range for 0.5 s, on the frame that is 0.5 s after the first', () => {
    const goal = createServoAngleGoal(anywhere, ctx);
    feed(goal, held(90, 4), { dtS: dt, fromS: 3 }); // 3, 3.125, 3.25, 3.375 s
    expect(goal.result()).toEqual({ id: 'goal', passed: false, points: 0, progress: 0.75, reasonKey: goalReasons.servoOutOfRange });
    feed(goal, held(90, 1), { dtS: dt, fromS: 3.5 });
    expect(goal.result()).toEqual({ id: 'goal', passed: true, points: 10, progress: 1, atS: 3.5 });
  });

  it('fails an angle that is set only on the final tick', () => {
    const goal = createServoAngleGoal(anywhere, ctx);
    feed(goal, [...held(0, 8), at(90)], { dtS: dt });
    expect(goal.result()).toEqual({ id: 'goal', passed: false, points: 0, progress: 0, reasonKey: goalReasons.servoOutOfRange });
    feed(goal, [at(90), at(90), at(90)], { dtS: dt, fromS: 9 * dt }); // still short of the 0.5 s: 3 more frames make 0.375 s
    expect(goal.result()).toMatchObject({ passed: false, progress: 0.75 });
  });

  it('keeps a pass for an angle that was held for 0.5 s at any time and moved afterwards', () => {
    const goal = createServoAngleGoal(anywhere, ctx);
    feed(goal, [...held(0, 3), ...held(90, 5), at(0), at(120), at(179)], { dtS: dt });
    expect(goal.result()).toEqual({ id: 'goal', passed: true, points: 10, progress: 1, atS: 7 * dt });
  });

  it('starts over when the angle leaves the range for one frame', () => {
    const goal = createServoAngleGoal(anywhere, ctx);
    feed(goal, [...held(90, 4), at(120), ...held(90, 4)], { dtS: dt }); // 4 frames since the break: 0.375 s
    expect(goal.result()).toMatchObject({ passed: false, progress: 0.75 });
    feed(goal, held(90, 1), { dtS: dt, fromS: 9 * dt });
    expect(goal.result()).toMatchObject({ passed: true, atS: 9 * dt });
  });

  it('does not care where the robot is: it can drive while the servo is held', () => {
    const goal = createServoAngleGoal(anywhere, ctx);
    feed(goal, [at(90, 10, 10), at(90, 50, 20), at(90, 120, 90), at(90, 190, 150), at(90, 30, 130)], { dtS: dt });
    expect(goal.result()).toMatchObject({ passed: true, atS: 4 * dt });
  });

  it('takes both ends of the range', () => {
    const run = (deg: number) => {
      const goal = createServoAngleGoal(anywhere, ctx);
      feed(goal, held(deg, 5), { dtS: dt });
      return goal.result().passed;
    };
    expect([run(80), run(100)]).toEqual([true, true]);
    expect([run(79.999), run(100.001)]).toEqual([false, false]);
  });

  it('has not passed before the first frame, and a servo the frame lacks is out of range', () => {
    expect(createServoAngleGoal(anywhere, ctx).result()).toMatchObject({ passed: false, progress: 0, reasonKey: goalReasons.servoOutOfRange });
    const goal = createServoAngleGoal(anywhere, ctx);
    feed(goal, Array.from({ length: 8 }, () => ({ servoDeg: { servo2: 90 } })), { dtS: dt });
    expect(goal.result().passed).toBe(false);
  });

  describe('when the robot leaves the arena', () => {
    it('fails for good with the reason if the hold was not done', () => {
      const goal = createServoAngleGoal(anywhere, ctx);
      feed(goal, [at(90), at(90), { ...at(90), outOfArena: true }, ...held(90, 10)], { dtS: dt });
      expect(goal.result()).toEqual({ id: 'goal', passed: false, points: 0, progress: 0, reasonKey: goalReasons.outOfArena, atS: 2 * dt });
    });

    it('keeps a pass', () => {
      const goal = createServoAngleGoal(anywhere, ctx);
      feed(goal, [...held(90, 5), { ...at(0), outOfArena: true }], { dtS: dt });
      expect(goal.result()).toMatchObject({ passed: true, atS: 0.5 });
    });
  });

  it('refuses a tick that is not a time', () => {
    expect(() => feed(createServoAngleGoal(anywhere, ctx), [at(90)], { dtS: -0.1 })).toThrow(RangeError);
  });
});
