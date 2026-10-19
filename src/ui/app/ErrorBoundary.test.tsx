// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from './ErrorBoundary';

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

function Broken(): never {
  throw new Error('The program panel failed');
}

describe('ErrorBoundary (Fix 6, N17 m2)', () => {
  it('shows its fallback instead of a child that throws, keeps the rest of the page, and tells its owner once', async () => {
    const onError = vi.fn();
    // React reports a caught error on the console too; it is expected here.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    await act(async () =>
      root.render(
        <main>
          <header>Toolbar</header>
          <ErrorBoundary fallback={<p>Panel failed</p>} onError={onError}>
            <Broken />
          </ErrorBoundary>
        </main>,
      ),
    );
    consoleError.mockRestore();
    expect(container.textContent).toBe('ToolbarPanel failed');
    expect(onError).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0]?.[0]).toBeInstanceOf(Error);
  });

  it('shows its children while they work', async () => {
    await act(async () =>
      root.render(
        <ErrorBoundary fallback={<p>Panel failed</p>}>
          <p>Blocks</p>
        </ErrorBoundary>,
      ),
    );
    expect(container.textContent).toBe('Blocks');
  });
});
