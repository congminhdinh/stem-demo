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

// Review YB2B-R2 (residual) and N-d: the structural bounds of L-1 sit above every program the language
// allows. A program the editor made and the compiler accepts must reopen; only metadata no valid program
// can have is refused, and quickly. Programs are made with real Blockly, not handwritten JSON.

const registry = createDeviceRegistry(localDeviceDefinitions);
const packs = createBlockPackCatalog(registry);
registerBlocks(packs);

const documentOf = (blocks: unknown): ProjectDocument => ({
  schemaVersion: 1,
  id: 'structural',
  name: 'Structural',
  profile: 'ybc-basic',
  circuit: { components: [{ id: 'ybc-board-1', deviceType: 'ybc-board', position: { x: 300, y: 200 } }], wires: [] },
  program: { blocks },
});

/** A join of `parts` parts, made by the join's own `compose` (decompose needs a rendered workspace). */
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
  for (let index = 0; index < parts; index++) {
    const part = workspace.newBlock('text', `${id}-part-${index}`);
    part.setFieldValue('a', 'TEXT');
    join.getInput(`ADD${index}`)?.connection?.connect(part.outputConnection as Blockly.Connection);
  }
  return join;
}

/** `on start` with a stack of prints, each printing a join of `parts` parts. */
function joinProgram(prints: number, parts: number) {
  const workspace = new Blockly.Workspace();
  try {
    const onStart = workspace.newBlock('stem_on_start', 'on-start');
    onStart.moveBy(40, 40);
    let previous: Blockly.Block | null = null;
    for (let index = 0; index < prints; index++) {
      const print = workspace.newBlock('text_print', `print-${index}`);
      print.getInput('TEXT')?.connection?.connect(joinOfParts(workspace, `join-${index}`, parts).outputConnection as Blockly.Connection);
      if (previous) {
        previous.nextConnection?.connect(print.previousConnection as Blockly.Connection);
      } else {
        onStart.getInput('DO')?.connection?.connect(print.previousConnection as Blockly.Connection);
      }
      previous = print;
    }
    return Blockly.serialization.workspaces.save(workspace);
  } finally {
    workspace.dispose();
  }
}

/** `on start` with one `if` of `elseIfs` else-if branches, each with a Boolean condition. */
function elseIfProgram(elseIfs: number) {
  const workspace = new Blockly.Workspace();
  try {
    const onStart = workspace.newBlock('stem_on_start', 'on-start');
    onStart.moveBy(40, 40);
    const choose = workspace.newBlock('controls_if', 'choose');
    choose.loadExtraState?.({ elseIfCount: elseIfs });
    for (let index = 0; index <= elseIfs; index++) {
      const condition = workspace.newBlock('logic_boolean', `condition-${index}`);
      condition.setFieldValue(index === elseIfs ? 'TRUE' : 'FALSE', 'BOOL');
      choose.getInput(`IF${index}`)?.connection?.connect(condition.outputConnection as Blockly.Connection);
    }
    onStart.getInput('DO')?.connection?.connect(choose.previousConnection as Blockly.Connection);
    return Blockly.serialization.workspaces.save(workspace);
  } finally {
    workspace.dispose();
  }
}

const blockCount = (value: unknown): number => JSON.stringify(value).split('"type"').length - 1;

describe('the structural bounds', () => {
  it('cap one block at twice the program limit: the quadratic cost of a single mutator block is what it guards', () => {
    expect(maxMutatorItemsPerBlock).toBe(2 * MAX_PROGRAM_BLOCKS);
  });

  it('cap a document at the program limit times the join limit, far above 4 000: many small blocks cost about linear time', () => {
    expect(maxTotalMutatorItems).toBe(MAX_PROGRAM_BLOCKS * MAX_TEXT_JOIN_PARTS);
    expect(maxTotalMutatorItems).toBeGreaterThan(maxMutatorItemsPerBlock);
  });
});

describe('21 prints of a join of 50 parts: more than 1 000 join parts in a valid program', () => {
  const saved = joinProgram(21, MAX_TEXT_JOIN_PARTS);
  const document = documentOf(saved);

  it('is a program inside the 2 000-block limit with more than the old 1 000 join parts', () => {
    expect(blockCount(saved)).toBeGreaterThan(1_000);
    expect(blockCount(saved)).toBeLessThan(MAX_PROGRAM_BLOCKS);
    expect(21 * MAX_TEXT_JOIN_PARTS).toBeGreaterThan(1_000);
  });

  it('reopens (L-1) and comes back from the repository unchanged', () => {
    expect(canOpenProgram(saved, packs)).toBe(true);
    expect(readStoredProject(document, registry, (blocks) => canOpenProgram(blocks, packs))).toEqual(document);
  });

  it('reloads in the editor and saves the same shape', () => {
    const workspace = new Blockly.Workspace();
    try {
      Blockly.serialization.workspaces.load(saved, workspace);
      expect(Blockly.serialization.workspaces.save(workspace)).toEqual(saved);
    } finally {
      workspace.dispose();
    }
  });

  it('compiles and runs', () => {
    expect(createRunSession(registry).start(document)).toEqual({ ok: true });
  });
});

describe('a join of 51 parts still reopens and is refused only by Run', () => {
  const saved = joinProgram(1, MAX_TEXT_JOIN_PARTS + 1);

  it('reopens and keeps all its parts', () => {
    expect(canOpenProgram(saved, packs)).toBe(true);
    expect(JSON.stringify(saved)).toContain(`"itemCount":${MAX_TEXT_JOIN_PARTS + 1}`);
  });

  it('is refused by Run with limit-exceeded at the join', () => {
    expect(createRunSession(registry).start(documentOf(saved))).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'limit-exceeded', blockId: 'join-0' }],
    });
  });
});

describe('an if with 1 001 else-ifs: a valid program of about 1 004 blocks', () => {
  const saved = elseIfProgram(1_001);
  const document = documentOf(saved);

  it('is inside the program limit and above the old else-if bound of 1 000', () => {
    expect(blockCount(saved)).toBeGreaterThan(1_000);
    expect(blockCount(saved)).toBeLessThan(MAX_PROGRAM_BLOCKS);
    expect(JSON.stringify(saved)).toContain('"elseIfCount":1001');
  });

  it('reopens (L-1) and comes back from the repository unchanged', () => {
    expect(canOpenProgram(saved, packs)).toBe(true);
    expect(readStoredProject(document, registry, (blocks) => canOpenProgram(blocks, packs))).toEqual(document);
  });

  it('compiles and runs: the last condition is the true one', () => {
    expect(createRunSession(registry).start(document)).toEqual({ ok: true });
  });
});

describe('metadata that no document should have is still refused, and quickly', () => {
  const program = (...blocks: unknown[]) => ({ blocks: { languageVersion: 0, blocks } });
  const joinOf = (itemCount: number, id: string) => ({ type: 'text_join', id, extraState: { itemCount } });
  const ifOf = (elseIfCount: number, id: string) => ({ type: 'controls_if', id, extraState: { elseIfCount } });
  const cheap = (blocks: unknown) => {
    const started = performance.now();
    const opened = canOpenProgram(blocks, packs);
    expect(performance.now() - started).toBeLessThan(250);
    return opened;
  };

  it.each([
    ['one join past the per-block bound', program(joinOf(maxMutatorItemsPerBlock + 1, 'j'))],
    ['one join of 100 000 parts', program(joinOf(100_000, 'j'))],
    ['one if past the per-block bound', program(ifOf(maxMutatorItemsPerBlock + 1, 'i'))],
    ['joins that add up past the total bound', program(...Array.from({ length: maxTotalMutatorItems / 1000 + 1 }, (_, i) => joinOf(1000, `j${i}`)))],
    ['ifs that add up past the total bound', program(...Array.from({ length: maxTotalMutatorItems / 1000 + 1 }, (_, i) => ifOf(1000, `i${i}`)))],
    ['joins and ifs that add up past the total bound', program(joinOf(maxTotalMutatorItems / 2, 'j'), ifOf(maxTotalMutatorItems / 2 + 1, 'i'))],
  ])('refuses %s without building anything', (_, blocks) => {
    // The blocks above that are "one huge block" are also past the per-block bound, so refused before any total is built.
    expect(cheap(blocks)).toBe(false);
  });

  it('accepts a block exactly at the per-block bound, and the total exactly at the total bound', () => {
    const started = performance.now();
    expect(canOpenProgram(program(joinOf(maxMutatorItemsPerBlock - 1, 'j')), packs)).toBe(true);
    expect(canOpenProgram(program(joinOf(maxMutatorItemsPerBlock, 'j')), packs)).toBe(true);
    expect(canOpenProgram(program(ifOf(maxMutatorItemsPerBlock - 1, 'i')), packs)).toBe(true);
    expect(canOpenProgram(program(ifOf(maxMutatorItemsPerBlock, 'i')), packs)).toBe(true);
    expect(performance.now() - started).toBeLessThan(2_000);
  });

  it('accepts the whole total when it is spread over many blocks, within a fraction of a second', () => {
    const started = performance.now();
    const spread = program(...Array.from({ length: maxTotalMutatorItems / MAX_TEXT_JOIN_PARTS }, (_, i) => joinOf(MAX_TEXT_JOIN_PARTS, `j${i}`)));
    expect(canOpenProgram(spread, packs)).toBe(true);
    expect(performance.now() - started).toBeLessThan(2_000);
  });
});
