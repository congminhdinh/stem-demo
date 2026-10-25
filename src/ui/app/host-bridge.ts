import type { CheckResult, Goal } from '../../core/challenge';
import type { ProjectDocument } from '../../core/circuit/document';
import {
  ROBOT_CHECK_LIMITS,
  robotCheckResultProblems,
  robotReadyProblems,
  type RobotCheckResult,
  type RobotGoalResult,
  type RobotVariantResult,
} from '../../core/scenario/check-result';

// The lab's side of stem-lab/v1 (N6a S3), the only channel between an embedded lab and the page that frames it
// (docs/lab-embed-contract.md). It exists only for a lab launch with a valid `origin=` inside a frame (main.tsx).
// Every message goes to that origin, never to '*'; a message is taken only from the parent window at that origin,
// and only a well-formed `load-project`. The bridge knows nothing of lessons, scores or progress: it reports
// what the lab does. The 3D robot lab (N18 R4.1, R7.1, plan §4.7) says `lab: "robot"` in every message, adds optional fields to
// `ready` and the score of a check to `check-result`; the Blockly and Yolo:Bit labs' messages have never had a `lab` and are unchanged.
//
// The host drops a whole message with one robot field out of its bounds and stores nothing for a scored check that lacks a field it needs
// (docs/lab-embed-contract.md §2; the shared fixture docs/fixtures/stem-lab-v1-robot.json lists both). So the robot lab's messages are
// BUILT here and never assembled by hand: a field out of its bounds is a bug of the lab, and throws a `RobotMessageError` instead of
// sending a message that would be ignored. The order matters as much as the shape: before a `check-result` the bridge sends any pending
// `project-changed`, and between `beginCheck()` and `endCheck()` it sends none, so the last `project-changed` before a `check-result` is
// exactly the program that was checked (the one `programHash` hashes).

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

/** What the robot lab adds to a scored `check-result` (plan §4.7): all of it, or none of it for a scenario without goals. */
export type RobotCheckFields = Pick<RobotCheckResult, 'score' | 'maxScore' | 'simTimeMs' | 'engine' | 'scenarioVersion' | 'programHash'> & {
  variants: RobotVariantResult[];
};

export type LabMessage =
  | ({ protocol: typeof LAB_PROTOCOL; type: 'ready'; template: string; profile: string | null; goals: LabGoal[] } & RobotStamp & Partial<RobotReady>)
  | ({ protocol: typeof LAB_PROTOCOL; type: 'run-started' } & RobotStamp)
  | ({ protocol: typeof LAB_PROTOCOL; type: 'run-stopped' } & RobotStamp)
  | ({ protocol: typeof LAB_PROTOCOL; type: 'check-result'; passed: boolean; goals: (LabGoal & { passed: boolean })[] } & RobotStamp & Partial<RobotCheckFields>)
  | ({ protocol: typeof LAB_PROTOCOL; type: 'project-changed'; document: ProjectDocument } & RobotStamp);

/** The `check-result` of a scored robot check, as `robotCheckResult` builds it. */
export type RobotCheckResultMessage = {
  protocol: typeof LAB_PROTOCOL;
  type: 'check-result';
  lab: typeof ROBOT_LAB;
  passed: boolean;
  goals: RobotGoalResult[];
} & RobotCheckFields;

/** A robot message that is not one the host would read, found before it was sent: a bug of the lab, never a reason to send it anyway. */
export class RobotMessageError extends Error {
  /** Each problem as `path: what is wrong`. */
  readonly problems: readonly string[];

  constructor(what: string, problems: readonly string[]) {
    super(`${what}: ${problems.join('; ')}`);
    this.name = 'RobotMessageError';
    this.problems = problems;
  }
}

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
  /**
   * `robot`: the robot lab's fields of `ready`, which are held to the host's bounds (a robot lab throws a `RobotMessageError` on a
   * scenario version or score the host would drop, or a goal it would not read). Ignored (not sent) by a bridge that is not the robot lab's.
   */
  ready(info: { template: string; profile: string | null; goals: readonly Pick<Goal, 'id' | 'label'>[]; robot?: RobotReady }): void;
  runStarted(): void;
  runStopped(): void;
  /**
   * Blockly and Yolo:Bit: the verdict and the goals. Robot lab: only for a scenario without goals (the sandbox), `{ passed, goals: [] }`
   * with `lab: "robot"`; a scenario with goals sends its score through `robotCheckResult`. A robot lab sends any pending `project-changed` first.
   */
  checkResult(result: CheckResult): void;
  /** Debounced: sent PROJECT_CHANGED_DEBOUNCE_MS after the last call, with the last document. Not sent while a robot check runs (`beginCheck`). */
  projectChanged(document: ProjectDocument): void;
  /** Sends a pending `project-changed` now (the page is going away). */
  flush(): void;
  /** Stops listening and drops a pending `project-changed`. */
  dispose(): void;
};

/**
 * The robot lab's bridge (N18 R7.1): a `HostBridge` that also sends the score of a check and keeps the order the host relies on. The bridge
 * `createHostBridge` returns is always one; a Blockly or Yolo:Bit bridge refuses `robotCheckResult` and ignores `beginCheck` and `endCheck`.
 */
export type RobotHostBridge = HostBridge & {
  /**
   * The `check-result` of a scored check. It must list the goals of `ready` (ids, in its order) and the scenario version `ready` announced;
   * anything the host would drop or not store throws a `RobotMessageError` and posts nothing. A pending `project-changed` is sent first.
   */
  robotCheckResult(result: RobotCheckResult): void;
  /**
   * The learner pressed Check: sends a pending `project-changed` now (the checked program), then sends no `project-changed` until `endCheck()`.
   * The robot lab locks editing during a check, so an edit that gets through anyway is dropped, not sent late: the host's last project is
   * the checked one. Call it before `runStarted()`.
   */
  beginCheck(): void;
  /** The check is over: its result is sent, or it was stopped. Edits are reported again. Harmless without a `beginCheck()`. Call it in a `finally`. */
  endCheck(): void;
};

const defaultTimers: BridgeTimers = {
  setTimeout: (task, ms) => setTimeout(task, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

const goalsOf = <T extends LabGoal>(goals: readonly T[]): T[] =>
  goals.slice(0, MAX_GOALS).map((goal) => ({ ...goal, label: goal.label.slice(0, MAX_LABEL) }));

/** What the host would refuse of the goals of a robot `ready`: more than 50, or an id or a label that is not 1 to 200 characters. */
function robotReadyGoalProblems(goals: readonly Pick<Goal, 'id' | 'label'>[]): string[] {
  const problems: string[] = [];
  if (goals.length > ROBOT_CHECK_LIMITS.maxGoals) {
    problems.push(`goals: at most ${ROBOT_CHECK_LIMITS.maxGoals}`);
  }
  const isText = (value: unknown) => typeof value === 'string' && value.length >= 1 && value.length <= ROBOT_CHECK_LIMITS.maxGoalText;
  goals.forEach((goal, index) => {
    for (const field of ['id', 'label'] as const) {
      if (!isText(goal?.[field])) {
        problems.push(`goals[${index}].${field}: must be 1 to ${ROBOT_CHECK_LIMITS.maxGoalText} characters`);
      }
    }
  });
  return problems;
}

/**
 * The `check-result` message of a scored robot check (plan §4.6, §4.7): `lab: "robot"`, the verdict, the goals and every robot field,
 * in the order the shared fixture lists them, with only the fields the host reads. It throws a `RobotMessageError` naming every field out of
 * its bounds (`robotCheckResultProblems`) instead of building a message the host would drop or not store: score 0..100 and finite,
 * `maxScore` 100, at most 10 variants, `engine`, `scenarioVersion` and `programHash` in range, and `passed` true only if every goal and
 * every variant passed. It knows nothing of `ready`; `RobotHostBridge.robotCheckResult` also checks the goals against it.
 */
export function robotCheckResult(input: RobotCheckResult): RobotCheckResultMessage {
  const problems = robotCheckResultProblems(input);
  if (problems.length > 0) {
    throw new RobotMessageError('The robot check-result is not one the host reads', problems);
  }
  return {
    protocol: LAB_PROTOCOL,
    type: 'check-result',
    lab: ROBOT_LAB,
    passed: input.passed,
    goals: input.goals.map(({ id, label, passed }) => ({ id, label, passed })),
    score: input.score,
    maxScore: input.maxScore,
    simTimeMs: input.simTimeMs,
    variants: input.variants.map(({ seed, passed, score, simTimeMs }) => ({ seed, passed, score, simTimeMs })),
    engine: input.engine,
    scenarioVersion: input.scenarioVersion,
    programHash: input.programHash,
  };
}

export function createHostBridge({ host, hostOrigin, window, onLoadProject, lab, timers = defaultTimers }: HostBridgeOptions): RobotHostBridge {
  let disposed = false;
  let pending: { handle: unknown; document: ProjectDocument } | null = null;
  /** A robot check is running: `project-changed` is not sent (`beginCheck`). */
  let checking = false;
  /** What `ready` told the host, which a robot `check-result` is read against: the goals' ids in order, and the scenario version if any. */
  let announced: { goalIds: string[]; scenarioVersion: number | undefined } | null = null;

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

  /** What a robot `check-result` must agree with `ready` on: the goals it lists and the scenario version it checked. */
  const readyProblems = (goalIds: readonly string[], scenarioVersion: number | undefined): string[] => {
    if (announced === null) {
      return ['ready: a check-result before ready (the host reads a check against the goals of its load’s ready: send ready first)'];
    }
    const problems: string[] = [];
    if (goalIds.length !== announced.goalIds.length || goalIds.some((id, index) => id !== announced?.goalIds[index])) {
      problems.push(`goals: must list the goals of ready (${announced.goalIds.join(', ')}) in its order, not (${goalIds.join(', ')})`);
    }
    if (scenarioVersion !== undefined && announced.scenarioVersion !== undefined && scenarioVersion !== announced.scenarioVersion) {
      problems.push(`scenarioVersion: ready said ${announced.scenarioVersion}, the check says ${scenarioVersion}`);
    }
    return problems;
  };

  window.addEventListener('message', onMessage);
  window.addEventListener('pagehide', flush);

  return {
    ready({ template, profile, goals, robot }) {
      if (lab !== undefined) {
        const problems = [...robotReadyProblems(robot ?? {}), ...robotReadyGoalProblems(goals)];
        if (problems.length > 0) {
          throw new RobotMessageError('The robot ready is not one the host reads', problems);
        }
      }
      const sent = goalsOf(goals.map(({ id, label }) => ({ id, label })));
      announced = { goalIds: sent.map((goal) => goal.id), scenarioVersion: lab === undefined ? undefined : robot?.scenarioVersion };
      post({
        ...head('ready'),
        template,
        profile,
        ...robotFields(robot),
        goals: sent,
      });
    },
    runStarted: () => post(head('run-started')),
    runStopped: () => post(head('run-stopped')),
    checkResult(result) {
      if (lab !== undefined) {
        // The sandbox's check: nothing to score. A scenario with goals sends its score (robotCheckResult), or the host stores nothing.
        const problems =
          announced === null ? [] : announced.goalIds.length > 0 ? ['a scenario with goals sends its score: use robotCheckResult'] : readyProblems(result.goals.map((goal) => goal.id), undefined);
        if (problems.length > 0) {
          throw new RobotMessageError('The robot check-result is not one the host stores', problems);
        }
        flush();
      }
      post({ ...head('check-result'), passed: result.passed, goals: goalsOf(result.goals.map(({ id, label, passed }) => ({ id, label, passed }))) });
    },
    robotCheckResult(result) {
      if (lab === undefined) {
        throw new RobotMessageError('Only the robot lab sends a robot check-result', ['lab: this bridge is not the robot lab’s']);
      }
      const message = robotCheckResult(result);
      const problems = readyProblems(message.goals.map((goal) => goal.id), message.scenarioVersion);
      if (problems.length > 0) {
        throw new RobotMessageError('The robot check-result does not match ready', problems);
      }
      flush();
      post(message);
    },
    beginCheck() {
      if (lab !== undefined) {
        flush();
        checking = true;
      }
    },
    endCheck() {
      checking = false;
    },
    projectChanged(document) {
      if (disposed || checking) {
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
