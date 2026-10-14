import * as Blockly from 'blockly/core';
import 'blockly/blocks';
import * as En from 'blockly/msg/en';
import { describe, expect, it } from 'vitest';
import { localDeviceDefinitions } from '../src/core/devices/local-catalog';
import { createDeviceRegistry } from '../src/core/devices/registry';
import { productionProfiles } from '../src/core/profiles';
import { buildToolbox, createBlockPackCatalog } from '../src/core/program/block-packs';
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
  // YB-4, contract C-23…C-25: the three pins the contract opens, and ON (1) / OFF (0). Never P3…P20, never PWM.
  ybc_pin_write: { PIN: ['P0', 'P1', 'P2'], LEVEL: ['1', '0'] },
  ybc_pin_read: { PIN: ['P0', 'P1', 'P2'] },
  ybc_pin_analog: { PIN: ['P0', 'P1', 'P2'] },
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
        expect(dropdowns).toBeGreaterThanOrEqual(4);
      } finally {
        workspace.dispose();
      }
    });
  }

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
