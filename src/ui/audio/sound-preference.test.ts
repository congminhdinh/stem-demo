import { describe, expect, it } from 'vitest';
import { readSoundOn, SOUND_PREFERENCE_KEY, writeSoundOn, type PreferenceStorage } from './sound-preference';

// N17 B3: whether the learner has turned the sound off is kept for the tab (sessionStorage): a reload keeps it, another tab or a new
// visit starts with the sound on. A frame that may not use storage (a sandbox, blocked site data) throws when it is touched: the
// switch then simply starts on and is not remembered, and nothing breaks.

function memoryStorage(initial: Record<string, string> = {}): PreferenceStorage & { items: Record<string, string> } {
  const items = { ...initial };
  return {
    items,
    getItem: (key) => (Object.hasOwn(items, key) ? (items[key] ?? null) : null),
    setItem: (key, value) => {
      items[key] = value;
    },
  };
}

const throwing: PreferenceStorage = {
  getItem: () => {
    throw new DOMException('The operation is insecure.', 'SecurityError');
  },
  setItem: () => {
    throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
  },
};

describe('the sound preference of the tab', () => {
  it('is the fallback when nothing is kept', () => {
    expect(readSoundOn(true, memoryStorage())).toBe(true);
    expect(readSoundOn(false, memoryStorage())).toBe(false);
  });

  it('is what the learner chose last in this tab', () => {
    const storage = memoryStorage();
    writeSoundOn(false, storage);
    expect(storage.items[SOUND_PREFERENCE_KEY]).toBe('off');
    expect(readSoundOn(true, storage)).toBe(false);
    writeSoundOn(true, storage);
    expect(storage.items[SOUND_PREFERENCE_KEY]).toBe('on');
    expect(readSoundOn(false, storage)).toBe(true);
  });

  it('ignores a value it did not write', () => {
    expect(readSoundOn(true, memoryStorage({ [SOUND_PREFERENCE_KEY]: 'loud' }))).toBe(true);
    expect(readSoundOn(false, memoryStorage({ [SOUND_PREFERENCE_KEY]: '' }))).toBe(false);
  });

  it('never throws when storage refuses, or when there is none', () => {
    expect(readSoundOn(true, throwing)).toBe(true);
    expect(() => writeSoundOn(false, throwing)).not.toThrow();
    expect(readSoundOn(true, null)).toBe(true);
    expect(() => writeSoundOn(false, null)).not.toThrow();
  });

  it('uses the tab’s sessionStorage by default (whatever this runtime has of it), and never throws', () => {
    expect(() => writeSoundOn(false)).not.toThrow();
    expect(typeof readSoundOn(true)).toBe('boolean');
    writeSoundOn(true);
    expect(readSoundOn(true)).toBe(true);
  });
});
