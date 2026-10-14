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
import { runYbcProgram } from '../src/core/program/ybc-interpreter';

// The Blockly <-> YBC compiler contract for YB-2a (plan §9.4, risk R2): real Blockly,
// headless, builds the programs and saves them; the compiler must read exactly the
// JSON Blockly writes, and the interpreter must print what the lesson says.

Blockly.setLocale(En as unknown as Record<string, string>);
const packs = createBlockPackCatalog(createDeviceRegistry(localDeviceDefinitions));
// What the editor registers: the blocks of every known pack.
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

const number = (workspace: Blockly.Workspace, id: string, value: number) => newBlock(workspace, 'math_number', id, { NUM: value });

/** Makes the blocks of a lesson-sized program, the way the editor does, and saves them. */
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
  const outcome = await runYbcProgram(compiled.ir, {
    sleep: () => new Promise(() => {}),
    console: runConsole,
  }).done;
  return { outcome, lines: runConsole.snapshot().lines };
}

/** A statement stack under `owner.input`, linked by next connections. */
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

describe('YBC blocks as real Blockly saves them', () => {
  it('compiles and runs: x = 7 // 2; print x; if x == 3 then "three" else "other"; print -7 % 3', async () => {
    const saved = build((workspace, onStart) => {
      const variable = workspace.getVariableMap().createVariable('x', '', 'x-id');
      const set = newBlock(workspace, 'variables_set', 'set-x');
      set.setFieldValue(variable.getId(), 'VAR');
      const divide = newBlock(workspace, 'ybc_int_divide', 'divide');
      plug(divide, 'A', number(workspace, 'seven', 7));
      plug(divide, 'B', number(workspace, 'two', 2));
      plug(set, 'VALUE', divide);

      const get = (id: string) => {
        const block = newBlock(workspace, 'variables_get', id);
        block.setFieldValue(variable.getId(), 'VAR');
        return block;
      };
      const printX = newBlock(workspace, 'text_print', 'print-x');
      plug(printX, 'TEXT', get('get-x-1'));

      const choose = newBlock(workspace, 'controls_if', 'choose');
      choose.loadExtraState?.({ hasElse: true });
      const compare = newBlock(workspace, 'logic_compare', 'compare', { OP: 'EQ' });
      plug(compare, 'A', get('get-x-2'));
      plug(compare, 'B', number(workspace, 'three', 3));
      plug(choose, 'IF0', compare);
      const say = (id: string, textId: string, value: string) => {
        const print = newBlock(workspace, 'text_print', id);
        plug(print, 'TEXT', newBlock(workspace, 'text', textId, { TEXT: value }));
        return print;
      };
      plug(choose, 'DO0', say('print-three', 'text-three', 'three'));
      plug(choose, 'ELSE', say('print-other', 'text-other', 'other'));

      const remainder = newBlock(workspace, 'math_modulo', 'rem');
      plug(remainder, 'DIVIDEND', number(workspace, 'minus-seven', -7));
      plug(remainder, 'DIVISOR', number(workspace, 'three-b', 3));
      const printRem = newBlock(workspace, 'text_print', 'print-rem');
      plug(printRem, 'TEXT', remainder);

      stack(onStart, 'DO', set, printX, choose, printRem);
    });

    expect(saved.variables).toContainEqual({ name: 'x', id: 'x-id' });
    const { outcome, lines } = await printedBy(saved);
    expect(lines).toEqual(['3', 'three', '2']);
    expect(outcome).toEqual({ status: 'finished' });
  });

  it('compiles and runs the arithmetic block with each of its three offered operators', async () => {
    const saved = build((workspace, onStart) => {
      const prints = (['ADD', 'MINUS', 'MULTIPLY'] as const).map((op) => {
        const arithmetic = newBlock(workspace, 'ybc_arith', `arith-${op}`, { OP: op });
        plug(arithmetic, 'A', number(workspace, `a-${op}`, 6));
        plug(arithmetic, 'B', number(workspace, `b-${op}`, 3));
        const print = newBlock(workspace, 'text_print', `print-${op}`);
        plug(print, 'TEXT', arithmetic);
        return print;
      });
      stack(onStart, 'DO', ...prints);
    });
    expect((await printedBy(saved)).lines).toEqual(['9', '3', '18']);
  });

  it('reads a shadow number plugged where the toolbox puts one', async () => {
    const saved = build((workspace, onStart) => {
      const arithmetic = newBlock(workspace, 'ybc_arith', 'arith', { OP: 'ADD' });
      const left = number(workspace, 'shadow-a', 1);
      left.setShadow(true);
      const right = number(workspace, 'shadow-b', 1);
      right.setShadow(true);
      plug(arithmetic, 'A', left);
      plug(arithmetic, 'B', right);
      const print = newBlock(workspace, 'text_print', 'print');
      plug(print, 'TEXT', arithmetic);
      plug(onStart, 'DO', print);
    });
    expect(JSON.stringify(saved)).toContain('"shadow"');
    expect((await printedBy(saved)).lines).toEqual(['2']);
  });

  it('refuses a foreign Blockly arithmetic block with DIVIDE, which is not read as ybc_arith', () => {
    const saved = build((workspace, onStart) => {
      const arithmetic = newBlock(workspace, 'math_arithmetic', 'arith', { OP: 'DIVIDE' });
      plug(arithmetic, 'A', number(workspace, 'a', 1));
      plug(arithmetic, 'B', number(workspace, 'b', 2));
      const print = newBlock(workspace, 'text_print', 'print');
      plug(print, 'TEXT', arithmetic);
      plug(onStart, 'DO', print);
    });
    expect(compileYbcProgram(saved, exposed).diagnostics).toEqual([expect.objectContaining({ code: 'float-not-supported', blockId: 'arith' })]);
  });

  it('compiles and runs an if / else if / else as Blockly saves it: extraState elseIfCount and hasElse', async () => {
    const saved = build((workspace, onStart) => {
      const choose = newBlock(workspace, 'controls_if', 'choose');
      choose.loadExtraState?.({ elseIfCount: 1, hasElse: true });
      const say = (id: string, value: string) => {
        const print = newBlock(workspace, 'text_print', id);
        plug(print, 'TEXT', newBlock(workspace, 'text', `${id}-text`, { TEXT: value }));
        return print;
      };
      const isTrue = (id: string, value: 'TRUE' | 'FALSE') => newBlock(workspace, 'logic_boolean', id, { BOOL: value });
      plug(choose, 'IF0', isTrue('first', 'FALSE'));
      plug(choose, 'DO0', say('print-first', 'first'));
      plug(choose, 'IF1', isTrue('second', 'TRUE'));
      plug(choose, 'DO1', say('print-second', 'second'));
      plug(choose, 'ELSE', say('print-else', 'else'));
      plug(onStart, 'DO', choose);
    });
    expect(saved).toBeDefined();
    expect((await printedBy(saved)).lines).toEqual(['second']);
  });

  it.each(['ADD', 'MINUS', 'MULTIPLY'])('saves and reloads a ybc_arith %s unchanged, operator included', (op) => {
    const saved = build((workspace, onStart) => {
      const arithmetic = newBlock(workspace, 'ybc_arith', 'arith', { OP: op });
      plug(arithmetic, 'A', number(workspace, 'a', 4));
      plug(arithmetic, 'B', number(workspace, 'b', 2));
      const print = newBlock(workspace, 'text_print', 'print');
      plug(print, 'TEXT', arithmetic);
      plug(onStart, 'DO', print);
    });
    const reload = new Blockly.Workspace();
    try {
      Blockly.serialization.workspaces.load(saved, reload);
      expect(Blockly.serialization.workspaces.save(reload)).toEqual(saved);
      expect(JSON.stringify(saved)).toContain(`"OP":"${op}"`);
    } finally {
      reload.dispose();
    }
  });
});
