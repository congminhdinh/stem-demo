import type { Challenge } from '../../core/challenge';
import type { ProjectDocument } from '../../core/circuit/document';
import type { DeviceRegistry } from '../../core/devices/registry';
import { readStoredProject, type ProgramCheck } from '../../core/persistence/project-repository';
import type { BoardFamily } from '../../core/profiles/board-context';
import type { ProfileCatalog } from '../../core/profiles/profile';
import type { LabKind, TemplateKey } from '../../samples/templates';
import type { YbcLabProfile } from '../../samples/ybc-templates';
import type { ProjectStore } from '../state/project-store';
import { selectIsRunning, type RunStore } from '../state/run-store';
import type { HostBridge } from './host-bridge';

// Connects a lab's stores to its host bridge (N6a S3): `ready` once, `run-started` / `run-stopped` as the run
// lock changes, `project-changed` on every document change (the bridge debounces), and the host's `load-project`
// opened when it is a project this lab can open. Check results are sent by the lab chrome (App), which runs them.

/**
 * The board family of the projects each lab opens (N18 R2.1, docs/lab-embed-contract.md §2): a generic project in a Blockly lab,
 * a Yolo:Bit one in a Yolo:Bit lab, a uno one in a robot lab. `robot` is listed before `LabKind` has it: R4.1 adds the kind to
 * `LabKind`, and nothing here changes.
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
  /** The launch's board profile, which a Yolo:Bit project opens with; null keeps the project's own. */
  profile: YbcLabProfile | null;
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
  return rules.lab === 'yolobit' && rules.profile !== null ? { ...project, profile: rules.profile } : project;
}

export type LabHostOptions = HostProjectRules & {
  bridge: HostBridge;
  projectStore: ProjectStore;
  runStore: RunStore;
  template: TemplateKey;
  challenge: Challenge | null;
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
  bridge.ready({ template, profile: projectStore.getState().document.profile ?? null, goals: challenge?.goals ?? [] });
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
