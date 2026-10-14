import { describe, expect, it } from 'vitest';
import { createFixtureEnvironment, programWithMarker, testMarkerType } from '../../core/profiles/__fixtures__/test-profiles';
import { createDefaultProgram } from '../../core/program/blocks';
import { canOpenProgram } from './editor-blocks';

// Structural loading uses the union of the known packs, not the active profile
// (plan §8.6 L-1, §12). A separate file: Blockly's block registry is global,
// and registering the fixture block here must not reach other test files.

const { packs } = createFixtureEnvironment();

describe('canOpenProgram with the union of known packs', () => {
  it('opens a program holding a block that only a richer profile shows (a lowered document stays loadable)', () => {
    expect(canOpenProgram(programWithMarker(), packs)).toBe(true);
    expect(JSON.stringify(programWithMarker())).toContain(testMarkerType);
  });

  it('still opens the empty program and the shared hats', () => {
    expect(canOpenProgram(createDefaultProgram(), packs)).toBe(true);
  });

  it('still refuses a block no pack knows', () => {
    const unknown = { blocks: { languageVersion: 0, blocks: [{ type: 'ybc_not_a_block', id: 'x' }] } };
    expect(canOpenProgram(unknown, packs)).toBe(false);
  });
});
