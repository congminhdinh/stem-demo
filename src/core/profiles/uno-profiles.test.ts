import { describe, expect, it } from 'vitest';
import { exposableConstructs, profileConstructViolations } from '../compat/contract-validation';
import { unoContract } from '../compat/uno-contract';
import { localDeviceDefinitions } from '../devices/local-catalog';
import { createDeviceRegistry } from '../devices/registry';
import { createBlockPackCatalog } from '../program/block-packs';
import { createProfileCatalog, productionProfiles } from './index';

// The UNO-compatible profiles of the robot lab (N18 R2.1, plan §4.0). Their rows are the UNO contract's
// (docs/uno-compatibility-contract.md §10.1); the contract is test data only, so production code never imports it. Their
// block packs are R2.2's (constructs/uno*.ts, program/block-packs.ts).

const registry = createDeviceRegistry(localDeviceDefinitions);
const basic = productionProfiles.get('uno-basic');
const advanced = productionProfiles.get('uno-advanced');
const ids = (rows: readonly { id: string }[]) => rows.map((row) => row.id).sort();

/** The language of both profiles: setup/loop, long variables and literals, int32 maths, logic, control flow, print, wait. */
const language = ['U-01', 'U-02', 'U-03', 'U-04', 'U-05', 'U-06', 'U-07', 'U-08', 'U-09', 'U-10', 'U-11', 'U-12', 'U-13', 'U-14', 'U-15', 'U-16', 'U-17', 'U-18'];
/** The module rows of Basic, by kit role: drive (motor, drive, stop), sensors (ultrasonic, line dark, button), servo, LED and buzzer tone. */
const basicModules = {
  drive: ['U-20', 'U-21', 'U-22'],
  sensor: ['U-27', 'U-28', 'U-30'],
  servo: ['U-23'],
  led: ['U-24', 'U-25'],
};
/** What only Advanced adds: millis, buzzer stop, the raw line value and the raw pins. */
const advancedOnly = ['U-19', 'U-26', 'U-29', 'U-31', 'U-32', 'U-33', 'U-34'];

describe('the UNO profiles (N18 R2.1)', () => {
  it('are of the uno family, on the UNO board, with only that board in the palette and no runtime control', () => {
    for (const profile of [basic, advanced]) {
      expect(profile, profile?.id).toMatchObject({ family: 'uno', boardType: 'uno-r3', palette: ['uno-r3'], controls: [], variableTypes: ['int'] });
      expect(registry.get(profile?.boardType ?? '').family).toBe('uno');
    }
    expect(advanced?.extends).toBe('uno-basic');
  });

  it('uno-basic exposes only drive/sensor/servo/led constructs', () => {
    // Besides the language, every row of Basic is a module of the kit (the buzzer tone is an output like the LED: contract U-25,
    // in both profiles). No raw pin, no millis, no raw line value.
    const modules = Object.values(basicModules).flat();
    expect([...(basic?.constructs ?? [])].sort()).toEqual([...language, ...modules].sort());
    for (const id of advancedOnly) {
      expect(basic?.constructs, id).not.toContain(id);
    }
  });

  it('gives Advanced every row of Basic, then millis, buzzer stop, the raw line value and the raw pins', () => {
    expect(advanced?.constructs).toEqual([...(basic?.constructs ?? []), ...advancedOnly]);
  });

  it('list exactly the rows the UNO contract opens for them, each passing the exposure gate (EG)', () => {
    expect([...(basic?.constructs ?? [])].sort()).toEqual(ids(exposableConstructs(unoContract, 'uno-basic')));
    expect([...(advanced?.constructs ?? [])].sort()).toEqual(ids(exposableConstructs(unoContract, 'uno-advanced')));
    expect(profileConstructViolations('uno-basic', basic?.constructs ?? [], unoContract)).toEqual([]);
    expect(profileConstructViolations('uno-advanced', advanced?.constructs ?? [], unoContract)).toEqual([]);
  });

  it('show the uno packs of R2.2: Basic the structure, the robot and the language, Advanced adds the raw line value, buzzer stop and the raw pins', () => {
    const packs = createBlockPackCatalog(registry);
    const basicPacks = ['uno.structure', 'uno.drive', 'uno.sensors', 'uno.servo', 'uno.output', 'uno.logic', 'uno.loops', 'uno.math', 'uno.text', 'uno.variables'];
    expect(basic?.blockPacks).toEqual(basicPacks);
    expect(advanced?.blockPacks).toEqual([...basicPacks, 'uno.sensors.advanced', 'uno.output.advanced', 'uno.pins']);
    for (const profile of [basic, advanced]) {
      expect(() => packs.typesOf(profile?.blockPacks ?? [])).not.toThrow();
      expect((profile?.blockPacks ?? []).map((id) => packs.get(id)?.family), profile?.id).toEqual((profile?.blockPacks ?? []).map(() => 'uno'));
    }
  });
});

describe('the profile family', () => {
  const base = { boardType: 'b', constructs: [], blockPacks: [], palette: [], controls: [], variableTypes: [] };

  it('is ybc or uno; generic has no profile', () => {
    expect(createProfileCatalog([{ ...base, id: 'u', family: 'uno' }]).get('u')?.family).toBe('uno');
    expect(() => createProfileCatalog([{ ...base, id: 'g', family: 'generic' }])).toThrow();
  });

  it('is the family of the profile extended: an extension cannot change it', () => {
    expect(() =>
      createProfileCatalog([
        { ...base, id: 'a', family: 'ybc' },
        { ...base, id: 'b', family: 'uno', extends: 'a' },
      ]),
    ).toThrow('Profile "b" has another family than "a"');
  });
});
