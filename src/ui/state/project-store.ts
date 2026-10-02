import { createStore } from 'zustand/vanilla';
import type { ProjectDocument } from '../../core/circuit/document';

// The project document is the source of truth for the canvas and the program
// panel. Actions only replace parts of the document; they hold no logic.
export type ProjectState = {
  document: ProjectDocument;
  /** Stores the serialized Blockly workspace (plan §5.1 B4). */
  setProgramBlocks(blocks: unknown): void;
};

export function createProjectStore(document: ProjectDocument) {
  return createStore<ProjectState>()((set) => ({
    document,
    setProgramBlocks: (blocks) => set((state) => ({ document: { ...state.document, program: { blocks } } })),
  }));
}

export type ProjectStore = ReturnType<typeof createProjectStore>;
