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

/** The observers that watch an element now, so that a test can resize what they watch. */
const observers = new Set<FakeResizeObserver>();

export class FakeResizeObserver {
  private readonly targets = new Set<Element>();
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe(target: Element) {
    this.targets.add(target);
    observers.add(this);
    this.report(target, 600, 400);
  }
  unobserve(target: Element) {
    this.targets.delete(target);
  }
  disconnect() {
    this.targets.clear();
    observers.delete(this);
  }
  report(target: Element, width: number, height: number) {
    this.callback([{ target, contentRect: { width, height } } as ResizeObserverEntry], this as unknown as ResizeObserver);
  }
  reportAll(width: number, height: number) {
    for (const target of this.targets) this.report(target, width, height);
  }
}

/** Tells every observed element that its content is now `width` × `height`, as a browser does when a container changes size. */
export function resizeObserved(width: number, height: number) {
  for (const observer of [...observers]) observer.reportAll(width, height);
}

/** Gives every canvas the stand-in 2D context (and none for WebGL), and the page a ResizeObserver that reports 600 × 400. */
export function installFakeCanvas2d() {
  observers.clear();
  const context = fakeContext2d();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(((kind: string) => (kind === '2d' ? context : null)) as never);
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  // jsdom lays nothing out: the stage's container is 600 × 400.
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(600);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(400);
}
