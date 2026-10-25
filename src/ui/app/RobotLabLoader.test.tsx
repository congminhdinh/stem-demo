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

  it('one click on Reload imports the chunk again, and the lab replaces the message when it loads, without reloading the page', async () => {
    const load = vi.fn<() => Promise<{ default: ComponentType<RobotLabProps> }>>().mockRejectedValueOnce(new TypeError('offline')).mockResolvedValue({ default: Lab });
    await render(load);
    expect(load).toHaveBeenCalledTimes(1);
    expect(button()?.textContent).toBe('Tải lại');

    await act(async () => button()?.click());
    expect(load).toHaveBeenCalledTimes(2);
    expect(text('lab')).toBe('rb-sandboxchương trình');
    expect(container.querySelector('[data-testid=robot-load-failed]')).toBeNull();
    expect(button()).toBeNull();
    expect(reloadPage).not.toHaveBeenCalled();
  });

  it('one click on Reload reloads the page when the import fails again (Chromium keeps a failed import), and only a click does', async () => {
    const load = vi.fn<() => Promise<{ default: ComponentType<RobotLabProps> }>>().mockRejectedValue(new TypeError('offline'));
    await render(load);
    // Nothing reloads the page by itself: not the failure, not the time that passes.
    await act(async () => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(load).toHaveBeenCalledTimes(1);
    expect(reloadPage).not.toHaveBeenCalled();

    // One click: the chunk is imported again, the import fails again, and the page is reloaded in that same click.
    await act(async () => button()?.click());
    expect(load).toHaveBeenCalledTimes(2);
    expect(reloadPage).toHaveBeenCalledTimes(1);
    // (Where the page would be gone; here, the message and the button stay for another click.)
    expect(text('robot-load-failed')).toContain('Không hiện được bài thực hành robot.');
    expect(button()?.textContent).toBe('Tải lại');
    expect(button()?.disabled).toBe(false);

    await act(async () => button()?.click());
    expect(reloadPage).toHaveBeenCalledTimes(2);
  });

  it('keeps the button from being pressed again while the chunk is being imported', async () => {
    let settle: (module: { default: ComponentType<RobotLabProps> }) => void = () => {};
    const load = vi
      .fn<() => Promise<{ default: ComponentType<RobotLabProps> }>>()
      .mockRejectedValueOnce(new TypeError('offline'))
      .mockImplementation(() => new Promise((done) => (settle = done)));
    await render(load);
    await act(async () => button()?.click());
    expect(button()?.disabled).toBe(true);
    await act(async () => button()?.click());
    expect(load).toHaveBeenCalledTimes(2);

    await act(async () => settle({ default: Lab }));
    expect(text('lab')).toBe('rb-sandboxchương trình');
    expect(reloadPage).not.toHaveBeenCalled();
  });
});
