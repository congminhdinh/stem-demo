import * as Blockly from 'blockly';
import { describe, expect, it } from 'vitest';
import type { ProjectDocument } from '../../core/circuit/document';
import { localDeviceDefinitions } from '../../core/devices/local-catalog';
import { createDeviceRegistry } from '../../core/devices/registry';
import { readStoredProject } from '../../core/persistence/project-repository';
import { createBlockPackCatalog } from '../../core/program/block-packs';
import { createRunSession } from '../../core/run/run-session';
import { canOpenProgram, registerBlocks } from './editor-blocks';

// Review YB2B-R2: the editor's own join mutator can make a join of 51 parts. Whatever the editor can save,
// it must reopen (L-1): the 50-part limit is a limit of Run (L-3), not of loading. This builds the shape
// through the real mutator (decompose / compose), not by writing JSON.

const registry = createDeviceRegistry(localDeviceDefinitions);

/** A Yolo:Bit-compatible project around a saved program. */
const createDocument = (blocks: unknown): ProjectDocument => ({
  schemaVersion: 1,
  id: 'join-mutator',
  name: 'Join',
  profile: 'ybc-basic',
  circuit: { components: [{ id: 'ybc-board-1', deviceType: 'ybc-board', position: { x: 300, y: 200 } }], wires: [] },
  program: { blocks },
});
const packs = createBlockPackCatalog(registry);
registerBlocks(packs);

/**
 * A join made `parts` long by the real mutator. Blockly's `decompose` needs a rendered workspace, so the
 * mutator's container is built by hand, exactly as `decompose` builds it (a container block with a chain of
 * item blocks in its STACK), and the join's own `compose` turns it into inputs and `itemCount`.
 */
function joinOfParts(workspace: Blockly.Workspace, parts: number) {
  const join = workspace.newBlock('text_join', 'join');
  const mutatorWorkspace = new Blockly.Workspace();
  try {
    const container = mutatorWorkspace.newBlock('text_create_join_container');
    let connection = container.getInput('STACK')?.connection;
    for (let index = 0; index < parts; index++) {
      const item = mutatorWorkspace.newBlock('text_create_join_item');
      if (!connection || !item.previousConnection) {
        throw new Error('The mutator workspace is not as expected');
      }
      connection.connect(item.previousConnection);
      connection = item.nextConnection;
    }
    (join as unknown as { compose(container: Blockly.Block): void }).compose(container);
  } finally {
    mutatorWorkspace.dispose();
  }
  return join;
}

function savedProgram(parts: number) {
  const workspace = new Blockly.Workspace();
  try {
    const onStart = workspace.newBlock('stem_on_start', 'on-start');
    onStart.moveBy(40, 40);
    const print = workspace.newBlock('text_print', 'print');
    const join = joinOfParts(workspace, parts);
    for (let index = 0; index < parts; index++) {
      const part = workspace.newBlock('text', `part-${index}`);
      part.setFieldValue('a', 'TEXT');
      join.getInput(`ADD${index}`)?.connection?.connect(part.outputConnection as Blockly.Connection);
    }
    print.getInput('TEXT')?.connection?.connect(join.outputConnection as Blockly.Connection);
    onStart.getInput('DO')?.connection?.connect(print.previousConnection as Blockly.Connection);
    return Blockly.serialization.workspaces.save(workspace);
  } finally {
    workspace.dispose();
  }
}

describe.each([50, 51])('a join of %d parts, made by the real mutator', (parts) => {
  const saved = savedProgram(parts);
  const document = createDocument(saved);

  it('is saved with its part count, every part in place', () => {
    expect(JSON.stringify(saved)).toContain(`"extraState":{"itemCount":${parts}}`);
    expect(JSON.stringify(saved).match(/"type":"text"/g)).toHaveLength(parts);
  });

  it('opens (L-1) and comes back from the repository unchanged', () => {
    expect(canOpenProgram(saved, packs)).toBe(true);
    const read = readStoredProject(structuredClone(document), registry, (blocks) => canOpenProgram(blocks, packs));
    expect(read).toEqual(document);
  });

  it('reloads in the editor with all its parts, and saves the same shape again', () => {
    const workspace = new Blockly.Workspace();
    try {
      Blockly.serialization.workspaces.load(saved, workspace);
      expect(Blockly.serialization.workspaces.save(workspace)).toEqual(saved);
    } finally {
      workspace.dispose();
    }
  });

  it(parts <= 50 ? 'runs' : 'is refused by Run with limit-exceeded at the join, nothing truncated', () => {
    const result = createRunSession(registry).start(document);
    if (parts <= 50) {
      expect(result).toEqual({ ok: true });
    } else {
      expect(result).toMatchObject({ ok: false, reason: 'compile-error', diagnostics: [{ code: 'limit-exceeded', blockId: 'join' }] });
      // The document itself is untouched: still 51 parts.
      expect(JSON.stringify(document.program.blocks)).toContain('"itemCount":51');
    }
  });
});
