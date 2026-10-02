import { createStore } from 'zustand/vanilla';
import type { ProjectDocument } from '../../core/circuit/document';
import type { RunSession, RunSnapshot, StartResult } from '../../core/run/run-session';

// Thin UI wrapper around the core RunSession (plan POC-08). The session may
// publish many snapshots per frame (a forever loop without wait); React only
// sees the latest one, at most once per animation frame (plan §2.5).

export type RunState = {
  snapshot: RunSnapshot;
  /** Why the last Run did not start; cleared by the next Run that starts. */
  startFailure: Extract<StartResult, { ok: false }> | null;
  run(project: ProjectDocument): void;
  stop(): void;
};

/**
 * True from Run until Stop, also once the program finished: the board stays
 * powered (E6) and editing the circuit stays locked (plan §3.4).
 */
export const selectIsRunning = (state: RunState) => state.snapshot.status !== 'idle';

export function createRunStore(
  session: RunSession,
  requestFrame: (callback: () => void) => void = (callback) => requestAnimationFrame(callback),
) {
  return createStore<RunState>()((set) => {
    let frameRequested = false;
    session.subscribe(() => {
      if (frameRequested) {
        return;
      }
      frameRequested = true;
      requestFrame(() => {
        frameRequested = false;
        set({ snapshot: session.getSnapshot() });
      });
    });

    return {
      snapshot: session.getSnapshot(),
      startFailure: null,
      run(project) {
        const result = session.start(project);
        set({ startFailure: result.ok ? null : result });
      },
      stop: () => session.stop(),
    };
  });
}

export type RunStore = ReturnType<typeof createRunStore>;
