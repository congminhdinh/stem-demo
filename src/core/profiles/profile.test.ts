import { describe, expect, it } from 'vitest';
import { profileConstructViolations } from '../compat/contract-validation';
import { yolobitContract } from '../compat/yolobit-contract';
import { localDeviceDefinitions } from '../devices/local-catalog';
import { createDeviceRegistry } from '../devices/registry';
import { createBlockPackCatalog } from '../program/block-packs';
import { testProfileData } from './__fixtures__/test-profiles';
import { createProfileCatalog, productionProfileData, productionProfiles } from './index';
import { profileListFields } from './profile';

const registry = createDeviceRegistry(localDeviceDefinitions);
const basic = productionProfiles.get('ybc-basic');
const advanced = productionProfiles.get('ybc-advanced');
const base = { family: 'ybc', boardType: 'ybc-board', constructs: [], blockPacks: [], palette: [], controls: [], variableTypes: [] };

describe('profile catalog', () => {
  it('lists the two production profiles', () => {
    expect(productionProfiles.ids()).toEqual(['ybc-basic', 'ybc-advanced']);
  });

  it('answers undefined for an unknown id', () => {
    expect(productionProfiles.get('ybc-expert')).toBeUndefined();
    expect(productionProfiles.get('constructor')).toBeUndefined();
    expect(productionProfiles.get('__proto__')).toBeUndefined();
  });

  it('builds the effective profile of an extension as the union, parent first', () => {
    const catalog = createProfileCatalog([
      { ...base, id: 'a', blockPacks: ['p1', 'p2'], palette: ['d1'] },
      { ...base, id: 'b', extends: 'a', blockPacks: ['p2', 'p3'], palette: ['d2'] },
    ]);
    expect(catalog.get('b')).toMatchObject({ blockPacks: ['p1', 'p2', 'p3'], palette: ['d1', 'd2'] });
    expect(catalog.get('a')).toMatchObject({ blockPacks: ['p1', 'p2'], palette: ['d1'] });
  });

  it.each([
    ['a duplicate id', [{ ...base, id: 'a' }, { ...base, id: 'a' }], 'Duplicate profile "a"'],
    ['an unknown parent', [{ ...base, id: 'a', extends: 'zzz' }], 'Unknown profile "zzz"'],
    ['a cycle', [{ ...base, id: 'a', extends: 'b' }, { ...base, id: 'b', extends: 'a' }], 'Circular profile chain'],
    [
      'another board type than its parent',
      [{ ...base, id: 'a' }, { ...base, id: 'b', extends: 'a', boardType: 'other' }],
      'another board type',
    ],
  ])('fails fast on %s', (_, data, message) => {
    expect(() => createProfileCatalog(data)).toThrow(message);
  });

  it('fails fast on data that is not a profile', () => {
    expect(() => createProfileCatalog([{ id: 'a' }])).toThrow();
    expect(() => createProfileCatalog([{ ...base, id: 'a', family: 'generic' }])).toThrow();
  });
});

describe('the production profiles', () => {
  it('make Advanced a superset of Basic on every list field', () => {
    for (const field of profileListFields) {
      for (const item of basic?.[field] ?? []) {
        expect(advanced?.[field], `${field}: ${item}`).toContain(item);
      }
    }
  });

  it('differ only in profile data: the id, the extension and the variable types', () => {
    const strip = (profile: typeof basic) => {
      const rest: Record<string, unknown> = { ...profile };
      delete rest.id;
      delete rest.extends;
      delete rest.variableTypes;
      return { rest, variableTypes: profile?.variableTypes };
    };
    expect(strip(advanced).rest).toEqual(strip(basic).rest);
    expect(strip(basic).variableTypes).toEqual(['int']);
    expect(strip(advanced).variableTypes).toEqual(['int', 'str']);
    expect(advanced?.extends).toBe('ybc-basic');
  });

  it('expose only the structure and the YB-2 language: no display, sensor, pin, sound, function, event, random or elapsed-time block', () => {
    for (const profile of [basic, advanced]) {
      expect(profile?.blockPacks).toEqual(['ybc.structure', 'lang.logic', 'lang.loops', 'lang.math', 'lang.text', 'lang.variables']);
      expect(profile?.constructs).toEqual(['C-01', 'C-02', 'C-04', 'C-29', 'C-30', 'C-31', 'C-32', 'C-33', 'C-34', 'C-35', 'C-36', 'C-37', 'C-38', 'C-39', 'C-56']);
      expect(profile?.controls).toEqual([]);
    }
  });

  it('use the ybc board and offer no generic device', () => {
    for (const profile of [basic, advanced]) {
      expect(profile?.boardType).toBe('ybc-board');
      expect(profile?.palette).toEqual(['ybc-board']);
      for (const deviceType of profile?.palette ?? []) {
        expect(registry.get(deviceType).family).toBe('ybc');
      }
    }
  });

  it('name only block packs that exist', () => {
    const packs = createBlockPackCatalog(registry);
    for (const profile of [basic, advanced]) {
      expect(() => packs.typesOf(profile?.blockPacks ?? [])).not.toThrow();
    }
  });

  it('list only constructs that pass the exposure gate (EG) and are meant for them', () => {
    for (const profile of [basic, advanced]) {
      expect(profileConstructViolations(profile?.id ?? '', profile?.constructs ?? [], yolobitContract)).toEqual([]);
    }
  });

  it('keep every fixture id out of the production data', () => {
    expect(JSON.stringify(productionProfileData)).not.toMatch(/"test/);
    expect(testProfileData.length).toBe(2);
  });
});
