import { createStore } from 'zustand/vanilla';
import type { ProjectDocument } from '../../core/circuit/document';
import type { RunSession, RunSnapshot, StartResult } from '../../core/run/run-session';
import type { ComponentInput } from '../../core/simulation/simulate-circuit';

// Thin UI wrapper around the core RunSession (plan POC-08). The session may
// publish many snapshots per frame (a forever loop without wait); React only
// sees the latest one, at most once per animation frame (plan §2.5).

export type RunState = {
  /** The latest session snapshot, handed over at most once per animation frame. */
  snapshot: RunSnapshot;
  /**
   * True from Run until Stop, also once the program finished: the board stays
   * powered (E6) and editing the circuit stays locked (plan §3.4). Unlike
   * `snapshot` it changes at once, because it is the edit lock: an edit made
   * right after Run, before the next frame, must already see it.
   */
  running: boolean;
  /** Why the last Run did not start; cleared by the next Run that starts, or by `clearStartFailure`. */
  startFailure: Extract<StartResult, { ok: false }> | null;
  run(project: ProjectDocument): void;
  stop(): void;
  /** Holds a push button of the running circuit closed or lets it open (no-op while idle). */
  setContactInput(componentId: string, closed: boolean): void;
  /**
   * Gives a component of the running circuit, or an onboard part of its board (`<board>/<part>`), the runtime input
   * its model takes: a button held, the light sensor's level (YB-3), a potentiometer's `slider` (YB-4). What it means
   * is the session's (no-op while idle, and for what cannot take it).
   */
  setComponentInput(componentId: string, input: ComponentInput): void;
  /** Forgets why the last Run did not start, e.g. when another project replaces the one that was run. */
  clearStartFailure(): void;
  /**
   * Every snapshot the session publishes, as it is published: not held back to one per frame like `snapshot`. For what
   * must not miss a change that comes and goes inside a frame, and must not wait for a frame that a hidden tab never
   * draws: the sound (a note that ends and the next one that starts in one task). Returns the way to stop listening.
   */
  onSnapshot(listener: (snapshot: RunSnapshot) => void): () => void;
};

export const selectIsRunning = (state: RunState) => state.running;

export function createRunStore(
  session: RunSession,
  requestFrame: (callback: () => void) => void = (callback) => requestAnimationFrame(callback),
) {
  return createStore<RunState>()((set, get) => {
    let frameRequested = false;
    session.subscribe((snapshot) => {
      const running = snapshot.status !== 'idle';
      if (running !== get().running) {
        set({ running });
      }
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
      running: session.getSnapshot().status !== 'idle',
      startFailure: null,
      run(project) {
        const result = session.start(project);
        set({ startFailure: result.ok ? null : result });
      },
      stop: () => session.stop(),
      setContactInput: (componentId, closed) => session.setContactInput(componentId, closed),
      setComponentInput: (componentId, input) => session.setComponentInput(componentId, input),
      clearStartFailure: () => set({ startFailure: null }),
      onSnapshot: (listener) => session.subscribe(listener),
    };
  });
}

export type RunStore = ReturnType<typeof createRunStore>;
