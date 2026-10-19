import { describe, expect, it } from 'vitest';
import { localDeviceDefinitions } from '../../core/devices/local-catalog';
import { createDeviceRegistry } from '../../core/devices/registry';
import { productionProfiles } from '../../core/profiles';
import { buildToolbox, createBlockPackCatalog } from '../../core/program/block-packs';
import { toolbox as genericToolbox } from '../../core/program/blocks';
import { localizeBlockDefinitions, localizeToolbox, viBlockText, viCategoryNames, viColourNames, viPictureNames } from './blocks';

const packs = createBlockPackCatalog(createDeviceRegistry(localDeviceDefinitions));
const definitions = packs.definitions();
const placeholders = (message: unknown) => (typeof message === 'string' ? (message.match(/%\d+/g) ?? []).sort() : []);
const hasWords = (message: unknown) => typeof message === 'string' && /\p{L}/u.test(message.replace(/%\d+/g, ''));

describe('Vietnamese blocks (N6a S5)', () => {
  it.each(definitions.map((definition) => [definition.type, definition] as const))('%s keeps the placeholders of the core', (type, definition) => {
    const text = viBlockText[type];
    if (text) {
      expect(placeholders(text.message0)).toEqual(placeholders(definition.message0));
      expect(text.tooltip).not.toBe('');
    }
  });

  it('translates every custom block that has words or a tooltip', () => {
    const missing = definitions.filter((definition) => (hasWords(definition.message0) || typeof definition.tooltip === 'string') && !viBlockText[definition.type]);
    expect(missing.map((definition) => definition.type)).toEqual([]);
  });

  it('translates no block the core does not define', () => {
    const known = new Set(definitions.map((definition) => definition.type));
    expect(Object.keys(viBlockText).filter((type) => !known.has(type))).toEqual([]);
  });

  /** A definition with every dropdown option label blanked: what must stay the same when only the labels are translated. */
  const unlabelled = (definition: Record<string, unknown>) =>
    JSON.parse(JSON.stringify(definition), (key, value: unknown) => (key === 'options' && Array.isArray(value) ? value.map((option: unknown) => [null, (option as unknown[])[1]]) : value)) as unknown;

  it('changes only message0, tooltip and the labels of the options it names, in new objects, and nothing in English', () => {
    const localized = localizeBlockDefinitions(definitions, 'vi');
    localized.forEach((definition, index) => {
      const original = definitions[index] ?? { type: '' };
      expect(unlabelled({ ...definition, message0: null, tooltip: null })).toEqual(unlabelled({ ...original, message0: null, tooltip: null }));
    });
    expect(localized.find((definition) => definition.type === 'ybc_display_show_image')?.message0).toBe('hiển thị hình %1');
    expect(definitions.find((definition) => definition.type === 'ybc_display_show_image')?.message0).toBe('show image in %1');
    expect(localizeBlockDefinitions(definitions, 'en')).toEqual(definitions);
  });

  it('names the eight colours and the thirteen pictures in Vietnamese, keeping the value each option saves (N17 B1)', () => {
    const optionsOf = (list: readonly Record<string, unknown>[], type: string) =>
      (list.find((definition) => definition.type === type)?.args0 as { options?: [string, string][] }[] | undefined)?.[0]?.options ?? [];
    const localized = localizeBlockDefinitions(definitions, 'vi');
    for (const type of ['ybc_colour', 'ybc_display_show_image']) {
      expect(optionsOf(localized, type), type).toEqual(optionsOf(definitions, type).map(([, value]) => [viColourNames[value], value]));
      expect(optionsOf(localized, type).map(([label]) => label), type).toEqual(['đỏ', 'cam', 'vàng', 'lục', 'lam', 'chàm', 'tím', 'trắng']);
    }
    expect(optionsOf(localized, 'ybc_display_show_icon')).toEqual(optionsOf(definitions, 'ybc_display_show_icon').map(([, value]) => [viPictureNames[value], value]));
    expect(optionsOf(localized, 'ybc_display_show_icon').every(([label]) => typeof label === 'string' && label !== '')).toBe(true);
    // The core's English labels are untouched.
    expect(optionsOf(definitions, 'ybc_colour')[0]).toEqual(['red', '#ff0000']);
  });

  it('names every toolbox category in Vietnamese', () => {
    const toolboxes = [genericToolbox, ...productionProfiles.ids().map((id) => buildToolbox(productionProfiles.get(id)?.blockPacks ?? [], packs))];
    for (const toolbox of toolboxes) {
      const localized = localizeToolbox(toolbox, 'vi');
      expect(localized.contents.map((category) => category.name).filter((name) => name !== undefined && !Object.values(viCategoryNames).includes(name))).toEqual([]);
      expect(localizeToolbox(toolbox, 'en')).toBe(toolbox);
    }
  });
});
