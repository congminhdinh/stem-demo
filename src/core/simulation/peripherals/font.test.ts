import { describe, expect, it } from 'vitest';
import { DISPLAY_CHAR_FROM, DISPLAY_CHAR_TO, isDisplayText } from '../../constructs/ybc.display';
import { GLYPH_HEIGHT, GLYPH_WIDTH, glyphs } from './font';

// The 5x5 font of the virtual display (contract §4.2, §14): one glyph for every character the display shows
// (ASCII 0x20-0x7E, C-07) and for no other. The shapes are presentation; what these tests hold is the data
// shape the scroll (display.ts) and the contract rely on.

const shown = Array.from({ length: DISPLAY_CHAR_TO - DISPLAY_CHAR_FROM + 1 }, (_, index) => String.fromCharCode(DISPLAY_CHAR_FROM + index));
const rowsOf = (character: string) => glyphs.get(character) ?? [];

describe('the display font', () => {
  it('is 5 columns by 5 rows, the size of the display', () => {
    expect(GLYPH_WIDTH).toBe(5);
    expect(GLYPH_HEIGHT).toBe(5);
  });

  it('has exactly 95 glyphs, for the characters 0x20 to 0x7E in that order', () => {
    expect(shown).toHaveLength(95);
    expect([...glyphs.keys()]).toEqual(shown);
  });

  it('has a glyph for every character the display shows and for none that it does not', () => {
    for (const character of shown) {
      expect(isDisplayText(character), character).toBe(true);
      expect(glyphs.has(character), character).toBe(true);
    }
    // Just outside the charset on both sides, the C0 and C1 controls, Latin-1, a letter with an accent, a symbol,
    // an emoji (a surrogate pair), the empty string and a two-character string: nothing is drawn for them.
    for (const outside of ['\u0000', '\t', '\n', '\u001f', '\u007f', '\u0080', '\u00a0', 'é', 'à', '€', '😀', '', 'ab', '__proto__', 'constructor']) {
      expect(glyphs.has(outside), JSON.stringify(outside)).toBe(false);
      expect(glyphs.get(outside), JSON.stringify(outside)).toBeUndefined();
    }
  });

  it('draws every glyph as 5 rows of 5 characters, # for a lit light and . for a dark one', () => {
    for (const character of shown) {
      const rows = rowsOf(character);
      expect(rows, character).toHaveLength(GLYPH_HEIGHT);
      for (const row of rows) {
        expect(row, character).toMatch(/^[#.]{5}$/);
        expect(row, character).toHaveLength(GLYPH_WIDTH);
      }
    }
  });

  it('leaves only the space dark', () => {
    expect(rowsOf(' ')).toEqual(['.....', '.....', '.....', '.....', '.....']);
    for (const character of shown.filter((candidate) => candidate !== ' ')) {
      expect(rowsOf(character).join(''), character).toContain('#');
    }
  });

  it('gives every character its own picture, so no two characters look the same', () => {
    const pictures = new Map<string, string>();
    for (const character of shown) {
      const picture = rowsOf(character).join('/');
      expect(pictures.get(picture), `${JSON.stringify(character)} looks like ${JSON.stringify(pictures.get(picture))}`).toBeUndefined();
      pictures.set(picture, character);
    }
    expect(pictures.size).toBe(95);
  });
});
