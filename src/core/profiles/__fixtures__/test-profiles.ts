import type { ProjectDocument } from '../../circuit/document';
import { localDeviceDefinitions } from '../../devices/local-catalog';
import { createDeviceRegistry } from '../../devices/registry';
import { createBlockPackCatalog, type BlockPack } from '../../program/block-packs';
import { blockTypes, createDefaultProgram } from '../../program/blocks';
import { productionProfileData } from '../index';
import { createProfileCatalog } from '../profile';

// TEST-ONLY fixtures for the profile mechanism (YB plan §8.7). They stand in
// for the constructs and devices that only Advanced will have (YB-7), so
// YB-1 can test filtering, preservation, diagnostics and persistence without
// them. They live only here, are injected through parameters, and no
// production file imports this directory (tests/fixture-leakage.test.ts).
// Every id starts with `test`. They are not Yolo:Bit capabilities: no
// contract row, no Python.

export const testMarkerType = 'test_marker';
export const testDeviceType = 'test-device';

/** `test-base`: the structure pack and the ybc board. `test-extended` adds exactly one construct and one device. */
export const testProfileData: readonly unknown[] = [
  {
    id: 'test-base',
    family: 'ybc',
    boardType: 'ybc-board',
    constructs: [],
    blockPacks: ['ybc.structure'],
    palette: ['ybc-board'],
    controls: [],
    variableTypes: ['int'],
  },
  {
    id: 'test-extended',
    family: 'ybc',
    boardType: 'ybc-board',
    extends: 'test-base',
    constructs: ['test-marker'],
    blockPacks: ['test.extended'],
    palette: ['test-device'],
    controls: [],
    variableTypes: ['int', 'str'],
  },
];

/** A device that only exists in the test registry. */
export const testDeviceDefinition = {
  id: testDeviceType,
  name: 'Test device',
  family: 'ybc',
  body: { width: 40, height: 40 },
  ports: [{ id: 'a', label: 'A', x: -10, y: 20, kind: 'passive' }],
  renderer: 'test-device',
  simulation: { model: 'test-device' },
};

/** The block pack of `test-extended`: one statement block, which compiles to a no-op node. */
export const testExtendedPack: BlockPack = {
  id: 'test.extended',
  family: 'ybc',
  blocks: [
    { type: testMarkerType, message0: 'test marker', previousStatement: null, nextStatement: null, colour: 0 },
  ],
  blockTypes: [testMarkerType],
  categories: [
    { kind: 'category', name: 'Test', colour: '0', contents: [{ kind: 'block', type: testMarkerType }] },
  ],
};

export function createFixtureEnvironment() {
  const registry = createDeviceRegistry([...localDeviceDefinitions, testDeviceDefinition]);
  return {
    registry,
    // The production profiles stay available next to the fixtures, as in the real catalog.
    profiles: createProfileCatalog([...productionProfileData, ...testProfileData]),
    packs: createBlockPackCatalog(registry, [testExtendedPack]),
    // The only block the YBC compiler may turn into a no-op.
    noopBlockTypes: new Set([testMarkerType]),
  };
}

const board = { id: 'ybc-board-1', deviceType: 'ybc-board', position: { x: 300, y: 200 } };
const testDevice = { id: 'test-device-1', deviceType: testDeviceType, position: { x: 100, y: 100 } };

/** The default program (on start + forever), with a `test_marker` inside on start. */
export function programWithMarker() {
  const program = createDefaultProgram();
  const [onStart] = program.blocks.blocks;
  return {
    ...program,
    blocks: {
      ...program.blocks,
      blocks: [
        { ...onStart, inputs: { DO: { block: { type: testMarkerType, id: 'marker-1' } } } },
        ...program.blocks.blocks.slice(1),
      ],
    },
  };
}

/** A project document of a profile with the given pieces. The default program is the empty one. */
export function fixtureDocument(
  profile: string | undefined,
  options: { components?: ProjectDocument['circuit']['components']; blocks?: unknown } = {},
): ProjectDocument {
  return {
    schemaVersion: 1,
    id: `doc-${profile ?? 'generic'}`,
    name: 'Fixture',
    ...(profile === undefined ? {} : { profile }),
    circuit: { components: options.components ?? [board], wires: [] },
    program: { blocks: options.blocks ?? createDefaultProgram() },
  };
}

export const fixtureComponents = { board, testDevice };
export { blockTypes };
