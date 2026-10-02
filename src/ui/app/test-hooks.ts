import { readCanvasState, type CanvasTestState } from '../canvas/canvas-test-state';

export type StemTestHooks = {
  getCanvasState(): CanvasTestState | null;
};

declare global {
  interface Window {
    __stem?: StemTestHooks;
  }
}

/** Installed only in dev builds (which E2E runs against); never in production. */
export function installTestHooks() {
  window.__stem = { getCanvasState: readCanvasState };
}
