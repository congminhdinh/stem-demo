import { describe, expect, it } from 'vitest';
import { productionKits, referenceKitRef } from '../hardware/catalog';
import type { Kit } from '../hardware/kit';
import allGoalsScenario from '../scenario/__fixtures__/all-goals.scenario.json';
import { loadScenario } from '../scenario/scenario';
import { ROBOT_FOOTPRINT_RADIUS_CM, variantOffsets } from '../scenario/variants';
import { createScenarioWorld } from './world';

// N19 A1 (plan D-G8): the world of a scenario is built from the variant the KIT's floor allows (`kitFootprintRadiusCm`), not a constant. The
// rover's 11 cm is what it always was; a kit that says 16 gets variants that keep 16 cm clear. (The robot itself is the rover's here: only
// the radius of the fixture kit differs, and it is only ever larger than the reach of the robot.)

const rover = productionKits.get(referenceKitRef) as Kit;
const wide: Kit = { ...rover, chassis: { ...rover.chassis!, footprintRadiusCm: 16 } };

/** The fixture's scenario with a start 20 cm from the west and south walls, which jitters 12 cm: 11 cm of floor needs x, y ≥ 13, 16 cm needs ≥ 18. */
const scenario = (() => {
  const loaded = loadScenario(allGoalsScenario);
  return { ...loaded, start: { xCm: 20, yCm: 20, yawDeg: 0 }, variants: { ...loaded.variants, count: 10, startJitterCm: 12 } };
})();

const variantOf = async (kit: Kit, index: number) => {
  const world = await createScenarioWorld(scenario, kit, index);
  try {
    return { offsets: world.variant, x: world.snapshot().robot.xCm, y: world.snapshot().robot.yCm };
  } finally {
    world.dispose();
  }
};

describe('createScenarioWorld takes the floor of the start from the kit', () => {
  it('uses the rover’s 11 cm for the rover: the variants variantOffsets gives at 11 cm', async () => {
    for (let i = 0; i < scenario.variants.count; i++) {
      expect((await variantOf(rover, i)).offsets, `variant ${i}`).toEqual(variantOffsets(scenario, i, ROBOT_FOOTPRINT_RADIUS_CM));
    }
  });

  it('uses 16 cm for a kit that says 16: the variants keep 16 cm clear of the walls, and some differ from the rover’s', async () => {
    let differ = 0;
    for (let i = 0; i < scenario.variants.count; i++) {
      const built = await variantOf(wide, i);
      expect(built.offsets, `variant ${i}`).toEqual(variantOffsets(scenario, i, 16));
      expect(built.x - 16, `variant ${i} x`).toBeGreaterThanOrEqual(2 - 1e-6);
      expect(built.y - 16, `variant ${i} y`).toBeGreaterThanOrEqual(2 - 1e-6);
      if (JSON.stringify(built.offsets) !== JSON.stringify(variantOffsets(scenario, i, ROBOT_FOOTPRINT_RADIUS_CM))) differ++;
    }
    expect(differ).toBeGreaterThan(0);
  });
});
