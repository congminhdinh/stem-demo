import { describe, expect, it } from 'vitest';
import { programWithMarker, testMarkerType } from '../profiles/__fixtures__/test-profiles';
import { compileYbcProgram } from './compile-ybc-program';

// No silent fallback to a no-op (review YB-2a N4): a block that a profile exposes but that the compiler has
// no meaning for is an error, so a future block can never be added to a pack and quietly do nothing.

const hats = ['stem_on_start', 'stem_forever'];
const workspace = (type: string) => ({
  blocks: { languageVersion: 0, blocks: [{ type: 'stem_on_start', id: 'on-start', inputs: { DO: { block: { type, id: 'future' } } } }] },
});

describe('compileYbcProgram: a block with no handler', () => {
  it('is an unsupported-construct error, not a no-op, when a profile exposes it', () => {
    const result = compileYbcProgram(workspace('ybc_future_block'), new Set([...hats, 'ybc_future_block']));
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toEqual([expect.objectContaining({ severity: 'error', code: 'unsupported-construct', blockId: 'future' })]);
  });

  it('is the same for the test marker unless the caller allows exactly that block', () => {
    const exposed = new Set([...hats, testMarkerType]);
    expect(compileYbcProgram(programWithMarker(), exposed).diagnostics).toEqual([
      expect.objectContaining({ code: 'unsupported-construct', blockId: 'marker-1' }),
    ]);
    expect(compileYbcProgram(programWithMarker(), exposed, new Set([testMarkerType]))).toMatchObject({
      ok: true,
      ir: { onStart: [{ kind: 'noop', blockId: 'marker-1' }] },
    });
  });

  it('does not let the allow-list turn another block into a no-op', () => {
    const result = compileYbcProgram(workspace('ybc_future_block'), new Set([...hats, 'ybc_future_block']), new Set([testMarkerType]));
    expect(result.diagnostics).toEqual([expect.objectContaining({ code: 'unsupported-construct' })]);
  });

  it('never makes a no-op of a block the profile does not expose', () => {
    expect(compileYbcProgram(workspace('ybc_future_block'), new Set(hats), new Set(['ybc_future_block'])).diagnostics).toEqual([
      expect.objectContaining({ code: 'unknown-block' }),
    ]);
  });
});
