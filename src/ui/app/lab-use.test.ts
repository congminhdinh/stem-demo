import { describe, expect, it, vi } from 'vitest';
import { watchLabUse } from './lab-use';

// N18 P2 fix round 1 (I1): the lab is used at its first press or key, or when the host's project is applied; whoever asks later hears it
// at once.

describe('the lab’s first use (N18 P2 fix round 1)', () => {
  for (const [name, event] of [
    ['a pointer press', () => new Event('pointerdown')],
    ['a key', () => new Event('keydown')],
  ] as const) {
    it(`is ${name}: told once to each listener, and at once to one that asks later`, () => {
      const target = new EventTarget();
      const watch = watchLabUse(target);
      const early = vi.fn();
      watch.onUsed(early);
      expect(watch.used()).toBe(false);
      target.dispatchEvent(event());
      target.dispatchEvent(event());
      expect(watch.used()).toBe(true);
      expect(early).toHaveBeenCalledTimes(1);
      const late = vi.fn();
      watch.onUsed(late);
      expect(late).toHaveBeenCalledTimes(1);
    });
  }

  it('is the host’s project applied (markUsed), before anyone listens', () => {
    const watch = watchLabUse(new EventTarget());
    watch.markUsed();
    const late = vi.fn();
    watch.onUsed(late);
    expect(late).toHaveBeenCalledTimes(1);
  });

  it('tells nobody who took the listener back, and hears nothing once disposed', () => {
    const target = new EventTarget();
    const watch = watchLabUse(target);
    const gone = vi.fn();
    watch.onUsed(gone)();
    watch.dispose();
    target.dispatchEvent(new Event('pointerdown'));
    expect(watch.used()).toBe(false);
    expect(gone).not.toHaveBeenCalled();
  });
});
