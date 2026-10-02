import { createStore } from 'zustand/vanilla';
import type { Circuit, ProjectDocument } from '../../core/circuit/document';

// The project document is the source of truth for the canvas and the program
// panel. Actions only replace parts of the document; they hold no logic.
export type ProjectState = {
  document: ProjectDocument;
  /**
   * Bumped by every load, never by edits. Views that keep their own copy of
   * the document (the Blockly workspace) reload on it, whatever the project id.
   */
  loadRevision: number;
  /** Opens a project, replacing the current one even if it has the same id. */
  loadProject(document: ProjectDocument): void;
  /**
   * The single path for circuit edits: the result of a pure core operation
   * (add, move, delete…). Undo would hook in here (BL-E1).
   */
  setCircuit(circuit: Circuit): void;
  /** Stores the serialized Blockly workspace (plan §5.1 B4). */
  setProgramBlocks(blocks: unknown): void;
};

export function createProjectStore(document: ProjectDocument) {
  return createStore<ProjectState>()((set) => ({
    document,
    loadRevision: 0,
    loadProject: (next) => set((state) => ({ document: next, loadRevision: state.loadRevision + 1 })),
    setCircuit: (circuit) => set((state) => ({ document: { ...state.document, circuit } })),
    setProgramBlocks: (blocks) => set((state) => ({ document: { ...state.document, program: { blocks } } })),
  }));
}

export type ProjectStore = ReturnType<typeof createProjectStore>;
