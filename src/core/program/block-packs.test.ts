import { describe, expect, it } from 'vitest';
import { localDeviceDefinitions } from '../devices/local-catalog';
import { createDeviceRegistry } from '../devices/registry';
import { testExtendedPack, testMarkerType } from '../profiles/__fixtures__/test-profiles';
import {
  buildToolbox,
  createBlockPackCatalog,
  createGenericPack,
  genericBoardPins,
  genericPackId,
  ybcStructurePackId,
  type BlockPack,
} from './block-packs';
import { blockTypes, buildBlockDefinitions, toolbox } from './blocks';

const registry = createDeviceRegistry(localDeviceDefinitions);
const packs = createBlockPackCatalog(registry);

describe('block packs', () => {
  it('know the generic pack and the YBC structure pack', () => {
    expect(packs.list().map((pack) => pack.id)).toEqual([genericPackId, ybcStructurePackId]);
  });

  it('take the generic pins from the generic boards of the registry, not from the ybc board', () => {
    expect(genericBoardPins(registry)).toEqual(['D13', 'D12', 'D11', 'D10', 'D9', 'D8', 'D7', 'D6', 'D5', 'D4', 'D3', 'D2']);
  });

  it('give the generic toolbox exactly as before (GB2)', () => {
    expect(buildToolbox([genericPackId], packs)).toEqual(toolbox);
  });

  it('give a YBC project only the program structure', () => {
    expect(buildToolbox([ybcStructurePackId], packs)).toEqual({
      kind: 'categoryToolbox',
      contents: [
        {
          kind: 'category',
          name: 'Program',
          colour: '45',
          contents: [
            { kind: 'block', type: blockTypes.onStart },
            { kind: 'block', type: blockTypes.forever },
          ],
        },
      ],
    });
  });

  it('register the blocks of every pack once, the shared hats included only once', () => {
    const types = packs.definitions().map((definition) => definition.type);
    expect(new Set(types).size).toBe(types.length);
    expect(types).toEqual(buildBlockDefinitions(genericBoardPins(registry)).map((definition) => definition.type));
  });

  it('tell the types of a pack set, and refuse an unknown pack', () => {
    expect([...packs.typesOf([ybcStructurePackId])].sort()).toEqual([blockTypes.forever, blockTypes.onStart].sort());
    expect(packs.typesOf([genericPackId]).has('controls_if')).toBe(true);
    expect(() => packs.typesOf(['nope'])).toThrow('Unknown block pack "nope"');
    expect(() => buildToolbox(['nope'], packs)).toThrow('Unknown block pack "nope"');
  });

  it('know the types some pack owns, and not the Blockly built-ins no pack lists', () => {
    expect(packs.isKnown(blockTypes.wait)).toBe(true);
    expect(packs.isKnown('math_number')).toBe(false);
    expect(packs.isKnown(testMarkerType)).toBe(false);
  });

  it('take extra packs for tests and know their blocks', () => {
    const withFixture = createBlockPackCatalog(registry, [testExtendedPack]);
    expect(withFixture.isKnown(testMarkerType)).toBe(true);
    expect(withFixture.definitions().map((definition) => definition.type)).toContain(testMarkerType);
    expect(packs.definitions().map((definition) => definition.type)).not.toContain(testMarkerType);
  });

  it('refuse two packs with one id, and two different definitions of one block type', () => {
    expect(() => createBlockPackCatalog(registry, [createGenericPack([])])).toThrow('Duplicate block pack');
    const clash: BlockPack = { ...testExtendedPack, blocks: [{ type: blockTypes.wait, message0: 'other' }] };
    expect(() => createBlockPackCatalog(registry, [clash])).toThrow('defined differently');
  });
});
