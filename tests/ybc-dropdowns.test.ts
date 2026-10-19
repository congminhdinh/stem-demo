import * as Blockly from 'blockly/core';
import 'blockly/blocks';
import * as En from 'blockly/msg/en';
import { describe, expect, it } from 'vitest';
import { localDeviceDefinitions } from '../src/core/devices/local-catalog';
import { createDeviceRegistry } from '../src/core/devices/registry';
import { productionProfiles } from '../src/core/profiles';
import { buildToolbox, createBlockPackCatalog } from '../src/core/program/block-packs';
import { noteNames, noteTicks } from '../src/core/constructs/ybc.sound';
import { buttonNames } from '../src/core/constructs/ybc.input';
import { compileYbcProgram } from '../src/core/program/compile-ybc-program';
import { program, print, num, foreignArith } from '../src/core/program/__fixtures__/ybc-blocks';

// Learner-visible dropdowns (YB plan §6.2, review YB2A-R1): a dropdown option is an operation a
// learner can pick, so it must pass the exposure gate like a block does. These read the options
// from real Blockly blocks, not from the preset values of the toolbox.

Blockly.setLocale(En as unknown as Record<string, string>);
const packs = createBlockPackCatalog(createDeviceRegistry(localDeviceDefinitions));
// What the editor registers: the blocks of every known pack.
Blockly.common.defineBlocksWithJsonArray(packs.definitions());
const exposed = packs.typesOf(productionProfiles.get('ybc-basic')?.blockPacks ?? []);

/** The operators each dropdown may offer: the frozen supported domain (plan §6.4). A new dropdown must be added here on purpose. */
const allowed: Record<string, Record<string, string[]>> = {
  ybc_arith: { OP: ['ADD', 'MINUS', 'MULTIPLY'] },
  logic_compare: { OP: ['EQ', 'NEQ', 'LT', 'LTE', 'GT', 'GTE'] },
  logic_operation: { OP: ['AND', 'OR'] },
  logic_boolean: { BOOL: ['TRUE', 'FALSE'] },
  // YB-3, the onboard hardware: the buttons are A and B and nothing else (A+B is EXCLUDED, C-47), a note is one of the 15
  // natural notes C3…C5 (C-50) and a length is 1, 2 or 4 ticks (C-50, C-51). Spelled out here, not read from the constants.
  ybc_button_pressed: { BUTTON: ['A', 'B'] },
  ybc_button_presses: { BUTTON: ['A', 'B'] },
  ybc_sound_note: {
    NOTE: ['C3', 'D3', 'E3', 'F3', 'G3', 'A3', 'B3', 'C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5'],
    TICKS: ['1', '2', '4'],
  },
  ybc_sound_rest: { TICKS: ['1', '2', '4'] },
  // YB-4, contract C-23…C-25: the three pins the contract opens, and ON (1) / OFF (0). Never P3…P20, never PWM.
  ybc_pin_write: { PIN: ['P0', 'P1', 'P2'], LEVEL: ['1', '0'] },
  ybc_pin_read: { PIN: ['P0', 'P1', 'P2'] },
  ybc_pin_analog: { PIN: ['P0', 'P1', 'P2'] },
  // N17 B1, the RGB display: the eight palette colours of contract §4.4 (red first, as the editor's colour field writes them),
  // and the thirteen built-in pictures (C-05: nine names of the editor's list and four arrows).
  ybc_colour: { COLOUR: ['#ff0000', '#ffa500', '#ffff00', '#00ff00', '#0000ff', '#4b0082', '#800080', '#ffffff'] },
  ybc_display_show_image: { COLOUR: ['#ff0000', '#ffa500', '#ffff00', '#00ff00', '#0000ff', '#4b0082', '#800080', '#ffffff'] },
  ybc_display_show_icon: {
    ICON: ['HEART', 'HEART_SMALL', 'HAPPY', 'SAD', 'CONFUSED', 'ANGRY', 'SURPRISED', 'YES', 'NO', 'ARROW_N', 'ARROW_E', 'ARROW_S', 'ARROW_W'],
  },
};

function blockTypesIn(value: unknown, found = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    value.forEach((item) => blockTypesIn(item, found));
  } else if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    if (typeof record.type === 'string') {
      found.add(record.type);
    }
    Object.values(record).forEach((child) => blockTypesIn(child, found));
  }
  return found;
}

describe('dropdowns of the YBC toolbox', () => {
  for (const profileId of ['ybc-basic', 'ybc-advanced']) {
    it(`offers in ${profileId} only supported operators, on every dropdown of every toolbox block`, () => {
      const types = [...blockTypesIn(buildToolbox(productionProfiles.get(profileId)?.blockPacks ?? [], packs))];
      expect(types.length).toBeGreaterThan(10);
      const workspace = new Blockly.Workspace();
      try {
        let dropdowns = 0;
        for (const type of types) {
          const block = workspace.newBlock(type);
          for (const input of block.inputList) {
            for (const field of input.fieldRow) {
              // A variable picker lists the learner's own variables; it is not an operator.
              if (field instanceof Blockly.FieldDropdown && !(field instanceof Blockly.FieldVariable) && field.name) {
                dropdowns++;
                expect(field.getOptions(false).map(([, value]) => value), `${type}.${field.name}`).toEqual(allowed[type]?.[field.name]);
              }
            }
          }
        }
        // The four of the language, the five of the YB-3 hardware (two buttons, a note and its length, a rest's length) and the
        // three of N17 B1 (the colour block, the colour of a picture, the built-in picture).
        expect(dropdowns).toBeGreaterThanOrEqual(12);
      } finally {
        workspace.dispose();
      }
    });
  }

  it('gives the hardware dropdowns exactly the contract domains, read from real Blockly blocks', () => {
    const workspace = new Blockly.Workspace();
    try {
      const options = (type: string, name: string) =>
        (workspace.newBlock(type).getField(name) as Blockly.FieldDropdown).getOptions(false).map(([, value]) => value);
      expect(options('ybc_button_pressed', 'BUTTON')).toEqual([...buttonNames]);
      expect(options('ybc_button_presses', 'BUTTON')).toEqual([...buttonNames]);
      expect(options('ybc_sound_note', 'NOTE')).toEqual([...noteNames]);
      expect(options('ybc_sound_note', 'TICKS')).toEqual(noteTicks.map(String));
      expect(options('ybc_sound_rest', 'TICKS')).toEqual(noteTicks.map(String));
      // No A+B, no sharps or flats, no octave beyond C3…C5, no length of 8 ticks.
      expect(options('ybc_button_pressed', 'BUTTON')).not.toContain('A+B');
      expect(options('ybc_sound_note', 'NOTE')).toHaveLength(15);
      expect(options('ybc_sound_note', 'TICKS')).not.toContain('8');
    } finally {
      workspace.dispose();
    }
  });

  it('gives ybc_arith exactly + − ×: no DIVIDE, no POWER', () => {
    const workspace = new Blockly.Workspace();
    try {
      const field = workspace.newBlock('ybc_arith').getField('OP') as Blockly.FieldDropdown;
      expect(field.getOptions(false).map(([, value]) => value)).toEqual(['ADD', 'MINUS', 'MULTIPLY']);
      expect(field.getOptions(false).map(([label]) => label)).toEqual(['+', '−', '×']);
      // Blockly's built-in keeps its own operators: it stays registered so documents load, and is not shown.
      const builtIn = workspace.newBlock('math_arithmetic').getField('OP') as Blockly.FieldDropdown;
      expect(builtIn.getOptions(false).map(([, value]) => value)).toEqual(['ADD', 'MINUS', 'MULTIPLY', 'DIVIDE', 'POWER']);
    } finally {
      workspace.dispose();
    }
  });

  it('shows ybc_arith and not math_arithmetic in the toolbox', () => {
    const toolbox = JSON.stringify(buildToolbox(productionProfiles.get('ybc-basic')?.blockPacks ?? [], packs));
    expect(toolbox).toContain('"type":"ybc_arith"');
    expect(toolbox).not.toContain('math_arithmetic');
  });

  it('loads a foreign math_arithmetic POWER and saves it as POWER: structurally loadable, never migrated, refused by the compiler', () => {
    const blocks = program([print(foreignArith('POWER', num(2), num(3)))]);
    const workspace = new Blockly.Workspace();
    try {
      Blockly.serialization.workspaces.load(blocks, workspace);
      const saved = Blockly.serialization.workspaces.save(workspace);
      expect(JSON.stringify(saved)).toContain('"OP":"POWER"');
      expect(JSON.stringify(saved)).not.toContain('ybc_arith');
      expect(compileYbcProgram(saved, exposed).diagnostics).toEqual([expect.objectContaining({ code: 'float-not-supported' })]);
    } finally {
      workspace.dispose();
    }
  });
});
