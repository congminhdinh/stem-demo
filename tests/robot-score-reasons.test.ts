import { describe, expect, it } from 'vitest';
import { PROGRAM_ERROR_REASON, RUN_ENDED_CONTACT_REASON } from '../src/core/scenario/scoring';
import { en, isMessageKey, vi } from '../src/ui/i18n/messages';

// N18 R6.2: the reasons the check's scorer gives (scoring.ts) besides the goal library's (goals/reasons.ts, held to messages.ts by
// src/ui/i18n/goal-reasons.test.ts): each is a message key with a text in English and in Vietnamese. R6.2 owns them until R5.2a's goal
// library lists `run-ended-contact`.
describe('the reasons a robot check’s scorer gives', () => {
  it.each([RUN_ENDED_CONTACT_REASON, PROGRAM_ERROR_REASON])('%s is a message with a text in English and in Vietnamese', (key) => {
    expect(isMessageKey(key)).toBe(true);
    if (!isMessageKey(key)) return;
    expect(en[key].trim()).not.toBe('');
    expect(vi[key].trim()).not.toBe('');
    expect(vi[key]).not.toBe(en[key]);
  });
});
