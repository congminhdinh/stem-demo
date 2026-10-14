// Reads the blocks of a Blockly serialization JSON without Blockly (B1, B4).
// Tolerant on purpose: a stored program is data of unknown shape, and the
// walk is bounded, so it can neither throw nor run for ever on one.

import { MAX_PROGRAM_BLOCKS, PREFLIGHT_BLOCK_COUNT } from './limits';

export type BlockRef = { type: string; id: string | undefined };

/** More blocks than this are not walked; MAX_PROGRAM_BLOCKS (YB-2) is the real limit. */
const maxWalkedBlocks = 100_000;

/**
 * Every block of the workspace JSON: top-level blocks, statement and value inputs, `next` chains.
 * Stops after `limit` blocks, so a huge or self-referencing structure costs no more than that.
 */
export function listBlocks(workspace: unknown, limit = maxWalkedBlocks): BlockRef[] {
  const found: BlockRef[] = [];
  const seen = new Set<object>();
  const pending: unknown[] = [asRecord(asRecord(workspace)?.blocks)?.blocks];
  while (pending.length > 0 && found.length < limit) {
    const value = pending.pop();
    if (Array.isArray(value)) {
      // An array met before is not walked again, so an array that contains itself ends the walk.
      if (seen.has(value)) {
        continue;
      }
      seen.add(value);
      // A loop, not a spread: a huge array must not overflow the call stack.
      for (const item of value) {
        pending.push(item);
      }
      continue;
    }
    const block = asRecord(value);
    if (!block || seen.has(block)) {
      continue;
    }
    seen.add(block);
    if (typeof block.type === 'string') {
      found.push({ type: block.type, id: typeof block.id === 'string' ? block.id : undefined });
    }
    const inputs = asRecord(block.inputs);
    for (const input of inputs ? Object.values(inputs) : []) {
      const record = asRecord(input);
      pending.push(record?.block, record?.shadow);
    }
    pending.push(asRecord(block.next)?.block);
  }
  return found;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Whether the workspace has more blocks than a YBC program may (plan §6.7). It counts
 * hats, statements, values and shadows alike, and stops at one block over the limit, so
 * the check costs the same for a program of 2 001 blocks and one of 2 million. The
 * preflight of RunSession and the compiler both ask this, so there is one rule.
 */
export function exceedsBlockLimit(workspace: unknown): boolean {
  // Entries of the top-level list count even when they are not blocks: a huge list of junk is refused, not walked.
  const topLevel = asRecord(asRecord(workspace)?.blocks)?.blocks;
  if (Array.isArray(topLevel) && topLevel.length > MAX_PROGRAM_BLOCKS) {
    return true;
  }
  return listBlocks(workspace, PREFLIGHT_BLOCK_COUNT).length >= PREFLIGHT_BLOCK_COUNT;
}
