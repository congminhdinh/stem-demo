import * as Blockly from 'blockly/core';
import 'blockly/blocks';
import * as En from 'blockly/msg/en';
import { describe, expect, it } from 'vitest';
import { localDeviceDefinitions } from '../src/core/devices/local-catalog';
import { createDeviceRegistry } from '../src/core/devices/registry';
import { productionProfiles } from '../src/core/profiles';
import { createBlockPackCatalog } from '../src/core/program/block-packs';
import { compileYbcProgram } from '../src/core/program/compile-ybc-program';
import { createRunConsole } from '../src/core/program/console';
import { runYbc } from '../src/core/program/__fixtures__/run-ybc';

// The Blockly <-> YBC compiler contract for the YB-2b blocks: real Blockly, headless, builds and saves
// repeat, while, count up, wait and join; the compiler reads exactly what Blockly writes.

Blockly.setLocale(En as unknown as Record<string, string>);
const packs = createBlockPackCatalog(createDeviceRegistry(localDeviceDefinitions));
Blockly.common.defineBlocksWithJsonArray(packs.definitions());
const exposed = packs.typesOf(productionProfiles.get('ybc-basic')?.blockPacks ?? []);

type Fields = Record<string, string | number>;

function newBlock(workspace: Blockly.Workspace, type: string, id: string, fields: Fields = {}) {
  const block = workspace.newBlock(type, id);
  for (const [name, value] of Object.entries(fields)) {
    block.setFieldValue(value, name);
  }
  return block;
}

function plug(parent: Blockly.Block, inputName: string, child: Blockly.Block) {
  const connection = parent.getInput(inputName)?.connection;
  const childConnection = child.outputConnection ?? child.previousConnection;
  if (!connection || !childConnection) {
    throw new Error(`Cannot plug ${child.type} into ${parent.type}.${inputName}`);
  }
  connection.connect(childConnection);
}

function stack(owner: Blockly.Block, input: string, ...blocks: Blockly.Block[]) {
  blocks.forEach((block, index) => {
    const previous = blocks[index - 1];
    if (!previous) {
      plug(owner, input, block);
    } else if (previous.nextConnection && block.previousConnection) {
      previous.nextConnection.connect(block.previousConnection);
    }
  });
}

const number = (workspace: Blockly.Workspace, id: string, value: number) => newBlock(workspace, 'math_number', id, { NUM: value });
const say = (workspace: Blockly.Workspace, id: string, value: Blockly.Block) => {
  const print = newBlock(workspace, 'text_print', id);
  plug(print, 'TEXT', value);
  return print;
};

function build(make: (workspace: Blockly.Workspace, onStart: Blockly.Block) => void) {
  const workspace = new Blockly.Workspace();
  try {
    const onStart = newBlock(workspace, 'stem_on_start', 'on-start');
    onStart.moveBy(40, 40);
    make(workspace, onStart);
    return Blockly.serialization.workspaces.save(workspace);
  } finally {
    workspace.dispose();
  }
}

async function printedBy(saved: Record<string, unknown>) {
  const compiled = compileYbcProgram(saved, exposed);
  if (!compiled.ok) {
    throw new Error(`Does not compile: ${JSON.stringify(compiled.diagnostics)}`);
  }
  const runConsole = createRunConsole();
  const outcome = await runYbc(compiled.ir, {
    sleep: () => Promise.resolve(),
    console: runConsole,
    yieldNow: () => Promise.resolve(),
  }).done;
  return { outcome, lines: runConsole.snapshot().lines };
}

const reloaded = (saved: Record<string, unknown>) => {
  const workspace = new Blockly.Workspace();
  try {
    Blockly.serialization.workspaces.load(saved, workspace);
    return Blockly.serialization.workspaces.save(workspace);
  } finally {
    workspace.dispose();
  }
};

describe('YB-2b blocks as real Blockly saves them', () => {
  it('compiles and runs count up with i from 1 to 7 by 3, as a variable block and a step field', async () => {
    const saved = build((workspace, onStart) => {
      const variable = workspace.getVariableMap().createVariable('i', '', 'i-id');
      const loop = newBlock(workspace, 'ybc_count_up', 'count');
      loop.setFieldValue(variable.getId(), 'VAR');
      loop.setFieldValue(3, 'STEP');
      plug(loop, 'FROM', number(workspace, 'from', 1));
      plug(loop, 'TO', number(workspace, 'to', 7));
      const get = newBlock(workspace, 'variables_get', 'get-i');
      get.setFieldValue(variable.getId(), 'VAR');
      plug(loop, 'DO', say(workspace, 'print-i', get));
      plug(onStart, 'DO', loop);
    });

    const loop = (saved.blocks as { blocks: { inputs: { DO: { block: { fields: unknown } } } }[] }).blocks[0]?.inputs.DO.block;
    expect(loop?.fields).toEqual({ VAR: { id: 'i-id' }, STEP: 3 });
    expect((await printedBy(saved)).lines).toEqual(['1', '4', '7']);
    expect(reloaded(saved)).toEqual(saved);
  });

  it('compiles and runs repeat, while and wait', async () => {
    const saved = build((workspace, onStart) => {
      const variable = workspace.getVariableMap().createVariable('x', '', 'x-id');
      const get = (id: string) => {
        const block = newBlock(workspace, 'variables_get', id);
        block.setFieldValue(variable.getId(), 'VAR');
        return block;
      };
      const increment = (id: string) => {
        const set = newBlock(workspace, 'variables_set', id);
        set.setFieldValue(variable.getId(), 'VAR');
        const sum = newBlock(workspace, 'ybc_arith', `${id}-sum`, { OP: 'ADD' });
        plug(sum, 'A', get(`${id}-get`));
        plug(sum, 'B', number(workspace, `${id}-one`, 1));
        plug(set, 'VALUE', sum);
        return set;
      };
      const times = newBlock(workspace, 'controls_repeat_ext', 'repeat');
      plug(times, 'TIMES', number(workspace, 'times', 3));
      plug(times, 'DO', increment('inc-1'));

      const loop = newBlock(workspace, 'ybc_while', 'while');
      const less = newBlock(workspace, 'logic_compare', 'less', { OP: 'LT' });
      plug(less, 'A', get('get-x'));
      plug(less, 'B', number(workspace, 'limit', 5));
      plug(loop, 'COND', less);
      plug(loop, 'DO', increment('inc-2'));

      const pause = newBlock(workspace, 'ybc_wait_ms', 'pause');
      plug(pause, 'MS', number(workspace, 'ms', 250));

      stack(onStart, 'DO', times, loop, pause, say(workspace, 'print-x', get('get-x-2')));
    });

    const { outcome, lines } = await printedBy(saved);
    expect(lines).toEqual(['5']);
    expect(outcome).toEqual({ status: 'finished' });
    expect(reloaded(saved)).toEqual(saved);
  });

  it('compiles and runs a join of three parts, with the mutator saved as itemCount', async () => {
    const saved = build((workspace, onStart) => {
      const join = newBlock(workspace, 'text_join', 'join');
      join.loadExtraState?.({ itemCount: 3 });
      plug(join, 'ADD0', newBlock(workspace, 'text', 'a', { TEXT: 'n = ' }));
      plug(join, 'ADD1', number(workspace, 'n', 42));
      plug(join, 'ADD2', newBlock(workspace, 'logic_boolean', 'flag', { BOOL: 'TRUE' }));
      plug(onStart, 'DO', say(workspace, 'print-join', join));
    });
    expect(JSON.stringify(saved)).toContain('"extraState":{"itemCount":3}');
    expect((await printedBy(saved)).lines).toEqual(['n = 42True']);
    expect(reloaded(saved)).toEqual(saved);
  });

  it('refuses a join saved with more than 50 parts, without running anything', () => {
    const saved = build((workspace, onStart) => {
      const join = newBlock(workspace, 'text_join', 'join');
      join.loadExtraState?.({ itemCount: 51 });
      plug(onStart, 'DO', say(workspace, 'print-join', join));
    });
    expect(compileYbcProgram(saved, exposed).diagnostics).toContainEqual(expect.objectContaining({ code: 'limit-exceeded', blockId: 'join' }));
  });

  it('does not offer the "until" variant of Blockly\'s while block: the dialect block has no dropdown', () => {
    const workspace = new Blockly.Workspace();
    try {
      const loop = workspace.newBlock('ybc_while');
      expect(loop.getField('MODE')).toBeNull();
      expect(loop.inputList.flatMap((input) => input.fieldRow).filter((field) => field instanceof Blockly.FieldDropdown)).toEqual([]);
    } finally {
      workspace.dispose();
    }
  });

  it('limits the step field of count up to 1..1 000 000 in the editor too', () => {
    const workspace = new Blockly.Workspace();
    try {
      const loop = workspace.newBlock('ybc_count_up');
      const step = loop.getField('STEP') as Blockly.FieldNumber;
      step.setValue(0);
      expect(step.getValue()).toBe(1);
      step.setValue(5_000_000);
      expect(step.getValue()).toBe(1_000_000);
      step.setValue(2.4);
      expect(step.getValue()).toBe(2);
    } finally {
      workspace.dispose();
    }
  });
});
