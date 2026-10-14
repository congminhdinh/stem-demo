import { describe, expect, it } from 'vitest';
import { localDeviceDefinitions } from '../../core/devices/local-catalog';
import { createDeviceRegistry } from '../../core/devices/registry';
import { createBlockPackCatalog } from '../../core/program/block-packs';
import { MAX_TEXT_JOIN_PARTS } from '../../core/program/limits';
import { canOpenProgram, maxMutatorItemsPerBlock, maxTotalMutatorItems } from './editor-blocks';

// The structural check of stored programs (L-1) for the join mutator (YB plan section 12): Blockly builds
// `itemCount` inputs for it, so the total is bounded before Blockly sees it. The bound is structural and
// generous. The language limit (50 parts) is not a reason to refuse a document: the editor can make a join of
// 51 parts, so L-1 opens it and only Run refuses it (L-3, limit-exceeded; see run-session tests).

const packs = createBlockPackCatalog(createDeviceRegistry(localDeviceDefinitions));
const program = (...blocks: unknown[]) => ({ blocks: { languageVersion: 0, blocks } });
const join = (extraState: unknown, id = 'join') => ({ type: 'text_join', id, extraState });

describe('canOpenProgram: the text join mutator', () => {
  it.each([0, 1, 2, MAX_TEXT_JOIN_PARTS, MAX_TEXT_JOIN_PARTS + 1, maxMutatorItemsPerBlock])('opens a join with %d parts', (itemCount) => {
    expect(canOpenProgram(program(join({ itemCount })), packs)).toBe(true);
  });

  it('refuses a join that asks for more inputs than the structural bound', () => {
    expect(canOpenProgram(program(join({ itemCount: maxMutatorItemsPerBlock + 1 })), packs)).toBe(false);
  });

  it.each<[string, unknown]>([
    ['a billion parts', { itemCount: 1_000_000_000 }],
    ['Infinity', { itemCount: Infinity }],
    ['NaN', { itemCount: NaN }],
    ['a negative count', { itemCount: -1 }],
    ['a fraction', { itemCount: 2.5 }],
    ['a numeric string', { itemCount: '3' }],
    ['an array', { itemCount: [3] }],
  ])('refuses a join with %s: nothing is built for it', (_, extraState) => {
    expect(canOpenProgram(program(join(extraState)), packs)).toBe(false);
  });

  it('adds up the joins of a document against the total bound, which is large', () => {
    const joins = (count: number) => Array.from({ length: count }, (_, index) => join({ itemCount: 1000 }, `join-${index}`));
    expect(canOpenProgram(program(...joins(maxTotalMutatorItems / 1000)), packs)).toBe(true);
    expect(canOpenProgram(program(...joins(maxTotalMutatorItems / 1000 + 1)), packs)).toBe(false);
  });

  it('still refuses mutator state on any other block', () => {
    expect(canOpenProgram(program({ type: 'text_print', id: 'p', extraState: { itemCount: 1 } }), packs)).toBe(false);
    expect(canOpenProgram(program({ type: 'stem_wait', id: 'w', extraState: {} }), packs)).toBe(false);
  });

  it('keeps the else-if budget as it was', () => {
    expect(canOpenProgram(program({ type: 'controls_if', id: 'if', extraState: { elseIfCount: maxMutatorItemsPerBlock } }), packs)).toBe(true);
    expect(canOpenProgram(program({ type: 'controls_if', id: 'if', extraState: { elseIfCount: maxMutatorItemsPerBlock + 1 } }), packs)).toBe(false);
  });

  it('opens a program of more than 2000 blocks: the size limit is for running, not for editing', () => {
    const prints = Array.from({ length: 3_000 }, (_, index) => ({ type: 'stem_wait', id: `loose-${index}` }));
    expect(canOpenProgram(program(...prints), packs)).toBe(true);
  });
});
