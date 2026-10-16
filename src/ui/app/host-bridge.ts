import type { CheckResult, Goal } from '../../core/challenge';
import type { ProjectDocument } from '../../core/circuit/document';

// The lab's side of stem-lab/v1 (N6a S3), the only channel between an embedded lab and the page that frames it
// (docs/lab-embed-contract.md). It exists only for a lab launch with a valid `origin=` inside a frame (main.tsx).
// Every message goes to that origin, never to '*'; a message is taken only from the parent window at that origin,
// and only a well-formed `load-project`. The bridge knows nothing of lessons, scores or progress: it reports
// what the lab does.

export const LAB_PROTOCOL = 'stem-lab/v1';
/** The learner's edits reach the host at most once a second (the last edit wins). */
export const PROJECT_CHANGED_DEBOUNCE_MS = 1000;
/** What the host accepts (its lab-protocol.ts): at most 50 goals, labels of at most 200 characters. */
const MAX_GOALS = 50;
const MAX_LABEL = 200;

export type LabGoal = { id: string; label: string };

export type LabMessage =
  | { protocol: typeof LAB_PROTOCOL; type: 'ready'; template: string; profile: string | null; goals: LabGoal[] }
  | { protocol: typeof LAB_PROTOCOL; type: 'run-started' }
  | { protocol: typeof LAB_PROTOCOL; type: 'run-stopped' }
  | { protocol: typeof LAB_PROTOCOL; type: 'check-result'; passed: boolean; goals: (LabGoal & { passed: boolean })[] }
  | { protocol: typeof LAB_PROTOCOL; type: 'project-changed'; document: ProjectDocument };

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
  timers?: BridgeTimers;
};

export type HostBridge = {
  ready(info: { template: string; profile: string | null; goals: readonly Pick<Goal, 'id' | 'label'>[] }): void;
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

export function createHostBridge({ host, hostOrigin, window, onLoadProject, timers = defaultTimers }: HostBridgeOptions): HostBridge {
  let disposed = false;
  let pending: { handle: unknown; document: ProjectDocument } | null = null;

  const post = (message: LabMessage) => {
    if (!disposed) {
      host.postMessage(message, hostOrigin);
    }
  };

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
      post({ protocol: LAB_PROTOCOL, type: 'project-changed', document });
    }
  };

  window.addEventListener('message', onMessage);
  window.addEventListener('pagehide', flush);

  return {
    ready({ template, profile, goals }) {
      post({ protocol: LAB_PROTOCOL, type: 'ready', template, profile, goals: goalsOf(goals.map(({ id, label }) => ({ id, label }))) });
    },
    runStarted: () => post({ protocol: LAB_PROTOCOL, type: 'run-started' }),
    runStopped: () => post({ protocol: LAB_PROTOCOL, type: 'run-stopped' }),
    checkResult(result) {
      post({ protocol: LAB_PROTOCOL, type: 'check-result', passed: result.passed, goals: goalsOf(result.goals.map(({ id, label, passed }) => ({ id, label, passed }))) });
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
