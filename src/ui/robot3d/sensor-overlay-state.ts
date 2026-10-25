import type { SensorOverlay, SensorOverlayProbe } from './parts/sensor-overlay';

// What the 3D view's sensor overlay shows now (N18 R4.3), for the E2E, which loads this module from the dev server (the very instance the
// lab runs on, as top-view-state.ts is loaded, R4.6). The overlay registers itself under its canvas; nothing else of the app reads it.

const overlays = new WeakMap<Element, SensorOverlay>();

/** The overlay of the canvas `canvas`; the returned function takes it away again. */
export function registerSensorOverlay(canvas: Element, overlay: SensorOverlay): () => void {
  overlays.set(canvas, overlay);
  return () => {
    if (overlays.get(canvas) === overlay) overlays.delete(canvas);
  };
}

/** The overlay of the lab's canvas as it is now (the beams, the spots and the goal zone, and the tag's text); null without one. */
export function readSensorOverlay(canvas: Element | null = document.querySelector('[data-testid=robot-canvas] canvas')): SensorOverlayProbe | null {
  return canvas === null ? null : (overlays.get(canvas)?.probe() ?? null);
}
