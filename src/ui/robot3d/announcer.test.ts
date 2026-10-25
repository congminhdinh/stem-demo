import { describe, expect, it, vi } from 'vitest';
import { createAnnouncer } from './announcer';

// N18 R8: what the robot lab tells a screen reader goes through one announcer: one polite message at a time (the latest), one assertive
// one for errors. Every message is a new one, even the same words twice, because a live region speaks what is added to it.

describe('the lab’s announcer', () => {
  it('starts with nothing to say', () => {
    const announcer = createAnnouncer();
    expect(announcer.polite.getState()).toEqual({ seq: 0, text: '' });
    expect(announcer.assertive.getState()).toEqual({ seq: 0, text: '' });
  });

  it('says a polite message and an assertive one apart, each the latest of its kind', () => {
    const announcer = createAnnouncer();
    announcer.say('Đã bắt đầu chạy.');
    announcer.say('Đã dừng.');
    announcer.alert('Chương trình có lỗi.');
    expect(announcer.polite.getState()).toEqual({ seq: 2, text: 'Đã dừng.' });
    expect(announcer.assertive.getState()).toEqual({ seq: 1, text: 'Chương trình có lỗi.' });
  });

  it('counts the same words said twice as two messages, so that both are spoken', () => {
    const announcer = createAnnouncer();
    const seen: number[] = [];
    announcer.polite.subscribe((state) => seen.push(state.seq));
    announcer.say('Đã dừng.');
    announcer.say('Đã dừng.');
    expect(seen).toEqual([1, 2]);
  });

  it('says nothing for empty words', () => {
    const announcer = createAnnouncer();
    const listener = vi.fn();
    announcer.polite.subscribe(listener);
    announcer.alert.call(announcer, '');
    announcer.say('');
    announcer.say('   ');
    expect(listener).not.toHaveBeenCalled();
    expect(announcer.polite.getState().seq).toBe(0);
  });

  it('can be passed around as bare functions', () => {
    const { say, alert, polite, assertive } = createAnnouncer();
    say('a');
    alert('b');
    expect([polite.getState().text, assertive.getState().text]).toEqual(['a', 'b']);
  });
});
