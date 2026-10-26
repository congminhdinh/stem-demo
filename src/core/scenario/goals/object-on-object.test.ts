import { describe, expect, it } from 'vitest';
import { feed, type FrameInit } from './__fixtures__/frames';
import { BASE, carryTo, ctx, cubeAt, heldAt, ON_BASE_Z, specOf } from './__fixtures__/pick-place';
import { createObjectOnObjectGoal, OBJECT_ON_OBJECT_REASONS, STACK_Z_TOLERANCE_CM } from './object-on-object';
import { goalReasons } from './reasons';
import type { GoalSpec } from './goal';

// N19 D2 (plan §4.5): `object-on-object` at the end of the run. The fixture's stack-cube puts the 4 cm cube on the 6 × 6 × 4 cm base at
// 130, 100 (its middle 2 cm up): resting on it, the cube's middle is at 2 + 2 + 2 = 6 cm. maxOffsetCm 1.5, maxTiltDeg 10, restS 0.5.

const stack = specOf('stack-cube', 'object-on-object');
const run = (frames: readonly FrameInit[], spec: GoalSpec<'object-on-object'> = stack) => {
  const goal = createObjectOnObjectGoal(spec, ctx);
  feed(goal, frames);
  return goal.result();
};
const onBase = (dx = 0, dy = 0, zCm = ON_BASE_Z) => carryTo(BASE.xCm + dx, BASE.yCm + dy, zCm);
/** `onBase`, then the cube left at its last place with `more`. */
const onBaseThen = (more: Parameters<typeof cubeAt>[2], extra: FrameInit = {}) => [
  ...onBase().slice(0, 6),
  ...[1, 2, 3].map(() => cubeAt(BASE.xCm, BASE.yCm, { zCm: ON_BASE_Z, ...more }, extra)),
];

describe('object-on-object', () => {
  it('passes when the gripper put the top on the bottom, near its middle, upright and still', () => {
    expect(run(onBase())).toEqual({ id: 'stack-cube', passed: true, points: 20, progress: 1 });
  });

  it('gives its reasons in this order', () => {
    expect(OBJECT_ON_OBJECT_REASONS).toEqual([
      'robot.goal.reason.out-of-arena',
      'robot.goal.reason.object-still-held',
      'robot.goal.reason.object-pushed',
      'robot.goal.reason.object-never-held',
      'robot.goal.reason.object-not-stacked',
      'robot.goal.reason.stack-off-centre',
      'robot.goal.reason.object-tipped',
      'robot.goal.reason.object-not-at-rest',
    ]);
  });

  it('accepts a height within 0.8 cm of resting on the top face, and no more', () => {
    expect(STACK_Z_TOLERANCE_CM).toBe(0.8);
    expect(run(onBase(0, 0, 6.8))).toMatchObject({ passed: true });
    expect(run(onBase(0, 0, 5.2))).toMatchObject({ passed: true });
    expect(run(onBase(0, 0, 6.85))).toMatchObject({ passed: false, reasonKey: goalReasons.objectNotStacked });
    expect(run(onBase(0, 0, 5.15))).toMatchObject({ passed: false, reasonKey: goalReasons.objectNotStacked });
  });

  it('says object-not-stacked for a top put down beside the bottom, or with no height to read', () => {
    expect(run(carryTo(140, 100))).toEqual({ id: 'stack-cube', passed: false, points: 0, progress: 0.25, reasonKey: goalReasons.objectNotStacked });
    // Carried up there (the grip's heights are read), then no height on the frames after it was let go
    const noHeight = onBase().map((frame, k) => (k < 5 ? frame : { ...frame, objects: { ...frame.objects, cube: { ...frame.objects!.cube!, zCm: undefined } } }));
    expect(run(noHeight)).toMatchObject({ reasonKey: goalReasons.objectNotStacked });
  });

  it('says stack-off-centre for a top more than maxOffsetCm from the bottom’s middle: 1.5 cm is near enough', () => {
    expect(run(onBase(1.5, 0))).toMatchObject({ passed: true });
    expect(run(onBase(1.2, 0.9))).toMatchObject({ passed: true }); // 1.5 cm on the diagonal
    expect(run(onBase(1.6, 0))).toEqual({ id: 'stack-cube', passed: false, points: 0, progress: 0.5, reasonKey: goalReasons.stackOffCentre });
  });

  it('says object-tipped for a top leaning more than maxTiltDeg (10), and object-not-at-rest for one still moving or touched', () => {
    expect(run(onBaseThen({ tiltDeg: 10 }))).toMatchObject({ passed: true });
    expect(run(onBaseThen({ tiltDeg: 10.5 }))).toMatchObject({ reasonKey: goalReasons.objectTipped });
    expect(run([...onBase().slice(0, 6), cubeAt(130, 100, { zCm: 6 }), cubeAt(130.4, 100, { zCm: 6 }), cubeAt(130.8, 100, { zCm: 6 })])).toMatchObject({
      reasonKey: goalReasons.objectNotAtRest,
    });
    expect(run(onBaseThen({}, { contacts: [{ otherId: 'cube', tags: ['object'] }] }))).toMatchObject({ reasonKey: goalReasons.objectNotAtRest });
  });

  it('says object-still-held while the gripper holds the top, or the base under it', () => {
    expect(run([...onBase().slice(0, 4), heldAt(130, 100, 6), heldAt(130, 100, 6), heldAt(130, 100, 6)])).toMatchObject({ reasonKey: goalReasons.objectStillHeld });
    expect(run(onBase().map((frame, k) => (k < 6 ? frame : { ...frame, gripper: { clawDeg: 60, liftDeg: 10, heldId: 'base' } })))).toMatchObject({
      reasonKey: goalReasons.objectStillHeld,
    });
  });

  it('wants the top carried: pushed up there, or never held at all, fails before anything else is looked at', () => {
    const pushedUp = [cubeAt(85, 60), cubeAt(100, 80), cubeAt(130, 100, { zCm: 6 }), cubeAt(130, 100, { zCm: 6 }), cubeAt(130, 100, { zCm: 6 })];
    expect(run(pushedUp)).toMatchObject({ passed: false, reasonKey: goalReasons.objectPushed, atS: 0.25 });
    expect(run([cubeAt(85, 60), cubeAt(85, 60)])).toMatchObject({ reasonKey: goalReasons.objectNeverHeld });
    expect(run(pushedUp, { ...stack, carried: false })).toMatchObject({ passed: true });
    // Let go on the base and slid off it by more than 3 cm
    expect(run([...onBase().slice(0, 6), cubeAt(133.5, 100, { zCm: 6 }), cubeAt(133.5, 100, { zCm: 6 }), cubeAt(133.5, 100, { zCm: 6 })])).toMatchObject({
      reasonKey: goalReasons.objectPushed,
    });
  });

  it('fails for good when the robot leaves the arena', () => {
    expect(run([...onBase().slice(0, 3), { ...heldAt(85, 60, 5), outOfArena: true }, ...onBase().slice(3)])).toEqual({
      id: 'stack-cube',
      passed: false,
      points: 0,
      progress: 0,
      reasonKey: goalReasons.outOfArena,
      atS: 0.75,
    });
  });

  it('refuses an object the arena does not have', () => {
    expect(() => createObjectOnObjectGoal({ ...stack, top: 'ball' }, ctx)).toThrow('no object "ball" in the arena');
    expect(() => createObjectOnObjectGoal({ ...stack, bottom: 'ball' }, ctx)).toThrow('no object "ball" in the arena');
  });
});
