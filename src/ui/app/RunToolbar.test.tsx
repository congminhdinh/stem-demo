// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SteadyLabel } from './RunToolbar';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLElement;
let root: Root;
beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe('SteadyLabel (Fix 6, N17 m1)', () => {
  it('holds the room of every label and shows only the one given; the others are hidden from assistive technology', async () => {
    await act(async () => root.render(<SteadyLabel shown="Đang kiểm tra…" labels={['Kiểm tra', 'Đang kiểm tra…']} />));
    const spans = [...container.querySelectorAll('.steady-label > span')];
    expect(spans.map((span) => span.textContent)).toEqual(['Kiểm tra', 'Đang kiểm tra…']);
    expect(spans.map((span) => span.getAttribute('aria-hidden'))).toEqual(['true', null]);
    expect(spans.map((span) => span.classList.contains('steady-label-room'))).toEqual([true, false]);
  });
});
