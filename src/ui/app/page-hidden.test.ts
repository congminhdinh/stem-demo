// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { onPageHidden } from './page-hidden';

// Review Focus 4 of N17 (task B6): a check stops being trusted the moment the page is hidden (the browser then runs its timers
// about once a second), so the lab is told at once.

const setVisibility = (state: DocumentVisibilityState) => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  document.dispatchEvent(new Event('visibilitychange'));
};

afterEach(() => {
  setVisibility('visible');
});

describe('onPageHidden (N17 B6)', () => {
  it('tells when the page becomes hidden, not when it becomes visible again', () => {
    const hidden = vi.fn();
    const stop = onPageHidden(document, hidden);
    setVisibility('visible');
    expect(hidden).not.toHaveBeenCalled();
    setVisibility('hidden');
    expect(hidden).toHaveBeenCalledTimes(1);
    stop();
  });

  it('tells at once when the page is already hidden', () => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    const hidden = vi.fn();
    const stop = onPageHidden(document, hidden);
    expect(hidden).toHaveBeenCalledTimes(1);
    stop();
  });

  it('tells nothing once stopped', () => {
    const hidden = vi.fn();
    onPageHidden(document, hidden)();
    setVisibility('hidden');
    expect(hidden).not.toHaveBeenCalled();
  });
});
