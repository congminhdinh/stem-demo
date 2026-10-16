// The block types of a program that run (N6a S2, goal `uses-block`): the blocks reachable from an enabled
// "on start" or "forever" through inputs and `next`, skipping disabled blocks with everything inside them.
// A loose block, or one the learner disabled, does not count: it is in the workspace but not in the program.
// Like block-walk.ts it reads Blockly JSON without Blockly and is bounded, so a stored program of any shape
// can neither throw nor run for ever here.

const hats = new Set(['stem_on_start', 'stem_forever']);

/** More blocks than this are not walked; MAX_PROGRAM_BLOCKS is the real limit of a program. */
const maxWalkedBlocks = 100_000;

export function runningBlockTypes(workspace: unknown): Set<string> {
  const types = new Set<string>();
  const seen = new Set<object>();
  const top = asRecord(asRecord(workspace)?.blocks)?.blocks;
  const pending: unknown[] = Array.isArray(top) ? top.filter((block) => hats.has(String(asRecord(block)?.type))) : [];
  let walked = 0;
  while (pending.length > 0 && walked < maxWalkedBlocks) {
    const block = asRecord(pending.pop());
    if (!block || seen.has(block)) {
      continue;
    }
    seen.add(block);
    walked += 1;
    const disabled = Array.isArray(block.disabledReasons) && block.disabledReasons.length > 0;
    if (!disabled) {
      if (typeof block.type === 'string') {
        types.add(block.type);
      }
      const inputs = asRecord(block.inputs);
      for (const input of inputs ? Object.values(inputs) : []) {
        pending.push(asRecord(input)?.block);
      }
    }
    // A disabled statement does not run, but the blocks after it still do.
    pending.push(asRecord(block.next)?.block);
  }
  return types;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}
