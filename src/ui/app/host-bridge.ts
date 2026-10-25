import type { CheckResult, Goal } from '../../core/challenge';
import type { ProjectDocument } from '../../core/circuit/document';

// The lab's side of stem-lab/v1 (N6a S3), the only channel between an embedded lab and the page that frames it
// (docs/lab-embed-contract.md). It exists only for a lab launch with a valid `origin=` inside a frame (main.tsx).
// Every message goes to that origin, never to '*'; a message is taken only from the parent window at that origin,
// and only a well-formed `load-project`. The bridge knows nothing of lessons, scores or progress: it reports
// what the lab does. The 3D robot lab (N18 R4.1, plan §4.7) says `lab: "robot"` in every message and adds optional fields to
// `ready`; the Blockly and Yolo:Bit labs' messages have never had a `lab` and are unchanged.

export const LAB_PROTOCOL = 'stem-lab/v1';
/** The learner's edits reach the host at most once a second (the last edit wins). */
export const PROJECT_CHANGED_DEBOUNCE_MS = 1000;
/** What the host accepts (its lab-protocol.ts): at most 50 goals, labels of at most 200 characters. */
const MAX_GOALS = 50;
const MAX_LABEL = 200;

/** The `lab` field of a robot lab's messages, which the host reads the robot fields of `ready` and `check-result` by. */
export const ROBOT_LAB = 'robot';

export type LabGoal = { id: string; label: string };

/** What the robot lab adds to `ready`; each field is left out when the lab has none, never null. */
export type RobotReady = {
  /** The scenario's version: a scenario that changes its behaviour raises it, its key never changes. */
  scenarioVersion: number;
  /** The scenario's top score (100); left out for a scenario without goals (the sandbox). */
  maxScore?: number;
};

/** `lab: "robot"` where the lab is the robot's, and nowhere else. */
type RobotStamp = { lab?: typeof ROBOT_LAB };

export type LabMessage =
  | ({ protocol: typeof LAB_PROTOCOL; type: 'ready'; template: string; profile: string | null; goals: LabGoal[] } & RobotStamp & Partial<RobotReady>)
  | ({ protocol: typeof LAB_PROTOCOL; type: 'run-started' } & RobotStamp)
  | ({ protocol: typeof LAB_PROTOCOL; type: 'run-stopped' } & RobotStamp)
  | ({ protocol: typeof LAB_PROTOCOL; type: 'check-result'; passed: boolean; goals: (LabGoal & { passed: boolean })[] } & RobotStamp)
  | ({ protocol: typeof LAB_PROTOCOL; type: 'project-changed'; document: ProjectDocument } & RobotStamp);

/** The embedding page's window (window.parent): only ever posted to, with its origin. */
export type HostWindow = { postMessage(message: unknown, targetOrigin: string): void };

/** Where messages and page events arrive (window). */
export type LabWindow = Pick<Window, 'addEventListener' | 'removeEventListener'>;

export type BridgeTimers = { setTimeout(task: () => void, ms: number): unknown; clearTimeout(handle: unknown): void };

export type HostBridgeOptions = {
  host: HostWindow;
  hostOrigin: string;
  window: LabWindow;
  /** A `load-project` from the host: its document, still unchecked (lab-host.ts checks it). */
  onLoadProject(document: unknown): void;
  /** `robot`: the lab is the 3D robot lab, whose every message says so (plan §4.7). Absent for the Blockly and Yolo:Bit labs. */
  lab?: typeof ROBOT_LAB;
  timers?: BridgeTimers;
};

export type HostBridge = {
  /** `robot`: the robot lab's fields of `ready`; ignored (not sent) by a bridge that is not the robot lab's. */
  ready(info: { template: string; profile: string | null; goals: readonly Pick<Goal, 'id' | 'label'>[]; robot?: RobotReady }): void;
  runStarted(): void;
  runStopped(): void;
  checkResult(result: CheckResult): void;
  /** Debounced: sent PROJECT_CHANGED_DEBOUNCE_MS after the last call, with the last document. */
  projectChanged(document: ProjectDocument): void;
  /** Sends a pending `project-changed` now (the page is going away). */
  flush(): void;
  /** Stops listening and drops a pending `project-changed`. */
  dispose(): void;
};

const defaultTimers: BridgeTimers = {
  setTimeout: (task, ms) => setTimeout(task, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

const goalsOf = <T extends LabGoal>(goals: readonly T[]): T[] =>
  goals.slice(0, MAX_GOALS).map((goal) => ({ ...goal, label: goal.label.slice(0, MAX_LABEL) }));

export function createHostBridge({ host, hostOrigin, window, onLoadProject, lab, timers = defaultTimers }: HostBridgeOptions): HostBridge {
  let disposed = false;
  let pending: { handle: unknown; document: ProjectDocument } | null = null;

  const post = (message: LabMessage) => {
    if (!disposed) {
      host.postMessage(message, hostOrigin);
    }
  };
  /** The start of a message: the protocol and type, then `lab` for the robot lab (the order the shared fixture lists them in). */
  const head = <T extends LabMessage['type']>(type: T): { protocol: typeof LAB_PROTOCOL; type: T; lab?: typeof ROBOT_LAB } =>
    lab === undefined ? { protocol: LAB_PROTOCOL, type } : { protocol: LAB_PROTOCOL, type, lab };
  /** The robot fields of `ready`: only the robot lab sends them, and only those it has. */
  const robotFields = (robot: RobotReady | undefined): Partial<RobotReady> =>
    lab === undefined || robot === undefined
      ? {}
      : robot.maxScore === undefined
        ? { scenarioVersion: robot.scenarioVersion }
        : { scenarioVersion: robot.scenarioVersion, maxScore: robot.maxScore };

  const onMessage = (event: MessageEvent) => {
    if (disposed || event.origin !== hostOrigin || event.source !== (host as unknown)) {
      return;
    }
    const data: unknown = event.data;
    if (typeof data !== 'object' || data === null) {
      return;
    }
    const message = data as Record<string, unknown>;
    if (message.protocol === LAB_PROTOCOL && message.type === 'load-project' && message.document !== undefined) {
      onLoadProject(message.document);
    }
  };

  const flush = () => {
    if (pending) {
      const { handle, document } = pending;
      pending = null;
      timers.clearTimeout(handle);
      post({ ...head('project-changed'), document });
    }
  };

  window.addEventListener('message', onMessage);
  window.addEventListener('pagehide', flush);

  return {
    ready({ template, profile, goals, robot }) {
      post({
        ...head('ready'),
        template,
        profile,
        ...robotFields(robot),
        goals: goalsOf(goals.map(({ id, label }) => ({ id, label }))),
      });
    },
    runStarted: () => post(head('run-started')),
    runStopped: () => post(head('run-stopped')),
    checkResult(result) {
      post({ ...head('check-result'), passed: result.passed, goals: goalsOf(result.goals.map(({ id, label, passed }) => ({ id, label, passed }))) });
    },
    projectChanged(document) {
      if (disposed) {
        return;
      }
      if (pending) {
        timers.clearTimeout(pending.handle);
      }
      pending = { document, handle: timers.setTimeout(flush, PROJECT_CHANGED_DEBOUNCE_MS) };
    },
    flush,
    dispose() {
      if (pending) {
        timers.clearTimeout(pending.handle);
        pending = null;
      }
      disposed = true;
      window.removeEventListener('message', onMessage);
      window.removeEventListener('pagehide', flush);
    },
  };
}
