import { describe, expect, it } from 'vitest';
import { fixtureDocument } from '../../profiles/__fixtures__/test-profiles';
import { productionProfiles } from '../../profiles';
import { chain, print, program, text } from '../../program/__fixtures__/ybc-blocks';
import { createRunSession } from '../../run/run-session';
import type { Expr, YbcProgramIR, YbcStatement } from '../../program/ybc-ir';
import { packs, registry } from './__fixtures__/compile-case';
import { generateYbcMicroPython } from './generate';
import { generateForDocument } from './generate-document';
import { MAX_GENERATED_BYTES } from './limits';

// YB5A-R1: the generated file is limited to MAX_GENERATED_BYTES UTF-8 bytes (plan §6.7), measured on
// the file as written. YB5A-R4: literal count-up bounds are validated like every other literal.

const bytes = (source: string) => new TextEncoder().encode(source).byteLength;
const str = (value: string): Expr => ({ type: 'str', kind: 'str', value, blockId: 's' });
const printOf = (value: string): YbcStatement => ({ kind: 'print', value: str(value), blockId: `p-${value.length}` });
const ir = (texts: string[]): YbcProgramIR => ({ onStart: texts.map(printOf), forever: null, variables: [] });
const sourceOf = (texts: string[]) => {
  const result = generateYbcMicroPython(ir(texts));
  return result.ok ? result.source : null;
};

/** Texts whose file is exactly `target` bytes of ASCII: full 1000-character prints, then one print that fills the rest. */
function textsOfSize(target: number): string[] {
  const texts: string[] = [];
  while (bytes(sourceOf([...texts, '']) ?? '') + 1000 <= target) {
    texts.push('x'.repeat(1000));
  }
  const rest = target - bytes(sourceOf([...texts, '']) ?? '');
  return [...texts, 'x'.repeat(rest)];
}

describe('the generated-size limit (YB5A-R1)', () => {
  it('is 256 KB', () => {
    expect(MAX_GENERATED_BYTES).toBe(262_144);
  });

  it.each([
    ['one byte under the limit', -1, true],
    ['exactly the limit', 0, true],
    ['one byte over the limit', 1, false],
  ])('%s', (_label, delta, passes) => {
    const texts = textsOfSize(MAX_GENERATED_BYTES + delta);
    const result = generateYbcMicroPython(ir(texts));
    if (passes) {
      expect(result.ok && bytes(result.source)).toBe(MAX_GENERATED_BYTES + delta);
    } else {
      expect(result).toEqual({ ok: false, diagnostics: [{ severity: 'error', code: 'program-too-large', message: expect.any(String) }] });
      expect('source' in result).toBe(false);
    }
  });

  it('counts UTF-8 bytes, not characters: the same length is under the limit in ASCII and over it in Vietnamese', () => {
    const ascii = textsOfSize(MAX_GENERATED_BYTES);
    expect(generateYbcMicroPython(ir(ascii)).ok).toBe(true);
    // One more byte-heavy character, no more characters: the file keeps its length in JavaScript and grows by two bytes.
    const swapped = [...ascii.slice(0, -1), `ế${ascii[ascii.length - 1]?.slice(1)}`];
    expect(swapped.join('').length).toBe(ascii.join('').length);
    expect(generateYbcMicroPython(ir(swapped))).toMatchObject({ ok: false, diagnostics: [{ code: 'program-too-large' }] });
  });

  it('is decided by the bytes even when the file is far shorter than the limit in characters', () => {
    // 100 prints of 1000 three-byte characters: about 101 000 UTF-16 units, about 301 000 bytes.
    const heavy = Array.from({ length: 100 }, () => 'ế'.repeat(1000));
    expect(heavy.join('').length).toBeLessThan(MAX_GENERATED_BYTES);
    expect(generateYbcMicroPython(ir(heavy))).toMatchObject({ ok: false, diagnostics: [{ code: 'program-too-large' }] });
    // The same number of characters in ASCII is fine.
    expect(generateYbcMicroPython(ir(Array.from({ length: 100 }, () => 'x'.repeat(1000)))).ok).toBe(true);
    // Four-byte characters (two UTF-16 units each): 140 prints of 500 emoji, about 281 000 bytes.
    expect(generateYbcMicroPython(ir(Array.from({ length: 140 }, () => '😀'.repeat(500))))).toMatchObject({ ok: false, diagnostics: [{ code: 'program-too-large' }] });
  });

  it('keeps the encoding rules: a lone surrogate is still refused, and what fits is still written whole', () => {
    expect(generateYbcMicroPython(ir(['a\ud83dz']))).toMatchObject({ ok: false, diagnostics: [{ code: 'invalid-literal' }] });
    const fits = generateYbcMicroPython(ir(['Xin chào 😀']));
    expect(fits.ok && fits.source).toContain("print('Xin chào 😀')");
  });

  it('blocks a document that is valid at L-2 and L-3 but too large for L-4, and gives no source', () => {
    // The reviewer's case: 270 prints of 1000 characters compile and run, and would be 272 845 bytes of Python.
    const statements = Array.from({ length: 270 }, () => print(text('x'.repeat(1000))));
    const project = fixtureDocument('ybc-basic', { blocks: { ...program([]), blocks: { languageVersion: 0, blocks: [{ type: 'stem_on_start', id: 'on-start', inputs: { DO: { block: chain(statements) } } }] } } });

    const session = createRunSession(registry);
    expect(session.start(project)).toEqual({ ok: true });
    session.stop();

    const generated = generateForDocument(project, registry, productionProfiles, packs);
    expect(generated).toMatchObject({ ok: false, layer: 'L-4', diagnostics: [{ code: 'program-too-large' }] });
    expect(generated && 'source' in generated).toBe(false);
  });
});

describe('literal count up bounds are validated before they are folded (YB5A-R4)', () => {
  const int = (value: number): Expr => ({ type: 'int', kind: 'int', value, blockId: `n${String(value)}` });
  const countUp = (from: number, to: number): YbcProgramIR => ({
    onStart: [{ kind: 'countUp', variable: 'x', from: int(from), to: int(to), step: 1, body: [], blockId: 'loop' }],
    forever: null,
    variables: [{ id: 'x', name: 'x', type: 'int' }],
  });

  it.each([1.5, NaN, Infinity, -Infinity])('refuses %s as the start and as the end, with the block of the literal, and no source', (bad) => {
    for (const result of [generateYbcMicroPython(countUp(bad, 4)), generateYbcMicroPython(countUp(1, bad))]) {
      expect(result).toEqual({ ok: false, diagnostics: [{ severity: 'error', code: 'invalid-literal', message: expect.any(String), blockId: `n${String(bad)}` }] });
      expect('source' in result).toBe(false);
    }
  });

  it('still folds valid literal bounds into one range', () => {
    const result = generateYbcMicroPython(countUp(1, 4));
    expect(result.ok && result.source).toContain('for x in range(1, 5):');
    expect(result.ok && result.source).not.toContain('_cu_');
  });

  it('keeps the range checks of the contract for literals that are whole numbers', () => {
    expect(generateYbcMicroPython(countUp(-1, 4))).toMatchObject({ ok: false, diagnostics: [{ code: 'value-out-of-range' }] });
    expect(generateYbcMicroPython(countUp(1, 1_000_001))).toMatchObject({ ok: false, diagnostics: [{ code: 'value-out-of-range' }] });
    expect(generateYbcMicroPython(countUp(4, 1))).toMatchObject({ ok: false, diagnostics: [{ code: 'descending-range-not-supported' }] });
  });
});
