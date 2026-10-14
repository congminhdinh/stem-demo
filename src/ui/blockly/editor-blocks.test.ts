import * as Blockly from 'blockly';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { localDeviceDefinitions } from '../../core/devices/local-catalog';
import { createDeviceRegistry } from '../../core/devices/registry';
import ifElseIf from '../../core/program/__fixtures__/if-else-if.json';
import missingCondition from '../../core/program/__fixtures__/missing-condition.json';
import { createBlockPackCatalog } from '../../core/program/block-packs';
import { createDefaultProgram } from '../../core/program/blocks';
import blinkSample from '../../samples/blink.project.json';
import buttonLedSample from '../../samples/button-led.project.json';
import { canOpenProgram, maxElseIfs } from './editor-blocks';

// The editor's own check of stored programs (plan §7), on real Blockly (its
// Node build, on jsdom): what it refuses is exactly what would make the
// program panel throw, and so the app go blank.

const packs = createBlockPackCatalog(createDeviceRegistry(localDeviceDefinitions));
const canOpen = (blocks: unknown) => canOpenProgram(blocks, packs);

/** The button-led program with `change` applied to its "if" block. */
const buttonLedWithIf = (change: (block: Record<string, unknown> & { inputs: Record<string, unknown> }) => void) => {
  const program = structuredClone(buttonLedSample.program.blocks);
  change(program.blocks.blocks[0]!.inputs.DO.block as Record<string, unknown> & { inputs: Record<string, unknown> });
  return program;
};

/** A program of the given top-level blocks. */
const program = (...blocks: unknown[]) => ({ blocks: { languageVersion: 0, blocks } });
const ifWith = (extraState: unknown, id = 'if') => ({ type: 'controls_if', id, extraState });

describe('canOpenProgram', () => {
  it.each<[string, unknown]>([
    ['blink', blinkSample.program.blocks],
    ['button-led', buttonLedSample.program.blocks],
    ['an if / else if / else with not', ifElseIf],
    ['the program of a new project', createDefaultProgram()],
    ['an empty workspace', {}],
    // The editor can save a program that does not compile yet; it must open again.
    ['an "if" with an empty condition', missingCondition],
  ])('opens %s', (_, blocks) => {
    expect(canOpen(blocks)).toBe(true);
  });

  it.each<[string, unknown]>([
    // Blockly throws 'The block "controls_if" … is missing a(n) ELSE connection'.
    ['an "if" whose extraState became null while it still has an else', buttonLedWithIf((block) => (block.extraState = null))],
    [
      'an "if" with an else-if input its extraState does not create',
      buttonLedWithIf((block) => (block.inputs.IF1 = structuredClone(block.inputs.IF0))),
    ],
    [
      'a value block in a statement input',
      buttonLedWithIf(
        (block) => (block.inputs.DO0 = { block: { type: 'stem_digital_read', id: 'read', fields: { PIN: 'D2' } } }),
      ),
    ],
    ['an unknown block type', { blocks: { languageVersion: 0, blocks: [{ type: 'stem_servo', id: 'servo' }] } }],
    ['a block without a type', { blocks: { languageVersion: 0, blocks: [{ id: 'no-type' }] } }],
    ['top-level blocks that are not a list', { blocks: { languageVersion: 0, blocks: 7 } }],
    ['null', null],
    ['a string', 'forever'],
    ['an array', []],
  ])('refuses %s', (_, blocks) => {
    expect(canOpen(blocks)).toBe(false);
  });

  it('refuses a program nested too deeply for Blockly to load, and still opens the next one', () => {
    let block: Record<string, unknown> = { type: 'stem_digital_read', id: 'read', fields: { PIN: 'D2' } };
    for (let depth = 0; depth < 100_000; depth++) {
      block = { type: 'logic_negate', id: `not-${depth}`, inputs: { BOOL: { block } } };
    }

    expect(canOpen({ blocks: { languageVersion: 0, blocks: [block] } })).toBe(false);
    expect(canOpen(buttonLedSample.program.blocks)).toBe(true);
  });

  it('opens a program with as many else-ifs as allowed, quickly', () => {
    const started = performance.now();

    expect(canOpen(program(ifWith({ elseIfCount: maxElseIfs, hasElse: true })))).toBe(true);
    expect(performance.now() - started).toBeLessThan(1000);
  });
});

describe('canOpenProgram, before Blockly loads anything (F4)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('still has Blockly load the programs it lets through', () => {
    const load = vi.spyOn(Blockly.serialization.workspaces, 'load');

    expect(canOpen(buttonLedSample.program.blocks)).toBe(true);
    expect(load).toHaveBeenCalledOnce();
  });

  /** A tree 2^depth blocks large, from depth + 1 objects: each "if" holds the next one twice. */
  const sharedTree = (depth: number) => {
    let block: Record<string, unknown> = ifWith({ hasElse: true }, 'leaf');
    for (let level = 0; level < depth; level++) {
      block = { ...ifWith({ hasElse: true }, `if-${level}`), inputs: { DO0: { block }, ELSE: { block } } };
    }
    return program(block);
  };
  const looped = () => {
    const block: Record<string, unknown> = ifWith({ hasElse: true });
    block.inputs = { ELSE: { block } };
    return program(block);
  };
  const holes = (length: number) => {
    const reasons: unknown[] = [];
    reasons.length = length;
    return reasons;
  };

  // Blockly builds what these claim before it checks anything: minutes of
  // work, or no end, while the page cannot render. Its loader is stubbed
  // here, so a guard that lets one through fails at once instead of hanging.
  it.each<[string, unknown]>([
    [
      'an "if" claiming a billion else-ifs (the reviewer’s case)',
      buttonLedWithIf((block) => (block.extraState = { elseIfCount: 1_000_000_000, hasElse: true })),
    ],
    ['an else-if count of Infinity, which IndexedDB can store', program(ifWith({ elseIfCount: Infinity }))],
    ['an else-if count as a string, which Blockly takes as a number', program(ifWith({ elseIfCount: '1000000000' }))],
    ['an else-if count in an array, which Blockly takes as a number', program(ifWith({ elseIfCount: [1_000_000_000] }))],
    [
      'more else-ifs in all than allowed, each "if" within the limit',
      program(ifWith({ elseIfCount: maxElseIfs }, 'first'), ifWith({ elseIfCount: 1 }, 'second')),
    ],
    [
      // Added to the total, "many" would make it a string that is not a number.
      'a billion else-ifs next to a count that is not a number',
      program(
        ifWith({ elseIfCount: 'many' }, 'first'),
        ifWith({ elseIfCount: 1_000_000_000 }, 'second'),
        ifWith({ elseIfCount: 'many' }, 'third'),
      ),
    ],
    [
      'the item count of a list block, which Blockly also knows',
      program({ type: 'lists_create_with', id: 'list', extraState: { itemCount: 1_000_000_000 } }),
    ],
    [
      'the item count of a text block, which Blockly also knows',
      program({ type: 'text_join', id: 'text', extraState: { itemCount: 1_000_000_000 } }),
    ],
    [
      'the parameters of a procedure call, which Blockly also knows',
      program({ type: 'procedures_callnoreturn', id: 'call', extraState: { name: 'f', params: { length: 1e9 } } }),
    ],
    ['one block referenced from two inputs, a tree of 2^30 blocks', sharedTree(30)],
    ['a block inside itself', looped()],
    [
      'disabled reasons with holes up to the longest array',
      program({ type: 'stem_wait', id: 'wait', disabledReasons: holes(2 ** 32 - 1) }),
    ],
  ])('refuses %s in bounded time, without handing it to Blockly', (_, blocks) => {
    const load = vi.spyOn(Blockly.serialization.workspaces, 'load').mockImplementation(() => {
      throw new Error('Blockly must not be asked to load this program');
    });
    const started = performance.now();

    expect(canOpen(blocks)).toBe(false);
    expect(performance.now() - started).toBeLessThan(100);
    // The count only: printing the calls would walk the program's holes too.
    expect(load.mock.calls.length).toBe(0);
  });
});
