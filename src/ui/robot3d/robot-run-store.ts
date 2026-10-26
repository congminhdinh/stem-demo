import { createStore } from 'zustand/vanilla';
import type { ProjectDocument } from '../../core/circuit/document';
import type { RobotPlaceResult, RobotRunSession, RobotRunSnapshot, RobotStartResult } from '../../core/run/robot-run-session';
import type { TeleopCommand } from '../../core/run/teleop';
import type { PlacementPose } from '../../core/scenario/placement';
import type { RobotSnapshot, ScoreState } from '../../core/world/snapshot';

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
//   - N18 bt-lab-fix (m1): a run the scenario ended by itself (its time limit, a crash) or that failed (an error) is over for the host as a
//     Dừng would make it, and for the controls (Dừng is off, Chạy is on): `ended`, set from the session's own snapshot at once, which is
//     what `selectHostRun` and the controls read. Nothing else changes: the run stays (`active`), with its last snapshot, the end badge and
//     the HUD, until Dừng, Đặt lại or the next run. Teleop and an attached check are no part of it (see `ended`).
//   - Stop keeps the stopped run's last snapshot (`held`) until Reset or the next run: the learner still sees where the robot got to, its
//     score and what it printed.
//     Reset of a run starts it again from t = 0 (`resetRobot`, the same as a new start); with no run, it clears what was held.
//   - A check (R6.3) holds the lab (`setLocked`): nothing of a run can be started, stepped, reset, paused or pressed meanwhile.
//   - N18 R6.3: a check at 1× or 4× is shown in this view (`attach`): the store reads the check's own run (checkRobot's session, R6.2) instead
//     of the lab's, hands React its snapshots, and drives it with every animation frame through the check's `frame` at the check's speed.
//     The check, not the store, runs its rounds and judges them: the frames only say how much page time went by, so a hidden tab (no frames)
//     pauses it and the result is the same (Review Focus 2). From `attach` to its detach the lab says one run is on (the host's run-started
//     and run-stopped), whatever the check's run publishes between its rounds. After a check, the world its last round ended in stays in
//     view (`held`, with that `round` and its score) until a run or Reset; a fast check (headless) is never shown while it runs, it only
//     leaves its last round (`hold`).
//   - Replay (`replay`, "Xem lại"): a round of a check is run again in the lab's session as that variant's check run (its seed, the scenario's
//     inputs only), at 1× from its start. The same project, scenario, seed and engine give the same run (robot plan §5), so nothing is recorded.
//   - N18 R4.8, teleop ("Lái tay", `startTeleop`): a run of the session without a program, driven by the frames like any other, its commands
//     (`teleop`) for the session's next tick. `teleop` says the lab's run is one (from the click, while its world is built, until another run
//     replaces it or it stops). It is refused while a check holds the lab, while a check's run is shown and while a replay goes on; Chạy and
//     Bước replace it (the session's start), and Dừng or `stopTeleop` end it, keeping where the robot got to in view. It is no run for the
//     host (`selectHostRun`: no run-started / run-stopped) and no reason for a load-project to wait (`labBusy`): it never touches the program.
//   - N18 R4.8, the placed start ("Di chuyển robot", `placeRobot`): with no run going on (one that is over gives way), the session takes the
//     pose for the learner's next worlds and the view shows the robot there (`startView`, read by `latestWorld`). Đặt lại robot goes back to
//     the placed pose (a run starts again there, what a stopped run left gives way to it); the next Đặt lại, with nothing else in between
//     (`resetToStart`), goes back to the scenario's start. A check never moves it: the session's check runs start at the scenario's start.

/** The speeds the controls offer. `setSpeed` takes any finite multiplier above 0 (the E2E's hook). */
export const ROBOT_SPEEDS = [0.5, 1, 2, 4] as const;

/** One Step, s of simulated time, and the frames it is given in (each well inside the session's per-frame cap of ticks). */
export const STEP_S = 0.1;
const STEP_FRAMES = 4;

/** A frame longer than this is a stall: it is driven as this long (the session drops what it cannot run either way). */
const MAX_FRAME_MS = 250;

export type RobotStartFailure = Extract<RobotStartResult, { ok: false }>;

/** A check's run as the view shows it (N18 R6.3): checkRobot's `run` and its `frame`. */
export type CheckRunView = Pick<RobotRunSession, 'getSnapshot' | 'subscribe'> & {
  /** One animation frame of the page, `wallMs` long, at `speed`. */
  frame(wallMs: number, speed: number): Promise<void>;
};

/**
 * The round of a check the view shows (N18 R6.3): during a check at 1× or 4×, after a check (its last round), in a replay. `score` is the
 * check's score of that round, which the HUD shows once the round's run is over (a round that ended in an error scores 0, whatever its
 * live score was); null while the check has not judged it.
 */
export type ShownRound = { index: number; count: number; score: ScoreState | null };

/** What a check leaves in view when it ends: the last world of its last round and that round, or nothing (a cancelled check). */
export type CheckLeft = { held: RobotRunSnapshot | null; round: ShownRound | null } | null;

/** Whether nothing is left to drive: no run, an error, or the scenario's end of the run (its time limit or a crash, N18 R6.2). */
export function isRunOver(snapshot: RobotRunSnapshot): boolean {
  return snapshot.status === 'idle' || snapshot.status === 'error' || snapshot.end !== undefined;
}

export type RobotLabState = {
  /** The session's latest snapshot, handed over at most once per animation frame. */
  snapshot: RobotRunSnapshot;
  /** A run exists (running, finished or failed): from its start until Stop. Changes at once, not a frame later (the host's run-started). */
  active: boolean;
  /**
   * N18 bt-lab-fix (m1): the lab's run is over by itself: the scenario ended it (its time limit, a crash) or it failed, and it has not been
   * stopped or replaced yet. `active` stays true then (the run, its last world and its end stay in view). Changes at once, like `active`.
   * Never true for an attached check (its run is over between two rounds; the host hears one run for the whole check). Teleop is a run
   * of the session like any other here (its crash or its 600 s cap set it), but never a run for the host.
   */
  ended: boolean;
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
  /** N18 R6.3: the round of a check the view shows, if it shows one. */
  round: ShownRound | null;
  /** N18 R4.8: the lab's run is teleop ("Lái tay"), or a teleop start is building its world. */
  teleop: boolean;
  /** N18 R4.8: where the learner placed the robot; null for the scenario's start. */
  placement: PlacementPose | null;
  /** N18 R4.8: the next Đặt lại robot goes to the scenario's start (the last one went to the placed pose, and nothing came since). */
  resetToStart: boolean;

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
  /**
   * N18 R6.3: shows a check's run instead of the lab's (which stops) and drives it with every frame at `speed`, until the returned detach,
   * which leaves what the check left in view (`CheckLeft`). Nothing of the lab's own run starts meanwhile.
   */
  attach(view: CheckRunView, speed: number): (left: CheckLeft) => void;
  /** N18 R6.3: the round of the attached check the view shows now. */
  setRound(round: ShownRound | null): void;
  /** N18 R6.3: what a check that was not shown (a fast check) left: the last world of its last round, in view until a run or Reset. */
  hold(held: RobotRunSnapshot, round: ShownRound): void;
  /** N18 R6.3, "Xem lại": runs the round `round.index` of a check of `project` again, as that variant's check run, at 1× from its start. */
  replay(project: ProjectDocument, round: ShownRound): Promise<void>;
  /** N18 R6.3: why a check could not be made, said as a start that failed (the message over the view, the warnings on the blocks). */
  showFailure(failure: RobotStartFailure): void;
  /** N18 R4.8: replaces the lab's run with teleop; nothing while a check holds the lab, a check's run is shown or a replay goes on. */
  startTeleop(): Promise<void>;
  /** N18 R4.8: a command of teleop, for the session's next tick; nothing unless teleop is on. */
  teleopCommand(command: TeleopCommand): void;
  /** N18 R4.8: ends teleop as Dừng does (where the robot got to stays in view); nothing unless teleop is on. */
  stopTeleop(): void;
  /**
   * N18 R4.8: puts the robot at `pose` for the learner's next runs (null: the scenario's start), before a run: a run that is over gives way
   * first. Null when nothing was asked of the session: a run goes on, a start is building its world, a check holds the lab or is shown.
   */
  placeRobot(pose: PlacementPose | null): Promise<RobotPlaceResult | null>;
  /** N18 P2: the session loads and warms the physics engine (`preparePhysics`); the lab asks at idle once the view is up. */
  preparePhysics(): void;
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

/**
 * N18 R4.8: a run the host hears of (run-started, run-stopped): the lab's run or a check's shown in it, but never teleop. N18 bt-lab-fix
 * (m1): a run that ended by itself (`ended`) is a stopped run: the host hears run-stopped when it ends, once, and a Dừng after it says
 * nothing more.
 */
export const selectHostRun = (state: RobotLabState) => state.active && !state.teleop && !state.ended;

/** N18 bt-lab-fix (m1): Dừng has something to end: a start is building its world, a run goes on, or teleop is on (Dừng ends that too). */
export const selectCanStop = (state: RobotLabState) => state.starting || (state.active && (!state.ended || state.teleop));

/** What the lab says the run is doing (the HUD's status). */
export type LabStatus = 'idle' | 'starting' | 'running' | 'paused' | 'finished' | 'stopped' | 'timeUp' | 'crashed' | 'error' | 'teleop';

/** The run's snapshot the lab shows: the running one, or what a stopped run left (null: neither). */
export const shownRun = (state: RobotLabState): RobotRunSnapshot | null => (state.snapshot.status !== 'idle' ? state.snapshot : state.held);

/**
 * The score the HUD shows (N18 R6.3): the shown run's, except a check's round whose run is over, which shows the check's score of it (a
 * round that ended in an error scores 0 there, whatever its live score was).
 */
export const shownScore = (state: RobotLabState): ScoreState | null => {
  const run = shownRun(state);
  if (run !== null && state.round?.score && run.status !== 'idle' && isRunOver(run)) {
    return state.round.score;
  }
  return run?.world?.score ?? null;
};

/**
 * N18 R6.3: the lab is busy: a check holds it, a start builds its world, or a run is going on (one that is over, a time limit, a crash or an
 * error, is not). A host's load-project waits while it is.
 */
export const labBusy = (state: RobotLabState): boolean => state.locked || state.starting || (state.active && !state.teleop && !isRunOver(state.snapshot));

/** How a run that is over ended, as the lab says it. */
const endedStatus = (snapshot: RobotRunSnapshot): LabStatus | null =>
  snapshot.status === 'error' ? 'error' : snapshot.end?.reason === 'contact' ? 'crashed' : snapshot.end?.reason === 'time-limit' ? 'timeUp' : null;

export function labStatus(state: RobotLabState): LabStatus {
  if (state.starting) return 'starting';
  const { snapshot } = state;
  if (snapshot.status === 'idle') {
    if (!state.held) return 'idle';
    // N18 R6.3: what a check's round left says how that round ended; a run the learner stopped (a replay too) says stopped.
    return (state.round !== null && endedStatus(state.held)) || 'stopped';
  }
  const ended = endedStatus(snapshot);
  if (ended !== null) return ended;
  if (state.paused) return 'paused';
  if (state.teleop) return 'teleop';
  return snapshot.status === 'finished' ? 'finished' : 'running';
}

export type RobotRunStoreOptions = {
  requestFrame?: (callback: (now: number) => void) => number;
  cancelFrame?: (handle: number) => void;
  /** Where the page says it is hidden or shown again (document). */
  visibility?: EventTarget & { readonly hidden: boolean };
  /** N18 R4.8: what the view shows before a run with the robot placed at `pose` (scene-math's idleSnapshot of that start). */
  startView?: (pose: PlacementPose) => RobotSnapshot;
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
    /** N18 R6.3: the check whose run the view shows, its speed, and the way to stop listening to it. */
    let attached: { view: CheckRunView; speed: number; unsubscribe: () => void } | null = null;
    /** The run the view shows: an attached check's, else the lab's session. */
    const shown = (): Pick<RobotRunSession, 'getSnapshot'> => attached?.view ?? session;
    /** N18 R4.8: a teleop start is building its world (its ticket), and the robot as placed, as the view shows it before a run. */
    let teleopStarting: number | null = null;
    let placedView: RobotSnapshot | null = null;

    /** Whether the lab's own session holds a run that is over (not a check's: that one is one run to the host). */
    const sessionEnded = () => {
      const snapshot = session.getSnapshot();
      return snapshot.status !== 'idle' && isRunOver(snapshot);
    };

    // A check is driven by every frame until it detaches: it runs its rounds itself, and between two of them its run is over for a moment.
    const shouldDrive = () => (attached !== null ? true : !get().paused && !isRunOver(session.getSnapshot()));

    const drive = (now: number) => {
      driveFrame = null;
      if (!shouldDrive()) {
        lastFrameAt = null;
        return;
      }
      const wallMs = lastFrameAt === null ? 0 : Math.min(MAX_FRAME_MS, Math.max(0, now - lastFrameAt));
      lastFrameAt = now;
      const advanced = attached !== null ? attached.view.frame(wallMs, attached.speed) : session.advance(wallMs, get().speed);
      advanced.catch((error: unknown) => console.warn('The robot simulation could not advance.', error));
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
      // An attached check is one run from attach to detach (the host's run-started and run-stopped).
      const active = attached !== null || snapshot.status !== 'idle';
      // N18 R4.8: the lab's run is teleop when its snapshot says so (or a teleop start is still building, while it shows none).
      const teleop = attached === null && (snapshot.status !== 'idle' ? snapshot.teleop === true : teleopStarting !== null);
      // N18 bt-lab-fix (m1): over by itself, from the snapshot at once. A check's run is over between its rounds and is one run to the host.
      const ended = attached === null && snapshot.status !== 'idle' && isRunOver(snapshot);
      if (active !== get().active || teleop !== get().teleop || ended !== get().ended) {
        set({ active, teleop, ended });
      }
      for (const listener of [...listeners]) {
        listener(snapshot);
      }
      if (commitFrame === null) {
        commitFrame = requestFrame(() => {
          commitFrame = null;
          set({ snapshot: shown().getSnapshot() });
        });
      }
    };
    /** The session's own snapshots: not shown while a check's run is (the lab's session is stopped then). */
    const onSessionSnapshot = (snapshot: RobotRunSnapshot) => {
      if (attached === null) {
        onSnapshot(snapshot);
      }
    };

    // A hidden page gets no frames; when it is shown again the clock starts afresh instead of owing the time it was away.
    const onVisibility = () => {
      lastFrameAt = null;
    };

    /** Starts a run of `project` (Run, Step from idle, or the replay of a check's `round`), paused or not. */
    const start = async (project: ProjectDocument, paused: boolean, round: ShownRound | null = null) => {
      const ticket = ++startTicket;
      stopDriving();
      teleopStarting = null;
      set({ starting: true, startFailure: null, held: null, paused, round, resetToStart: false });
      const result = round === null ? await session.start(project) : await session.start(project, round.index, { check: true });
      if (ticket !== startTicket) {
        return false;
      }
      // The snapshot now, not a frame later: the HUD never shows the state before the start next to the controls after it.
      // A start that failed leaves the session idle: teleop is over either way (Chạy turns it off).
      set({ starting: false, startFailure: result.ok || result.reason === 'superseded' ? null : result, snapshot: session.getSnapshot(), teleop: result.ok && session.getSnapshot().teleop === true });
      if (result.ok) {
        ensureDriving();
      }
      return result.ok;
    };

    /** N18 R4.8: the robot placed at `pose` (null: the scenario's start), as the view shows it before a run. */
    const setPlacement = (pose: PlacementPose | null) => {
      placedView = pose === null || options.startView === undefined ? null : options.startView(pose);
      set({ placement: pose === null ? null : { ...pose } });
    };

    return {
      snapshot: session.getSnapshot(),
      active: session.getSnapshot().status !== 'idle',
      ended: sessionEnded(),
      starting: false,
      paused: false,
      speed: 1,
      held: null,
      startFailure: null,
      locked: false,
      round: null,
      teleop: false,
      placement: null,
      resetToStart: false,

      async run(project) {
        if (get().locked || attached !== null) {
          return;
        }
        await start(project, false);
      },

      stop() {
        if (attached !== null) {
          return;
        }
        startTicket++;
        teleopStarting = null;
        stopDriving();
        const left = session.getSnapshot();
        session.stop();
        set({ held: left.status === 'idle' ? get().held : left, paused: false, starting: false, snapshot: session.getSnapshot(), teleop: false, resetToStart: false });
      },

      togglePause() {
        if (get().locked || attached !== null || session.getSnapshot().status === 'idle') {
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
        if (get().locked || attached !== null || stepping) {
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
        if (get().locked || attached !== null) {
          return;
        }
        // N18 R4.8: with the robot placed, Đặt lại goes back to the placed pose, and the next one (nothing in between) to the scenario's start.
        // The replay of a check's round is the check's run: it starts again at the scenario's start every time.
        const replaying = get().round !== null && session.getSnapshot().status !== 'idle';
        const placed = get().placement !== null && !replaying;
        const toStart = placed && get().resetToStart;
        if (session.getSnapshot().status === 'idle') {
          if (get().held === null && toStart) {
            await session.placeRobot(null);
            setPlacement(null);
            set({ resetToStart: false, startFailure: null, round: null });
            return;
          }
          set({ held: null, startFailure: null, round: null, resetToStart: placed });
          return;
        }
        const ticket = ++startTicket;
        stopDriving();
        set({ starting: true, resetToStart: false });
        const result = toStart ? await session.placeRobot(null) : await session.resetRobot();
        if (ticket !== startTicket) {
          return;
        }
        if (toStart && result.ok) {
          setPlacement(null);
        }
        const failed = !result.ok && (result.reason === 'layer' || result.reason === 'compile' || result.reason === 'world-error' || result.reason === 'scorer-error');
        set({ starting: false, startFailure: failed ? result : null, snapshot: session.getSnapshot(), resetToStart: placed && !toStart });
        ensureDriving();
      },

      setSpeed(multiplier) {
        if (!Number.isFinite(multiplier) || multiplier <= 0) {
          throw new RangeError(`The speed must be a finite number above 0, not ${multiplier}.`);
        }
        set({ speed: multiplier });
      },

      press(role, down) {
        if (!get().locked && attached === null) {
          session.pressButton(role, down);
        }
      },

      setLocked(locked) {
        set({ locked, resetToStart: false });
      },

      attach(view, speed) {
        if (!(Number.isFinite(speed) && speed > 0)) {
          throw new RangeError(`A check is driven at a speed above 0, not ${speed}.`);
        }
        attached?.unsubscribe();
        // The lab's own run ends: the check is what the view shows now.
        startTicket++;
        stopDriving();
        session.stop();
        const unsubscribe = view.subscribe(onSnapshot);
        const mine = { view, speed, unsubscribe };
        attached = mine;
        // The round is the check's to say (`setRound`): it is told before its run has a world to show.
        set({ snapshot: view.getSnapshot(), active: true, ended: false, starting: false, paused: false, held: null, startFailure: null });
        ensureDriving();
        return (left) => {
          if (attached !== mine) {
            return;
          }
          stopDriving();
          unsubscribe();
          attached = null;
          set({ snapshot: session.getSnapshot(), active: session.getSnapshot().status !== 'idle', ended: sessionEnded(), held: left?.held ?? null, round: left?.round ?? null });
        };
      },

      setRound(round) {
        set({ round });
      },

      hold(held, round) {
        if (attached !== null) {
          return;
        }
        startTicket++;
        stopDriving();
        session.stop();
        set({ snapshot: session.getSnapshot(), held, round, paused: false, starting: false });
      },

      async replay(project, round) {
        if (get().locked || attached !== null) {
          return;
        }
        set({ speed: 1 });
        await start(project, false, round);
      },

      showFailure(failure) {
        set({ startFailure: failure });
      },

      async startTeleop() {
        const { locked, round, active } = get();
        // A replay of a check's round is the check's: teleop waits until it is over.
        if (locked || attached !== null || (round !== null && active && !isRunOver(session.getSnapshot()))) {
          return;
        }
        const ticket = ++startTicket;
        teleopStarting = ticket;
        stopDriving();
        set({ starting: true, startFailure: null, held: null, paused: false, round: null, teleop: true, resetToStart: false });
        const result = await session.startTeleop();
        if (ticket !== startTicket) {
          return;
        }
        teleopStarting = null;
        const failed = !result.ok && (result.reason === 'world-error' || result.reason === 'scorer-error');
        set({ starting: false, startFailure: failed ? result : null, snapshot: session.getSnapshot(), teleop: result.ok });
        if (result.ok) {
          ensureDriving();
        }
      },

      teleopCommand(command) {
        if (get().teleop && !get().locked && attached === null) {
          session.teleop(command);
        }
      },

      stopTeleop() {
        if (get().teleop) {
          get().stop();
        }
      },

      async placeRobot(pose) {
        if (get().locked || get().starting || attached !== null) {
          return null;
        }
        const now = session.getSnapshot();
        if (now.status !== 'idle' && !isRunOver(now)) {
          return null;
        }
        // A run that is over gives way: the robot stands where it is put, not where that run left it.
        if (now.status !== 'idle') {
          startTicket++;
          stopDriving();
          session.stop();
          set({ snapshot: session.getSnapshot(), held: null, paused: false, teleop: false });
        }
        const ticket = startTicket;
        set({ resetToStart: false });
        const result = await session.placeRobot(pose);
        // A run started meanwhile stands: what it shows is not the placed robot's.
        if (ticket === startTicket && result.ok) {
          setPlacement(pose === null ? null : result.pose);
          set({ held: null, round: null, startFailure: null });
        }
        return result;
      },

      latestWorld: () => shown().getSnapshot().world ?? get().held?.world ?? (get().locked ? null : placedView),

      onPublish(listener) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },

      preparePhysics() {
        void session.preparePhysics();
      },

      connect() {
        const unsubscribe = session.subscribe(onSessionSnapshot);
        visibility?.addEventListener('visibilitychange', onVisibility);
        return () => {
          startTicket++;
          stopDriving();
          if (commitFrame !== null) {
            cancelFrame(commitFrame);
            commitFrame = null;
          }
          unsubscribe();
          attached?.unsubscribe();
          attached = null;
          visibility?.removeEventListener('visibilitychange', onVisibility);
          session.stop();
          set({ snapshot: session.getSnapshot(), active: false, ended: false, starting: false, paused: false });
        };
      },
    };
  });
}

export type RobotRunStore = ReturnType<typeof createRobotRunStore>;
