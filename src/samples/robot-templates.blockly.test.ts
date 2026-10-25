import * as Blockly from 'blockly';
import { describe, expect, it } from 'vitest';
import { localDeviceDefinitions } from '../core/devices/local-catalog';
import { createDeviceRegistry } from '../core/devices/registry';
import { createBlockPackCatalog } from '../core/program/block-packs';
import { canOpenProgram, registerBlocks } from '../ui/blockly/editor-blocks';
import { robotStarterDocument, robotTemplateKeys } from './robot-templates';

// N18 R4.1: the project a robot lab opens is one the block editor opens as it is, and saves back as the same program: the lab's
// first autosave would otherwise tell the host about an edit the learner did not make (project-changed on open).

const packs = createBlockPackCatalog(createDeviceRegistry(localDeviceDefinitions));

describe('the program of a robot scenario in the block editor (N18 R4.1)', () => {
  it.each(robotTemplateKeys)('%s opens, and Blockly saves the same program back', (key) => {
    const { blocks } = robotStarterDocument(key).program;
    expect(canOpenProgram(blocks, packs)).toBe(true);
    registerBlocks(packs);
    const workspace = new Blockly.Workspace();
    try {
      Blockly.serialization.workspaces.load(blocks as Record<string, unknown>, workspace);
      expect(Blockly.serialization.workspaces.save(workspace)).toEqual(blocks);
    } finally {
      workspace.dispose();
    }
  });
});
