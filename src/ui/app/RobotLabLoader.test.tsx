// @vitest-environment jsdom
import { act, type ComponentType } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RobotLabProps } from '../robot3d/RobotLab';
import { TextProvider } from '../i18n/text';
import { RobotLabLoader } from './RobotLabLoader';

// N18 R4.1 fix round 1: the robot lab is a chunk, and a chunk can fail to load (the network, a deploy that replaced it). The page must
// say so and offer another attempt, not go blank.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLElement;
let root: Root;
beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  // React reports a caught error on the console too; it is expected in these tests.
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

const Lab: ComponentType<RobotLabProps> = ({ template, program }) => (
  <main data-testid="lab">
    {template}
    {program}
  </main>
);
const props: RobotLabProps = { template: 'rb-sandbox', program: <p>chương trình</p> };

const reloadPage = vi.fn();
beforeEach(() => reloadPage.mockClear());
const render = (load: () => Promise<{ default: ComponentType<RobotLabProps> }>, locale: 'en' | 'vi' = 'vi') =>
  act(async () =>
    root.render(
      <TextProvider locale={locale}>
        <RobotLabLoader load={load} reloadPage={reloadPage} {...props} />
      </TextProvider>,
    ),
  );
const button = () => container.querySelector('button');
const text = (testId: string) => container.querySelector(`[data-testid=${testId}]`)?.textContent;

describe('RobotLabLoader (N18 R4.1 fix 1)', () => {
  it('says the lab is loading, then shows it with its props', async () => {
    let resolve: (module: { default: ComponentType<RobotLabProps> }) => void = () => {};
    await render(() => new Promise((done) => (resolve = done)));
    expect(text('robot-loading')).toBe('Đang tải bài thực hành robot…');
    expect(container.querySelector('h1')?.textContent).toBe('Robot 3D');
    await act(async () => resolve({ default: Lab }));
    expect(text('lab')).toBe('rb-sandboxchương trình');
    expect(container.querySelector('[data-testid=robot-loading]')).toBeNull();
  });

  it('a chunk that does not load is a message with a Reload button, in Vietnamese, not a blank page', async () => {
    await render(() => Promise.reject(new TypeError('Failed to fetch dynamically imported module')));
    expect(container.textContent).not.toBe('');
    expect(container.querySelector('h1')?.textContent).toBe('Robot 3D');
    expect(container.querySelector('[data-testid=robot-load-failed]')?.getAttribute('role')).toBe('alert');
    expect(text('robot-load-failed')).toContain('Không hiện được bài thực hành robot.');
    expect(text('robot-load-failed')).toContain('Tải lại');
    expect(button()?.textContent).toBe('Tải lại');
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it('says it in English for an English lab', async () => {
    await render(() => Promise.reject(new Error('offline')), 'en');
    expect(text('robot-load-failed')).toBe('The robot lab could not be shown. Check your connection, then press Reload.');
    expect(button()?.textContent).toBe('Reload');
  });

  it('Reload imports the chunk again, and the lab replaces the message when it loads', async () => {
    const load = vi.fn<() => Promise<{ default: ComponentType<RobotLabProps> }>>().mockRejectedValueOnce(new TypeError('offline')).mockResolvedValue({ default: Lab });
    await render(load);
    expect(load).toHaveBeenCalledTimes(1);
    expect(button()?.textContent).toBe('Tải lại');

    await act(async () => button()?.click());
    expect(load).toHaveBeenCalledTimes(2);
    expect(text('lab')).toBe('rb-sandboxchương trình');
    expect(container.querySelector('[data-testid=robot-load-failed]')).toBeNull();
    expect(button()).toBeNull();
  });

  it('keeps the message, and the button, while the chunk still does not load; then the button reloads the page (Chromium keeps a failed import)', async () => {
    const load = vi.fn<() => Promise<{ default: ComponentType<RobotLabProps> }>>().mockRejectedValue(new TypeError('offline'));
    await render(load);
    expect(reloadPage).not.toHaveBeenCalled();

    // First click: the chunk is imported again, and fails again.
    await act(async () => button()?.click());
    expect(load).toHaveBeenCalledTimes(2);
    expect(reloadPage).not.toHaveBeenCalled();
    expect(text('robot-load-failed')).toContain('Không hiện được bài thực hành robot.');
    expect(button()?.textContent).toBe('Tải lại');

    // Second click: another import cannot help, a new page can.
    await act(async () => button()?.click());
    expect(load).toHaveBeenCalledTimes(2);
    expect(reloadPage).toHaveBeenCalledTimes(1);
    expect(button()?.textContent).toBe('Tải lại');
  });
});
