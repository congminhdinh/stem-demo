// A goal's id or label as STEMLearning's LearningService reads it (LabAttemptRules.IsGoalText and HasHiddenCharacter; N18 final fix M5,
// the LMS final fix's item 3): one rule for the scenario schema (an author's label), the lab's check result and verify:attempt, so that a
// label the lab accepts is never one the LMS refuses, which would make every stored check of it "invalid".
//
//   1. Trim as .NET's string.Trim() does: the UTF-16 units char.IsWhiteSpace has, U+0009–U+000D, U+0020, U+0085, U+00A0, U+1680,
//      U+2000–U+200A, U+2028, U+2029, U+202F, U+205F, U+3000. Not String.prototype.trim (nor zod's `.trim()`), which also trims U+FEFF
//      and keeps U+0085: a label that starts with U+FEFF is refused by the LMS, one that starts with U+0085 is not.
//   2. Count UTF-16 units, as .NET's Length (and JS's `.length`) does.
//   3. Refuse any code point of Unicode general category Cc (control: U+0000–U+001F, U+007F–U+009F) or Cf (format: zero-width, bidi,
//      the BOM, the soft hyphen, the tag characters…): 235 code points in Unicode 17, the same set on .NET 10 and Node 24. A lone surrogate
//      is no code point of either (.NET reads it as U+FFFD), so it is not refused.
//
// Leaf, like check-result.ts: it imports nothing.

/** The edges .NET's string.Trim() removes (char.IsWhiteSpace), one run at the start and one at the end. */
const dotNetEdges = /^[\t-\r \u{85}\u{A0}\u{1680}\u{2000}-\u{200A}\u{2028}\u{2029}\u{202F}\u{205F}\u{3000}]+|[\t-\r \u{85}\u{A0}\u{1680}\u{2000}-\u{200A}\u{2028}\u{2029}\u{202F}\u{205F}\u{3000}]+$/gu;

/** `text` trimmed as .NET's string.Trim() trims it. */
export const trimLikeDotNet = (text: string): string => text.replace(dotNetEdges, '');

/** Whether `text` holds a code point of Unicode general category Cc or Cf (LabAttemptRules.HasHiddenCharacter). */
export const hasHiddenCharacter = (text: string): boolean => /[\p{Cc}\p{Cf}]/u.test(text);

/** Whether the LMS takes `text` as a goal text of at most `max` characters: trimmed (.NET), 1 to `max` UTF-16 units, nothing hidden. */
export function isGoalText(text: string, max: number): boolean {
  const trimmed = trimLikeDotNet(text);
  return trimmed.length >= 1 && trimmed.length <= max && !hasHiddenCharacter(trimmed);
}
