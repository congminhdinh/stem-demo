import { describe, expect, it } from 'vitest';
import { localDeviceDefinitions } from '../devices/local-catalog';
import { createDeviceRegistry } from '../devices/registry';
import { productionKits, referenceKitRef, unoR3Board } from '../hardware/catalog';
import { scenarioCatalog } from '../../samples/robot-scenarios';
import { robotTemplateKeys } from '../../samples/robot-keys';
import { scenarioKitRef } from './scenario';
import type { Scenario } from './scenario-schema';
import { createVerifyEnvironment } from './verify-attempt';

// N19 A1 (plan D-G1): the kit a scenario runs on, and at which version, is read from the scenario (its `kit` and robot-keys.ts's table of
// versions), not assumed to be the rover's. These are the two readers that turn a scenario into a kit: the lab (RobotLab.tsx) and the
// verifier (verify-attempt.ts `createVerifyEnvironment`).

const scenarioOf = (key: string): Scenario => {
  const scenario = scenarioCatalog.get(key);
  if (scenario === undefined) throw new Error(`no scenario ${key}`);
  return scenario;
};

/** A scenario that names a kit this build does not list (the schema refuses it for a production key, so it is built by hand). */
const onKit = (scenario: Scenario, kit: string): Scenario => ({ ...scenario, kit });

describe('scenarioKitRef', () => {
  it.each(robotTemplateKeys)('%s runs on ref-uno-rover@0', (key) => {
    expect(scenarioKitRef(scenarioOf(key))).toEqual({ id: 'ref-uno-rover', version: '0' });
    expect(scenarioKitRef(scenarioOf(key))).toEqual(referenceKitRef);
  });

  it('is undefined for a kit the table does not list, and for ids a lookup would find on any object', () => {
    for (const kit of ['ref-uno-gripper', 'vendor-kit', 'constructor', '__proto__', '']) {
      expect(scenarioKitRef({ kit }), kit).toBeUndefined();
    }
  });
});

describe('the verifier’s kit of a scenario', () => {
  const env = createVerifyEnvironment({ scenarios: scenarioCatalog, kits: productionKits, registry: createDeviceRegistry(localDeviceDefinitions) });

  it.each(robotTemplateKeys)('%s: the rover and the UNO board of the catalog', (key) => {
    const { kit, board } = env.kitOf(scenarioOf(key));
    expect(kit).toBe(productionKits.get(referenceKitRef));
    expect(board).toBe(unoR3Board);
  });

  it('throws, naming the scenario and the kit, for a kit this build does not have', () => {
    expect(() => env.kitOf(onKit(scenarioOf('rb-mini-mission'), 'ref-uno-gripper'))).toThrow(
      'Scenario "rb-mini-mission" runs on the kit ref-uno-gripper, which this build does not have.',
    );
  });
});
