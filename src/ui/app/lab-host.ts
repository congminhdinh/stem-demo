import type { Challenge } from '../../core/challenge';
import type { ProjectDocument } from '../../core/circuit/document';
import type { DeviceRegistry } from '../../core/devices/registry';
import { readStoredProject, type ProgramCheck } from '../../core/persistence/project-repository';
import type { BoardFamily } from '../../core/profiles/board-context';
import type { ProfileCatalog } from '../../core/profiles/profile';
import { isRobotTemplateKey, robotReadyFields, robotReadyGoals } from '../../samples/robot-templates';
import type { LabKind, LabProfile, LabTemplateKey } from '../../samples/templates';
import type { ProjectStore } from '../state/project-store';
import { selectIsRunning, type RunStore } from '../state/run-store';
import type { HostBridge } from './host-bridge';

// Connects a lab's stores to its host bridge (N6a S3): `ready` once, `run-started` / `run-stopped` as the run
// lock changes, `project-changed` on every document change (the bridge debounces), and the host's `load-project`
// opened when it is a project this lab can open. Check results are sent by the lab chrome (App), which runs them. The robot lab runs its
// own session, which the run store does not see: it says when it is busy (`LabBusy`, N18 R6.3), and a load-project waits for it.

/**
 * The board family of the projects each lab opens (N18 R2.1, docs/lab-embed-contract.md §2): a generic project in a Blockly lab,
 * a Yolo:Bit one in a Yolo:Bit lab, a uno one in a robot lab (`LabKind` has `robot` since R4.1).
 */
export const labFamilies = {
  blockly: 'generic',
  yolobit: 'ybc',
  robot: 'uno',
} as const satisfies Readonly<Record<LabKind, BoardFamily>> & Readonly<Record<string, BoardFamily>>;

/** A lab that reads host projects: a key of `labFamilies`. */
export type HostLab = keyof typeof labFamilies;

export type HostProjectRules = {
  lab: HostLab;
  /** The launch's board profile, which a Yolo:Bit or a robot project opens with; null keeps the project's own. */
  profile: LabProfile | null;
  registry: DeviceRegistry;
  profiles: ProfileCatalog;
  canOpenProgram: ProgramCheck;
};

/**
 * The project of a `load-project`, or null when this lab cannot open it: it must be a project the editor opens
 * (the standalone loader's rules: schema, known devices and profile, a program Blockly loads), of this lab's
 * family (`labFamilies`).
 */
export function readHostProject(document: unknown, rules: HostProjectRules): ProjectDocument | null {
  const project = readStoredProject(document, rules.registry, rules.canOpenProgram, rules.profiles);
  if (!project) {
    return null;
  }
  const family = project.profile === undefined ? 'generic' : rules.profiles.get(project.profile)?.family;
  if (family !== labFamilies[rules.lab]) {
    return null;
  }
  return rules.lab !== 'blockly' && rules.profile !== null ? { ...project, profile: rules.profile } : project;
}

export type LabHostOptions = HostProjectRules & {
  bridge: HostBridge;
  projectStore: ProjectStore;
  runStore: RunStore;
  template: LabTemplateKey;
  challenge: Challenge | null;
  /** The language of the goals' labels a robot lab lists in `ready`; Vietnamese, the language of `lab=robot`, by default. */
  locale?: 'vi' | 'en';
};

/** Sends `ready` and keeps the host told until the returned function is called. */
export function connectLabHost(options: LabHostOptions): () => void {
  const { bridge, projectStore, runStore, template, challenge } = options;
  const stopRuns = runStore.subscribe((state, previous) => {
    if (selectIsRunning(state) !== selectIsRunning(previous)) {
      if (selectIsRunning(state)) {
        bridge.runStarted();
      } else {
        bridge.runStopped();
      }
    }
  });
  const stopEdits = projectStore.subscribe((state, previous) => {
    if (state.document !== previous.document) {
      bridge.projectChanged(state.document);
    }
  });
  // A robot scenario adds its version and its score to ready (plan §4.7), and lists its goals (N18 R6.3): its scored check-result lists the
  // same ids in the same order, which the host reads it against.
  const isRobot = options.lab === 'robot' && isRobotTemplateKey(template);
  const robot = isRobot ? { robot: robotReadyFields(template) } : {};
  const goals = challenge?.goals ?? (isRobot ? robotReadyGoals(template, options.locale ?? 'vi') : []);
  bridge.ready({ template, profile: projectStore.getState().document.profile ?? null, goals, ...robot });
  return () => {
    stopRuns();
    stopEdits();
  };
}

/**
 * What to do with a `load-project`: open the project when this lab can, and the editor is not locked by a run
 * (like New, loading replaces the whole project); otherwise nothing.
 */
export function loadHostProject(document: unknown, options: HostProjectRules & { projectStore: ProjectStore; runStore: RunStore }): boolean {
  if (selectIsRunning(options.runStore.getState())) {
    return false;
  }
  const project = readHostProject(document, options);
  if (!project) {
    return false;
  }
  options.projectStore.getState().loadProject(project);
  options.runStore.getState().clearStartFailure();
  return true;
}

/**
 * N18 R6.3: whether the robot lab is busy, a check or a run of its own going on (its session is not the run store's, so loadHostProject
 * cannot see it): the robot lab says so (`set`), the host's loader waits for it (`subscribe`).
 */
export type LabBusy = { isBusy(): boolean; set(busy: boolean): void; subscribe(listener: () => void): () => void };

export function createLabBusy(): LabBusy {
  let busy = false;
  const listeners = new Set<() => void>();
  return {
    isBusy: () => busy,
    set(next) {
      if (next !== busy) {
        busy = next;
        [...listeners].forEach((listener) => listener());
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/**
 * The host's `load-project`, opened as `loadHostProject` opens it. While `busy` says the robot lab is busy (a check, or a robot run), the
 * project is not refused: the last one waits and opens as soon as the lab is not busy (N18 R6.3), after the check's result was sent, so the
 * host hears the check-result first, then the project-changed of what it loaded. Without `busy`, it is `loadHostProject` as it was.
 */
export function createHostLoader(options: HostProjectRules & { projectStore: ProjectStore; runStore: RunStore; busy?: LabBusy }): {
  load(document: unknown): void;
  dispose(): void;
} {
  const { busy } = options;
  let waiting: { document: unknown } | null = null;
  const stop = busy?.subscribe(() => {
    if (waiting !== null && !busy.isBusy()) {
      const { document } = waiting;
      waiting = null;
      loadHostProject(document, options);
    }
  });
  return {
    load(document) {
      if (busy?.isBusy()) {
        waiting = { document };
        return;
      }
      loadHostProject(document, options);
    },
    dispose() {
      waiting = null;
      stop?.();
    },
  };
}
