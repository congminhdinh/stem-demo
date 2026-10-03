import { projectDocumentSchema } from '../../core/circuit/document';
import { readCanvasState, type CanvasTestState } from '../canvas/canvas-test-state';
import type { ProjectStore } from '../state/project-store';

export type StemTestHooks = {
  getCanvasState(): CanvasTestState | null;
  /** The project document as stored (design state only, B2). */
  getProject(): unknown;
  /** The serialized program as stored in the document (not read from Blockly). */
  getProgramBlocks(): unknown;
  /** Opens a project document (validated), e.g. a sample other than the default one. */
  loadProject(document: unknown): void;
};

declare global {
  interface Window {
    __stem?: StemTestHooks;
  }
}

/** Installed only in dev builds (which E2E runs against); never in production. */
export function installTestHooks(projectStore: ProjectStore) {
  window.__stem = {
    getCanvasState: readCanvasState,
    getProject: () => projectStore.getState().document,
    getProgramBlocks: () => projectStore.getState().document.program.blocks,
    loadProject: (document) => projectStore.getState().loadProject(projectDocumentSchema.parse(document)),
  };
}
