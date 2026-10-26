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
  /**
   * N18 P2 fix round 1: pins the low tier's frame-rate chain ('off': no step of its own) or lets it run ('auto', the default), in the
   * mounted lab and in every lab the page mounts after it. The E2E's lesson helpers pin it off, so a busy machine changes no spec.
   */
  setLowTierChain(mode: 'auto' | 'off'): void;
  /** N18 P2 fix round 1: the mounted lab takes the chain's step now: 'cap' (30 fps on the low tier), then 'offer' (the 2D map offered). */
  forceLowTierStep(step: 'cap' | 'offer'): void;
};

/** What the mounted robot lab serves to `window.__stem.robot` (N18 R4.2). */
export type RobotTestTarget = Pick<RobotTestHooks, 'getSnapshot' | 'snapshotHash' | 'setSpeed' | 'getSpeed' | 'setLowTierChain' | 'forceLowTierStep'>;

/** The robot lab that is mounted, if any. Only the dev hooks read it: in a production build nothing does. */
let robotTarget: RobotTestTarget | null = null;
/** The low tier's chain as the hooks last set it: a lab mounted later takes it too. */
let lowTierChain: 'auto' | 'off' = 'auto';

/** The robot lab serves the hooks from now until the returned function is called (when it unmounts). */
export function attachRobotTestTarget(target: RobotTestTarget): () => void {
  robotTarget = target;
  if (lowTierChain !== 'auto') target.setLowTierChain(lowTierChain);
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
  const robot: Omit<RobotTestHooks, 'setLowTierChain' | 'forceLowTierStep'> = {
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
  };
  // N18 P2 fix round 1: the low tier's chain's hooks, not enumerable: the keys of R4.1's contract (getSnapshot, getSpeed, setSpeed,
  // snapshotHash) stay what they were; these two are the E2E's own.
  const chain: Pick<RobotTestHooks, 'setLowTierChain' | 'forceLowTierStep'> = {
    setLowTierChain: (mode) => {
      if (mode !== 'auto' && mode !== 'off') throw new RangeError(`The low tier's chain is 'auto' or 'off', not ${String(mode)}.`);
      lowTierChain = mode;
      robotTarget?.setLowTierChain(mode);
    },
    forceLowTierStep: (step) => {
      if (!robotTarget) throw new Error('No robot lab is mounted.');
      robotTarget.forceLowTierStep(step);
    },
  };
  Object.defineProperties(robot, {
    setLowTierChain: { enumerable: false, value: chain.setLowTierChain },
    forceLowTierStep: { enumerable: false, value: chain.forceLowTierStep },
  });
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
    robot: robot as RobotTestHooks,
  };
}
