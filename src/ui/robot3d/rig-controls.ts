import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

// N18 P2: three's OrbitControls, as the 3D view's camera rig uses them (CameraRig.tsx), with a `disconnect` that also finds the document
// they listened on once the canvas has left it. three adds a keydown listener (and, while Control is held, a keyup one) to
// `domElement.getRootNode()` and takes them off the same way; by the time R3F unmounts the scene, React has taken the canvas out of the
// page and that root is the canvas's own detached tree, so the listeners stayed, and with them the controls, the camera and the scene
// (measured: one listener and 186–212 KB of heap each 3D mount, spikes/p2-perf3d/listener-leak.mjs).

/** The root each controls' key listeners went to (kept outside the class: OrbitControls connects from its constructor, before a subclass's fields exist). */
const listenedOn = new WeakMap<OrbitControls, Node>();

/** three's own handlers, the ones it adds to the root (OrbitControls.js `_interceptControlDown`, `_interceptControlUp`). */
type KeyHandlers = { _interceptControlDown?: EventListener; _interceptControlUp?: EventListener };

export class RigControls extends OrbitControls {
  override connect(element: HTMLElement | SVGElement): void {
    super.connect(element);
    listenedOn.set(this, element.getRootNode());
  }

  override disconnect(): void {
    super.disconnect();
    const root = listenedOn.get(this);
    listenedOn.delete(this);
    const { _interceptControlDown: down, _interceptControlUp: up } = this as unknown as KeyHandlers;
    if (root && down) root.removeEventListener('keydown', down, { capture: true });
    if (root && up) root.removeEventListener('keyup', up, { capture: true });
  }
}
