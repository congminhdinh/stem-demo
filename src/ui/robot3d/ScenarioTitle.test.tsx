// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ScenarioTitle } from './ScenarioTitle';

// N19 final fix (G1 c2, minor round m1): a gripper lesson's title in the lab's header may be shortened with an ellipsis; then the keyboard
// and a tap reach its whole text: the title is a Tab stop, and on focus (or hover) a popover under it shows the whole title, which Esc hides
// until the title is left. Screen readers read the heading's own text, which is whole, so the popover is hidden from them. A rover lesson's
// title is the plain heading it always was. jsdom lays nothing out: the widths a browser gives are stubbed.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLElement;
let root: Root;
beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

/** The title's box as a browser would lay it out: its text `scroll` px wide in `client` px. */
const widths = (scroll: number, client: number) => {
  vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(scroll);
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(client);
};
const title = () => host.querySelector<HTMLElement>('[data-testid=robot-scenario]')!;
const popover = () => host.querySelector<HTMLElement>('[data-testid=robot-scenario-full]');

describe('the lab header’s scenario title (N19 final fix, minor round m1)', () => {
  it('in a rover lesson is the plain heading it was', () => {
    widths(155, 97);
    act(() => root.render(<ScenarioTitle text="Chạy tới vùng đích" shrinks={false} />));
    expect(host.innerHTML).toBe('<h2 class="robot-scenario" data-testid="robot-scenario">Chạy tới vùng đích</h2>');
  });

  it('in a gripper lesson whose title fits is a heading with no Tab stop and no popover', () => {
    widths(83, 97);
    act(() => root.render(<ScenarioTitle text="Tìm và gắp" shrinks />));
    expect(title().textContent).toBe('Tìm và gắp');
    expect(title().hasAttribute('tabindex')).toBe(false);
    expect(popover()).toBeNull();
  });

  it('shortened, is a Tab stop with its whole text in a popover the screen reader skips (the heading is whole); Esc hides it until it is left', () => {
    widths(143, 97);
    act(() => root.render(<ScenarioTitle text="Phân loại theo màu" shrinks />));
    expect(title().getAttribute('tabindex')).toBe('0');
    expect(title().textContent).toBe('Phân loại theo màu');
    expect(title().hasAttribute('title')).toBe(false);
    expect([popover()!.textContent, popover()!.getAttribute('aria-hidden'), popover()!.getAttribute('data-dismissed')]).toEqual(['Phân loại theo màu', 'true', 'false']);
    act(() => title().focus());
    act(() => {
      title().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(popover()!.getAttribute('data-dismissed')).toBe('true');
    act(() => title().blur());
    expect(popover()!.getAttribute('data-dismissed')).toBe('false');
  });
});
