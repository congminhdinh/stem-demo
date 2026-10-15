import { describe, expect, it } from 'vitest';
import { createHoldTracker, isHoldKey } from './hold-tracker';

describe('createHoldTracker', () => {
  it('closes the button once when a source holds it, and opens it once when that source lets go', () => {
    const tracker = createHoldTracker();

    expect(tracker.hold('pointer:1')).toBe(true);
    expect(tracker.release('pointer:1')).toBe(false);
  });

  it('never reports the same value twice in a row', () => {
    const tracker = createHoldTracker();

    expect(tracker.release('pointer:1')).toBeUndefined();
    expect(tracker.hold('pointer:1')).toBe(true);
    expect(tracker.hold('pointer:1')).toBeUndefined();
    expect(tracker.release('pointer:1')).toBe(false);
    expect(tracker.release('pointer:1')).toBeUndefined();
  });

  it('keeps the button closed while any source still holds it', () => {
    const tracker = createHoldTracker();

    expect(tracker.hold('pointer:1')).toBe(true);
    expect(tracker.hold('key: ')).toBeUndefined();
    expect(tracker.release('pointer:1')).toBeUndefined();
    expect(tracker.release('key: ')).toBe(false);
  });

  it('lets two touches hold one button, and opens it when the last one lets go', () => {
    const tracker = createHoldTracker();

    expect(tracker.hold('pointer:1')).toBe(true);
    expect(tracker.hold('pointer:2')).toBeUndefined();
    expect(tracker.release('pointer:2')).toBeUndefined();
    expect(tracker.release('pointer:1')).toBe(false);
  });

  it('opens the button once on releaseAll, whatever held it', () => {
    const tracker = createHoldTracker();
    tracker.hold('pointer:1');
    tracker.hold('key:Enter');

    expect(tracker.releaseAll()).toBe(false);
    expect(tracker.releaseAll()).toBeUndefined();
    // What held it is forgotten: a late pointerup of the old pointer changes nothing.
    expect(tracker.release('pointer:1')).toBeUndefined();
  });

  it('says nothing for releaseAll when nothing was held', () => {
    expect(createHoldTracker().releaseAll()).toBeUndefined();
  });

  it('treats source names as data', () => {
    const tracker = createHoldTracker();

    expect(tracker.hold('__proto__')).toBe(true);
    expect(tracker.release('constructor')).toBeUndefined();
    expect(tracker.release('__proto__')).toBe(false);
  });
});

describe('isHoldKey', () => {
  it('holds a button with Space and Enter only', () => {
    expect(isHoldKey(' ')).toBe(true);
    expect(isHoldKey('Enter')).toBe(true);
    for (const key of ['a', 'Tab', 'Escape', 'ArrowUp', 'Spacebar', '']) {
      expect(isHoldKey(key)).toBe(false);
    }
  });
});
