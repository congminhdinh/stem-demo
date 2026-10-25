import { describe, expect, it } from 'vitest';
import { base, ctx, inside, nowhere } from './__fixtures__/context';
import { feed } from './__fixtures__/frames';
import { createObjectInZoneGoal } from './object-in-zone';
import { goalReasons } from './reasons';
import type { GoalSpec } from './goal';

const spec: GoalSpec<'object-in-zone'> = { ...base, kind: 'object-in-zone', object: 'crate', zone: 'gate' };
const crateAt = (xCm: number, yCm: number) => ({ objects: { crate: { xCm, yCm, yawDeg: 0 } } });

describe('object-in-zone', () => {
  it('passes when the middle of the object is in the zone at the end', () => {
    const goal = createObjectInZoneGoal(spec, ctx);
    feed(goal, [crateAt(130, 80), crateAt(110, 80), crateAt(100, 80)]);
    expect(goal.result()).toEqual({ id: 'goal', passed: true, points: 10, progress: 1 });
  });

  it('has not passed while the object is outside, and says why', () => {
    const goal = createObjectInZoneGoal(spec, ctx);
    expect(goal.result()).toEqual({ id: 'goal', passed: false, points: 0, progress: 0, reasonKey: goalReasons.objectNotInZone });
    feed(goal, [crateAt(130, 80)]);
    expect(goal.result()).toEqual({ id: 'goal', passed: false, points: 0, progress: 0, reasonKey: goalReasons.objectNotInZone });
  });

  it('is the state at the end that counts: an object that was in the zone and was pushed out has not passed', () => {
    const goal = createObjectInZoneGoal(spec, ctx);
    feed(goal, [crateAt(130, 80), crateAt(100, 80), crateAt(100, 80), crateAt(125, 80)]);
    expect(goal.result()).toMatchObject({ passed: false, points: 0, reasonKey: goalReasons.objectNotInZone });
  });

  it('passes again when the object is pushed back in', () => {
    const goal = createObjectInZoneGoal(spec, ctx);
    feed(goal, [crateAt(100, 80), crateAt(125, 80), crateAt(105, 70)]);
    expect(goal.result()).toMatchObject({ passed: true, points: 10 });
  });

  it('judges the middle of the object on the same edges as the paint: lower and left in, upper and right out', () => {
    const at = (x: number, y: number) => {
      const goal = createObjectInZoneGoal(spec, ctx); // gate: x 80..120, y 60..100
      feed(goal, [crateAt(x, y)]);
      return goal.result().passed;
    };
    expect([at(80, 80), at(100, 60), at(80, 60)]).toEqual([true, true, true]);
    expect([at(120, 80), at(100, 100), at(120, 100)]).toEqual([false, false, false]);
  });

  it('does not look at the robot', () => {
    const goal = createObjectInZoneGoal(spec, ctx);
    feed(goal, [{ ...inside.gate, ...crateAt(130, 80) }, { ...nowhere, ...crateAt(130, 80) }]);
    expect(goal.result().passed).toBe(false);
  });

  it('treats an object that the frame does not have as being nowhere', () => {
    const goal = createObjectInZoneGoal(spec, ctx);
    feed(goal, [{ objects: { other: { xCm: 100, yCm: 80, yawDeg: 0 } } }, {}]);
    expect(goal.result().passed).toBe(false);
  });

  describe('when the robot leaves the arena', () => {
    it('fails for good with the reason, whether or not the object is in the zone', () => {
      const goal = createObjectInZoneGoal(spec, ctx);
      feed(goal, [crateAt(130, 80), { ...crateAt(130, 80), outOfArena: true }, crateAt(100, 80)], { dtS: 2 });
      expect(goal.result()).toEqual({ id: 'goal', passed: false, points: 0, progress: 0, reasonKey: goalReasons.outOfArena, atS: 2 });
    });
  });

  it('refuses an object or a zone the arena does not have', () => {
    expect(() => createObjectInZoneGoal({ ...spec, object: 'bench' }, ctx)).toThrow('no object "bench" in the arena (objects: crate)');
    expect(() => createObjectInZoneGoal({ ...spec, zone: 'moon' }, ctx)).toThrow('no zone "moon"');
  });
});
