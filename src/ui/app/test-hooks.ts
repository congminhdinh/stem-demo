import { projectDocumentSchema } from '../../core/circuit/document';
import type { ProfileCatalog } from '../../core/profiles/profile';
import { readCanvasState, type CanvasTestState } from '../canvas/canvas-test-state';
import type { ProjectStore } from '../state/project-store';

/**
 * The robot lab's hooks (N18 R4.1): the place the E2E reads the 3D lab through, since it cannot look inside a canvas. R4.1 held the
 * contract; since R4.2 the mounted robot lab serves it (`attachRobotTestTarget`).
 */
export type RobotTestHooks = {
  /** The RobotSnapshot of the lab's world as the view shows it, or null when the view shows the scenario's start (no run yet, or Reset). */
  getSnapshot(): unknown;
  /** Sets the speed of the simulation (a multiplier of real time; finite and above 0): the robot lab drives its run at it. */
  setSpeed(multiplier: number): void;
  /** The speed the lab drives at (1 until it is set). */
  getSpeed(): number;
  /** `hashSnapshot` of the snapshot `getSnapshot` gives (the same on every browser for the same run), or null when it gives none. */
  snapshotHash(): string | null;
};

/** What the mounted robot lab serves to `window.__stem.robot` (N18 R4.2). */
export type RobotTestTarget = Pick<RobotTestHooks, 'getSnapshot' | 'snapshotHash' | 'setSpeed' | 'getSpeed'>;

/** The robot lab that is mounted, if any. Only the dev hooks read it: in a production build nothing does. */
let robotTarget: RobotTestTarget | null = null;

/** The robot lab serves the hooks from now until the returned function is called (when it unmounts). */
export function attachRobotTestTarget(target: RobotTestTarget): () => void {
  robotTarget = target;
  return () => {
    if (robotTarget === target) {
      robotTarget = null;
    }
  };
}

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
      getSnapshot: () => robotTarget?.getSnapshot() ?? null,
      setSpeed: (multiplier) => {
        if (!Number.isFinite(multiplier) || multiplier <= 0) {
          throw new RangeError(`The speed must be a finite number above 0, not ${multiplier}.`);
        }
        robotSpeed = multiplier;
        robotTarget?.setSpeed(multiplier);
      },
      getSpeed: () => robotTarget?.getSpeed() ?? robotSpeed,
      snapshotHash: () => robotTarget?.snapshotHash() ?? null,
    },
  };
}
