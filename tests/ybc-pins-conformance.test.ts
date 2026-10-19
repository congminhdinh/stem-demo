import * as Blockly from 'blockly/core';
import 'blockly/blocks';
import * as En from 'blockly/msg/en';
import { describe, expect, it } from 'vitest';
import { boardTargetOf } from '../src/core/devices/board-pins';
import { localDeviceDefinitions } from '../src/core/devices/local-catalog';
import { createDeviceRegistry } from '../src/core/devices/registry';
import { productionProfiles } from '../src/core/profiles';
import { capabilitiesOf } from '../src/core/profiles/board-context';
import { buildToolbox, createBlockPackCatalog } from '../src/core/program/block-packs';
import { compileYbcProgram } from '../src/core/program/compile-ybc-program';
import { canOpenProgram } from '../src/ui/blockly/editor-blocks';

// The Blockly <-> YBC compiler contract for the header pins (YB-4; plan §9.4, §12, risk R2): real Blockly, headless.
// The blocks are the ones the editor registers, their dropdowns are read from the real fields (never from the
// toolbox presets), and the programs are built the way the editor builds them, saved, and compiled; the compiler
// must read exactly the JSON Blockly writes.

Blockly.setLocale(En as unknown as Record<string, string>);
const registry = createDeviceRegistry(localDeviceDefinitions);
const packs = createBlockPackCatalog(registry);
// What the editor registers: the blocks of every known pack.
Blockly.common.defineBlocksWithJsonArray(packs.definitions());
const exposed = packs.typesOf(productionProfiles.get('ybc-basic')?.blockPacks ?? []);
const ybcBoard = registry.get('ybc-board');
const target = boardTargetOf(ybcBoard, capabilitiesOf(ybcBoard));

const withWorkspace = <T>(use: (workspace: Blockly.Workspace) => T): T => {
  const workspace = new Blockly.Workspace();
  try {
    return use(workspace);
  } finally {
    workspace.dispose();
  }
};
const dropdown = (block: Blockly.Block, name: string) => block.getField(name) as Blockly.FieldDropdown;
const options = (field: Blockly.FieldDropdown) => field.getOptions(false).map(([label, value]) => [String(label), value]);

describe('the pin blocks as Blockly registers them', () => {
  it('"set pin" offers exactly P0, P1, P2 and ON / OFF, and starts at P0 / ON', () => {
    withWorkspace((workspace) => {
      const block = workspace.newBlock('ybc_pin_write');
      expect(options(dropdown(block, 'PIN'))).toEqual([['P0', 'P0'], ['P1', 'P1'], ['P2', 'P2']]);
      expect(options(dropdown(block, 'LEVEL'))).toEqual([['ON', '1'], ['OFF', '0']]);
      expect([block.getFieldValue('PIN'), block.getFieldValue('LEVEL')]).toEqual(['P0', '1']);
      expect(block.previousConnection).not.toBeNull();
      expect(block.nextConnection).not.toBeNull();
      expect(block.outputConnection).toBeNull();
    });
  });

  it('"digital read" and "analog read" offer exactly P0, P1, P2 and start at P0', () => {
    withWorkspace((workspace) => {
      for (const type of ['ybc_pin_read', 'ybc_pin_analog']) {
        const block = workspace.newBlock(type);
        expect(options(dropdown(block, 'PIN')), type).toEqual([['P0', 'P0'], ['P1', 'P1'], ['P2', 'P2']]);
        expect(block.getFieldValue('PIN'), type).toBe('P0');
        expect(block.outputConnection, type).not.toBeNull();
        expect(block.previousConnection, type).toBeNull();
      }
    });
  });

  it('refuses a pin or a level the dropdown does not offer (the field validates; the editor cannot save one)', () => {
    withWorkspace((workspace) => {
      const block = workspace.newBlock('ybc_pin_write');
      block.setFieldValue('P3', 'PIN');
      block.setFieldValue('P20', 'PIN');
      block.setFieldValue('2', 'LEVEL');
      expect([block.getFieldValue('PIN'), block.getFieldValue('LEVEL')]).toEqual(['P0', '1']);
    });
  });

  it('types the connections: a digital read is a Boolean (fits "if", not "+"), an analog read a Number (fits "+", not "if")', () => {
    withWorkspace((workspace) => {
      const digital = workspace.newBlock('ybc_pin_read');
      const analog = workspace.newBlock('ybc_pin_analog');
      const ifBlock = workspace.newBlock('controls_if');
      const sum = workspace.newBlock('ybc_arith');
      const condition = ifBlock.getInput('IF0')?.connection ?? null;
      const operand = sum.getInput('A')?.connection ?? null;
      // Blockly's own connection checker decides, as it does when a learner drags a block over an input.
      const fits = (output: Blockly.Connection | null, input: Blockly.Connection | null) =>
        output?.getConnectionChecker().canConnect(output, input, false) ?? null;
      expect(fits(digital.outputConnection, condition)).toBe(true);
      expect(fits(analog.outputConnection, condition)).toBe(false);
      expect(fits(analog.outputConnection, operand)).toBe(true);
      expect(fits(digital.outputConnection, operand)).toBe(false);
    });
  });

  it('are in the Pins category of both toolboxes, as real blocks the flyout can make', () => {
    for (const id of ['ybc-basic', 'ybc-advanced']) {
      const toolbox = buildToolbox(productionProfiles.get(id)?.blockPacks ?? [], packs);
      const pins = toolbox.contents.find((category) => category.name === 'Pins');
      const types = (pins?.contents ?? []).map((item) => (item as { type: string }).type);
      // N17 B5: Advanced adds analog write and the servo after the three.
      expect(types, id).toEqual(['ybc_pin_write', 'ybc_pin_read', 'ybc_pin_analog', ...(id === 'ybc-advanced' ? ['ybc_pin_write_analog', 'ybc_servo_write'] : [])]);
      withWorkspace((workspace) => {
        for (const type of types) {
          expect(() => workspace.newBlock(type), type).not.toThrow();
        }
      });
    }
  });
});

describe('what Blockly saves is what the compiler reads', () => {
  /** The knob-and-LED program of the contract (P7), made the way the editor makes it. */
  function p7() {
    return withWorkspace((workspace) => {
      const hat = workspace.newBlock('stem_forever', 'forever');
      const branch = workspace.newBlock('controls_if', 'if');
      branch.loadExtraState?.({ hasElse: true });
      const compare = workspace.newBlock('logic_compare', 'compare');
      compare.setFieldValue('GT', 'OP');
      const knob = workspace.newBlock('ybc_pin_analog', 'knob');
      knob.setFieldValue('P1', 'PIN');
      const threshold = workspace.newBlock('math_number', 'threshold');
      threshold.setFieldValue(2048, 'NUM');
      const on = workspace.newBlock('ybc_pin_write', 'on');
      on.setFieldValue('P0', 'PIN');
      on.setFieldValue('1', 'LEVEL');
      const off = workspace.newBlock('ybc_pin_write', 'off');
      off.setFieldValue('P0', 'PIN');
      off.setFieldValue('0', 'LEVEL');
      compare.getInput('A')?.connection?.connect(knob.outputConnection as Blockly.Connection);
      compare.getInput('B')?.connection?.connect(threshold.outputConnection as Blockly.Connection);
      branch.getInput('IF0')?.connection?.connect(compare.outputConnection as Blockly.Connection);
      branch.getInput('DO0')?.connection?.connect(on.previousConnection as Blockly.Connection);
      branch.getInput('ELSE')?.connection?.connect(off.previousConnection as Blockly.Connection);
      hat.getInput('DO')?.connection?.connect(branch.previousConnection as Blockly.Connection);
      return Blockly.serialization.workspaces.save(workspace);
    });
  }

  it('compiles P7 from the JSON Blockly saved, with the pins and the levels as Blockly wrote them', () => {
    const saved = p7();
    expect(JSON.stringify(saved)).toContain('"PIN":"P1"');
    const result = compileYbcProgram(saved, exposed, undefined, target);
    expect(result).toMatchObject({ ok: true });
    const forever = result.ok ? result.ir.forever : null;
    expect(forever).toEqual([
      {
        kind: 'if',
        blockId: 'if',
        branches: [
          {
            condition: {
              kind: 'compare',
              op: '>',
              type: 'bool',
              blockId: 'compare',
              left: { kind: 'read', op: 'analogIn.read', type: 'int', blockId: 'knob', args: [{ kind: 'int', type: 'int', value: 1, blockId: 'knob' }] },
              right: { kind: 'int', type: 'int', value: 2048, blockId: 'threshold' },
            },
            body: [{ kind: 'call', op: 'digital.write', blockId: 'on', args: [{ kind: 'int', type: 'int', value: 0, blockId: 'on' }, { kind: 'int', type: 'int', value: 1, blockId: 'on' }] }],
          },
        ],
        else: [{ kind: 'call', op: 'digital.write', blockId: 'off', args: [{ kind: 'int', type: 'int', value: 0, blockId: 'off' }, { kind: 'int', type: 'int', value: 0, blockId: 'off' }] }],
      },
    ]);
  });

  it('keeps every dropdown choice through save and compile: each pin and each level', () => {
    for (const [pin, number] of [['P0', 0], ['P1', 1], ['P2', 2]] as const) {
      for (const [level, value] of [['1', 1], ['0', 0]] as const) {
        const saved = withWorkspace((workspace) => {
          const hat = workspace.newBlock('stem_on_start', 'start');
          const block = workspace.newBlock('ybc_pin_write', 'write');
          block.setFieldValue(pin, 'PIN');
          block.setFieldValue(level, 'LEVEL');
          hat.getInput('DO')?.connection?.connect(block.previousConnection as Blockly.Connection);
          return Blockly.serialization.workspaces.save(workspace);
        });
        const result = compileYbcProgram(saved, exposed, undefined, target);
        expect(result.ok && result.ir.onStart[0], `${pin}/${level}`).toMatchObject({ kind: 'call', op: 'digital.write', args: [{ value: number }, { value }] });
      }
    }
  });

  it('opens: a program with pin blocks loads into Blockly (L-1), whatever profile is active', () => {
    expect(canOpenProgram(p7(), packs)).toBe(true);
  });

  it('survives a save, a load and a save: nothing in the pin blocks is lost or rewritten', () => {
    const saved = p7();
    const again = withWorkspace((workspace) => {
      Blockly.serialization.workspaces.load(saved, workspace);
      return Blockly.serialization.workspaces.save(workspace);
    });
    expect(again).toEqual(saved);
  });
});
