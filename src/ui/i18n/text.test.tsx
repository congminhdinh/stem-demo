// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Palette } from '../canvas/Palette';
import { TextProvider, useText } from './text';

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

function Probe() {
  const t = useText();
  return <p>{t('run.run')}</p>;
}

describe('TextProvider (N6a S5)', () => {
  it('is English without a provider, as every component test expects', async () => {
    await act(async () => root.render(<Probe />));
    expect(container.textContent).toBe('Run');
  });

  it('speaks the provider’s language', async () => {
    await act(async () =>
      root.render(
        <TextProvider locale="vi">
          <Probe />
        </TextProvider>,
      ),
    );
    expect(container.textContent).toBe('Chạy');
  });

  it('names devices in Vietnamese, and keeps a name it does not know', async () => {
    const items = [
      { deviceType: 'led', name: 'LED' },
      // N17 B5 made the servo a device; a motor is still none.
      { deviceType: 'motor', name: 'Motor' },
    ];
    await act(async () =>
      root.render(
        <TextProvider locale="vi">
          <Palette items={items} disabled={false} onAdd={() => {}} />
        </TextProvider>,
      ),
    );
    expect([...container.querySelectorAll('button')].map((button) => [button.getAttribute('aria-label'), button.textContent])).toEqual([
      ['Thêm Đèn LED', '+ Đèn LED'],
      ['Thêm Motor', '+ Motor'],
    ]);
  });
});
