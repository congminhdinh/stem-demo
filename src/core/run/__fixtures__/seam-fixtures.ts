import type { ProjectDocument } from '../../circuit/document';
import ledDefinition from '../../devices/definitions/led.json';
import pushButtonDefinition from '../../devices/definitions/push-button.json';
import ybcBoardDefinition from '../../devices/definitions/ybc-board.json';
import { localDeviceDefinitions } from '../../devices/local-catalog';
import { createDeviceRegistry } from '../../devices/registry';
import { productionProfileData } from '../../profiles';
import { fixtureDocument } from '../../profiles/__fixtures__/test-profiles';
import { createProfileCatalog } from '../../profiles/profile';
import { program } from '../../program/__fixtures__/ybc-blocks';

// TEST-ONLY fixtures for the RunSession seams of YB-CP amendment 1 (peripheral state, press history, simulation
// access). They stand in for the parts YB-3 and YB-4 will add so the transport can be tested without them: no
// contract row, no construct, no Python. Like the profile fixtures (YB plan §8.7) they live only here, are injected
// through parameters, and every id starts with `test` (tests/fixture-leakage.test.ts).

export const boardId = 'ybc-board-1';
export const ybcBoard = { id: boardId, deviceType: 'ybc-board', position: { x: 300, y: 200 } };

/** The same shapes as the catalog's push button and LED, but offered to a Yolo:Bit-compatible project. */
const testButton = { ...pushButtonDefinition, id: 'test-ybc-button', family: 'ybc' };
const testLed = { ...ledDefinition, id: 'test-ybc-led', family: 'ybc' };
/**
 * A component whose simulation model takes a slider. It is only a model id from `inputKindOfModel`; nothing in the
 * simulation reads it, so this tests that the input arrives, not what a potentiometer would do with it.
 */
const testSlider = {
  id: 'test-ybc-slider',
  name: 'Test slider part',
  family: 'ybc',
  body: { width: 40, height: 40 },
  ports: [{ id: 'a', label: 'A', x: 0, y: 0, kind: 'passive' }],
  renderer: 'test-ybc-slider',
  simulation: { model: 'light-sensor' },
};

/** A model id that is also an `Object.prototype` member: a lookup by model must not take it for a model that takes an input. */
const testPrototypeModel = { ...testSlider, id: 'test-ybc-proto-model', renderer: 'test-ybc-proto-model', simulation: { model: 'constructor' } };

const testDevices = [testButton, testLed, testSlider, testPrototypeModel];

/** The catalog and the test parts. */
export const seamRegistry = createDeviceRegistry([...localDeviceDefinitions, ...testDevices]);

/**
 * The same, but the `ybc-board` is simulated by the generic `board` model (which already exists), so that its pins
 * drive nets. It stands in for the pin simulation YB-4 adds; this branch implements none.
 */
export const seamRegistryWithSimulatedBoard = createDeviceRegistry([
  ...localDeviceDefinitions.filter((definition) => (definition as { id?: string }).id !== 'ybc-board'),
  { ...ybcBoardDefinition, simulation: { model: 'board' } },
  ...testDevices,
]);

/** `ybc-basic` plus a palette that lets the circuit hold the test parts (the production profiles allow the board only). */
export const seamProfiles = createProfileCatalog([
  ...productionProfileData,
  {
    id: 'test-seams',
    family: 'ybc',
    boardType: 'ybc-board',
    extends: 'ybc-basic',
    constructs: [],
    blockPacks: [],
    palette: ['test-ybc-button', 'test-ybc-led', 'test-ybc-slider', 'test-ybc-proto-model'],
    controls: [],
    variableTypes: [],
  },
]);

/** A project of the `test-seams` profile whose program keeps running (an empty forever), so a run stays alive until it is stopped. */
export function seamDocument(
  components: ProjectDocument['circuit']['components'] = [ybcBoard],
  wires: ProjectDocument['circuit']['wires'] = [],
): ProjectDocument {
  return { ...fixtureDocument('test-seams', { components, blocks: program([], []) }), circuit: { components, wires } };
}

export const at = { x: 100, y: 100 };

export const wire = (id: string, from: [string, string], to: [string, string]) => ({
  id,
  from: { componentId: from[0], portId: from[1] },
  to: { componentId: to[0], portId: to[1] },
});

/** P0 → LED → GND, and 3V3 → push button → P1: one output pin and one input pin. Run it with `seamRegistryWithSimulatedBoard`. */
export const seamPinDocument = (): ProjectDocument =>
  seamDocument(
    [
      ybcBoard,
      { id: 'led-1', deviceType: 'test-ybc-led', position: at },
      { id: 'btn-1', deviceType: 'test-ybc-button', position: at },
    ],
    [
      wire('w1', [boardId, 'p0'], ['led-1', 'anode']),
      wire('w2', ['led-1', 'cathode'], [boardId, 'gnd']),
      wire('w3', [boardId, '3v3'], ['btn-1', 'a']),
      wire('w4', ['btn-1', 'b'], [boardId, 'p1']),
    ],
  );
