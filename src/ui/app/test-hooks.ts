import { projectDocumentSchema } from '../../core/circuit/document';
import type { ProfileCatalog } from '../../core/profiles/profile';
import { readCanvasState, type CanvasTestState } from '../canvas/canvas-test-state';
import type { ProjectStore } from '../state/project-store';

/**
 * The robot lab's hooks (N18 R4.1): the place the E2E reads the 3D lab through, since it cannot look inside a canvas. R4.1 only
 * holds the contract; the world fills it in later.
 */
export type RobotTestHooks = {
  /** The RobotSnapshot of the lab's world as the view shows it, or null until a run exists. R3.6 defines the snapshot, R4.2 serves it. */
  getSnapshot(): unknown;
  /** Sets the speed of the simulation (a multiplier of real time; finite and above 0). R4.2 makes the run follow it. */
  setSpeed(multiplier: number): void;
  /** The speed `setSpeed` stored; 1 until it is called. */
  getSpeed(): number;
  /** The hash of the snapshot (the same on every browser for the same run), or null until a run exists. R3.6 defines it, R4.2 serves it. */
  snapshotHash(): string | null;
};

export type StemTestHooks = {
  getCanvasState(): CanvasTestState | null;
  /** The project document as stored (design state only, B2). */
  getProject(): unknown;
  /** The serialized program as stored in the document (not read from Blockly). */
  getProgramBlocks(): unknown;
  /** Opens a project document (validated, profile included), e.g. a sample other than the default one. */
  loadProject(document: unknown): void;
  /** The robot lab (`lab=robot`); present, and empty of runs, in every dev build. */
  robot: RobotTestHooks;
};

declare global {
  interface Window {
    __stem?: StemTestHooks;
  }
}

/** Installed only in dev builds (which E2E runs against); never in production. */
export function installTestHooks(projectStore: ProjectStore, profiles: ProfileCatalog) {
  let robotSpeed = 1;
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
    robot: {
      getSnapshot: () => null,
      setSpeed: (multiplier) => {
        if (!Number.isFinite(multiplier) || multiplier <= 0) {
          throw new RangeError(`The speed must be a finite number above 0, not ${multiplier}.`);
        }
        robotSpeed = multiplier;
      },
      getSpeed: () => robotSpeed,
      snapshotHash: () => null,
    },
  };
}
