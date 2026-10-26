import { describe, expect, it } from 'vitest';
import { feed, type FrameInit } from './__fixtures__/frames';
import { BASE, ctx, specOf } from './__fixtures__/pick-place';
import { createObjectUnmovedGoal } from './object-unmoved';
import { goalReasons } from './reasons';
import { MIN_GUARD_TRAVEL_CM } from './travel';
import type { GoalObject } from './frame';

// N19 D2 (plan §4.5): `object-unmoved` is a guard: it fails for good on the first frame the object has moved more than maxMoveCm (1 in the
// fixture's base-still) or leans more than maxTiltDeg (20 by default), and passes only once the robot has driven MIN_GUARD_TRAVEL_CM.

const still = specOf('base-still', 'object-unmoved');
const run = (frames: readonly FrameInit[]) => {
  const goal = createObjectUnmovedGoal(still, ctx);
  feed(goal, frames);
  return goal.result();
};
/** The robot at x (it starts at 100 on every frame that does not say), the base moved by (dx, dy, dz). */
const frame = (robotXCm: number, dx = 0, dy = 0, dz = 0, more: Partial<GoalObject> = {}): FrameInit => ({
  xCm: robotXCm,
  objects: { base: { xCm: BASE.xCm + dx, yCm: BASE.yCm + dy, zCm: BASE.zCm + dz, yawDeg: 0, ...more } },
});
const drives = [frame(100), frame(110), frame(120), frame(125)];

describe('object-unmoved', () => {
  it('passes when the robot drove and the object stayed within maxMoveCm, 1 cm itself included', () => {
    expect(MIN_GUARD_TRAVEL_CM).toBe(20);
    expect(run(drives)).toEqual({ id: 'base-still', passed: true, points: 10, progress: 1 });
    expect(run([...drives, frame(125, 0.6, 0.8)])).toMatchObject({ passed: true });
  });

  it('is a guard: met by doing nothing, so it has not passed until the robot has been 20 cm from its start', () => {
    expect(run([frame(100), frame(105), frame(119)])).toEqual({ id: 'base-still', passed: false, points: 0, progress: 0.95, reasonKey: goalReasons.robotDidNotMove });
    expect(run([])).toMatchObject({ reasonKey: goalReasons.robotDidNotMove, progress: 0 });
  });

  it('fails for good at the first frame the object has moved more than maxMoveCm, even when it is put back', () => {
    const moved = [frame(100), frame(110, 0.5), frame(120, 1.2), frame(125, 0), frame(126, 0)];
    expect(run(moved)).toEqual({ id: 'base-still', passed: false, points: 0, progress: 0, reasonKey: goalReasons.objectMoved, atS: 0.5 });
  });

  it('counts a lift as a move: 1.2 cm straight up is more than 1', () => {
    expect(run([...drives, frame(125, 0, 0, 1.2)])).toMatchObject({ reasonKey: goalReasons.objectMoved, atS: 1 });
  });

  it('fails for good when the object leans more than maxTiltDeg (20): object-tipped', () => {
    expect(run([...drives, frame(125, 0, 0, 0, { tiltDeg: 20 })])).toMatchObject({ passed: true });
    expect(run([...drives, frame(125, 0, 0, 0, { tiltDeg: 21 }), frame(125)])).toMatchObject({ reasonKey: goalReasons.objectTipped, atS: 1 });
  });

  it('has moved when the frame no longer has the object', () => {
    expect(run([...drives, { xCm: 125 }])).toMatchObject({ reasonKey: goalReasons.objectMoved, atS: 1 });
  });

  it('fails for good when the robot leaves the arena, leaving winning over a move on the same frame', () => {
    expect(run([frame(100), frame(120), { ...frame(125, 5), outOfArena: true }])).toEqual({
      id: 'base-still',
      passed: false,
      points: 0,
      progress: 0,
      reasonKey: goalReasons.outOfArena,
      atS: 0.5,
    });
  });

  it('refuses an object the arena does not have', () => {
    expect(() => createObjectUnmovedGoal({ ...still, object: 'ball' }, ctx)).toThrow('no object "ball" in the arena');
  });
});
