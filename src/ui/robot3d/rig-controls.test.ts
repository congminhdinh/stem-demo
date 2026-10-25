// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PerspectiveCamera } from 'three';
import { RigControls } from './rig-controls';

// N18 P2: the camera's OrbitControls leave nothing on the document when the 3D view goes. three takes its keydown listener off
// `domElement.getRootNode()`, which is the canvas's own detached tree once React has taken the canvas out of the page (R3F unmounts the
// scene after that): every 3D mount left one listener behind, and with it the controls, the camera and the scene (186–212 KB a mount).

/** The listeners on `target` now: each added and not yet removed, by type, function and capture. */
function liveListeners(target: EventTarget) {
  const live = new Set<string>();
  const ids = new Map<unknown, number>();
  const key = (type: string, listener: unknown, options: boolean | AddEventListenerOptions | EventListenerOptions | undefined, adding: boolean) => {
    if (adding && !ids.has(listener)) ids.set(listener, ids.size);
    const capture = typeof options === 'boolean' ? options : options?.capture === true;
    return `${type} ${ids.get(listener) ?? '?'} ${capture}`;
  };
  const add = target.addEventListener.bind(target);
  const remove = target.removeEventListener.bind(target);
  vi.spyOn(target, 'addEventListener').mockImplementation((type, listener, options) => {
    live.add(key(type, listener, options, true));
    add(type, listener, options);
  });
  vi.spyOn(target, 'removeEventListener').mockImplementation((type, listener, options) => {
    live.delete(key(type, listener, options, false));
    remove(type, listener, options);
  });
  return live;
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe('the 3D camera’s controls (N18 P2)', () => {
  it('take their keydown listener off the document when they are disposed after the canvas has left the page', () => {
    const live = liveListeners(document);
    const canvas = document.createElement('canvas');
    document.body.append(canvas);
    const controls = new RigControls(new PerspectiveCamera(), canvas);
    expect([...live]).toEqual(['keydown 0 true']);
    canvas.remove();
    controls.dispose();
    expect([...live]).toEqual([]);
  });

  it('take it off when disposed in the page too, and after a Control key held (its keyup listener) as well', () => {
    const live = liveListeners(document);
    const canvas = document.createElement('canvas');
    document.body.append(canvas);
    const controls = new RigControls(new PerspectiveCamera(), canvas);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Control' }));
    expect(live.size).toBe(2);
    canvas.remove();
    controls.dispose();
    expect([...live]).toEqual([]);
  });

  it('listen again where the canvas is when connected again', () => {
    const live = liveListeners(document);
    const canvas = document.createElement('canvas');
    document.body.append(canvas);
    const controls = new RigControls(new PerspectiveCamera(), canvas);
    controls.disconnect();
    expect([...live]).toEqual([]);
    controls.connect(canvas);
    expect([...live]).toEqual(['keydown 0 true']);
    controls.dispose();
    expect([...live]).toEqual([]);
  });
});
