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
  it('lists the two production profiles, then the two UNO ones of N18 R2.1', () => {
    expect(productionProfiles.ids()).toEqual(['ybc-basic', 'ybc-advanced', 'uno-basic', 'uno-advanced']);
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

  it('differ in profile data (the id, the extension), in the sensors of N17 B2 (rows, pack, controls), in the music of N17 B3 (rows, pack) and in analog write and the servo of N17 B5 (rows, pack, part)', () => {
    const strip = (profile: typeof basic) => {
      const rest: Record<string, unknown> = { ...profile };
      delete rest.id;
      delete rest.extends;
      delete rest.variableTypes;
      return { rest, variableTypes: profile?.variableTypes };
    };
    const sensors = {
      constructs: ['C-16', 'C-17', 'C-18', 'C-20', 'C-21', 'C-22', 'C-26', 'C-27'],
      blockPacks: ['ybc.sensors', 'ybc.music', 'ybc.pwm'],
      controls: ['temperature', 'accelerometer'],
      palette: ['servo'],
    };
    expect(strip(advanced).rest).toEqual({
      ...strip(basic).rest,
      constructs: [...(basic?.constructs ?? []), ...sensors.constructs],
      blockPacks: [...(basic?.blockPacks ?? []), ...sensors.blockPacks],
      controls: [...(basic?.controls ?? []), ...sensors.controls],
      palette: [...(basic?.palette ?? []), ...sensors.palette],
    });
    // N17 B6: no text variables at either level; Advanced takes Basic's whole numbers and adds nothing.
    expect(strip(basic).variableTypes).toEqual(['int']);
    expect(strip(advanced).variableTypes).toEqual(['int']);
    expect(advanced?.extends).toBe('ybc-basic');
  });

  it('expose the structure, the YB-2 language with the running time and random numbers of N17 B4, the YB-3 onboard hardware with the RGB display of N17 B1, and the YB-4 header pins; Advanced the sensors of N17 B2, the music of N17 B3 and analog write and the servo of N17 B5 too: no function or event block', () => {
    const basicPacks = ['ybc.structure', 'ybc.display', 'ybc.input', 'ybc.sound', 'ybc.pins', 'lang.logic', 'lang.loops', 'lang.math', 'lang.text', 'lang.variables'];
    const basicConstructs = [
      'C-01', 'C-02', 'C-04', 'C-05', 'C-06', 'C-07', 'C-08', 'C-09', 'C-10', 'C-12', 'C-13', 'C-15', 'C-19', 'C-23', 'C-24', 'C-25', 'C-29', 'C-30', 'C-31',
      'C-32', 'C-33', 'C-34', 'C-35', 'C-36', 'C-37', 'C-38', 'C-39', 'C-40', 'C-42', 'C-43', 'C-50', 'C-51', 'C-56',
    ];
    expect(basic?.blockPacks).toEqual(basicPacks);
    expect(basic?.constructs).toEqual(basicConstructs);
    // The parts that get a runtime control: the two buttons (hold) and the light sensor (slider). Display and buzzer only show.
    expect(basic?.controls).toEqual(['button-a', 'button-b', 'light']);
    // Advanced, the union with Basic first: the sensors pack (its blocks join the Input category), its rows and its controls; the
    // music pack of N17 B3 (its blocks join the Sound category) and its rows.
    // N17 B5: the `ybc.pwm` pack (its blocks join the Pins category) and its rows.
    expect(advanced?.blockPacks).toEqual([...basicPacks, 'ybc.sensors', 'ybc.music', 'ybc.pwm']);
    expect(advanced?.constructs).toEqual([...basicConstructs, 'C-16', 'C-17', 'C-18', 'C-20', 'C-21', 'C-22', 'C-26', 'C-27']);
    expect(advanced?.controls).toEqual(['button-a', 'button-b', 'light', 'temperature', 'accelerometer']);
  });

  it('use the ybc board and offer no generic board; the circuit parts of the header pins are the generic LED, resistor and button plus the potentiometer (YB-4), and the servo in Advanced (N17 B5)', () => {
    expect(registry.get('servo').family).toBe('ybc');
    for (const profile of [basic, advanced]) {
      expect(profile?.boardType).toBe('ybc-board');
      expect(profile?.palette).toEqual(['ybc-board', 'led', 'resistor', 'push-button', 'potentiometer', ...(profile === advanced ? ['servo'] : [])]);
      expect(profile?.palette).not.toContain('board');
      // The devices of this track are of the ybc family; the three generic parts are reused by listing them (R-F3).
      expect(registry.get('ybc-board').family).toBe('ybc');
      expect(registry.get('potentiometer').family).toBe('ybc');
      for (const deviceType of ['led', 'resistor', 'push-button']) {
        expect(registry.get(deviceType).family).toBeUndefined();
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
