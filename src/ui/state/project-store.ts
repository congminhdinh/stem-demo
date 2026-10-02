import { createStore } from 'zustand/vanilla';
import type { ProjectDocument } from '../../core/circuit/document';

// The project document is the source of truth for the canvas. No actions yet:
// the first document change (Blockly program, editing) adds the single update
// path (plan POC-03 scope).
export type ProjectState = { document: ProjectDocument };

export function createProjectStore(document: ProjectDocument) {
  return createStore<ProjectState>()(() => ({ document }));
}

export type ProjectStore = ReturnType<typeof createProjectStore>;
