import { projectDocumentSchema } from '../../core/circuit/document';
import type { ProfileCatalog } from '../../core/profiles/profile';
import { readCanvasState, type CanvasTestState } from '../canvas/canvas-test-state';
import type { ProjectStore } from '../state/project-store';

export type StemTestHooks = {
  getCanvasState(): CanvasTestState | null;
  /** The project document as stored (design state only, B2). */
  getProject(): unknown;
  /** The serialized program as stored in the document (not read from Blockly). */
  getProgramBlocks(): unknown;
  /** Opens a project document (validated, profile included), e.g. a sample other than the default one. */
  loadProject(document: unknown): void;
};

declare global {
  interface Window {
    __stem?: StemTestHooks;
  }
}

/** Installed only in dev builds (which E2E runs against); never in production. */
export function installTestHooks(projectStore: ProjectStore, profiles: ProfileCatalog) {
  window.__stem = {
    getCanvasState: readCanvasState,
    getProject: () => projectStore.getState().document,
    getProgramBlocks: () => projectStore.getState().document.program.blocks,
    loadProject: (document) => {
      const parsed = projectDocumentSchema.parse(document);
      // L-1: an unknown profile does not open (R-F2), like on the real load path.
      if (parsed.profile !== undefined && !profiles.get(parsed.profile)) {
        throw new Error(`Unknown profile "${parsed.profile}"`);
      }
      projectStore.getState().loadProject(parsed);
    },
  };
}
