import { describe, expect, it } from 'vitest';
import { localDeviceDefinitions } from '../../core/devices/local-catalog';
import { createDeviceRegistry } from '../../core/devices/registry';
import { productionProfiles } from '../../core/profiles';
import { buildToolbox, createBlockPackCatalog } from '../../core/program/block-packs';
import { toolbox as genericToolbox } from '../../core/program/blocks';
import { localizeBlockDefinitions, localizeToolbox, viBlockText, viCategoryNames } from './blocks';

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

  it('changes only message0 and tooltip, in new objects, and nothing in English', () => {
    const localized = localizeBlockDefinitions(definitions, 'vi');
    localized.forEach((definition, index) => {
      const original = definitions[index];
      expect({ ...definition, message0: null, tooltip: null }).toEqual({ ...original, message0: null, tooltip: null });
    });
    expect(localized.find((definition) => definition.type === 'ybc_display_show_image')?.message0).toBe('hiển thị hình');
    expect(definitions.find((definition) => definition.type === 'ybc_display_show_image')?.message0).toBe('show image');
    expect(localizeBlockDefinitions(definitions, 'en')).toEqual(definitions);
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
