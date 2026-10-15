import { describe, expect, it } from 'vitest';
import { capabilityKeys } from '../capabilities/io';
import type { FieldEntry, YolobitContract } from '../compat/contract-types';
import { evaluatePred, exposureViolations, isExposable, profileConstructViolations, simDependentFields } from '../compat/contract-validation';
import { yolobitContract } from '../compat/yolobit-contract';
import { localDeviceDefinitions } from '../devices/local-catalog';
import { createDeviceRegistry } from '../devices/registry';
import { productionProfiles } from '../profiles';
import { capabilitiesOf } from '../profiles/board-context';
import { buildToolbox, createBlockPackCatalog } from '../program/block-packs';
import { images, showImage } from '../program/__fixtures__/ybc-blocks';
import { inputKindOfModel } from '../simulation/simulate-circuit';
import { langConstructs, langContractIds } from './lang';
import { hardwareConstructOf, hardwareConstructs, hardwareContractIds, hardwarePackIds } from './ybc';
import { clearDisplayType, IMAGE_SIZE, isDisplayText, pixelFieldName, scrollNumberType, scrollTextType, showImageDefinition, showImageType } from './ybc.display';
import { buttonNames, buttonPressedType, buttonPressesType, lightLevelType } from './ybc.input';
import { noteNames, noteTicks, playNoteType, restType } from './ybc.sound';

// The YB-3 hardware constructs against the frozen machine-readable contract: every block a profile shows for the
// onboard hardware is a construct, every construct a contract row that passes the exposure gate, each reaches a
// capability the board really has, and nothing excluded, deferred or owned by a later phase is shown.

const contract = yolobitContract;
const registry = createDeviceRegistry(localDeviceDefinitions);
const packs = createBlockPackCatalog(registry);
const board = registry.get('ybc-board');
const onboard = board.board?.onboard ?? [];
const profileOf = (id: string) => {
  const profile = productionProfiles.get(id);
  if (!profile) {
    throw new Error(`No profile ${id}`);
  }
  return profile;
};
const basic = profileOf('ybc-basic');
const advanced = profileOf('ybc-advanced');
const profiles = [basic, advanced];

const row = (id: string) => {
  const found = contract.constructs.find((candidate) => candidate.id === id);
  if (!found) {
    throw new Error(`No contract row ${id}`);
  }
  return found;
};

/** What YB-3 opens, spelled out here and not read from the table under test. */
const hardwareIds = ['C-06', 'C-07', 'C-08', 'C-09', 'C-12', 'C-13', 'C-15', 'C-50', 'C-51'];
const hardwareBlockTypes = [
  showImageType, scrollTextType, scrollNumberType, clearDisplayType,
  buttonPressedType, buttonPressesType, lightLevelType,
  playNoteType, restType,
];

/** The rows another phase owns, or that no phase opens: none of them may be shown by YB-3. */
const notOwned = [
  'C-10', 'C-16', 'C-23', 'C-24', 'C-25', 'C-27', 'C-42', 'C-43',
  'C-14', 'C-26', 'C-19', 'C-40', 'C-47', 'C-11', 'C-20', 'C-21', 'C-22', 'C-52',
];

type Json = Record<string, unknown>;

/** The block entries of a toolbox (`kind: 'block'`), shadows apart, wherever they are nested. */
function blocksIn(value: unknown, found: Json[] = []): Json[] {
  if (Array.isArray(value)) {
    value.forEach((item) => blocksIn(item, found));
  } else if (typeof value === 'object' && value !== null) {
    const record = value as Json;
    if (record.kind === 'block' && typeof record.type === 'string') {
      found.push(record);
    }
    Object.values(record).forEach((child) => blocksIn(child, found));
  }
  return found;
}

/** Every block type that appears in a toolbox, shadows included. */
function typesIn(value: unknown, found = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    value.forEach((item) => typesIn(item, found));
  } else if (typeof value === 'object' && value !== null) {
    const record = value as Json;
    if (typeof record.type === 'string') {
      found.add(record.type);
    }
    Object.values(record).forEach((child) => typesIn(child, found));
  }
  return found;
}

const fieldsOf = (block: Json) => (block.fields ?? {}) as Json;
const toolboxOf = (profile: typeof basic) => buildToolbox(profile.blockPacks, packs);

describe('YB-3 hardware constructs', () => {
  it('are exactly the nine rows YB-3 opens, in the order display, input, sound', () => {
    expect(hardwareContractIds).toEqual(hardwareIds);
    expect(hardwareConstructs.flatMap((construct) => construct.blockTypes)).toEqual(hardwareBlockTypes);
    expect(hardwarePackIds).toEqual(['ybc.display', 'ybc.input', 'ybc.sound']);
  });

  it.each(hardwareConstructs.map((construct) => [construct.contractId, construct] as const))(
    '%s is a contract row that passes the exposure gate, for both profiles',
    (id, construct) => {
      const contractRow = row(id);
      expect(exposureViolations(contractRow, contract)).toEqual([]);
      expect(isExposable(contractRow, contract)).toBe(true);
      expect(['ELIGIBLE', 'RESTRICTED']).toContain(contractRow.eligibility);
      expect(contractRow.profiles).toEqual(['ybc-basic', 'ybc-advanced']);
      for (const profile of profiles) {
        expect(profileConstructViolations(profile.id, [id], contract), `${profile.id}/${id}`).toEqual([]);
      }
      // A restricted row says what it is restricted to: a domain the compiler and the interpreter can check.
      expect(contractRow.python, id).toBeDefined();
      if (contractRow.eligibility === 'RESTRICTED') {
        expect(contractRow.domain, id).toBeDefined();
      }
      expect(construct.blockTypes.length).toBeGreaterThan(0);
    },
  );

  it('are RESTRICTED where the contract restricts them (image, text, number, buttons, notes, rests) and ELIGIBLE for clear and light', () => {
    const eligibility = Object.fromEntries(hardwareIds.map((id) => [id, row(id).eligibility]));
    expect(eligibility).toEqual({
      'C-06': 'RESTRICTED', 'C-07': 'RESTRICTED', 'C-08': 'RESTRICTED', 'C-09': 'ELIGIBLE',
      'C-12': 'RESTRICTED', 'C-13': 'RESTRICTED', 'C-15': 'ELIGIBLE', 'C-50': 'RESTRICTED', 'C-51': 'RESTRICTED',
    });
  });

  it('need the yolobit module (C-03b) for the display, the buttons and the light, and the music module (C-03c) for the sound', () => {
    for (const construct of hardwareConstructs) {
      const expected = construct.capability === 'sound' ? ['C-03c'] : ['C-03b'];
      expect(['display', 'buttons', 'light', 'sound'], construct.contractId).toContain(construct.capability);
      expect(row(construct.contractId).modules, construct.contractId).toEqual(expected);
    }
    expect(contract.modules.find((module) => module.id === 'C-03b')?.module).toBe('yolobit');
    expect(contract.modules.find((module) => module.id === 'C-03c')?.module).toBe('music');
  });

  it('reach the capability of the part the contract names: display, buttons, light, sound', () => {
    const capabilityOf = Object.fromEntries(hardwareConstructs.map((construct) => [construct.contractId, construct.capability]));
    expect(capabilityOf).toEqual({
      'C-06': 'display', 'C-07': 'display', 'C-08': 'display', 'C-09': 'display',
      'C-12': 'buttons', 'C-13': 'buttons', 'C-15': 'light', 'C-50': 'sound', 'C-51': 'sound',
    });
  });

  it('reach only capabilities the ybc-board really has, each through an onboard part of the right model', () => {
    const boardCapabilities = capabilitiesOf(board);
    const partOf = (id: string) => onboard.find((part) => part.id === id);
    // The parts the constructs and the controls use, and what the definition says they are.
    expect(partOf('display')).toMatchObject({ model: 'matrix-display', capability: 'display' });
    expect(partOf('button-a')).toMatchObject({ model: 'button', capability: 'buttons' });
    expect(partOf('button-b')).toMatchObject({ model: 'button', capability: 'buttons' });
    expect(partOf('light')).toMatchObject({ model: 'light-sensor', capability: 'light' });
    expect(partOf('buzzer')).toMatchObject({ model: 'buzzer', capability: 'sound' });
    for (const construct of hardwareConstructs) {
      expect(capabilityKeys, construct.contractId).toContain(construct.capability);
      expect(boardCapabilities, construct.contractId).toContain(construct.capability);
      expect(onboard.some((part) => part.capability === construct.capability), construct.contractId).toBe(true);
    }
  });

  it('are found by block type, and only by block type the table lists: not by a language block, a hat or a prototype name', () => {
    for (const construct of hardwareConstructs) {
      for (const type of construct.blockTypes) {
        expect(hardwareConstructOf(type), type).toBe(construct);
      }
    }
    for (const type of ['stem_on_start', 'stem_forever', 'text_print', 'variables_get', 'ybc_arith', '', 'ybc_button_pressed ', '__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
      expect(hardwareConstructOf(type), JSON.stringify(type)).toBeUndefined();
    }
  });

  it('give every block type to one construct: no block type is listed twice, and none belongs to the language', () => {
    const all = hardwareConstructs.flatMap((construct) => construct.blockTypes);
    expect(new Set(all).size).toBe(all.length);
    const language = new Set(langConstructs.flatMap((construct) => construct.blockTypes));
    expect(all.filter((type) => language.has(type))).toEqual([]);
    expect(new Set(hardwareContractIds).size).toBe(hardwareContractIds.length);
    expect(hardwareContractIds.filter((id) => langContractIds.includes(id))).toEqual([]);
  });
});

describe('the YB-3 block packs', () => {
  it('own exactly the block types of their constructs and register exactly those definitions', () => {
    for (const id of hardwarePackIds) {
      const pack = packs.get(id);
      expect(pack, id).toBeDefined();
      expect(pack?.family, id).toBe('ybc');
      const owned = hardwareConstructs.filter((construct) => construct.pack === id).flatMap((construct) => construct.blockTypes);
      expect(owned.length, id).toBeGreaterThan(0);
      expect([...(pack?.blockTypes ?? [])].sort(), id).toEqual([...owned].sort());
      expect((pack?.blocks ?? []).map((definition) => definition.type).sort(), id).toEqual([...owned].sort());
    }
  });

  it('register every hardware definition once with Blockly, among the definitions of all packs', () => {
    const registered = packs.definitions().map((definition) => definition.type);
    expect(new Set(registered).size).toBe(registered.length);
    for (const type of hardwareBlockTypes) {
      expect(registered.filter((candidate) => candidate === type), type).toHaveLength(1);
      expect(packs.isKnown(type), type).toBe(true);
    }
  });

  it('give each block the connections its construct needs: a statement the stack connections, a value an output', () => {
    const values = new Map<string, string>([[buttonPressedType, 'Boolean'], [buttonPressesType, 'Number'], [lightLevelType, 'Number']]);
    const definitions = hardwarePackIds.flatMap((id) => packs.get(id)?.blocks ?? []);
    expect(definitions.map((definition) => definition.type).sort()).toEqual([...hardwareBlockTypes].sort());
    for (const definition of definitions) {
      if (values.has(definition.type)) {
        expect(definition.output, definition.type).toBe(values.get(definition.type));
        expect(definition, definition.type).not.toHaveProperty('previousStatement');
        expect(definition, definition.type).not.toHaveProperty('nextStatement');
      } else {
        expect(definition.previousStatement, definition.type).toBeNull();
        expect(definition.nextStatement, definition.type).toBeNull();
        expect(definition, definition.type).not.toHaveProperty('output');
      }
    }
  });

  it('type the value inputs of the display: text for scroll text and a number for scroll number', () => {
    const inputOf = (type: string) => (packs.get('ybc.display')?.blocks.find((definition) => definition.type === type)?.args0 as Json[] | undefined)?.[0];
    expect(inputOf(scrollTextType)).toMatchObject({ type: 'input_value', name: 'TEXT', check: 'String' });
    expect(inputOf(scrollNumberType)).toMatchObject({ type: 'input_value', name: 'NUM', check: 'Number' });
  });

  it('give the show-image block exactly 25 checkbox fields named R{row}C{col}, five to a row, in reading order', () => {
    const definition = showImageDefinition as unknown as Json;
    const names: string[] = [];
    for (let row = 0; row < IMAGE_SIZE; row++) {
      const cells = definition[`args${row + 1}`] as Json[];
      expect(cells, `row ${row}`).toHaveLength(IMAGE_SIZE);
      expect(definition[`message${row + 1}`], `row ${row}`).toBe('%1 %2 %3 %4 %5');
      cells.forEach((cell, column) => {
        expect(cell.type, pixelFieldName(row, column)).toBe('field_checkbox');
        expect(cell.name, `row ${row} column ${column}`).toBe(`R${row}C${column}`);
        names.push(String(cell.name));
      });
    }
    expect(names).toHaveLength(25);
    expect(new Set(names).size).toBe(25);
    // Nothing else holds a value: no other field, no input.
    expect(definition).not.toHaveProperty('args0');
    expect(definition).not.toHaveProperty('args6');
  });
});

describe('what both profiles list', () => {
  it('is exactly the YB-3 rows next to the structure and the language, for Basic and for Advanced', () => {
    for (const profile of profiles) {
      expect([...profile.constructs].sort(), profile.id).toEqual(['C-01', 'C-02', ...langContractIds, ...hardwareIds].sort());
      expect(profileConstructViolations(profile.id, profile.constructs, contract), profile.id).toEqual([]);
      for (const pack of hardwarePackIds) {
        expect(profile.blockPacks, profile.id).toContain(pack);
      }
    }
  });

  it('keep Advanced a superset of Basic in every list', () => {
    for (const field of ['constructs', 'blockPacks', 'controls', 'palette'] as const) {
      expect(basic[field].filter((item) => !advanced[field].includes(item)), field).toEqual([]);
    }
  });

  it('do not list the rows YB-3 does not own: pins, temperature, the Advanced display, events, PWM, time, random, A+B, melodies, pitch, stop, tempo', () => {
    for (const id of notOwned) {
      expect(contract.constructs.some((candidate) => candidate.id === id), `${id} is a contract row`).toBe(true);
      expect(hardwareContractIds, id).not.toContain(id);
      for (const profile of profiles) {
        expect(profile.constructs, `${profile.id}/${id}`).not.toContain(id);
      }
    }
  });

  it('have a block type for the nine rows only: no pitch, stop, brightness, A+B, event, random, elapsed-time or pin block exists in the YBC packs', () => {
    const ybcTypes = packs.list().filter((pack) => pack.family === 'ybc').flatMap((pack) => pack.blockTypes);
    const expected = ['stem_on_start', 'stem_forever', ...langConstructs.flatMap((construct) => construct.blockTypes), ...hardwareBlockTypes];
    expect([...ybcTypes].sort()).toEqual([...expected].sort());
    expect(ybcTypes.filter((type) => /pitch|stop|brightness|tempo|melody|event|_ab\b|random|elapsed|running|timer|pin|pixel|set_all|gesture|accelerometer|temperature|servo|pwm|pulse|touch|digital|analog/i.test(type))).toEqual([]);
    for (const profile of profiles) {
      const shown = typesIn(toolboxOf(profile));
      expect([...shown].filter((type) => !expected.includes(type)), profile.id).toEqual([]);
    }
  });
});

describe('the toolbox of both profiles', () => {
  it.each(profiles.map((profile) => [profile.id, profile] as const))('%s has the Display, Input and Sound categories, after Program', (_id, profile) => {
    const names = toolboxOf(profile).contents.map((category) => category.name);
    expect(names.slice(0, 4)).toEqual(['Program', 'Display', 'Input', 'Sound']);
  });

  it.each(profiles.map((profile) => [profile.id, profile] as const))('%s shows every hardware block type, and each pack shows its own blocks in its own category', (_id, profile) => {
    const toolbox = toolboxOf(profile);
    const shown = new Set(blocksIn(toolbox.contents).map((block) => block.type));
    for (const type of hardwareBlockTypes) {
      expect(shown.has(type), type).toBe(true);
    }
    for (const [category, pack] of [['Display', 'ybc.display'], ['Input', 'ybc.input'], ['Sound', 'ybc.sound']] as const) {
      const contents = toolbox.contents.find((candidate) => candidate.name === category)?.contents;
      expect(new Set(blocksIn(contents).map((block) => block.type)), category).toEqual(new Set(packs.get(pack)?.blockTypes));
    }
  });

  it('offers a ring as the first picture of the show-image block, with all 25 cells written', () => {
    const [first] = blocksIn(toolboxOf(basic).contents).filter((block) => block.type === showImageType);
    expect(first).toBeDefined();
    const fields = fieldsOf(first ?? {});
    expect(Object.keys(fields).sort()).toEqual(Object.keys(showImage(images.RING).fields as Json).sort());
    expect(Object.keys(fields)).toHaveLength(25);
    expect(fields).toEqual(showImage(images.RING).fields);
    // Row by row, a ring: the border lit and the inside dark.
    const picture = images.RING.map((digits, rowIndex) => [...digits].map((_, column) => (fields[pixelFieldName(rowIndex, column)] === true ? '1' : '0')).join(''));
    expect(picture).toEqual(['11111', '10001', '10001', '10001', '11111']);
  });

  it.each(profiles.map((profile) => [profile.id, profile] as const))('%s presets only values inside the contract domain of the block they are on', (_id, profile) => {
    const blocks = blocksIn(toolboxOf(profile).contents);
    const ofType = (type: string) => blocks.filter((block) => block.type === type);
    const domain = (id: string) => row(id).domain;

    // Buttons: both A and B are offered, and nothing else.
    for (const [type, id] of [[buttonPressedType, 'C-12'], [buttonPressesType, 'C-13']] as const) {
      const offered = ofType(type).map((block) => fieldsOf(block).BUTTON);
      expect([...offered].sort(), type).toEqual(['A', 'B']);
      for (const button of offered) {
        expect(evaluatePred(domain(id)?.runtime ?? { all: [] }, { values: { button: String(button) } }), `${type} ${String(button)}`).toBe(true);
      }
    }
    // A note and a rest: a note of the 15 and a length of 1, 2 or 4 ticks (the dropdown saves the text of the option).
    expect(ofType(playNoteType)).not.toHaveLength(0);
    for (const block of ofType(playNoteType)) {
      const { NOTE, TICKS } = fieldsOf(block);
      expect(typeof NOTE).toBe('string');
      expect(typeof TICKS).toBe('string');
      expect(evaluatePred(domain('C-50')?.runtime ?? { all: [] }, { values: { note: String(NOTE), ticks: Number(TICKS) } }), `${String(NOTE)} ${String(TICKS)}`).toBe(true);
    }
    expect(ofType(restType)).not.toHaveLength(0);
    for (const block of ofType(restType)) {
      const { TICKS } = fieldsOf(block);
      expect(typeof TICKS).toBe('string');
      expect(evaluatePred(domain('C-51')?.runtime ?? { all: [] }, { values: { ticks: Number(TICKS) } }), String(TICKS)).toBe(true);
    }
    // The preset text of scroll text is made of the display's characters; the preset number is a whole number.
    for (const block of ofType(scrollTextType)) {
      const shadow = ((block.inputs as Json).TEXT as Json).shadow as Json;
      const text = String(fieldsOf(shadow).TEXT);
      expect(shadow.type).toBe('text');
      expect(isDisplayText(text), text).toBe(true);
      expect(evaluatePred(domain('C-07')?.runtime ?? { all: [] }, { values: { text } }), text).toBe(true);
    }
    for (const block of ofType(scrollNumberType)) {
      const shadow = ((block.inputs as Json).NUM as Json).shadow as Json;
      expect(shadow.type).toBe('math_number');
      expect(Number.isInteger(fieldsOf(shadow).NUM)).toBe(true);
    }
  });

  it('presets no value for a field the block does not have, and none for a field of another block', () => {
    const allowedFields: Record<string, string[]> = {
      [buttonPressedType]: ['BUTTON'],
      [buttonPressesType]: ['BUTTON'],
      [playNoteType]: ['NOTE', 'TICKS'],
      [restType]: ['TICKS'],
      [showImageType]: Array.from({ length: 25 }, (_, index) => pixelFieldName(Math.floor(index / 5), index % 5)),
    };
    for (const profile of profiles) {
      for (const block of blocksIn(toolboxOf(profile).contents)) {
        if (hardwareConstructOf(String(block.type))) {
          expect(Object.keys(fieldsOf(block)).sort(), `${profile.id}/${String(block.type)}`).toEqual([...(allowedFields[String(block.type)] ?? [])].sort());
        }
      }
    }
  });
});

describe('the runtime controls', () => {
  it('are the parts that take an input: the two buttons (hold) and the light sensor (slider), and neither the display nor the buzzer', () => {
    for (const profile of profiles) {
      expect(profile.controls, profile.id).toEqual(['button-a', 'button-b', 'light']);
      for (const id of profile.controls) {
        expect(onboard.some((part) => part.id === id), `${profile.id}/${id} is an onboard part`).toBe(true);
      }
    }
    const kindOf = (id: string) => {
      const model = onboard.find((part) => part.id === id)?.model ?? '';
      return Object.hasOwn(inputKindOfModel, model) ? inputKindOfModel[model] : undefined;
    };
    expect(kindOf('button-a')).toBe('hold');
    expect(kindOf('button-b')).toBe('hold');
    expect(kindOf('light')).toBe('slider');
    expect(kindOf('display')).toBeUndefined();
    expect(kindOf('buzzer')).toBeUndefined();
  });

  it('are exactly the onboard parts that take an input, so no part with an input lacks a control and no control lacks an input', () => {
    const takingInput = onboard.filter((part) => Object.hasOwn(inputKindOfModel, part.model)).map((part) => part.id);
    expect(takingInput).toEqual(['button-a', 'button-b', 'light']);
    for (const profile of profiles) {
      expect([...profile.controls].sort(), profile.id).toEqual([...takingInput].sort());
    }
  });

  it('offer no control for a part of a capability that has no construct: every control belongs to a capability the blocks use', () => {
    const used = new Set<string>(hardwareConstructs.map((construct) => construct.capability));
    for (const id of profiles.flatMap((profile) => profile.controls)) {
      const capability = onboard.find((part) => part.id === id)?.capability ?? '';
      expect(used.has(capability), id).toBe(true);
    }
  });
});

describe('the offered values against the domains of the contract', () => {
  it('give the buttons, notes and lengths the dropdowns offer exactly the oneOf of the contract rows', () => {
    const oneOf = (id: string, arg: string) => {
      const rule = row(id).domain?.compileTime.find((candidate) => 'oneOf' in candidate.when && candidate.when.oneOf.arg === arg)?.when;
      return rule && 'oneOf' in rule ? rule.oneOf.values : undefined;
    };
    expect([...buttonNames]).toEqual(oneOf('C-12', 'button'));
    expect([...buttonNames]).toEqual(oneOf('C-13', 'button'));
    expect([...noteNames]).toEqual(oneOf('C-50', 'note'));
    expect([...noteTicks]).toEqual(oneOf('C-50', 'ticks'));
    expect([...noteTicks]).toEqual(oneOf('C-51', 'ticks'));
  });
});

describe('the gate keeps a hardware construct out when its evidence is not enough', () => {
  const unsure = (label: 'UNKNOWN' | 'INFERRED'): FieldEntry => ({ label, note: 'not established' });
  const mutatedRow = (id: string, field: keyof YolobitContract['constructs'][number]['fields'], entry: FieldEntry): YolobitContract => ({
    ...contract,
    constructs: contract.constructs.map((candidate) => (candidate.id === id ? { ...candidate, fields: { ...candidate.fields, [field]: entry } } : candidate)),
  });
  const mutatedModule = (id: string, field: 'import' | 'module', entry: FieldEntry): YolobitContract => ({
    ...contract,
    modules: contract.modules.map((candidate) => (candidate.id === id ? { ...candidate, fields: { ...candidate.fields, [field]: entry } } : candidate)),
  });
  const requiredFields = (id: string) =>
    Object.entries(row(id).fields)
      .filter(([, entry]) => entry.label !== 'n/a')
      .map(([field]) => field as keyof YolobitContract['constructs'][number]['fields']);

  it.each(['UNKNOWN', 'INFERRED'] as const)('a profile cannot list a hardware row whose required field is %s: every field of every row', (label) => {
    for (const id of hardwareIds) {
      const fields = requiredFields(id);
      expect(fields.length, id).toBeGreaterThan(0);
      for (const field of fields) {
        const broken = mutatedRow(id, field, unsure(label));
        for (const profile of profiles) {
          expect(profileConstructViolations(profile.id, [id], broken), `${profile.id}/${id}.${field}`).not.toEqual([]);
        }
        expect(isExposable(broken.constructs.find((candidate) => candidate.id === id) ?? row(id), broken), `${id}.${field}`).toBe(false);
      }
    }
  });

  it.each(['UNKNOWN', 'INFERRED'] as const)('a profile cannot list a hardware row whose module is %s: C-03b for the display, buttons and light, C-03c for the sound', (label) => {
    for (const [module, ids] of [['C-03b', ['C-06', 'C-07', 'C-08', 'C-09', 'C-12', 'C-13', 'C-15']], ['C-03c', ['C-50', 'C-51']]] as const) {
      for (const field of ['import', 'module'] as const) {
        const broken = mutatedModule(module, field, unsure(label));
        for (const id of ids) {
          expect(profileConstructViolations('ybc-basic', [id], broken), `${module}.${field} -> ${id}`).not.toEqual([]);
        }
      }
    }
  });

  it('would drop every hardware row if RV-1 were rejected, because each rests on the public simulator alone for some claim (contract §22.3)', () => {
    for (const id of hardwareIds) {
      expect(simDependentFields(row(id), contract).length, `${id} rests on the simulator`).toBeGreaterThan(0);
      expect(isExposable(row(id), contract), id).toBe(true);
      expect(isExposable(row(id), contract, 'REJECTED'), id).toBe(false);
      expect(exposureViolations(row(id), contract, 'REJECTED'), id).not.toEqual([]);
      for (const profile of profiles) {
        expect(profileConstructViolations(profile.id, [id], contract, 'REJECTED'), `${profile.id}/${id}`).not.toEqual([]);
      }
    }
  });

  it('would keep the language rows if RV-1 were rejected: only the hardware depends on the simulator', () => {
    for (const id of ['C-01', 'C-02', ...langContractIds]) {
      expect(isExposable(row(id), contract, 'REJECTED'), id).toBe(true);
    }
  });

  it('a profile cannot list the rows YB-3 does not own, whether the contract excludes them, defers them or leaves them to a later phase', () => {
    for (const id of ['C-14', 'C-26', 'C-19', 'C-40', 'C-47', 'C-11', 'C-20', 'C-21', 'C-22', 'C-52']) {
      expect(profileConstructViolations('ybc-basic', [id], contract), id).not.toEqual([]);
    }
  });
});
