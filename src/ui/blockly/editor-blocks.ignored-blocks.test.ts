import * as Blockly from 'blockly';
import { describe, expect, it } from 'vitest';
import type { ProjectDocument } from '../../core/circuit/document';
import { localDeviceDefinitions } from '../../core/devices/local-catalog';
import { createDeviceRegistry } from '../../core/devices/registry';
import { readStoredProject } from '../../core/persistence/project-repository';
import { createBlockPackCatalog } from '../../core/program/block-packs';
import { MAX_PROGRAM_BLOCKS, MAX_TEXT_JOIN_PARTS } from '../../core/program/limits';
import { createRunSession } from '../../core/run/run-session';
import { canOpenProgram, maxMutatorItemsPerBlock, maxTotalMutatorItems, registerBlocks } from './editor-blocks';

// Review YB2B-R3: the editor saves blocks that the compiler skips (loose blocks outside `on start` / `forever`,
// disabled blocks). Their joins and ifs are not part of the 2 000 blocks that run, so the structural bounds
// of L-1 must not count them against the program limit: such a document has to reopen. Built with real
// Blockly; the loose joins are made with the join's own `compose`.

const registry = createDeviceRegistry(localDeviceDefinitions);
const packs = createBlockPackCatalog(registry);
registerBlocks(packs);

const documentOf = (blocks: unknown): ProjectDocument => ({
  schemaVersion: 1,
  id: 'ignored-blocks',
  name: 'Ignored blocks',
  profile: 'ybc-basic',
  circuit: { components: [{ id: 'ybc-board-1', deviceType: 'ybc-board', position: { x: 300, y: 200 } }], wires: [] },
  program: { blocks },
});

/** A join of `parts` empty slots, made by the join's own `compose` (decompose needs a rendered workspace). */
function joinOfParts(workspace: Blockly.Workspace, id: string, parts: number) {
  const join = workspace.newBlock('text_join', id);
  const mutatorWorkspace = new Blockly.Workspace();
  try {
    const container = mutatorWorkspace.newBlock('text_create_join_container');
    let connection = container.getInput('STACK')?.connection;
    for (let index = 0; index < parts; index++) {
      const item = mutatorWorkspace.newBlock('text_create_join_item');
      connection?.connect(item.previousConnection as Blockly.Connection);
      connection = item.nextConnection;
    }
    (join as unknown as { compose(container: Blockly.Block): void }).compose(container);
  } finally {
    mutatorWorkspace.dispose();
  }
  return join;
}

const printOk = (workspace: Blockly.Workspace, id: string) => {
  const print = workspace.newBlock('text_print', id);
  const text = workspace.newBlock('text', `${id}-text`);
  text.setFieldValue('ok', 'TEXT');
  print.getInput('TEXT')?.connection?.connect(text.outputConnection as Blockly.Connection);
  return print;
};

/** `on start { print "ok" }` plus whatever `extra` adds to the same workspace. */
function build(extra: (workspace: Blockly.Workspace, onStart: Blockly.Block) => void) {
  const workspace = new Blockly.Workspace();
  try {
    const onStart = workspace.newBlock('stem_on_start', 'on-start');
    onStart.moveBy(40, 40);
    onStart.getInput('DO')?.connection?.connect(printOk(workspace, 'main-print').previousConnection as Blockly.Connection);
    extra(workspace, onStart);
    return Blockly.serialization.workspaces.save(workspace);
  } finally {
    workspace.dispose();
  }
}

const blockCount = (value: unknown): number => JSON.stringify(value).split('"type"').length - 1;

/** What a document must do to count as reopenable and editable, and what Run does with its main program. */
function expectReopens(saved: Record<string, unknown>) {
  const document = documentOf(saved);
  expect(canOpenProgram(saved, packs)).toBe(true);
  expect(readStoredProject(document, registry, (blocks) => canOpenProgram(blocks, packs))).toEqual(document);
  const workspace = new Blockly.Workspace();
  try {
    Blockly.serialization.workspaces.load(saved, workspace);
    expect(Blockly.serialization.workspaces.save(workspace)).toEqual(saved);
  } finally {
    workspace.dispose();
  }
  return document;
}

describe('loose joins: saved by the editor, skipped by the compiler', () => {
  const loose = (count: number) =>
    build((workspace) => {
      for (let index = 0; index < count; index++) {
        joinOfParts(workspace, `loose-${index}`, MAX_TEXT_JOIN_PARTS).moveBy(400, index * 30);
      }
    });

  it.each([80, 81, 200])('%d loose joins of 50 parts: the document reopens, the main program runs', (count) => {
    const saved = loose(count);
    expect(blockCount(saved)).toBeLessThan(MAX_PROGRAM_BLOCKS);
    const document = expectReopens(saved);
    expect(createRunSession(registry).start(document)).toEqual({ ok: true });
  });

  it('is above the old document total of 4 000 join parts, which is what failed before', () => {
    expect(81 * MAX_TEXT_JOIN_PARTS).toBeGreaterThan(2 * MAX_PROGRAM_BLOCKS);
  });

  it('keeps the loose joins exactly as saved: nothing truncated, nothing removed', () => {
    const saved = loose(81);
    expect(JSON.stringify(saved).match(/"itemCount":50/g)).toHaveLength(81);
  });
});

describe('disabled joins: saved by the editor, skipped by the compiler', () => {
  const disabled = (count: number) =>
    build((workspace, onStart) => {
      let last = workspace.getBlockById('main-print') as Blockly.Block;
      for (let index = 0; index < count; index++) {
        const print = workspace.newBlock('text_print', `disabled-${index}`);
        print.getInput('TEXT')?.connection?.connect(joinOfParts(workspace, `disabled-join-${index}`, MAX_TEXT_JOIN_PARTS).outputConnection as Blockly.Connection);
        print.setDisabledReason(true, Blockly.constants.MANUALLY_DISABLED);
        last.nextConnection?.connect(print.previousConnection as Blockly.Connection);
        last = print;
      }
      expect(onStart.getInput('DO')).toBeDefined();
    });

  it('81 disabled prints of a 50-part join next to one print: about 165 blocks, reopens, runs', () => {
    const saved = disabled(81);
    expect(blockCount(saved)).toBe(165);
    const document = expectReopens(saved);
    expect(JSON.stringify(saved).match(/disabledReasons/g)).toHaveLength(81);
    expect(createRunSession(registry).start(document)).toEqual({ ok: true });
  });
});

describe('loose and disabled ifs with many else-ifs', () => {
  it('reopens when the else-ifs of loose ifs add up to more than the old 4 000, each below the per-block bound', () => {
    const saved = build((workspace) => {
      for (let index = 0; index < 5; index++) {
        workspace.newBlock('controls_if', `loose-if-${index}`).loadExtraState?.({ elseIfCount: 1_000 });
      }
    });
    expect(blockCount(saved)).toBe(8); // the hat, one print and its text, five loose ifs
    const document = expectReopens(saved);
    expect(createRunSession(registry).start(document)).toEqual({ ok: true });
  });

  it('reopens disabled ifs the same way', () => {
    const saved = build((workspace) => {
      let last = workspace.getBlockById('main-print') as Blockly.Block;
      for (let index = 0; index < 5; index++) {
        const choose = workspace.newBlock('controls_if', `disabled-if-${index}`);
        choose.loadExtraState?.({ elseIfCount: 1_000 });
        choose.setDisabledReason(true, Blockly.constants.MANUALLY_DISABLED);
        last.nextConnection?.connect(choose.previousConnection as Blockly.Connection);
        last = choose;
      }
    });
    const document = expectReopens(saved);
    expect(createRunSession(registry).start(document)).toEqual({ ok: true });
  });
});

describe('an oversized document is as editable as it is not runnable', () => {
  it('2001 loose default joins reopen, like 2001 loose plain texts, and Run refuses both as too large', () => {
    const joins = build((workspace) => {
      for (let index = 0; index < MAX_PROGRAM_BLOCKS + 1; index++) {
        joinOfParts(workspace, `join-${index}`, 2);
      }
    });
    const texts = build((workspace) => {
      for (let index = 0; index < MAX_PROGRAM_BLOCKS + 1; index++) {
        workspace.newBlock('text', `text-${index}`);
      }
    });
    for (const saved of [joins, texts]) {
      const document = documentOf(saved);
      expect(canOpenProgram(saved, packs)).toBe(true);
      expect(readStoredProject(document, registry, (blocks) => canOpenProgram(blocks, packs))).not.toBeNull();
      expect(createRunSession(registry).start(document)).toMatchObject({ ok: false, diagnostics: [{ code: 'program-too-large' }] });
    }
  });

  it('keeps the total structural: 2 000 loose joins of 50 parts (100 000 items) reopen, one more does not', () => {
    const joinsOf50 = (count: number) =>
      ({ blocks: { languageVersion: 0, blocks: Array.from({ length: count }, (_, i) => ({ type: 'text_join', id: `j${i}`, extraState: { itemCount: 50 } })) } });
    expect(canOpenProgram(joinsOf50(maxTotalMutatorItems / 50), packs)).toBe(true);
    expect(canOpenProgram(joinsOf50(maxTotalMutatorItems / 50 + 1), packs)).toBe(false);
  });

  it('still refuses one block past the per-block bound, however empty the rest is', () => {
    const one = (itemCount: number) => ({ blocks: { languageVersion: 0, blocks: [{ type: 'text_join', id: 'j', extraState: { itemCount } }] } });
    expect(canOpenProgram(one(maxMutatorItemsPerBlock), packs)).toBe(true);
    expect(canOpenProgram(one(maxMutatorItemsPerBlock + 1), packs)).toBe(false);
  });
});
