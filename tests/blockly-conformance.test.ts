import * as Blockly from 'blockly/core';
import 'blockly/blocks';
import * as En from 'blockly/msg/en';
import { describe, expect, it } from 'vitest';
import disabledHat from '../src/core/program/__fixtures__/disabled-hat.json';
import disabledStatement from '../src/core/program/__fixtures__/disabled-statement.json';
import duplicateOnStart from '../src/core/program/__fixtures__/duplicate-on-start.json';
import ifElseIf from '../src/core/program/__fixtures__/if-else-if.json';
import missingCondition from '../src/core/program/__fixtures__/missing-condition.json';
import orphanBlock from '../src/core/program/__fixtures__/orphan-block.json';
import { blockTypes, buildBlockDefinitions, builtInBlockTypes, createDefaultProgram } from '../src/core/program/blocks';
import blinkSample from '../src/samples/blink.project.json';
import buttonDirectSample from '../src/samples/button-direct.project.json';
import buttonLedSample from '../src/samples/button-led.project.json';
import ledOnSample from '../src/samples/led-on.project.json';

// Guards the Blockly ↔ compiler contract (plan §6.3, risk R2): real Blockly
// (headless, on jsdom) must accept the core block definitions and reproduce
// every committed program fixture exactly, so compiler tests read real JSON.
// The built-in blocks need their messages (e.g. "not %1") to be created. The
// typings give the locale a synthetic default export; at runtime it is the map.
Blockly.setLocale(En as unknown as Record<string, string>);
Blockly.common.defineBlocksWithJsonArray(
  buildBlockDefinitions(['D13', 'D12', 'D11', 'D10', 'D9', 'D8', 'D7', 'D6', 'D5', 'D4', 'D3', 'D2']),
);

/** A block made through Blockly's own API, the way the editor makes them. */
function newBlock(
  workspace: Blockly.Workspace,
  type: string,
  id: string,
  { fields = {}, extraState }: { fields?: Record<string, string>; extraState?: object } = {},
) {
  const block = workspace.newBlock(type, id);
  if (extraState) {
    block.loadExtraState?.(extraState);
  }
  for (const [name, value] of Object.entries(fields)) {
    block.setFieldValue(value, name);
  }
  return block;
}

/** Plugs `child` into `parent`'s input: a statement input, or a value input via the child's output. */
function plug(parent: Blockly.Block, inputName: string, child: Blockly.Block) {
  const connection = parent.getInput(inputName)?.connection;
  const childConnection = child.outputConnection ?? child.previousConnection;
  if (!connection || !childConnection) {
    throw new Error(`Cannot plug ${child.type} into ${parent.type}.${inputName}`);
  }
  connection.connect(childConnection);
}

describe('Blockly conformance', () => {
  it.each<[string, Record<string, unknown>]>([
    ['led-on sample', ledOnSample.program.blocks],
    ['blink sample', blinkSample.program.blocks],
    ['button-direct sample', buttonDirectSample.program.blocks],
    ['button-led sample', buttonLedSample.program.blocks],
    ['if-else-if', ifElseIf],
    ['missing-condition', missingCondition],
    ['default program of a new project', createDefaultProgram()],
    ['orphan-block', orphanBlock],
    ['duplicate-on-start', duplicateOnStart],
    ['disabled-statement', disabledStatement],
    ['disabled-hat', disabledHat],
  ])('round-trips the %s program unchanged', (_, program) => {
    const workspace = new Blockly.Workspace();
    try {
      Blockly.serialization.workspaces.load(program, workspace);

      expect(Blockly.serialization.workspaces.save(workspace)).toEqual(program);
    } finally {
      workspace.dispose();
    }
  });

  // Round-tripping alone would accept JSON that Blockly loads but never writes
  // itself; these build the M3 programs through the API and compare.
  it('writes the button-led program itself as the sample has it: if/else as extraState hasElse', () => {
    const workspace = new Blockly.Workspace();
    try {
      const forever = newBlock(workspace, blockTypes.forever, 'forever');
      forever.moveBy(40, 40);
      const ifPressed = newBlock(workspace, builtInBlockTypes.if, 'if-pressed', { extraState: { hasElse: true } });
      plug(forever, 'DO', ifPressed);
      plug(ifPressed, 'IF0', newBlock(workspace, blockTypes.digitalRead, 'read-d2', { fields: { PIN: 'D2' } }));
      const high = { PIN: 'D13', LEVEL: 'HIGH' };
      plug(ifPressed, 'DO0', newBlock(workspace, blockTypes.digitalWrite, 'write-high', { fields: high }));
      const low = { PIN: 'D13', LEVEL: 'LOW' };
      plug(ifPressed, 'ELSE', newBlock(workspace, blockTypes.digitalWrite, 'write-low', { fields: low }));

      expect(Blockly.serialization.workspaces.save(workspace)).toEqual(buttonLedSample.program.blocks);
    } finally {
      workspace.dispose();
    }
  });

  it('writes an if / else if / else with not as the if-else-if fixture has it', () => {
    const workspace = new Blockly.Workspace();
    try {
      const onStart = newBlock(workspace, blockTypes.onStart, 'on-start');
      onStart.moveBy(40, 40);
      const extraState = { elseIfCount: 1, hasElse: true };
      const block = newBlock(workspace, builtInBlockTypes.if, 'if-else-if', { extraState });
      plug(onStart, 'DO', block);
      const not = newBlock(workspace, builtInBlockTypes.not, 'not-d2');
      plug(not, 'BOOL', newBlock(workspace, blockTypes.digitalRead, 'read-d2', { fields: { PIN: 'D2' } }));
      plug(block, 'IF0', not);
      const write = (id: string, pin: string) =>
        newBlock(workspace, blockTypes.digitalWrite, id, { fields: { PIN: pin, LEVEL: 'HIGH' } });
      plug(block, 'DO0', write('write-d13', 'D13'));
      plug(block, 'IF1', newBlock(workspace, blockTypes.digitalRead, 'read-d3', { fields: { PIN: 'D3' } }));
      plug(block, 'DO1', write('write-d12', 'D12'));
      plug(block, 'ELSE', write('write-d11', 'D11'));

      expect(Blockly.serialization.workspaces.save(workspace)).toEqual(ifElseIf);
    } finally {
      workspace.dispose();
    }
  });

  it('serializes a disabled block as disabledReasons, the key the compiler reads', () => {
    const workspace = new Blockly.Workspace();
    try {
      const block = workspace.newBlock('stem_wait');
      block.setDisabledReason(true, Blockly.constants.MANUALLY_DISABLED);

      expect(Blockly.serialization.blocks.save(block)).toMatchObject({ disabledReasons: ['MANUALLY_DISABLED'] });
    } finally {
      workspace.dispose();
    }
  });
});
