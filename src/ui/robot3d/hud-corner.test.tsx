// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { overlaysOf, useViewOverlays, type ViewOverlays } from './hud-corner';

// N18 R4.7: what floats over the 3D view, measured in its normalised device coordinates: the HUD's corner, the view tools' corner (R4.8)
// and an open results card. Fix round 1 (C3): the view's element comes and goes (the 2D map in its place, a canvas tried again), and the
// one there now is the one measured.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const rect = (left: number, top: number, width: number, height: number) => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect;

describe('overlaysOf (N18 R4.7)', () => {
  it('turns the page boxes into the view’s NDC, 8 px of room round each', () => {
    const view = rect(100, 50, 600, 400);
    const overlays = overlaysOf(view, rect(110, 60, 292, 92), rect(400, 60, 290, 200), rect(110, 288, 50, 142));
    expect(overlays.hud!.right).toBeCloseTo(-1 + (2 * (402 + 8 - 100)) / 600, 12);
    expect(overlays.hud!.bottom).toBeCloseTo(1 - (2 * (152 + 8 - 50)) / 400, 12);
    expect(overlays.card!.left).toBeCloseTo(-1 + (2 * (400 - 8 - 100)) / 600, 12);
    expect(overlays.tools!.right).toBeCloseTo(-1 + (2 * (160 + 8 - 100)) / 600, 12);
    expect(overlays.tools!.top).toBeCloseTo(1 - (2 * (288 - 8 - 50)) / 400, 12);
    expect(overlaysOf(view, null, rect(0, 0, 0, 0), null)).toEqual({ hud: null, card: null, tools: null });
    expect(overlaysOf(rect(0, 0, 0, 0), rect(110, 60, 292, 92), null, null)).toEqual({ hud: null, card: null, tools: null });
  });
});

describe('useViewOverlays (N18 R4.7 fix round 1)', () => {
  let host: HTMLElement;
  let root: Root;
  const observers: (() => void)[] = [];
  const boxes = new Map<string, DOMRect>();
  beforeEach(() => {
    observers.length = 0;
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          observers.push(callback);
        }
        observe() {}
        disconnect() {}
      },
    );
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return boxes.get(this.dataset.box ?? '') ?? rect(0, 0, 0, 0);
    });
    boxes.set('view', rect(0, 0, 600, 400));
    boxes.set('hud', rect(10, 10, 290, 100));
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  let seen: ViewOverlays | null = null;
  let show: (on: boolean) => void = () => undefined;
  function Stage() {
    const [on, setOn] = useState(true);
    show = setOn;
    const { ref, overlays } = useViewOverlays();
    seen = overlays;
    return (
      <div className="robot-stage">
        {on && <div data-box="view" ref={ref} />}
        <div data-testid="robot-hud" data-box="hud" />
      </div>
    );
  }

  it('measures the view there now: gone while the 2D map stands in, measured again when the 3D view is made again', () => {
    act(() => root.render(<Stage />));
    expect(seen!.hud!.right).toBeCloseTo(-1 + (2 * 308) / 600, 12);
    act(() => show(false));
    expect(seen).toEqual({ hud: null, card: null, tools: null });
    boxes.set('hud', rect(10, 10, 290, 160));
    act(() => show(true));
    expect(seen!.hud!.bottom).toBeCloseTo(1 - (2 * 178) / 400, 12);
    // The HUD grows: the observer of the view made last says so.
    boxes.set('hud', rect(10, 10, 290, 200));
    act(() => observers.at(-1)!());
    expect(seen!.hud!.bottom).toBeCloseTo(1 - (2 * 218) / 400, 12);
  });
});
