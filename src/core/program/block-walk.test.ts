import { describe, expect, it } from 'vitest';
import { exceedsBlockLimit, listBlocks } from './block-walk';
import { MAX_PROGRAM_BLOCKS } from './limits';

// The walk over stored program JSON (a stored program is data of unknown shape): it ends on any repeated
// object or array, and stops at the block bound it is given.

const workspace = (...blocks: unknown[]) => ({ blocks: { languageVersion: 0, blocks } });

describe('listBlocks', () => {
  it('lists the blocks of inputs and next chains', () => {
    const found = listBlocks(
      workspace({ type: 'a', id: '1', inputs: { X: { block: { type: 'b', id: '2', next: { block: { type: 'c', id: '3' } } } } } }),
    );
    expect(found.map((block) => block.type).sort()).toEqual(['a', 'b', 'c']);
  });

  it('ends on a block that contains itself', () => {
    const cyclic: Record<string, unknown> = { type: 'a', id: '1' };
    cyclic.next = { block: cyclic };
    expect(listBlocks(workspace(cyclic))).toHaveLength(1);
  });

  it('ends on an array that contains itself', () => {
    const list: unknown[] = [{ type: 'a', id: '1' }];
    list.push(list);
    expect(listBlocks({ blocks: { blocks: list } })).toHaveLength(1);
  });

  it('ends on arrays that contain each other', () => {
    const first: unknown[] = [{ type: 'a', id: '1' }];
    const second: unknown[] = [first, { type: 'b', id: '2' }];
    first.push(second);
    expect(listBlocks({ blocks: { blocks: first } }).map((block) => block.type).sort()).toEqual(['a', 'b']);
  });

  it('ends on an array reached from a block input', () => {
    const loop: unknown[] = [];
    loop.push(loop, { type: 'inner', id: '2' });
    const block = { type: 'a', id: '1', inputs: { X: { block: loop } } };
    expect(listBlocks(workspace(block)).map((found) => found.type).sort()).toEqual(['a', 'inner']);
  });

  it('stops at the limit it is given', () => {
    const many = Array.from({ length: 50 }, (_, index) => ({ type: 'a', id: String(index) }));
    expect(listBlocks(workspace(...many), 10)).toHaveLength(10);
  });

  it('does not overflow the stack on a huge array', () => {
    expect(() => listBlocks({ blocks: { blocks: new Array(2_000_000).fill(null) } })).not.toThrow();
  });

  it('survives values that are not a workspace', () => {
    for (const value of [null, undefined, 7, 'x', [], {}, { blocks: 3 }, { blocks: { blocks: 'x' } }]) {
      expect(listBlocks(value)).toEqual([]);
    }
  });
});

describe('exceedsBlockLimit', () => {
  const blocks = (count: number) => Array.from({ length: count }, (_, index) => ({ type: 'a', id: String(index) }));

  it('is false up to the limit and true one block over it', () => {
    expect(exceedsBlockLimit(workspace(...blocks(MAX_PROGRAM_BLOCKS)))).toBe(false);
    expect(exceedsBlockLimit(workspace(...blocks(MAX_PROGRAM_BLOCKS + 1)))).toBe(true);
  });

  it('counts nested blocks, shadows included', () => {
    const nested = (depth: number): unknown =>
      depth === 0 ? { type: 'leaf', id: 'leaf' } : { type: 'n', id: String(depth), inputs: { A: { shadow: nested(depth - 1) } } };
    expect(exceedsBlockLimit(workspace(nested(MAX_PROGRAM_BLOCKS - 1)))).toBe(false);
    expect(exceedsBlockLimit(workspace(nested(MAX_PROGRAM_BLOCKS)))).toBe(true);
  });

  it('refuses a top-level list longer than the limit without walking it', () => {
    expect(exceedsBlockLimit({ blocks: { blocks: new Array(MAX_PROGRAM_BLOCKS + 1).fill(null) } })).toBe(true);
  });

  it('terminates on repeated references, in objects and in arrays', () => {
    const list: unknown[] = [{ type: 'a', id: '1' }];
    list.push(list);
    expect(exceedsBlockLimit({ blocks: { blocks: list } })).toBe(false);
  });
});
