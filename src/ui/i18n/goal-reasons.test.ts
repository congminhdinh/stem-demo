import { describe, expect, it } from 'vitest';
import { goalReasonKeys } from '../../core/scenario/goals/reasons';
import { en, isMessageKey, vi } from './messages';

// A goal that fails says why with a reason key (N18 R6.1); the core cannot hold the words (B1), so the words are here. Every reason
// the goal library can give must be a message key with a text in both languages.
describe('the reasons a robot goal can give', () => {
  it('has a reason for each kind of failure', () => {
    expect(goalReasonKeys.length).toBe(30);
    expect(new Set(goalReasonKeys).size).toBe(goalReasonKeys.length);
  });

  // N19 D1–D3 fix round 1 (review M5): one word for the robot in each family of texts, as N18 has them: a reason (the HUD) says "Robot",
  // a clause of the check's report says "Xe" ("Xe chạm tường lúc 12,4 s ở lượt 2").
  it('calls the robot "Robot" in every Vietnamese reason and "Xe" in every clause of the check’s report', () => {
    const vietnamese = Object.entries(vi);
    const says = (word: string) => new RegExp(`(^|\\s)${word}(\\s|$)`, 'i');
    const reasons = vietnamese.filter(([key]) => key.startsWith('robot.goal.reason.'));
    const clauses = vietnamese.filter(([key]) => key.startsWith('robot.check.why.'));
    expect(reasons.length).toBe(goalReasonKeys.length);
    expect(reasons.filter(([, text]) => says('xe').test(text)).map(([key]) => key)).toEqual([]);
    expect(clauses.filter(([, text]) => says('robot').test(text)).map(([key]) => key)).toEqual([]);
  });

  it.each(goalReasonKeys)('%s is a message with a text in English and in Vietnamese', (key) => {
    expect(isMessageKey(key)).toBe(true);
    if (!isMessageKey(key)) return;
    expect(en[key].trim()).not.toBe('');
    expect(vi[key].trim()).not.toBe('');
    expect(vi[key]).not.toBe(en[key]);
  });
});
