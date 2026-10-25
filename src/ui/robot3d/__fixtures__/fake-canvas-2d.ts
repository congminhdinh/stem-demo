import { vi } from 'vitest';

// jsdom has no 2D canvas, which Konva needs (N18 R4.6 tests of the 2D top view). This is a stand-in for its context: every method does
// nothing and every property keeps what was set. The node tree Konva builds is real; the pixels are not.

function fakeContext2d() {
  const values = new Map<string | symbol, unknown>();
  return new Proxy(
    {},
    {
      get(_target, name) {
        if (name === 'measureText') {
          return () => ({ width: 8 });
        }
        if (name === 'getImageData') {
          return () => ({ data: Uint8ClampedArray.from({ length: 400 }, (_, index) => (index % 4 === 3 ? 255 : 40)) });
        }
        return values.has(name) ? values.get(name) : () => undefined;
      },
      set(_target, name, value) {
        values.set(name, value);
        return true;
      },
    },
  );
}

export class FakeResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe(target: Element) {
    this.callback([{ target, contentRect: { width: 600, height: 400 } } as ResizeObserverEntry], this as unknown as ResizeObserver);
  }
  unobserve() {}
  disconnect() {}
}

/** Gives every canvas the stand-in 2D context (and none for WebGL), and the page a ResizeObserver that reports 600 × 400. */
export function installFakeCanvas2d() {
  const context = fakeContext2d();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(((kind: string) => (kind === '2d' ? context : null)) as never);
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  // jsdom lays nothing out: the stage's container is 600 × 400.
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(600);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(400);
}
