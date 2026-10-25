// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { onFirstUse } from './first-use';

// N18 P2: the robot lab loads the physics engine once it is used, not when it is only opened.

describe('the lab’s first use (N18 P2)', () => {
  for (const [name, event] of [
    ['a pointer press', () => new Event('pointerdown')],
    ['a key', () => new KeyboardEvent('keydown', { key: 'a' })],
    ['the host’s load-project', () => new MessageEvent('message', { data: { protocol: 'stem-lab/v1', type: 'load-project', document: {} } })],
  ] as const) {
    it(`is ${name}, once`, () => {
      const target = new EventTarget();
      const used = vi.fn();
      onFirstUse(target, used);
      target.dispatchEvent(event());
      target.dispatchEvent(event());
      target.dispatchEvent(new Event('pointerdown'));
      expect(used).toHaveBeenCalledTimes(1);
    });
  }

  it('is no other message, and nothing once it is stopped', () => {
    const target = new EventTarget();
    const used = vi.fn();
    const stop = onFirstUse(target, used);
    target.dispatchEvent(new MessageEvent('message', { data: { protocol: 'stem-lab/v1', type: 'check-request' } }));
    target.dispatchEvent(new MessageEvent('message', { data: 'load-project' }));
    target.dispatchEvent(new MessageEvent('message', { data: null }));
    expect(used).not.toHaveBeenCalled();
    stop();
    target.dispatchEvent(new Event('pointerdown'));
    expect(used).not.toHaveBeenCalled();
  });
});
