import { describe, expect, it } from 'vitest';
import type { Scenario } from '../../../core/scenario/scenario';
import { bodyKindColors, bodyPalette } from '../../../core/world/arena/body-colors';
import { gripperSnapshot, gripperTestScenario } from '../__fixtures__/gripper-scene';
import { goalObjectIds, objectTagHidden, objectTags } from './zone-tags';

// N19 E5: the objects a lesson's goals name have small tags in the 3D view, as its zones do (the learner's name of the object, "Khối đỏ",
// with a dot of its colour), over the object wherever it is; a tag is hidden while the gripper holds its object (the HUD's chip says it
// then) and in "Theo xe", as the zones' are (N18 R4.7). An object no goal names has none.

const label = { vi: 'x', en: 'x' };
const goals = [
  { id: 'grab', kind: 'object-held', label, points: 10, object: 'cube-red', holdS: 0.5, minLiftCm: 2 },
  { id: 'place', kind: 'object-placed', label, points: 10, object: 'cube-red', zone: 'red-zone', fully: true, maxTiltDeg: 15, restS: 0.5, carried: true, maxSlideCm: 3, minCarryLiftCm: 1, minCarryCm: 5 },
  { id: 'stack', kind: 'object-on-object', label, points: 10, top: 'cube-blue', bottom: 'base', maxOffsetCm: 1.5, maxTiltDeg: 10, restS: 0.5, carried: true, minCarryLiftCm: 1, minCarryCm: 5 },
  { id: 'still', kind: 'object-unmoved', label, points: 10, object: 'parcel', maxMoveCm: 2, maxTiltDeg: 20 },
  { id: 'push', kind: 'object-in-zone', label, points: 10, object: 'cube-green', zone: 'kho' },
  { id: 'reach', kind: 'reach-zone', label, points: 10, zone: 'kho' },
] as unknown as Scenario['goals'];
const scenario: Pick<Scenario, 'arena' | 'goals'> = { ...gripperTestScenario, goals };
const names: Record<string, string> = { 'cube-red': 'Khối đỏ', 'cube-green': 'Khối xanh lá', 'cube-blue': 'Khối xanh dương', parcel: 'Kiện hàng', base: 'Bệ xanh dương', 'cube-yellow': 'Khối vàng' };
const labels = { zoneLabel: () => null, objectLabel: (id: string) => names[id] ?? null };

describe('the objects’ tags (N19 E5)', () => {
  it('are for every object a goal names, once each, in the arena’s order', () => {
    expect(goalObjectIds(goals)).toEqual(new Set(['cube-red', 'cube-blue', 'base', 'parcel', 'cube-green']));
    expect(objectTags(scenario, labels)).toEqual([
      { objectId: 'cube-red', text: 'Khối đỏ', color: bodyPalette.red, index: 0, halfHeightCm: 2 },
      { objectId: 'cube-green', text: 'Khối xanh lá', color: bodyPalette.green, index: 1, halfHeightCm: 2 },
      { objectId: 'cube-blue', text: 'Khối xanh dương', color: bodyPalette.blue, index: 2, halfHeightCm: 2 },
      // The parcel has no colour of its own: its dot is the 3D view's colour of an object.
      { objectId: 'parcel', text: 'Kiện hàng', color: bodyKindColors.object, index: 4, halfHeightCm: 2.5 },
      { objectId: 'base', text: 'Bệ xanh dương', color: bodyPalette.blue, index: 5, halfHeightCm: 2 },
    ]);
  });

  it('are none without the objects’ words (an N18 view), or for an object the words leave unnamed, or with no goal naming one', () => {
    expect(objectTags(scenario, { zoneLabel: () => null })).toEqual([]);
    expect(objectTags(scenario, { zoneLabel: () => null, objectLabel: (id) => (id === 'base' ? null : (names[id] ?? null)) }).map((tag) => tag.objectId)).toEqual(['cube-red', 'cube-green', 'cube-blue', 'parcel']);
    expect(objectTags({ ...scenario, goals: [] }, labels)).toEqual([]);
  });

  it('are hidden while the gripper holds their object, and in "Theo xe"', () => {
    const [red, green] = objectTags(scenario, labels);
    const holding = gripperSnapshot({ clawDeg: 26, liftDeg: 90, heldId: 'cube-red' });
    expect(objectTagHidden(red!, holding, 'orbit')).toBe(true);
    expect(objectTagHidden(green!, holding, 'orbit')).toBe(false);
    expect(objectTagHidden(green!, holding, 'top')).toBe(false);
    expect(objectTagHidden(green!, holding, 'follow')).toBe(true);
    expect(objectTagHidden(red!, gripperSnapshot({ clawDeg: 0, liftDeg: 0, heldId: null }), 'orbit')).toBe(false);
  });
});
