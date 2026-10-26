import { describe, expect, it } from 'vitest';
import { feed, type FrameInit } from './__fixtures__/frames';
import { ctx, cubeAt, heldAt, ON_BASE_Z, specOf } from './__fixtures__/pick-place';
import { createObjectHeldGoal } from './object-held';
import { goalReasons } from './reasons';
import type { GoalSpec } from './goal';

// N19 D2 (plan §4.5): `object-held` passes once the gripper has held the object for holdS (0.5 s) in a row, lifted all that time at least
// minLiftCm (2 in the fixture's grab-cube) above where it was taken from; and stays passed. Frames are 0.25 s apart (feed).

const grab = specOf('grab-cube', 'object-held');
const run = (frames: readonly FrameInit[], spec: GoalSpec<'object-held'> = grab) => {
  const goal = createObjectHeldGoal(spec, ctx);
  feed(goal, frames);
  return goal.result();
};
const touching = { contacts: [{ otherId: 'cube', tags: ['object'] }] };

describe('object-held', () => {
  it('passes once held 0.5 s at 2 cm or more above where it lay, at the frame that completes the hold', () => {
    // taken at z 2 at 0.25 s; 4 cm (lifted 2) from 0.5 s; the hold of 0.5 s is complete at 1.0 s
    const frames = [cubeAt(85, 60), heldAt(85, 60, 2), heldAt(85, 60, 4), heldAt(85, 60, 4), heldAt(85, 60, 4)];
    expect(run(frames)).toEqual({ id: 'grab-cube', passed: true, points: 20, progress: 1, atS: 1 });
    expect(run(frames.slice(0, 4))).toEqual({ id: 'grab-cube', passed: false, points: 0, progress: 0.5, reasonKey: goalReasons.objectNotLifted });
  });

  it('stays passed: the robot may put the object down, or still hold it at the end', () => {
    const lifted = [cubeAt(85, 60), heldAt(85, 60, 2), heldAt(85, 60, 4), heldAt(85, 60, 4), heldAt(85, 60, 4)];
    expect(run([...lifted, heldAt(130, 60, 2), cubeAt(130, 60), cubeAt(130, 60)])).toMatchObject({ passed: true, atS: 1 });
    expect(run([...lifted, heldAt(130, 60, 4)])).toMatchObject({ passed: true, atS: 1 });
    expect(run([...lifted, { ...cubeAt(130, 60), outOfArena: true }])).toMatchObject({ passed: true });
  });

  it('says object-not-reached when the robot never touched nor held the object', () => {
    expect(run([cubeAt(85, 60), cubeAt(85, 60)])).toEqual({ id: 'grab-cube', passed: false, points: 0, progress: 0, reasonKey: goalReasons.objectNotReached });
    expect(run([])).toMatchObject({ reasonKey: goalReasons.objectNotReached });
  });

  it('says object-not-grasped when it touched it but never held it, or not for long enough', () => {
    expect(run([cubeAt(85, 60), cubeAt(86, 60, {}, touching), cubeAt(88, 60)])).toMatchObject({ reasonKey: goalReasons.objectNotGrasped });
    // pushed along, never touched by a contact the frame names, but held for 0.25 s only
    expect(run([cubeAt(85, 60), heldAt(85, 60, 4), heldAt(85, 60, 4), cubeAt(85, 60, { zCm: 4 }), cubeAt(85, 60)])).toMatchObject({ reasonKey: goalReasons.objectNotGrasped });
  });

  it('says object-not-lifted when it held it long enough but not as high: 1.9 cm is not 2', () => {
    expect(run([cubeAt(85, 60), heldAt(85, 60, 2), heldAt(85, 60, 3.9), heldAt(85, 60, 3.9), heldAt(85, 60, 3.9)])).toMatchObject({
      passed: false,
      reasonKey: goalReasons.objectNotLifted,
    });
    expect(run([cubeAt(85, 60), heldAt(85, 60, 2), heldAt(85, 60, 4), heldAt(85, 60, 4), heldAt(85, 60, 4)])).toMatchObject({ passed: true });
  });

  it('wants the hold and the height together for the whole time: a dip starts it again', () => {
    const frames = [cubeAt(85, 60), heldAt(85, 60, 2), heldAt(85, 60, 4), heldAt(85, 60, 4), heldAt(85, 60, 3), heldAt(85, 60, 4), heldAt(85, 60, 4)];
    expect(run(frames)).toMatchObject({ passed: false, reasonKey: goalReasons.objectNotLifted, progress: 0.5 });
    expect(run([...frames, heldAt(85, 60, 4)])).toMatchObject({ passed: true, atS: 1.75 });
  });

  it('measures the lift from where the object was taken: from the top of the base, a cube lifted 2 cm is at 8', () => {
    expect(run([cubeAt(130, 100, { zCm: ON_BASE_Z }), heldAt(130, 100, ON_BASE_Z), heldAt(130, 100, 7.9), heldAt(130, 100, 7.9), heldAt(130, 100, 7.9)])).toMatchObject({
      reasonKey: goalReasons.objectNotLifted,
    });
    expect(run([cubeAt(130, 100, { zCm: ON_BASE_Z }), heldAt(130, 100, ON_BASE_Z), heldAt(130, 100, 8), heldAt(130, 100, 8), heldAt(130, 100, 8)])).toMatchObject({ passed: true });
  });

  it('with minLiftCm 0, holding is enough, with or without a height on the frame', () => {
    const anyHeight = { ...grab, minLiftCm: 0 };
    expect(run([cubeAt(85, 60), heldAt(85, 60, 2), heldAt(85, 60, 2), heldAt(85, 60, 2)], anyHeight)).toMatchObject({ passed: true, atS: 0.75 });
    const noHeight: FrameInit[] = [1, 2, 3].map(() => ({ objects: { cube: { xCm: 85, yCm: 60, yawDeg: 0, held: true } } }));
    expect(run(noHeight, anyHeight)).toMatchObject({ passed: true });
    expect(run(noHeight)).toMatchObject({ reasonKey: goalReasons.objectNotLifted }); // a height it cannot read is not a lift
  });

  it('reads a hold from the gripper as well as from the object', () => {
    const viaGripper = (zCm: number): FrameInit => ({ ...cubeAt(85, 60, { zCm }), gripper: { clawDeg: 40, liftDeg: 30, heldId: 'cube' } });
    expect(run([cubeAt(85, 60), viaGripper(2), viaGripper(4), viaGripper(4), viaGripper(4)])).toMatchObject({ passed: true });
    expect(run([cubeAt(85, 60), { ...cubeAt(85, 60, { zCm: 4 }), gripper: { clawDeg: 40, liftDeg: 30, heldId: 'base' } }])).toMatchObject({ reasonKey: goalReasons.objectNotReached });
  });

  it('fails for good when the robot leaves the arena before it passes', () => {
    const frames = [cubeAt(85, 60), heldAt(85, 60, 2), { ...heldAt(85, 60, 4), outOfArena: true }, heldAt(85, 60, 4), heldAt(85, 60, 4), heldAt(85, 60, 4)];
    expect(run(frames)).toEqual({ id: 'grab-cube', passed: false, points: 0, progress: 0, reasonKey: goalReasons.outOfArena, atS: 0.5 });
  });

  it('refuses an object the arena does not have', () => {
    expect(() => createObjectHeldGoal({ ...grab, object: 'ball' }, ctx)).toThrow('no object "ball" in the arena');
  });
});
