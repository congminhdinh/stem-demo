import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadUiFont } from './fonts';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('loadUiFont (N6a S5)', () => {
  it('asks for the three weights the UI uses, and resolves once they are loaded', async () => {
    const asked: string[] = [];
    await loadUiFont({ load: async (font) => (asked.push(font), []) }, 1500);
    expect(asked).toEqual(['400 16px "Be Vietnam Pro"', '600 16px "Be Vietnam Pro"', '700 16px "Be Vietnam Pro"']);
  });

  it('stops waiting after the given time', async () => {
    let done = false;
    void loadUiFont({ load: () => new Promise(() => {}) }, 1500).then(() => (done = true));
    await vi.advanceTimersByTimeAsync(1499);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(done).toBe(true);
  });

  it('never fails: a font that does not load is a fallback', async () => {
    await expect(loadUiFont({ load: () => Promise.reject(new Error('offline')) }, 1500)).resolves.toBeUndefined();
    await expect(loadUiFont(undefined)).resolves.toBeUndefined();
  });
});
