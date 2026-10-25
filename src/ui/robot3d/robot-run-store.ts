import { createStore } from 'zustand/vanilla';
import type { ProjectDocument } from '../../core/circuit/document';
import type { RobotRunSession, RobotRunSnapshot, RobotStartResult } from '../../core/run/robot-run-session';

// The robot lab's run as the UI drives it (N18 R4.2, R4.4): a thin store over the RobotRunSession of R3.6, like run-store.ts is over the
// circuit's RunSession.
//
//   - Realtime: while a run goes on, every animation frame calls `session.advance(wallMs, speed)` with the page time since the frame
//     before (the session turns it into whole ticks, drops what a slow machine cannot keep up with and says so). The first frame after a
//     start, a Resume or the page coming back into sight starts the clock at 0, so a pause or a hidden tab is never owed.
//   - It stops calling `advance` when there is nothing to drive: no run (idle), Pause, or the run is over: an error, or the scenario's
//     end (`end`, N18 R6.2: its time limit or a crash), which the session decides. A finished run that is still in its time is driven on,
//     even at rest: its goals are judged on every tick (a stop in a zone passes after the robot has held still for the goal's time) and
//     its time limit ends it; the session publishes nothing for the ticks of a robot at rest (R6.2), so the view draws nothing for them
//     and React renders nothing, and a frame costs only the session's cheap ticks.
//   - Step: 0.1 s of simulated time, in frames of 25 ms at 1× (3 ticks each at 120 Hz, inside the session's per-frame cap), after the
//     frame in flight. A run that was going is paused first; from idle, the run starts paused.
//   - React gets at most one snapshot per frame, the latest (`snapshot`); `onPublish` tells every publish at once (the 3D view asks for a
//     frame), and `latestWorld()` is what the view draws, read in its frame callback without a React render.
//   - Stop keeps the stopped run's last snapshot (`held`) until Reset or the next run: the learner still sees where the robot got to, its
//     score and what it printed.
//     Reset of a run starts it again from t = 0 (`resetRobot`, the same as a new start); with no run, it clears what was held.
//   - A check (R6.3) holds the lab (`setLocked`): nothing of a run can be started, stepped, reset, paused or pressed meanwhile.

/** The speeds the controls offer. `setSpeed` takes any finite multiplier above 0 (the E2E's hook). */
export const ROBOT_SPEEDS = [0.5, 1, 2, 4] as const;

/** One Step, s of simulated time, and the frames it is given in (each well inside the session's per-frame cap of ticks). */
export const STEP_S = 0.1;
const STEP_FRAMES = 4;

/** A frame longer than this is a stall: it is driven as this long (the session drops what it cannot run either way). */
const MAX_FRAME_MS = 250;

export type RobotStartFailure = Extract<RobotStartResult, { ok: false }>;

/** Whether nothing is left to drive: no run, an error, or the scenario's end of the run (its time limit or a crash, N18 R6.2). */
export function isRunOver(snapshot: RobotRunSnapshot): boolean {
  return snapshot.status === 'idle' || snapshot.status === 'error' || snapshot.end !== undefined;
}

export type RobotLabState = {
  /** The session's latest snapshot, handed over at most once per animation frame. */
  snapshot: RobotRunSnapshot;
  /** A run exists (running, finished or failed): from its start until Stop. Changes at once, not a frame later (the host's run-started). */
  active: boolean;
  /** A start (Run, Step from idle, Reset of a run) is building its world. */
  starting: boolean;
  /** Time is held: no frame drives the run until Resume or a Step. */
  paused: boolean;
  /** The multiplier of real time the run is driven at. */
  speed: number;
  /** What a stopped run left: its last snapshot (world, console, score), shown until Reset or the next run. */
  held: RobotRunSnapshot | null;
  /** Why the last start did not happen; cleared by the next start. */
  startFailure: RobotStartFailure | null;
  /** A check holds the lab (R6.3). */
  locked: boolean;

  /** Replaces any run with a run of `project`. */
  run(project: ProjectDocument): Promise<void>;
  stop(): void;
  togglePause(): void;
  /** 0.1 s of simulated time; `project` starts a run (paused) when there is none. */
  step(project: ProjectDocument): Promise<void>;
  resetRobot(): Promise<void>;
  setSpeed(multiplier: number): void;
  /** The kit's button `role`, pressed or let go (pointer or keyboard). */
  press(role: string, down: boolean): void;
  setLocked(locked: boolean): void;
  /** The world the view draws now: the run's latest, else what a stopped run left; null shows the start. Not held back to a frame. */
  latestWorld(): RobotRunSnapshot['world'];
  /** Every snapshot the session publishes, at once. Returns the way to stop listening. */
  onPublish(listener: (snapshot: RobotRunSnapshot) => void): () => void;
  /**
   * Starts listening to the session and the page (the lab is mounted). Returns the way to stop: it stops the run, its frames and every
   * listener. Making the store does nothing else, so React may make one and drop it (StrictMode), and mount, unmount and mount again.
   */
  connect(): () => void;
};

export const selectRunActive = (state: RobotLabState) => state.active;

/** What the lab says the run is doing (the HUD's status). */
export type LabStatus = 'idle' | 'starting' | 'running' | 'paused' | 'finished' | 'stopped' | 'timeUp' | 'crashed' | 'error';

/** The run's snapshot the lab shows: the running one, or what a stopped run left (null: neither). */
export const shownRun = (state: RobotLabState): RobotRunSnapshot | null => (state.snapshot.status !== 'idle' ? state.snapshot : state.held);

export function labStatus(state: RobotLabState): LabStatus {
  if (state.starting) return 'starting';
  const { snapshot } = state;
  if (snapshot.status === 'idle') return state.held ? 'stopped' : 'idle';
  if (snapshot.status === 'error') return 'error';
  if (snapshot.end?.reason === 'contact') return 'crashed';
  if (snapshot.end?.reason === 'time-limit') return 'timeUp';
  if (state.paused) return 'paused';
  return snapshot.status === 'finished' ? 'finished' : 'running';
}

export type RobotRunStoreOptions = {
  requestFrame?: (callback: (now: number) => void) => number;
  cancelFrame?: (handle: number) => void;
  /** Where the page says it is hidden or shown again (document). */
  visibility?: EventTarget & { readonly hidden: boolean };
};

export function createRobotRunStore(session: RobotRunSession, options: RobotRunStoreOptions = {}) {
  const requestFrame = options.requestFrame ?? ((callback: (now: number) => void) => requestAnimationFrame(callback));
  const cancelFrame = options.cancelFrame ?? ((handle: number) => cancelAnimationFrame(handle));
  const visibility = options.visibility ?? (typeof document === 'undefined' ? undefined : document);

  return createStore<RobotLabState>()((set, get) => {
    /** The driving frame requested, if any, and the page time of the frame before (null: the next frame starts the clock). */
    let driveFrame: number | null = null;
    let lastFrameAt: number | null = null;
    /** The frame that hands React the latest snapshot, while one is asked for. */
    let commitFrame: number | null = null;
    let stepping = false;
    /** Counts the starts, so that a start a newer one replaced does not report. */
    let startTicket = 0;
    const listeners = new Set<(snapshot: RobotRunSnapshot) => void>();

    const shouldDrive = () => !get().paused && !isRunOver(session.getSnapshot());

    const drive = (now: number) => {
      driveFrame = null;
      if (!shouldDrive()) {
        lastFrameAt = null;
        return;
      }
      const wallMs = lastFrameAt === null ? 0 : Math.min(MAX_FRAME_MS, Math.max(0, now - lastFrameAt));
      lastFrameAt = now;
      session.advance(wallMs, get().speed).catch((error: unknown) => console.warn('The robot simulation could not advance.', error));
      driveFrame = requestFrame(drive);
    };

    const ensureDriving = () => {
      if (driveFrame === null && shouldDrive()) {
        lastFrameAt = null;
        driveFrame = requestFrame(drive);
      }
    };

    const stopDriving = () => {
      if (driveFrame !== null) {
        cancelFrame(driveFrame);
        driveFrame = null;
      }
      lastFrameAt = null;
    };

    const onSnapshot = (snapshot: RobotRunSnapshot) => {
      const active = snapshot.status !== 'idle';
      if (active !== get().active) {
        set({ active });
      }
      for (const listener of [...listeners]) {
        listener(snapshot);
      }
      if (commitFrame === null) {
        commitFrame = requestFrame(() => {
          commitFrame = null;
          set({ snapshot: session.getSnapshot() });
        });
      }
    };

    // A hidden page gets no frames; when it is shown again the clock starts afresh instead of owing the time it was away.
    const onVisibility = () => {
      lastFrameAt = null;
    };

    /** Starts a run of `project` (Run, or Step from idle), paused or not. */
    const start = async (project: ProjectDocument, paused: boolean) => {
      const ticket = ++startTicket;
      stopDriving();
      set({ starting: true, startFailure: null, held: null, paused });
      const result = await session.start(project);
      if (ticket !== startTicket) {
        return false;
      }
      // The snapshot now, not a frame later: the HUD never shows the state before the start next to the controls after it.
      set({ starting: false, startFailure: result.ok || result.reason === 'superseded' ? null : result, snapshot: session.getSnapshot() });
      if (result.ok) {
        ensureDriving();
      }
      return result.ok;
    };

    return {
      snapshot: session.getSnapshot(),
      active: session.getSnapshot().status !== 'idle',
      starting: false,
      paused: false,
      speed: 1,
      held: null,
      startFailure: null,
      locked: false,

      async run(project) {
        if (get().locked) {
          return;
        }
        await start(project, false);
      },

      stop() {
        startTicket++;
        stopDriving();
        const left = session.getSnapshot();
        session.stop();
        set({ held: left.status === 'idle' ? get().held : left, paused: false, starting: false, snapshot: session.getSnapshot() });
      },

      togglePause() {
        if (get().locked || session.getSnapshot().status === 'idle') {
          return;
        }
        const paused = !get().paused;
        set({ paused });
        if (paused) {
          stopDriving();
        } else {
          ensureDriving();
        }
      },

      async step(project) {
        if (get().locked || stepping) {
          return;
        }
        stepping = true;
        try {
          if (session.getSnapshot().status === 'idle') {
            if (!(await start(project, true))) {
              return;
            }
          } else if (!get().paused) {
            set({ paused: true });
            stopDriving();
          }
          // After the frame in flight (a call made during a frame only adds to the next one).
          await session.advance(0, 1);
          for (let frame = 0; frame < STEP_FRAMES; frame++) {
            if (isRunOver(session.getSnapshot())) {
              break;
            }
            await session.advance((STEP_S * 1000) / STEP_FRAMES, 1);
          }
        } finally {
          stepping = false;
        }
      },

      async resetRobot() {
        if (get().locked) {
          return;
        }
        if (session.getSnapshot().status === 'idle') {
          set({ held: null, startFailure: null });
          return;
        }
        const ticket = ++startTicket;
        stopDriving();
        set({ starting: true });
        const result = await session.resetRobot();
        if (ticket !== startTicket) {
          return;
        }
        set({ starting: false, startFailure: result.ok || result.reason === 'superseded' || result.reason === 'idle' ? null : result, snapshot: session.getSnapshot() });
        ensureDriving();
      },

      setSpeed(multiplier) {
        if (!Number.isFinite(multiplier) || multiplier <= 0) {
          throw new RangeError(`The speed must be a finite number above 0, not ${multiplier}.`);
        }
        set({ speed: multiplier });
      },

      press(role, down) {
        if (!get().locked) {
          session.pressButton(role, down);
        }
      },

      setLocked(locked) {
        set({ locked });
      },

      latestWorld: () => session.getSnapshot().world ?? get().held?.world ?? null,

      onPublish(listener) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },

      connect() {
        const unsubscribe = session.subscribe(onSnapshot);
        visibility?.addEventListener('visibilitychange', onVisibility);
        return () => {
          startTicket++;
          stopDriving();
          if (commitFrame !== null) {
            cancelFrame(commitFrame);
            commitFrame = null;
          }
          unsubscribe();
          visibility?.removeEventListener('visibilitychange', onVisibility);
          session.stop();
          set({ snapshot: session.getSnapshot(), active: false, starting: false, paused: false });
        };
      },
    };
  });
}

export type RobotRunStore = ReturnType<typeof createRobotRunStore>;
