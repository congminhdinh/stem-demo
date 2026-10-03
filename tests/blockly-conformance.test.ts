import * as Blockly from 'blockly/core';
import { describe, expect, it } from 'vitest';
import disabledHat from '../src/core/program/__fixtures__/disabled-hat.json';
import disabledStatement from '../src/core/program/__fixtures__/disabled-statement.json';
import duplicateOnStart from '../src/core/program/__fixtures__/duplicate-on-start.json';
import orphanBlock from '../src/core/program/__fixtures__/orphan-block.json';
import { buildBlockDefinitions, createDefaultProgram } from '../src/core/program/blocks';
import blinkSample from '../src/samples/blink.project.json';
import buttonDirectSample from '../src/samples/button-direct.project.json';
import ledOnSample from '../src/samples/led-on.project.json';

// Guards the Blockly ↔ compiler contract (plan §6.3, risk R2): real Blockly
// (headless, on jsdom) must accept the core block definitions and reproduce
// every committed program fixture exactly, so compiler tests read real JSON.
Blockly.common.defineBlocksWithJsonArray(
  buildBlockDefinitions(['D13', 'D12', 'D11', 'D10', 'D9', 'D8', 'D7', 'D6', 'D5', 'D4', 'D3', 'D2']),
);

describe('Blockly conformance', () => {
  it.each<[string, Record<string, unknown>]>([
    ['led-on sample', ledOnSample.program.blocks],
    ['blink sample', blinkSample.program.blocks],
    ['button-direct sample', buttonDirectSample.program.blocks],
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
