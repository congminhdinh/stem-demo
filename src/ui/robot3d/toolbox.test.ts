import { describe, expect, it } from 'vitest';
import { localDeviceDefinitions } from '../../core/devices/local-catalog';
import { createDeviceRegistry } from '../../core/devices/registry';
import { productionProfiles } from '../../core/profiles';
import { buildToolbox, createBlockPackCatalog, type Toolbox } from '../../core/program/block-packs';
import { restrictToolbox } from './toolbox';

// N18 R4.2: the robot lab's toolbox is the scenario's `toolbox` list inside the profile's packs.

const packs = createBlockPackCatalog(createDeviceRegistry(localDeviceDefinitions));
const unoBasic = buildToolbox(productionProfiles.get('uno-basic')!.blockPacks, packs);

/** Each category's name and the types of its blocks, in order. */
const outline = (toolbox: Toolbox) =>
  toolbox.contents.map((category) => [category.name ?? category.custom, (category.contents ?? []).map((entry) => (entry as { type?: string }).type)]);

describe('restrictToolbox (N18 R4.2)', () => {
  it('keeps the blocks of the list in the profile’s order and drops every category left empty, the variables one included', () => {
    const allowed = ['stem_on_start', 'stem_forever', 'math_number', 'ybc_wait_ms', 'uno_drive_move', 'uno_drive_stop', 'uno_motor_set'];
    expect(outline(restrictToolbox(unoBasic, allowed))).toEqual([
      ['Program', ['stem_on_start', 'stem_forever']],
      ['Motors', ['uno_drive_move', 'uno_drive_move', 'uno_drive_stop', 'uno_motor_set', 'uno_motor_set']],
      ['Time', ['ybc_wait_ms']],
      ['Math', ['math_number']],
    ]);
  });

  it('keeps each kept entry as the profile gives it (its fields and shadows) and leaves the toolbox it was given as it was', () => {
    const before = JSON.stringify(unoBasic);
    const restricted = restrictToolbox(unoBasic, ['uno_drive_move']);
    expect(restricted.kind).toBe('categoryToolbox');
    expect(restricted.contents[0]?.contents?.[0]).toEqual({ kind: 'block', type: 'uno_drive_move', fields: { DIRECTION: 'forward' }, inputs: { SPEED: { shadow: { type: 'math_number', fields: { NUM: 50 } } } } });
    expect(JSON.stringify(unoBasic)).toBe(before);
  });

  it('keeps the variables category when the list has a variable block, and everything when there is no list (the sandbox)', () => {
    expect(outline(restrictToolbox(unoBasic, ['variables_get'])).map(([name]) => name)).toEqual(['Variables']);
    expect(restrictToolbox(unoBasic, undefined)).toBe(unoBasic);
  });

  it('never offers a block of the list that the profile does not have', () => {
    expect(outline(restrictToolbox(unoBasic, ['uno_line_raw', 'stem_on_start']))).toEqual([['Program', ['stem_on_start']]]);
  });
});
