// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { CHECK_SPEED_KEY, checkSpeedMemory, type PreferenceStorage } from './check-speed-memory';

// N18 final fix I1: the learner's check speed is kept for the viewer in localStorage. Nothing kept, a value that is no speed, or a storage
// that refuses (it throws, or there is none) all read as Nhanh; a refused write is no error.

/** A storage of `kept`; it throws on read or write when told to. */
function storage(kept: Record<string, string> = {}, refuses: { read?: boolean; write?: boolean } = {}) {
  const items = new Map(Object.entries(kept));
  const fake: PreferenceStorage = {
    getItem: (key) => {
      if (refuses.read) throw new DOMException('denied', 'SecurityError');
      return items.get(key) ?? null;
    },
    setItem: (key, value) => {
      if (refuses.write) throw new DOMException('full', 'QuotaExceededError');
      items.set(key, value);
    },
  };
  return { fake, items };
}

afterEach(() => localStorage.removeItem(CHECK_SPEED_KEY));

describe('the check speed the viewer chose (N18 final fix I1)', () => {
  it('reads Nhanh when nothing is kept, and each speed that is', () => {
    expect(CHECK_SPEED_KEY).toBe('stem-studio:robot-check-speed');
    expect(checkSpeedMemory(storage().fake).read()).toBe('fast');
    for (const speed of ['1x', '4x', 'fast'] as const) {
      expect(checkSpeedMemory(storage({ [CHECK_SPEED_KEY]: speed }).fake).read()).toBe(speed);
    }
  });

  it('reads Nhanh for a value that is no speed it offers', () => {
    for (const kept of ['2x', '1X', '', ' fast', 'null']) {
      expect(checkSpeedMemory(storage({ [CHECK_SPEED_KEY]: kept }).fake).read(), kept).toBe('fast');
    }
  });

  it('keeps a choice, and the next memory of the same storage reads it', () => {
    const { fake, items } = storage();
    checkSpeedMemory(fake).write('4x');
    expect(items.get(CHECK_SPEED_KEY)).toBe('4x');
    expect(checkSpeedMemory(fake).read()).toBe('4x');
  });

  it('never throws where the storage refuses or there is none: Nhanh, and nothing kept', () => {
    const refused = checkSpeedMemory(storage({ [CHECK_SPEED_KEY]: '1x' }, { read: true, write: true }).fake);
    expect(refused.read()).toBe('fast');
    expect(() => refused.write('1x')).not.toThrow();
    const none = checkSpeedMemory(null);
    expect(none.read()).toBe('fast');
    expect(() => none.write('4x')).not.toThrow();
  });

  it('uses the viewer’s localStorage by default', () => {
    expect(checkSpeedMemory().read()).toBe('fast');
    checkSpeedMemory().write('1x');
    expect(localStorage.getItem(CHECK_SPEED_KEY)).toBe('1x');
    expect(checkSpeedMemory().read()).toBe('1x');
  });
});
