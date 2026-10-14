import { describe, expect, it } from 'vitest';
import { programWithMarker, testMarkerType } from '../profiles/__fixtures__/test-profiles';
import { createDefaultProgram } from './blocks';
import { compileYbcProgram } from './compile-ybc-program';

// The YB-1 skeleton compiler: two hats and, for a block the profile exposes, a
// no-op. The language compiler is YB-2's.

const hatsOnly = new Set(['stem_on_start', 'stem_forever']);
const withMarker = new Set([...hatsOnly, testMarkerType]);
const markerOnly = new Set([testMarkerType]);
const workspace = (...blocks: unknown[]) => ({ blocks: { languageVersion: 0, blocks } });

describe('compileYbcProgram', () => {
  it('compiles the empty default program to two empty hats', () => {
    expect(compileYbcProgram(createDefaultProgram(), hatsOnly)).toEqual({
      ok: true,
      ir: { onStart: [], forever: [], variables: [] },
      diagnostics: [],
    });
  });

  it('leaves forever null when the program has none, and accepts an empty workspace', () => {
    expect(compileYbcProgram(workspace({ type: 'stem_on_start', id: 'a' }), hatsOnly)).toMatchObject({
      ok: true,
      ir: { onStart: [], forever: null },
    });
    expect(compileYbcProgram({}, hatsOnly)).toMatchObject({ ok: true, ir: { onStart: [], forever: null } });
  });

  it('compiles a block the profile exposes to a no-op, with its block id', () => {
    expect(compileYbcProgram(programWithMarker(), withMarker, markerOnly)).toMatchObject({
      ok: true,
      ir: { onStart: [{ kind: 'noop', blockId: 'marker-1' }], forever: [] },
    });
  });

  it('follows the next chain and skips a disabled block', () => {
    const chain = workspace({
      type: 'stem_forever',
      id: 'f',
      inputs: {
        DO: {
          block: {
            type: testMarkerType,
            id: 'one',
            next: { block: { type: testMarkerType, id: 'off', disabledReasons: ['x'], next: { block: { type: testMarkerType, id: 'two' } } } },
          },
        },
      },
    });
    expect(compileYbcProgram(chain, withMarker, markerOnly)).toMatchObject({
      ok: true,
      ir: { forever: [{ kind: 'noop', blockId: 'one' }, { kind: 'noop', blockId: 'two' }] },
    });
  });

  it('reports a block the profile does not expose as an unknown block, with its id', () => {
    const result = compileYbcProgram(programWithMarker(), hatsOnly);
    expect(result).toMatchObject({ ok: false, diagnostics: [{ severity: 'error', code: 'unknown-block', blockId: 'marker-1' }] });
  });

  it('reports a second hat of a kind, and warns about a loose block', () => {
    const result = compileYbcProgram(
      workspace({ type: 'stem_on_start', id: 'a' }, { type: 'stem_on_start', id: 'b' }, { type: testMarkerType, id: 'loose' }),
      withMarker,
    );
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ severity: 'error', code: 'duplicate-hat', blockId: 'b' }),
      expect.objectContaining({ severity: 'warning', code: 'ignored-block', blockId: 'loose' }),
    ]);
    expect(result.ok).toBe(false);
  });

  it('drops a disabled hat with its whole stack', () => {
    expect(compileYbcProgram(workspace({ type: 'stem_forever', id: 'f', disabledReasons: ['x'] }), hatsOnly)).toMatchObject({
      ok: true,
      ir: { onStart: [], forever: null },
    });
  });

  it.each([null, 7, 'text', [], { blocks: 5 }, { blocks: { blocks: 'x' } }])('never throws for %j; it reports', (blocks) => {
    const result = compileYbcProgram(blocks, hatsOnly);
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]).toMatchObject({ severity: 'error', code: 'malformed-program' });
  });

  it('reports a malformed block and a malformed input', () => {
    expect(compileYbcProgram(workspace({ id: 'no-type' }), hatsOnly).diagnostics[0]).toMatchObject({ code: 'malformed-program' });
    expect(compileYbcProgram(workspace({ type: 'stem_on_start', id: 'a', inputs: { DO: 4 } }), hatsOnly).diagnostics[0]).toMatchObject({
      code: 'malformed-program',
      blockId: 'a',
    });
  });

  it('does not follow a chain without end', () => {
    const cyclic: Record<string, unknown> = { type: testMarkerType, id: 'loop' };
    cyclic.next = { block: cyclic };
    const result = compileYbcProgram(workspace({ type: 'stem_on_start', id: 'a', inputs: { DO: { block: cyclic } } }), withMarker);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.at(-1)).toMatchObject({ code: 'malformed-program' });
  });

  it('puts no type field on IR nodes (the typed IR is YB-2)', () => {
    const result = compileYbcProgram(programWithMarker(), withMarker, markerOnly);
    expect(JSON.stringify(result.ok ? result.ir : null)).not.toContain('"type"');
  });
});
