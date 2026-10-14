// Reads the blocks of a Blockly serialization JSON without Blockly (B1, B4).
// Tolerant on purpose: a stored program is data of unknown shape, and the
// walk is bounded, so it can neither throw nor run for ever on one.

export type BlockRef = { type: string; id: string | undefined };

/** More blocks than this are not walked; MAX_PROGRAM_BLOCKS (YB-2) is the real limit. */
const maxWalkedBlocks = 100_000;

/** Every block of the workspace JSON: top-level blocks, statement and value inputs, `next` chains. */
export function listBlocks(workspace: unknown): BlockRef[] {
  const found: BlockRef[] = [];
  const seen = new Set<object>();
  const pending: unknown[] = [asRecord(asRecord(workspace)?.blocks)?.blocks];
  while (pending.length > 0 && found.length < maxWalkedBlocks) {
    const value = pending.pop();
    if (Array.isArray(value)) {
      pending.push(...value);
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
