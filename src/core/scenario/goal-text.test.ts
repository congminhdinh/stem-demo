import { describe, expect, it } from 'vitest';
import { hasHiddenCharacter, isGoalText, trimLikeDotNet } from './goal-text';

// N18 final fix M5: a goal text as LearningService reads it (LabAttemptRules.IsGoalText, HasHiddenCharacter; the LMS final fix's item 3).
// The values here are the ones its tests pin on .NET 10: the trim set of char.IsWhiteSpace, UTF-16 lengths, and Cc + Cf by code point.

describe('a goal text as the LMS reads it (N18 final fix M5)', () => {
  it('trims exactly the 25 UTF-16 units of .NET’s char.IsWhiteSpace, not those of String.prototype.trim', () => {
    const trimmed = Array.from({ length: 0x10000 }, (_, unit) => unit).filter((unit) => trimLikeDotNet(`${String.fromCharCode(unit)}x`) === 'x');
    expect(trimmed.map((unit) => unit.toString(16))).toEqual([
      '9', 'a', 'b', 'c', 'd', '20', '85', 'a0', '1680', '2000', '2001', '2002', '2003', '2004', '2005', '2006', '2007', '2008', '2009', '200a', '2028', '2029', '202f', '205f', '3000',
    ]);
    // Where they differ: JS trims U+FEFF and keeps U+0085; .NET keeps U+FEFF and trims U+0085.
    expect(trimLikeDotNet('\u{FEFF}Tới vùng\u{FEFF}')).toBe('\u{FEFF}Tới vùng\u{FEFF}');
    expect('\u{FEFF}Tới vùng'.trim()).toBe('Tới vùng');
    expect(trimLikeDotNet('\u{85}Tới vùng\u{85}')).toBe('Tới vùng');
    expect('\u{85}Tới vùng'.trim()).toBe('\u{85}Tới vùng');
    // Only the edges: inside, a space of any kind stays.
    expect(trimLikeDotNet(' \t\n\u{A0}Tới\u{A0}vùng\u{3000}đích \u{2028}')).toBe('Tới\u{A0}vùng\u{3000}đích');
  });

  it('refuses the 235 code points of Cc and Cf (Unicode 17), by code point', () => {
    let control = 0;
    for (let point = 0; point <= 0x10ffff; point++) {
      if (point >= 0xd800 && point <= 0xdfff) continue;
      if (hasHiddenCharacter(String.fromCodePoint(point))) control++;
    }
    expect(control).toBe(235);
    // Tag characters are Cf outside the BMP: a surrogate pair, refused as one code point.
    expect(hasHiddenCharacter('\u{E0041}')).toBe(true);
    // A lone surrogate is no code point of Cc or Cf (.NET reads it as U+FFFD).
    expect(hasHiddenCharacter('a\u{D800}b')).toBe(false);
    expect(hasHiddenCharacter('a\u{DC00}')).toBe(false);
  });

  it('takes or refuses the edge cases as LabAttemptRules does: U+FEFF, U+0085, U+200B, U+202E and a lone surrogate', () => {
    const cases: [string, boolean][] = [
      ['Xe dừng hẳn trong vùng trước tường', true],
      // A leading or trailing BOM is not trimmed, and is Cf.
      ['\u{FEFF}Tới vùng đích', false],
      ['Tới vùng đích\u{FEFF}', false],
      // A leading or trailing U+0085 is trimmed; inside it is Cc.
      ['\u{85}Tới vùng đích\u{85}', true],
      ['Tới vùng\u{85}đích', false],
      // Zero-width space and right-to-left override, inside: Cf.
      ['Tới\u{200B}vùng đích', false],
      ['Tới vùng \u{202E}hcíđ', false],
      // A lone surrogate is taken, as .NET takes it.
      ['Tới vùng đích \u{D800}', true],
      // A line break or a tab inside: Cc. Around: trimmed.
      ['Tới vùng\nđích', false],
      ['Tới\tvùng đích', false],
      ['\n\tTới vùng đích \r\n', true],
      // ZWJ (an emoji sequence) and the soft hyphen are Cf; a combining mark, a variation selector and an emoji alone are not.
      ['Cả nhà 👨\u{200D}👩\u{200D}👧', false],
      ['Tới vùng\u{AD}đích', false],
      ['Tới vùng đi\u{301}ch 🚩\u{FE0F}', true],
      // Only spaces: empty once trimmed.
      [' \u{A0}\u{3000} ', false],
    ];
    expect(cases.map(([text]) => isGoalText(text, 200))).toEqual(cases.map(([, taken]) => taken));
  });

  it('counts UTF-16 units after the trim, as .NET’s Length does', () => {
    expect(isGoalText('a'.repeat(200), 200)).toBe(true);
    expect(isGoalText('a'.repeat(201), 200)).toBe(false);
    expect(isGoalText(`  ${'a'.repeat(200)}\u{85}`, 200)).toBe(true);
    // An emoji outside the BMP is two units.
    expect(isGoalText('🚩'.repeat(100), 200)).toBe(true);
    expect(isGoalText(`${'🚩'.repeat(100)}a`, 200)).toBe(false);
    expect(isGoalText('', 200)).toBe(false);
  });
});
