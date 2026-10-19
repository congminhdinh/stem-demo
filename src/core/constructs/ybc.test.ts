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
import {
  clearDisplayType, clearPixelType, colourType, IMAGE_SIZE, isDisplayText, paletteColours, pixelFieldName, scrollNumberType, scrollTextType, setAllType,
  setPixelType, showIconType, showImageDefinition, showImageType,
} from './ybc.display';
import { accelerationType, axisNames, buttonNames, buttonPressedType, buttonPressesType, gestureIsType, gestureNames, lightLevelType, temperatureType } from './ybc.input';
import { pinConstructs, pinContractIds } from './ybc.pins';
import { melodyNames, melodyType, noteNames, noteTicks, pitchType, playNoteType, restType, soundStopType } from './ybc.sound';

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

/**
 * What YB-3 opens, the RGB display N17 B1 adds to it (C-05, C-10, C-42, C-43), the sensors of the Advanced board N17 B2 adds
 * (C-16, C-17, C-18) and the melodies, the tone and stop N17 B3 adds to it (C-20, C-21, C-22), spelled out here and not read from
 * the table under test.
 */
const sensorIds = ['C-16', 'C-17', 'C-18'];
const musicIds = ['C-20', 'C-21', 'C-22'];
const advancedOnlyIds = [...sensorIds, ...musicIds];
const hardwareIds = ['C-06', 'C-07', 'C-08', 'C-09', 'C-05', 'C-10', 'C-42', 'C-43', 'C-12', 'C-13', 'C-15', 'C-50', 'C-51', ...sensorIds, ...musicIds];
const sensorBlockTypes = [temperatureType, accelerationType, gestureIsType];
const musicBlockTypes = [melodyType, pitchType, soundStopType];
const advancedOnlyBlockTypes = [...sensorBlockTypes, ...musicBlockTypes];
const hardwareBlockTypes = [
  showImageType, scrollTextType, scrollNumberType, clearDisplayType,
  showIconType, setPixelType, colourType, clearPixelType, setAllType,
  buttonPressedType, buttonPressesType, lightLevelType,
  playNoteType, restType,
  ...sensorBlockTypes,
  ...musicBlockTypes,
];
/** The profiles that show a hardware row: the sensors (C-16…C-18) and the melodies, tone and stop (C-20…C-22) are Advanced only. */
const profilesOf = (id: string) => (advancedOnlyIds.includes(id) ? [advanced] : profiles);

/** Rows the onboard hardware does not own that no profile lists yet. The header pins (C-23…C-25) are not its either: they are YB-4's, and listed. */
const notOwned = [
  'C-27',
  'C-14', 'C-26', 'C-19', 'C-40', 'C-47', 'C-11', 'C-52',
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
  it('are exactly the rows YB-3, N17 B1, N17 B2 and N17 B3 open, in the order display, input, sound, sensors, music', () => {
    expect(hardwareContractIds).toEqual(hardwareIds);
    expect(hardwareConstructs.flatMap((construct) => construct.blockTypes)).toEqual(hardwareBlockTypes);
    expect(hardwarePackIds).toEqual(['ybc.display', 'ybc.input', 'ybc.sound', 'ybc.sensors', 'ybc.music']);
  });

  it.each(hardwareConstructs.map((construct) => [construct.contractId, construct] as const))(
    '%s is a contract row that passes the exposure gate, for the profiles meant to show it (the sensors and the music: Advanced only)',
    (id, construct) => {
      const contractRow = row(id);
      expect(exposureViolations(contractRow, contract)).toEqual([]);
      expect(isExposable(contractRow, contract)).toBe(true);
      expect(['ELIGIBLE', 'RESTRICTED']).toContain(contractRow.eligibility);
      expect(contractRow.profiles).toEqual(profilesOf(id).map((profile) => profile.id));
      for (const profile of profilesOf(id)) {
        expect(profileConstructViolations(profile.id, [id], contract), `${profile.id}/${id}`).toEqual([]);
      }
      if (advancedOnlyIds.includes(id)) {
        expect(profileConstructViolations('ybc-basic', [id], contract), id).not.toEqual([]);
      }
      // A restricted row says what it is restricted to: a domain the compiler and the interpreter can check.
      expect(contractRow.python, id).toBeDefined();
      if (contractRow.eligibility === 'RESTRICTED') {
        expect(contractRow.domain, id).toBeDefined();
      }
      expect(construct.blockTypes.length).toBeGreaterThan(0);
    },
  );

  it('are RESTRICTED where the contract restricts them (images, text, number, pixels, fill, buttons, notes, rests, sensors, melodies, tones) and ELIGIBLE for clear, light and stop', () => {
    const eligibility = Object.fromEntries(hardwareIds.map((id) => [id, row(id).eligibility]));
    expect(eligibility).toEqual({
      'C-06': 'RESTRICTED', 'C-07': 'RESTRICTED', 'C-08': 'RESTRICTED', 'C-09': 'ELIGIBLE',
      'C-05': 'RESTRICTED', 'C-10': 'RESTRICTED', 'C-42': 'RESTRICTED', 'C-43': 'RESTRICTED',
      'C-12': 'RESTRICTED', 'C-13': 'RESTRICTED', 'C-15': 'ELIGIBLE', 'C-50': 'RESTRICTED', 'C-51': 'RESTRICTED',
      'C-16': 'RESTRICTED', 'C-17': 'RESTRICTED', 'C-18': 'RESTRICTED',
      'C-20': 'RESTRICTED', 'C-21': 'RESTRICTED', 'C-22': 'ELIGIBLE',
    });
  });

  it('need the yolobit module (C-03b) for the display, the buttons and the light, and the music module (C-03c) for the sound', () => {
    for (const construct of hardwareConstructs) {
      const expected = construct.capability === 'sound' ? ['C-03c'] : ['C-03b'];
      expect(['display', 'buttons', 'light', 'sound', 'temperature', 'motion'], construct.contractId).toContain(construct.capability);
      expect(row(construct.contractId).modules, construct.contractId).toEqual(expected);
    }
    expect(contract.modules.find((module) => module.id === 'C-03b')?.module).toBe('yolobit');
    expect(contract.modules.find((module) => module.id === 'C-03c')?.module).toBe('music');
  });

  it('reach the capability of the part the contract names: display, buttons, light, sound, temperature, motion', () => {
    const capabilityOf = Object.fromEntries(hardwareConstructs.map((construct) => [construct.contractId, construct.capability]));
    expect(capabilityOf).toEqual({
      'C-06': 'display', 'C-07': 'display', 'C-08': 'display', 'C-09': 'display',
      'C-05': 'display', 'C-10': 'display', 'C-42': 'display', 'C-43': 'display',
      'C-12': 'buttons', 'C-13': 'buttons', 'C-15': 'light', 'C-50': 'sound', 'C-51': 'sound',
      'C-16': 'temperature', 'C-17': 'motion', 'C-18': 'motion',
      'C-20': 'sound', 'C-21': 'sound', 'C-22': 'sound',
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
    expect(partOf('temperature')).toMatchObject({ model: 'temperature-sensor', capability: 'temperature' });
    expect(partOf('accelerometer')).toMatchObject({ model: 'accelerometer', capability: 'motion' });
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
    const values = new Map<string, string>([
      [buttonPressedType, 'Boolean'], [buttonPressesType, 'Number'], [lightLevelType, 'Number'], [colourType, 'Colour'],
      [temperatureType, 'Number'], [accelerationType, 'Number'], [gestureIsType, 'Boolean'],
    ]);
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

  it('type the value inputs of the display: text for scroll text, a number for scroll number and the coordinates, a colour for the colour (N17)', () => {
    const argsOf = (type: string) => (packs.get('ybc.display')?.blocks.find((definition) => definition.type === type)?.args0 as Json[] | undefined) ?? [];
    const colour = { type: 'input_value', name: 'COLOUR', check: 'Colour' };
    expect(argsOf(scrollTextType)).toEqual([{ type: 'input_value', name: 'TEXT', check: 'String' }, colour]);
    expect(argsOf(scrollNumberType)).toEqual([{ type: 'input_value', name: 'NUM', check: 'Number' }, colour]);
    const coordinates = [{ type: 'input_value', name: 'X', check: 'Number' }, { type: 'input_value', name: 'Y', check: 'Number' }];
    expect(argsOf(setPixelType)).toEqual([...coordinates, colour]);
    expect(argsOf(clearPixelType)).toEqual(coordinates);
    expect(argsOf(setAllType)).toEqual([colour]);
  });

  it('type the value inputs of the tone (N17 B3): a number for the Hz and one for the ms; the melody and its mode are dropdowns', () => {
    const argsOf = (type: string) => (packs.get('ybc.music')?.blocks.find((definition) => definition.type === type)?.args0 as Json[] | undefined) ?? [];
    expect(argsOf(pitchType)).toEqual([{ type: 'input_value', name: 'HZ', check: 'Number' }, { type: 'input_value', name: 'MS', check: 'Number' }]);
    const [melody, mode] = argsOf(melodyType);
    expect(melody?.type).toBe('field_dropdown');
    expect((melody?.options as string[][]).map(([, value]) => value)).toEqual([...melodyNames]);
    expect(mode).toMatchObject({ type: 'field_dropdown', name: 'MODE' });
    expect((mode?.options as string[][]).map(([, value]) => value)).toEqual(['wait', 'background']);
    expect(argsOf(soundStopType)).toEqual([]);
  });

  it('offer the eight colours of the palette (contract §4.4), red first, in the colour block and the colour field of "show image"', () => {
    const options = [['red', '#ff0000'], ['orange', '#ffa500'], ['yellow', '#ffff00'], ['green', '#00ff00'], ['blue', '#0000ff'], ['indigo', '#4b0082'], ['purple', '#800080'], ['white', '#ffffff']];
    const dropdownOf = (type: string) => (packs.get('ybc.display')?.blocks.find((definition) => definition.type === type)?.args0 as Json[] | undefined)?.[0];
    expect(dropdownOf(colourType)).toEqual({ type: 'field_dropdown', name: 'COLOUR', options });
    expect(dropdownOf(showImageType)).toEqual({ type: 'field_dropdown', name: 'COLOUR', options });
    expect(paletteColours.map(({ value }) => value.toUpperCase())).toEqual(contract.display.palette);
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
    // Nothing else holds a value but the colour field of N17 on the first line: no other field, no input.
    expect(definition.message0).toBe('show image in %1');
    expect((definition.args0 as Json[]).map((arg) => [arg.type, arg.name])).toEqual([['field_dropdown', 'COLOUR']]);
    expect(definition).not.toHaveProperty('args6');
  });
});

describe('what both profiles list', () => {
  it('is exactly the hardware rows next to the structure, the language and the header pins of YB-4: Advanced all of them, Basic all but the sensors and the music', () => {
    for (const profile of profiles) {
      const shown = profile === advanced ? hardwareIds : hardwareIds.filter((id) => !advancedOnlyIds.includes(id));
      expect([...profile.constructs].sort(), profile.id).toEqual(['C-01', 'C-02', ...langContractIds, ...shown, ...pinContractIds].sort());
      expect(profileConstructViolations(profile.id, profile.constructs, contract), profile.id).toEqual([]);
      for (const pack of hardwarePackIds) {
        if (profile === advanced || (pack !== 'ybc.sensors' && pack !== 'ybc.music')) {
          expect(profile.blockPacks, profile.id).toContain(pack);
        } else {
          expect(profile.blockPacks, profile.id).not.toContain(pack);
        }
      }
    }
  });

  it('keep Advanced a superset of Basic in every list', () => {
    for (const field of ['constructs', 'blockPacks', 'controls', 'palette'] as const) {
      expect(basic[field].filter((item) => !advanced[field].includes(item)), field).toEqual([]);
    }
  });

  it('do not list the rows the onboard hardware does not own (events, PWM, time, random, A+B, brightness, tempo), and do not count the pins of YB-4 as its rows', () => {
    for (const id of pinContractIds) {
      expect(hardwareContractIds, id).not.toContain(id);
    }
    for (const id of notOwned) {
      expect(contract.constructs.some((candidate) => candidate.id === id), `${id} is a contract row`).toBe(true);
      expect(hardwareContractIds, id).not.toContain(id);
      for (const profile of profiles) {
        expect(profile.constructs, `${profile.id}/${id}`).not.toContain(id);
      }
    }
  });

  it('have a block type for the onboard rows and the three pin rows of YB-4 only: no brightness, tempo, A+B, event, random, elapsed-time or other pin block exists in the YBC packs', () => {
    const ybcTypes = packs.list().filter((pack) => pack.family === 'ybc').flatMap((pack) => pack.blockTypes);
    const pinBlockTypes = pinConstructs.flatMap((construct) => construct.blockTypes);
    const expected = ['stem_on_start', 'stem_forever', ...langConstructs.flatMap((construct) => construct.blockTypes), ...hardwareBlockTypes, ...pinBlockTypes];
    expect([...ybcTypes].sort()).toEqual([...expected].sort());
    expect(ybcTypes.filter((type) => !pinBlockTypes.includes(type) && !advancedOnlyBlockTypes.includes(type)).filter((type) => /pitch|stop|brightness|tempo|melody|event|_ab\b|random|elapsed|running|timer|_pin_|gesture|accel|temperature|servo|pwm|pulse|touch|digital|analog/i.test(type))).toEqual([]);
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

  it.each(profiles.map((profile) => [profile.id, profile] as const))('%s shows every hardware block type it lists, and each pack shows its own blocks in its own category', (_id, profile) => {
    const toolbox = toolboxOf(profile);
    const shown = new Set(blocksIn(toolbox.contents).map((block) => block.type));
    for (const type of hardwareBlockTypes) {
      expect(shown.has(type), type).toBe(profile === advanced || !advancedOnlyBlockTypes.includes(type));
    }
    // N17 B2: the sensors of Advanced join the Input category, after the buttons and the light; N17 B3: the melodies, the tone
    // and stop join the Sound category, after the note and the rest. Each category is shown once.
    const input = profile === advanced ? ['ybc.input', 'ybc.sensors'] : ['ybc.input'];
    const sound = profile === advanced ? ['ybc.sound', 'ybc.music'] : ['ybc.sound'];
    for (const [category, packIds] of [['Display', ['ybc.display']], ['Input', input], ['Sound', sound]] as const) {
      expect(toolbox.contents.filter((candidate) => candidate.name === category), category).toHaveLength(1);
      const contents = toolbox.contents.find((candidate) => candidate.name === category)?.contents;
      expect(new Set(blocksIn(contents).map((block) => block.type)), category).toEqual(new Set(packIds.flatMap((pack) => packs.get(pack)?.blockTypes ?? [])));
    }
  });

  it('offers a ring as the first picture of the show-image block, with all 25 cells written, in red', () => {
    const [first] = blocksIn(toolboxOf(basic).contents).filter((block) => block.type === showImageType);
    expect(first).toBeDefined();
    const fields = fieldsOf(first ?? {});
    expect(fields.COLOUR).toBe('#ff0000');
    expect(Object.keys(fields).sort()).toEqual(Object.keys(showImage(images.RING).fields as Json).sort());
    expect(Object.keys(fields).filter((name) => /^R\dC\d$/.test(name))).toHaveLength(25);
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
    // N17 B3 (Advanced): a melody of the twenty, until done or in the background; a tone of 20..20000 Hz for 0..60000 ms.
    for (const block of ofType(melodyType)) {
      const { MELODY, MODE } = fieldsOf(block);
      expect(evaluatePred(domain('C-20')?.runtime ?? { all: [] }, { values: { melody: String(MELODY) } }), String(MELODY)).toBe(true);
      expect(['wait', 'background']).toContain(MODE);
    }
    for (const block of ofType(pitchType)) {
      const numberIn = (name: string) => {
        const shadow = ((block.inputs as Json)[name] as Json).shadow as Json;
        expect(shadow.type).toBe('math_number');
        return Number(fieldsOf(shadow).NUM);
      };
      expect(evaluatePred(domain('C-21')?.runtime ?? { all: [] }, { values: { hz: numberIn('HZ'), ms: numberIn('MS') } })).toBe(true);
    }
    expect(ofType(melodyType).length > 0 && ofType(pitchType).length > 0 && ofType(soundStopType).length > 0).toBe(profile === advanced);
  });

  it('presets no value for a field the block does not have, and none for a field of another block', () => {
    const allowedFields: Record<string, string[]> = {
      [buttonPressedType]: ['BUTTON'],
      [buttonPressesType]: ['BUTTON'],
      [playNoteType]: ['NOTE', 'TICKS'],
      [restType]: ['TICKS'],
      [showImageType]: [...Array.from({ length: 25 }, (_, index) => pixelFieldName(Math.floor(index / 5), index % 5)), 'COLOUR'],
      [showIconType]: ['ICON'],
      [colourType]: ['COLOUR'],
      [accelerationType]: ['AXIS'],
      [gestureIsType]: ['GESTURE'],
      [melodyType]: ['MELODY', 'MODE'],
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
  it('are the parts that take an input: the two buttons (hold) and the light sensor (slider), and in Advanced the temperature (slider) and the accelerometer (tilt); never the display or the buzzer', () => {
    expect(basic.controls).toEqual(['button-a', 'button-b', 'light']);
    expect(advanced.controls).toEqual(['button-a', 'button-b', 'light', 'temperature', 'accelerometer']);
    for (const profile of profiles) {
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
    expect(kindOf('temperature')).toBe('slider');
    expect(kindOf('accelerometer')).toBe('tilt');
    expect(kindOf('display')).toBeUndefined();
    expect(kindOf('buzzer')).toBeUndefined();
  });

  it('are exactly the onboard parts that take an input, so no part with an input lacks a control in Advanced and no control lacks an input', () => {
    const takingInput = onboard.filter((part) => Object.hasOwn(inputKindOfModel, part.model)).map((part) => part.id);
    expect(takingInput).toEqual(['button-a', 'button-b', 'light', 'temperature', 'accelerometer']);
    expect([...advanced.controls].sort()).toEqual([...takingInput].sort());
    // Basic has no block that reads the sensors of N17 B2, so it shows no control for them.
    expect([...basic.controls].sort()).toEqual(['button-a', 'button-b', 'light']);
  });

  it('offer no control for a part of a capability that has no construct in the profile: every control belongs to a capability its blocks use', () => {
    for (const profile of profiles) {
      const used = new Set<string>(hardwareConstructs.filter((construct) => profile.constructs.includes(construct.contractId)).map((construct) => construct.capability));
      for (const id of profile.controls) {
        const capability = onboard.find((part) => part.id === id)?.capability ?? '';
        expect(used.has(capability), `${profile.id}/${id}`).toBe(true);
      }
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
    expect([...axisNames]).toEqual(oneOf('C-17', 'axis'));
    expect([...gestureNames]).toEqual(oneOf('C-18', 'gesture'));
    expect([...melodyNames]).toEqual(oneOf('C-20', 'melody'));
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

  it.each(['UNKNOWN', 'INFERRED'] as const)('a profile cannot list a hardware row whose required field is %s: every field of every row (but the UNKNOWN ones the owner opened as UNVERIFIED, N17 B2)', (label) => {
    for (const id of hardwareIds) {
      const named = Object.keys(row(id).unverifiedFields ?? {});
      const fields = requiredFields(id).filter((field) => !(label === 'UNKNOWN' && named.includes(field)));
      expect(fields.length, id).toBeGreaterThan(0);
      for (const field of fields) {
        const broken = mutatedRow(id, field, unsure(label));
        for (const profile of profilesOf(id)) {
          expect(profileConstructViolations(profile.id, [id], broken), `${profile.id}/${id}.${field}`).not.toEqual([]);
        }
        expect(isExposable(broken.constructs.find((candidate) => candidate.id === id) ?? row(id), broken), `${id}.${field}`).toBe(false);
      }
    }
  });

  it.each(['UNKNOWN', 'INFERRED'] as const)('a profile cannot list a hardware row whose module is %s: C-03b for the display, buttons and light, C-03c for the sound', (label) => {
    for (const [module, ids] of [['C-03b', ['C-06', 'C-07', 'C-08', 'C-09', 'C-05', 'C-10', 'C-42', 'C-43', 'C-12', 'C-13', 'C-15', 'C-16', 'C-17', 'C-18']], ['C-03c', ['C-50', 'C-51', 'C-20', 'C-21', 'C-22']]] as const) {
      for (const field of ['import', 'module'] as const) {
        const broken = mutatedModule(module, field, unsure(label));
        for (const id of ids) {
          expect(profileConstructViolations('ybc-advanced', [id], broken), `${module}.${field} -> ${id}`).not.toEqual([]);
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
    for (const id of ['C-14', 'C-26', 'C-19', 'C-40', 'C-47', 'C-11', 'C-52']) {
      expect(profileConstructViolations('ybc-basic', [id], contract), id).not.toEqual([]);
    }
  });
});
