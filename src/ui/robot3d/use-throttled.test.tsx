// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useThrottled } from './use-throttled';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// N18 R4.5: the block the robot is in moves through a program faster than the eye follows; the C++ tab shows it at most every 100 ms, as
// Blockly's own highlight does (R2.4), and always ends on the latest.

let host: HTMLElement;
let root: Root;
let seen: (string | null)[];
beforeEach(() => {
  vi.useFakeTimers();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  seen = [];
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

function Probe({ value }: { value: string | null }) {
  const shown = useThrottled(value, 100);
  seen.push(shown);
  return <p>{shown ?? 'none'}</p>;
}
const show = (value: string | null) => act(() => root.render(<Probe value={value} />));

describe('useThrottled (N18 R4.5)', () => {
  it('shows the first value at once, then at most one change every interval, ending on the latest', () => {
    show(null);
    show('a');
    expect(host.textContent).toBe('a');
    show('b');
    show('c');
    expect(host.textContent).toBe('a');
    act(() => vi.advanceTimersByTime(100));
    expect(host.textContent).toBe('c');
    expect(new Set(seen)).toEqual(new Set([null, 'a', 'c']));
  });

  it('shows a change after a quiet time at once', () => {
    show('a');
    act(() => vi.advanceTimersByTime(1000));
    show('z');
    expect(host.textContent).toBe('z');
  });

  it('leaves no timer behind when it unmounts', () => {
    show('a');
    show('b');
    act(() => root.unmount());
    expect(vi.getTimerCount()).toBe(0);
    root = createRoot(host);
  });
});
