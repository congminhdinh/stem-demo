import { describe, expect, it } from 'vitest';
import { goalReasonKeys } from '../../core/scenario/goals/reasons';
import { en, isMessageKey, vi } from './messages';

// A goal that fails says why with a reason key (N18 R6.1); the core cannot hold the words (B1), so the words are here. Every reason
// the goal library can give must be a message key with a text in both languages.
describe('the reasons a robot goal can give', () => {
  it('has a reason for each kind of failure', () => {
    expect(goalReasonKeys.length).toBe(15);
    expect(new Set(goalReasonKeys).size).toBe(goalReasonKeys.length);
  });

  it.each(goalReasonKeys)('%s is a message with a text in English and in Vietnamese', (key) => {
    expect(isMessageKey(key)).toBe(true);
    if (!isMessageKey(key)) return;
    expect(en[key].trim()).not.toBe('');
    expect(vi[key].trim()).not.toBe('');
    expect(vi[key]).not.toBe(en[key]);
  });
});
