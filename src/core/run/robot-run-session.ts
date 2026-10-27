import type { ProjectDocument } from '../circuit/document';
import type { ModuleIO } from '../capabilities/io';
import { createRunScheduler, createRuntimeServices, createSeededRandomInt, type ProgramClock, type RunScheduler, type RunWarning } from '../capabilities/services';
import type { DeviceRegistry } from '../devices/registry';
import { createProgramIO } from '../hardware/binding';
import type { BoardProfile } from '../hardware/board';
import type { KitCatalog } from '../hardware/catalog';
import { createTcs34725, TCS_STATUS_AVALID, type Rgbc, type Tcs34725 } from '../hardware/devices/tcs34725';
import type { ModuleUse } from '../hardware/drivers';
import { colorReadLastEventUs } from '../hardware/drivers/tcs34725';
import { kitKey, kitPort, portParam, type Kit } from '../hardware/kit';
import { createVirtualUno, type VirtualUno } from '../hardware/virtual-uno';
import { productionProfiles } from '../profiles';
import type { ProfileCatalog } from '../profiles/profile';
import { createBlockPackCatalog, type BlockPackCatalog } from '../program/block-packs';
import { compileUnoProject } from '../program/compile-uno-program';
import type { UnoProgramUses } from '../program/uno-uses';
import { createRunConsole, type ConsoleSnapshot, type RunConsole } from '../program/console';
import { EXEC_SLICE_MS } from '../program/limits';
import { runYbcProgram } from '../program/ybc-interpreter';
import type { YbcProgramIR } from '../program/ybc-ir';
import type { GoalContact, GoalFrame } from '../scenario/goals/frame';
import { inputsDueBetween, runEndingContact, type Scenario } from '../scenario/scenario';
import type { Arena } from '../world/arena/arena-schema';
import { isPhysicsReady, PHYSICS_DT_S, PHYSICS_HZ } from '../world/rapier';
import type { RobotSnapshot, RunStatus, ScoreState } from '../world/snapshot';
import { checkPlacement, type PlacementPose } from '../scenario/placement';
import type { ActuatorTargets } from '../world/robot/assembly';
import { createScenarioWorld, type World } from '../world/world';
import { createLightHistory, type LightHistory } from './light-history';
import { createModuleModels } from './robot-modules';
import type { RunDiagnostic } from './run-session';
import { canTeleop, createTeleopController, TELEOP_LIMIT_S, teleopUses, type TeleopCommand, type TeleopController, type TeleopEntry } from './teleop';
import { createVirtualScheduler, nextTurn, type VirtualScheduler } from './virtual-clock';

// The robot lab's run (N18 R3.6, robot plan §3, B5): the ONLY place where the learner's program, the hardware and the world meet.
//
//   interpreter ── ModuleIO ─► drivers ─► VirtualUno pins ─► module models ─► world.applyActuators
//        ▲ programClock (charged µs)            ▲ pulse / analog / digital sources ◄── world.sense (this tick's measures)
//        └── VirtualScheduler.advanceTo(world time) ◄── world.tick
//
// A run (`start(project, variantIndex)`): the project is compiled against the session's kit (compileUnoProject: L-1 first, an unknown
// kit is a diagnostic; then the board, the profile's blocks, the program and the kit's pin rules, a timer-claimed refuses the start),
// the world of the scenario's variant is built (createScenarioWorld, the variant's seed), then a virtual UNO on a virtual scheduler
// (run/virtual-clock.ts: `createVirtualScheduler({ signal, delayOverheadUs })`, one per run), whose pins read the world through
// sources (the echo of the ultrasonic, `sense.ultrasonic(role).echoUs`: cm·58, 0 without an echo, which pulseIn reads as no pulse and
// the HC-SR04 helper as 400 cm (U-27); each line sensor's digital level and ADC value, `sense.line(role)`; each button, pressed LOW).
// N19 B4: each IR obstacle sensor's level, `sense.ir(role).level`; each colour sensor, a TCS34725 register model on the I²C bus
// (hardware/devices/tcs34725.ts, at its address) whose light is the run's light history of that sensor (run/light-history.ts): the world's
// `sense.color(role).light` of tick 0 when the run is made, then of each tick at its step, so a window's counts are the ticks inside it and
// never depend on when the program reads them (the bus runs at most world.t + dt + 1124 µs ahead of the world: plan §4.7).
// The module binding runs setup(), the scorer is fed tick 0's frame, and the snapshot of t = 0 is published. The program itself starts
// in tick 0, after that tick's inputs: when the first tick is driven (at once, a frame later) never changes what it sees.
//
// One tick (dt = 1/PHYSICS_HZ), its index k = world.tick:
//   1. the button inputs due in [k·dt, (k+1)·dt): the UI's presses since the last tick, then the scenario's script (inputsDueBetween);
//      in tick 0 the program starts here, so it sees tick 0's inputs from its first statement;
//   2. `advanceTo(k * 1000 / PHYSICS_HZ)`, from the integer index, never a sum: the program runs through its part of the tick until
//      it is blocked, reading the world at tick k;
//   3. the hardware has lived through the tick's interval [t, t + dt) (see "The hardware's time" below); the module models read the
//      pins (robot-modules.ts) and set the actuator targets;
//   4. `world.step(PHYSICS_DT_S)`, and (N19 B4) the light history records the new tick's light of each colour sensor;
//   5. the scorer (R6) is fed the tick's goal frame, built from the world's bodies (`World.goalFrame`), never from a snapshot.
// A snapshot is built only to publish one: at most one per `advance` call (a frame) and one at the end of `runUntil`.
//
// Driving it:
//   - `advance(wallMs, speed)`, the realtime mode (from requestAnimationFrame): the owed virtual time grows by wallMs × speed, and a
//     frame runs the whole ticks it owes. A frame may owe one tick more than MAX_TICKS_PER_FRAME without anything lost (JITTER_TICKS:
//     at 4× a 60 Hz display asks for exactly 8 ticks a frame, and a frame that comes 0.1 ms late owes 8.05): it runs them all. A frame
//     that owes more than MAX_TICKS_PER_FRAME + JITTER_TICKS runs MAX_TICKS_PER_FRAME, drops the rest (a slow machine or a tab coming
//     back runs slower, it does not catch up); after SLOW_BADGE_FRAMES such frames in a row the snapshot says `slowerThanRealtime`, until
//     as many frames in a row fit again (N18 R6.2: one slow frame does not flash it). It is single-flight:
//     the frame starts in a microtask after the call, so every call of the same turn adds its time to it; a call while it runs adds
//     its time for the next frame and returns the one in flight. Ticks always run one after the other.
//   - `runUntil(tS)`, the headless mode: ticks until the world's time reaches tS, giving the browser a turn every EXEC_SLICE_MS of wall
//     time through a fresh MessageChannel (`VirtualScheduler.yieldNow`: never setTimeout(0), clamped and throttled in a hidden tab).
//     It waits for the frame in flight. From the call until it ends, `advance` adds no time (it returns the headless run); when it
//     ends, no time is owed and the run is not slower than real time.
//   Once the ticks have stopped (an error), `advance` adds no time and `pressButton` is ignored: nothing grows.
//   Neither the frame rate, the speed, a hidden tab nor the mode changes what happens: only the tick index does.
//
// The hardware's time. The virtual UNO times what runs by itself (a tone of `ms`, which ends on its own) on the clock it is given. The
// program clock stands still while the program waits (a `wait 2000` holds it at the start of the wait until the wait ends), so on the
// program clock alone a tone of 1000 ms followed by a wait of 2000 ms would play for 2000 ms. The UNO's clock is therefore the later
// of the program clock and the end of the last tick the program lived through ((k + 1) · dt after tick k). While the program runs a
// statement its clock is never behind that (world.t ≤ programClock, virtual-clock.ts), so what the program reads (millis) and charges
// is the program clock's, unchanged.
//
// Reentrancy, as in run-session.ts: the latest call wins. Every operation settles `current` (retiring the run it replaces: abort,
// timers, world) before it publishes, and publishing is its last step; a run that was stopped or replaced publishes nothing more, and
// every tick checks after each await and each call into foreign code (the scorer) that its run is still the current one. `start` is
// async (the world loads physics): a stop or a newer start meanwhile supersedes it, and the world it built is disposed.
//
// What ends a run: the program finishing leaves it `finished` and the world goes on (the motors keep what the pins say, as the board
// does); a program fault (`error`, with its block) and a failure of the simulation itself (a timer task that throws, which rejects
// advanceTo, the world refusing a step, a scorer that throws: `error`, `internal-error`, with a diagnostic) end the ticks: the world
// stays at that moment. A scorer that throws on tick 0 (or whose first score throws) fails the start instead (`scorer-error`).
// N18 R6.2 adds the scenario's own ends (`end` of the snapshot, `RobotRunEnd`), in every run, a check or not:
//   - the time limit: a run is the ticks up to t = timeLimitS (the first tick at or after it, when the limit is not a whole number of
//     ticks), every one judged; the next tick, which would go past it, ends the run instead (`time-limit`);
//   - the first contact with a tag of the scenario's `endOnContact` (scenario.ts `runEndingContact`): that tick is the last, its frame
//     judged (`contact`); N18 bt-lab-fix (c3): the snapshot then also holds the collider that ended it (`endContact`, its id and tags).
// Either way the program is stopped, the status is `finished`, the scorer is told (`RobotScorer.end`) and the world stays at that moment:
// nothing more is owed, pressed or ticked, as after an error.
//
// A finished run at rest (R6.2): once the program has finished and every point of the robot's outline has moved under REST_SPEED_CM_S
// for REST_HOLD_S in a row, a realtime frame publishes for the ticks alone only once the world's time has moved REST_CLOCK_S since the
// last publish (N18 R4.2 fix round 1: the HUD's clock, shown in tenths, goes on; the view draws nothing for it, since the picture is the
// same). The ticks go on, so the goals and the time limit count as they would; a frame still publishes when anything else changes (the
// status, the end, a goal's verdict or the points, the console, a diagnostic), and a headless run still publishes its last snapshot. A
// robot that moves again publishes every frame again.
//
// N18 R4.8, teleop ("Lái tay", teleop.ts): `startTeleop()` replaces any run (as `start` does: the latest call wins) with a run that has no
// program, on a new world from the start, its snapshots marked `teleop`. setup() is the drive's (TELEOP_USES); the commands of `teleop(cmd)`
// wait for the next tick, and in step 2 of that tick, in place of the program, the controller calls `drive.move` / `drive.stop` on the
// module binding: the same calls, on the same pins, as a program's first statement in that tick, so the world is the same tick for tick
// (and the log of (tick, command) replays it). The board's time there is the tick's start plus what its calls cost (the hardware's clock
// with no program, see `createRun`). The scorer judges each tick (the HUD shows it; nothing is ever sent as a check); teleop is exploration,
// never scored, so the scenario's time limit does not end it: TELEOP_LIMIT_S does (fix round 1, controller ruling), and a crash
// (`endOnContact`) still does. `resetRobot` starts a new teleop run, `start` (Chạy) replaces it, `stopTeleop` (or `stop`) ends it. Commands given while its world is built apply at tick 0; to any other run they are nothing. It is refused while a check
// run goes on (`check`) and for a kit without the drive (`no-drive`).
//
// N18 R4.8, the placed start ("Di chuyển robot"): `placeRobot(pose)` sets where every next world of the learner's runs starts (its run,
// Đặt lại robot, teleop), moved inside the arena and checked against it (scenario/placement.ts: a pose that stands in something is
// refused); null gives back the scenario's start. A run going on is started again from there (a new world, as `resetRobot`). A check's run
// always starts at the scenario's start and its variants' (robot plan §4.6): its worlds never take the placed pose, and placeRobot is refused
// while one is the session's. A start that is building its world keeps the start it began with.

/** The most ticks one `advance` runs (one frame) on a machine that keeps up: 4× speed at 60 frames per second. */
export const MAX_TICKS_PER_FRAME = 8;

/**
 * How many ticks more than MAX_TICKS_PER_FRAME a frame may owe and still run them all, with nothing dropped and no flag: the jitter of
 * requestAnimationFrame (16.5–16.9 ms frames at 60 Hz) at 4×, where a frame owes 7.9–8.1 ticks.
 */
export const JITTER_TICKS = 1;

/**
 * N18 R6.2: frames in a row that drop ticks before the snapshot says `slowerThanRealtime`, and frames in a row that fit before it stops:
 * a single slow frame (a GC pause, a tab coming back) does not flash the badge. `slowBadgeFrames` of the options sets it; 1 flags each
 * frame by itself. The badge is cleared when the run's status leaves `running` and after a headless run.
 */
export const SLOW_BADGE_FRAMES = 3;

/** N18 P2: the ticks `preparePhysics` runs its scratch world for (0.25 s), and how many a turn of the event loop. */
const PREPARE_TICKS = 30;
const PREPARE_TICKS_A_TURN = 6;
/** N18 P2: the scratch world's robot drives forward, so its wheels roll and its sensors read as in a run. */
const PREPARE_DRIVE: ActuatorTargets = { motors: { motorLeft: { duty: 200, dir: 1, brake: false }, motorRight: { duty: 200, dir: 1, brake: false } } };

/** N18 R6.2: a robot is at rest while no point of its outline moves faster than this, cm/s. */
export const REST_SPEED_CM_S = 0.5;

/** N18 R6.2: how long a finished run's robot is at rest before a frame stops publishing it, s (a whole number of ticks). */
export const REST_HOLD_S = 0.5;

/**
 * N18 R4.2 fix round 1: a run at rest still publishes once its world time has moved this far since the last publish, s (a whole number of
 * ticks): the HUD shows the time in tenths of a second, and it goes on while the robot rests.
 */
export const REST_CLOCK_S = 0.1;

/** One tick of the world, ms. */
const TICK_MS = 1000 / PHYSICS_HZ;

/** The ticks of REST_HOLD_S and REST_CLOCK_S. */
const REST_HOLD_TICKS = Math.round(REST_HOLD_S * PHYSICS_HZ);
const REST_CLOCK_TICKS = Math.round(REST_CLOCK_S * PHYSICS_HZ);

/** A time limit this close above a whole number of ticks is that tick: 12.3 s × 120 is 1476.0000000000002. */
const LIMIT_EPSILON_TICKS = 1e-6;

/** Owed time this close to a whole tick counts as one: frame times are floats (16.666… ms is two ticks of 8.333… ms). */
const OWED_EPSILON_MS = 1e-6;

/** What a run's error says: a fault of the program (its code and block) or of the simulation (`internal-error`). */
export type RobotRunError = { message: string; blockId?: string; code?: string };

/** N18 R6.2: why the scenario ended a run (see the top of this file). */
export type RobotRunEndReason = 'time-limit' | 'contact';

/** N18 R6.2: how the scenario ended a run: why, at what simulated time, and for a contact, the tag of `endOnContact` it had. */
export type RobotRunEnd = { reason: RobotRunEndReason; atS: number; tag?: string };

/** What the session publishes. Plain JSON; a new object on every publish. */
export type RobotRunSnapshot = {
  status: RunStatus;
  /** The compile warnings of the run, then the warnings it gave while it ran (each once: code, message and block). */
  diagnostics: RunDiagnostic[];
  error: RobotRunError | null;
  /** What the program printed (Serial), newest lines. */
  console: ConsoleSnapshot;
  /** The world on the latest tick with the run's part (pins, LEDs, active block, status, score); null while idle. Frozen. */
  world: RobotSnapshot | null;
  /**
   * Frames owed more than MAX_TICKS_PER_FRAME + JITTER_TICKS ticks and dropped some: the simulation runs slower than real time. Set after
   * SLOW_BADGE_FRAMES such frames in a row, cleared after as many that fit (N18 R6.2).
   */
  slowerThanRealtime: boolean;
  /** N18 R6.2: present once the scenario ended the run (its time limit or a contact); left out before and for every other state. */
  end?: RobotRunEnd;
  /**
   * N18 bt-lab-fix (c3): the collider that ended the run, when `end` is a contact: its id and every tag it has, its kind (`wall`, `box`…)
   * among them, so that the UI can say "the wall" for a wall that carries the scenario's `obstacle` tag. Left out for every other end and
   * state. It is no part of `end` (which is as it was) nor of the world (the hashes are unchanged).
   */
  endContact?: GoalContact;
  /** N18 R4.8: present (true) while the run is teleop (no program; the drive follows `teleop` commands); left out for every other run. */
  teleop?: true;
  /**
   * N19 E4/E5: the colour of each arena object that has one in the run's variant, by id: the world's own arena (`applyVariant`), what its
   * colour sensor reads, for the views to paint the round they show in its colours. The same frozen object on every publish of a run. Only
   * for a scenario whose variants recolour objects (`variants.objectColors`); left out otherwise (a rover's snapshots are as they were). It is
   * no part of the world (the hashes are unchanged).
   */
  objectColors?: Readonly<Record<string, string>>;
  /**
   * N19 final fix (G2 I1): the roles of the kit's colour sensors the run's program sets up (an op of theirs in its uses, `color.is` or
   * `color.raw`, whose setup() runs colorBegin; a teleop run's `color.is`, teleop.ts), in kit order: the views show a colour sensor's ray,
   * spot and tag line only for these (a program with no colour block never begins the sensor, which never reads). The same frozen array on
   * every publish of a run. Left out for a kit with no colour sensor (a rover's states are as they were). It is no part of the world (the
   * hashes are unchanged).
   */
  colorSensorsOn?: readonly string[];
};

export type RobotStartFailureReason =
  /** L-1 (an unknown kit), L-2 or L-3: the program was not compiled. */
  | 'layer'
  /** The program, or the kit's pin rules for what it uses (timer-claimed, pin-conflict, pin-reserved). */
  | 'compile'
  /** The world could not be built (physics did not load) or the robot not set up. */
  | 'world-error'
  /** The scorer could not be made, or failed on tick 0's frame or its first score. */
  | 'scorer-error'
  /** A stop or a newer start came while this one was building its world: the newer state stands. */
  | 'superseded'
  /** `resetRobot` without a run. */
  | 'idle';

export type RobotStartResult = { ok: true } | { ok: false; reason: RobotStartFailureReason; diagnostics: RunDiagnostic[] };

/** N18 R4.8: how `startTeleop` went: as a start, or refused while a check run goes on (`check`) or for a kit without the drive (`no-drive`). */
export type RobotTeleopResult = RobotStartResult | { ok: false; reason: 'check' | 'no-drive'; diagnostics: RunDiagnostic[] };

/**
 * N18 R4.8: how `placeRobot` went: the pose every next world of the learner's runs starts at (moved inside the arena); refused for a pose
 * that stands in something (`overlap`, the start check's issues), for one that is not finite numbers (`invalid`, fix round 1: never a
 * throw) and while a check run is the session's (`check`); or, when it started the run going on again, why that start failed.
 */
export type RobotPlaceResult =
  | { ok: true; pose: PlacementPose }
  | { ok: false; reason: 'overlap' | 'check' | 'invalid'; issues: readonly { readonly path: string; readonly message: string }[] }
  | Extract<RobotStartResult, { ok: false }>;

export type RobotStartOptions = {
  /** A check (R6.2) runs it: `pressButton` is ignored, only the scenario's inputs press buttons. */
  check?: boolean;
};

/** The score of a run, fed one goal frame per tick (R6.2 makes it; the session only feeds it and shows its score). */
export type RobotScorer = {
  /** Tick 0's frame with a tick of 0 s when the run starts, then each tick's frame after its step with PHYSICS_DT_S. */
  update(frame: GoalFrame, dtS: number): void;
  /** The score so far; the snapshot holds a copy of it. */
  score(): ScoreState;
  /** N18 R6.2: the scenario ended the run, after the last frame (its end rules apply). Once; not for a run that ends otherwise. */
  end?(end: RobotRunEnd): void;
};

/** Makes the scorer of one run (a start or a reset). `program` is the project's Blockly workspace (uses-block reads it). */
export type RobotScorerFactory = (run: { scenario: Scenario; arena: Arena; program: unknown; variantIndex: number; check: boolean }) => RobotScorer;

export type RobotRunSessionOptions = {
  scenario: Scenario;
  /** The scenario's kit: the robot the world builds and the one kit a project is compiled against. */
  kit: Kit;
  /** The kit's board profile. */
  board: BoardProfile;
  registry: DeviceRegistry;
  profiles?: ProfileCatalog;
  packs?: BlockPackCatalog;
  /** The scorer of each run; without one the score is empty (points 0, no max score, no goals). */
  scorer?: RobotScorerFactory;
  /** The wall clock the housekeeping yields look at, ms; `performance.now` by default. It never reaches the simulation. */
  wallNow?: () => number;
  /** N18 R6.2: the debounce of `slowerThanRealtime`, in frames (a whole number from 1); SLOW_BADGE_FRAMES by default. */
  slowBadgeFrames?: number;
};

export type RobotRunSession = {
  /**
   * Replaces any run with a run of `project` in variant `variantIndex` (0 by default) of the scenario. Resolves once it runs (the
   * snapshot of t = 0 is published) or with why not: a failed start leaves the session idle. Rejects only for a variant the scenario
   * does not have.
   */
  start(project: ProjectDocument, variantIndex?: number, options?: RobotStartOptions): Promise<RobotStartResult>;
  /** Ends the run and drops its state: the program, the timers, the world. */
  stop(): void;
  /** Realtime: `wallMs` of the page's time at `speed` (see the top of this file). Single-flight; adds no time during `runUntil` or once the ticks have stopped. */
  advance(wallMs: number, speed?: number): Promise<void>;
  /** Headless: ticks until the world's time is `tS` s or more (or the run ends in an error, or is stopped or replaced). */
  runUntil(tS: number): Promise<void>;
  /** A new world from the start and the program again from t = 0, the same variant and seed: the same as a fresh start. */
  resetRobot(): Promise<RobotStartResult>;
  /**
   * The UI's button (`button1`), pressed or released, from the next tick on (before the program's first statement when no tick ran yet).
   * Ignored while idle, during a check, once the ticks have stopped (an error), and for a role that is no button of the kit.
   */
  pressButton(role: string, down: boolean): void;
  /** N18 R4.8: replaces any run with a teleop run on a new world from the start (see the top of this file). */
  startTeleop(): Promise<RobotTeleopResult>;
  /**
   * N18 R4.8: a command of the teleop run, applied at its next tick (its first, while its world is built). Ignored for any other run, while
   * idle and once its ticks have stopped. Throws a RangeError for a command that is none (teleop.ts).
   */
  teleop(command: TeleopCommand): void;
  /** N18 R4.8: ends the teleop run, or the teleop start building its world; nothing for any other run. */
  stopTeleop(): void;
  /** N18 R4.8: the commands the teleop run applied, with their ticks (empty for any other run). */
  teleopLog(): readonly TeleopEntry[];
  /** N18 R4.8: where the learner's next worlds start (null: the scenario's start); a run going on starts again there. */
  placeRobot(pose: PlacementPose | null): Promise<RobotPlaceResult>;
  getSnapshot(): RobotRunSnapshot;
  subscribe(listener: (snapshot: RobotRunSnapshot) => void): () => void;
  /**
   * N18 P2: loads the physics engine and runs a scratch world of the scenario for PREPARE_TICKS, the robot driving, then drops it, a few
   * ticks a turn of the event loop: the engine's code is then compiled before the first run or check (about 250 ms of wasm on a school
   * PC, once a page). The lab calls it at idle once its view is up and it was used. It publishes nothing and touches no run; the same
   * promise every call, true when it warmed the engine. Fix round 1 (I1): nothing (false) when the engine is loaded already (a run or a
   * check of the page loaded it) or a run or a start exists; a run started while it builds its world stops it. A failure is left for the
   * first run to meet (and say).
   */
  preparePhysics(): Promise<boolean>;
};

const emptyConsole: ConsoleSnapshot = { lines: [], hidden: 0 };
const idle: RobotRunSnapshot = { status: 'idle', diagnostics: [], error: null, console: emptyConsole, world: null, slowerThanRealtime: false };
const noScore: ScoreState = { points: 0, maxScore: null, goals: [] };

/** What a start compiled, kept for `resetRobot`; a teleop run has no program (`ir` null) and sets up the drive only. */
type Prepared = { ir: YbcProgramIR | null; uses: Pick<UnoProgramUses, 'modules' | 'inputPins' | 'outputPins'>; diagnostics: RunDiagnostic[]; program: unknown };

/**
 * N19 final fix (G2 I1): the roles of `kit`'s colour sensors that `uses` sets up (an op of the role: binding.ts runs that op's setup, the
 * driver's colorBegin), in kit order, frozen; null for a kit with no colour sensor.
 */
function colorSensorsSetUp(kit: Kit, uses: readonly ModuleUse[]): readonly string[] | null {
  const sensors = kit.modules.filter((module) => module.kind === 'color-sensor');
  if (sensors.length === 0) return null;
  return Object.freeze(sensors.filter((module) => uses.some((use) => use.role === module.role)).map((module) => module.role));
}

/** What a teleop run is made from (N18 R4.8): no program, the drive's setup (N19 E3: and the gripper's, for a kit that has one), nothing for uses-block to read. */
const teleopPrepared = (kit: Kit, board: BoardProfile): Prepared => ({ ir: null, uses: teleopUses(kit, board), diagnostics: [], program: null });

type ActiveRun = {
  readonly prepared: Prepared;
  readonly variantIndex: number;
  readonly check: boolean;
  /** N18 R4.8: the teleop controller of a teleop run; null for a program's run. */
  readonly teleop: TeleopController | null;
  readonly world: World;
  readonly uno: VirtualUno;
  /** The module binding of the run's virtual UNO (the program's `modules`, teleop's drive). */
  readonly modules: ModuleIO;
  readonly scheduler: VirtualScheduler;
  readonly controller: AbortController;
  readonly timers: RunScheduler;
  readonly console: RunConsole;
  /** Made by `startScore`, before the run is published. */
  scorer: RobotScorer | undefined;
  /** The hardware has lived through tick k's interval: its clock is now at least the tick's end (see the top of this file). */
  readonly livedThrough: (k: number) => void;
  /** N19 B4: after a step, each colour sensor's light history records the world's new tick. */
  readonly recordLight: () => void;
  /** N19 B4: each colour sensor's counts of its last completed window now (none before its first), by role; empty without one. */
  readonly colorCounts: () => ReadonlyMap<string, Rgbc>;
  /** Makes the scorer, feeds it tick 0's frame and gives its first score (a copy). Throws what the scorer throws. */
  readonly startScore: () => ScoreState;
  /** Starts the program, once: in tick 0, after its inputs. */
  readonly startProgram: () => void;
  readonly unsubscribe: () => void;
  status: RunStatus;
  error: RobotRunError | null;
  activeBlockId: string | null;
  diagnostics: RunDiagnostic[];
  /** The console as last published; refreshed when the program printed since. */
  consoleSnapshot: ConsoleSnapshot;
  consoleDirty: boolean;
  /** Something the snapshot shows changed since the last publish. */
  dirty: boolean;
  /** Each button role of the kit: pressed. */
  buttons: Map<string, boolean>;
  /** The UI's presses since the last tick, in order. */
  pendingPresses: [string, boolean][];
  /** Realtime: the virtual time owed, ms. */
  owedMs: number;
  slower: boolean;
  /** Frames in a row that dropped ticks, and that fit (the badge's debounce). */
  slowFrames: number;
  fitFrames: number;
  /** Ticks ran since the last publish. */
  moved: boolean;
  /** N18 R6.2: how the scenario ended the run, once it did. */
  end: RobotRunEnd | null;
  /** N18 bt-lab-fix (c3): the collider a contact end touched (a copy), else null. */
  endContact: GoalContact | null;
  /** N19 E4/E5: the objects' colours in the run's variant (frozen, published as is), or null for a scenario whose variants recolour nothing. */
  objectColors: Readonly<Record<string, string>> | null;
  /** N19 final fix (G2 I1): the colour sensors the program sets up (frozen, published as is), or null for a kit with none. */
  colorSensorsOn: readonly string[] | null;
  /** Once the program finished: the robot's outline on the last tick, and the ticks in a row it has been at rest (see the top of this file). */
  restPoints: readonly (readonly [number, number])[] | null;
  restTicks: number;
  /** The points and the goals' verdicts the last snapshot showed, to tell a change while the robot rests. */
  publishedVerdict: string;
  /** The world's tick of the last snapshot, to publish the clock of a run at rest every REST_CLOCK_TICKS. */
  publishedTick: number;
  /** Headless runs asked for and not ended yet: while there is one, `advance` adds no time. */
  headlessRuns: number;
  /** The frame or headless run in flight, if any. */
  driving: Promise<void> | null;
};

export function createRobotRunSession(options: RobotRunSessionOptions): RobotRunSession {
  const { scenario, kit, board, registry } = options;
  const slowBadgeFrames = options.slowBadgeFrames ?? SLOW_BADGE_FRAMES;
  if (!Number.isInteger(slowBadgeFrames) || slowBadgeFrames < 1) {
    throw new RangeError(`slowBadgeFrames is a whole number of frames from 1, not ${slowBadgeFrames}.`);
  }
  if (scenario.kit !== kit.id) {
    throw new RangeError(`Scenario "${scenario.key}" runs on the kit "${scenario.kit}", not "${kit.id}".`);
  }
  if (kit.board !== board.id) {
    throw new RangeError(`Kit ${kitKey(kit)} is for the board "${kit.board}", not "${board.id}".`);
  }
  const profiles = options.profiles ?? productionProfiles;
  const packs = options.packs ?? createBlockPackCatalog(registry);
  const wallNow = options.wallNow ?? (() => performance.now());
  const kits = robotKitCatalog(kit, board);
  const models = createModuleModels(kit, board);
  const buttonRoles = new Set<string>(kit.modules.filter((module) => module.kind === 'button').map((module) => module.role));
  /** N18 R4.8: the kit has the drive, so it can be driven by hand. */
  const drivable = canTeleop(kit, board);
  /** The first tick at or after the time limit: the run is the ticks before it, and the next one would go past the limit. */
  const limitTick = Math.ceil(scenario.timeLimitS * PHYSICS_HZ - LIMIT_EPSILON_TICKS);
  /** N18 R4.8 fix round 1: a teleop run's, from TELEOP_LIMIT_S instead of the scenario's time limit. */
  const teleopLimitTick = Math.ceil(TELEOP_LIMIT_S * PHYSICS_HZ - LIMIT_EPSILON_TICKS);
  const endsOnContact = (scenario.endOnContact ?? []).length > 0;

  let snapshot = idle;
  const listeners = new Set<(snapshot: RobotRunSnapshot) => void>();
  /** The run that owns the session: from its start until stop or a replacing start, also once it finished or failed. */
  let current: ActiveRun | null = null;
  /** The start that is building its world (with its teleop controller, for a teleop start); a stop or a newer start replaces it. */
  let pendingStart: { readonly teleop: TeleopController | null } | null = null;
  /** N18 R4.8: where the learner placed the robot; null for the scenario's start. */
  let placement: PlacementPose | null = null;

  const publish = (next: RobotRunSnapshot) => {
    snapshot = next;
    // A listener may stop or start: the others then get the newest snapshot, as in run-session.ts.
    for (const listener of [...listeners]) {
      listener(snapshot);
    }
  };

  /** Ends a run: its program (the abort first), its timers, its world. Safe to repeat. Calls nothing outside the session. */
  const retire = (run: ActiveRun) => {
    run.controller.abort();
    run.timers.dispose();
    run.unsubscribe();
    run.world.dispose();
  };

  /** A warning of `run` (the program's, with its block, or the virtual UNO's), once per code, message and block (run-session.ts). */
  const addWarning = (run: ActiveRun, { code, message, blockId }: RunWarning) => {
    if (current !== run) {
      return;
    }
    const known = run.diagnostics.some((diagnostic) => diagnostic.code === code && diagnostic.message === message && (blockId === undefined || diagnostic.blockId === blockId));
    if (!known) {
      run.diagnostics.push({ severity: 'warning', code, message, ...(blockId === undefined ? {} : { blockId }) });
      run.dirty = true;
    }
  };

  /** The simulation itself failed (a timer task threw, the world refused a step): the run ends in an error, the ticks stop. */
  const failRun = (run: ActiveRun, error: unknown) => {
    run.controller.abort();
    run.timers.dispose();
    const message = `The robot simulation stopped: ${detailOf(error)}`;
    run.status = 'error';
    run.activeBlockId = null;
    run.error = { message, code: 'internal-error' };
    run.diagnostics.push({ severity: 'error', code: 'internal-error', message });
    clearBadge(run);
    run.dirty = true;
  };

  /** The run's status left `running`: the badge goes, and its debounce starts again. */
  const clearBadge = (run: ActiveRun) => {
    run.slowFrames = 0;
    run.fitFrames = 0;
    if (run.slower) {
      run.slower = false;
      run.dirty = true;
    }
  };

  /** N18 R6.2: the scenario ends the run (its time limit or a contact): the program stops, the status is finished, the scorer is told. */
  const endRun = (run: ActiveRun, end: RobotRunEnd, contact: GoalContact | null = null) => {
    run.controller.abort();
    run.timers.dispose();
    run.status = 'finished';
    run.end = end;
    run.endContact = contact === null ? null : { otherId: contact.otherId, tags: [...contact.tags] };
    run.activeBlockId = null;
    clearBadge(run);
    run.dirty = true;
    try {
      run.scorer?.end?.({ ...end });
    } catch (error) {
      if (current === run) {
        failRun(run, error);
      }
    }
  };

  /** Whether the run's ticks go on: it owns the session, and no error or end of the scenario stopped them. */
  const ticking = (run: ActiveRun) => current === run && run.status !== 'error' && run.end === null;

  /**
   * Publishes the snapshot of `run`, the current run, with `given` as its score or the scorer's. The score comes first: the scorer is
   * foreign code, which may stop the run or fail.
   */
  const publishRun = (run: ActiveRun, given?: ScoreState) => {
    let score = given ?? noScore;
    if (given === undefined && run.scorer) {
      try {
        score = structuredClone(run.scorer.score());
      } catch (error) {
        if (current === run) {
          failRun(run, error);
        }
      }
    }
    if (current !== run) {
      return;
    }
    const pins = run.uno.pins();
    if (run.consoleDirty) {
      run.consoleSnapshot = run.console.snapshot();
      run.consoleDirty = false;
    }
    const shown = run.world.snapshot();
    const counts = run.colorCounts();
    const world: RobotSnapshot = deepFreeze({
      ...shown,
      // N19 B4: what each colour sensor's program would read now (its register model's last window); the rover's sensors as they are.
      ...(counts.size === 0
        ? {}
        : {
            sensors: shown.sensors.map((sensor) => {
              const rgbc = sensor.kind === 'color-sensor' ? counts.get(sensor.role) : undefined;
              return rgbc === undefined ? sensor : { ...sensor, rgbc: { r: rgbc.r, g: rgbc.g, b: rgbc.b, c: rgbc.c } };
            }),
          }),
      pins,
      leds: models.leds(pins),
      activeBlockId: run.activeBlockId,
      status: run.status,
      score,
    });
    run.dirty = false;
    run.moved = false;
    run.publishedVerdict = verdictOf(score);
    run.publishedTick = run.world.tick;
    publish({
      status: run.status,
      diagnostics: run.diagnostics.map((diagnostic) => ({ ...diagnostic })),
      error: run.error === null ? null : { ...run.error },
      console: run.consoleSnapshot,
      world,
      slowerThanRealtime: run.slower,
      ...(run.end === null ? {} : { end: { ...run.end } }),
      ...(run.endContact === null ? {} : { endContact: { otherId: run.endContact.otherId, tags: [...run.endContact.tags] } }),
      ...(run.teleop === null ? {} : { teleop: true as const }),
      ...(run.objectColors === null ? {} : { objectColors: run.objectColors }),
      ...(run.colorSensorsOn === null ? {} : { colorSensorsOn: run.colorSensorsOn }),
    });
  };

  /**
   * Once the program has finished, whether the robot is at rest (see the top of this file): every point of its outline (and its middle)
   * moved under REST_SPEED_CM_S since the last tick, for REST_HOLD_TICKS ticks in a row. Only the view reads it: never the goals.
   */
  const trackRest = (run: ActiveRun, frame: GoalFrame) => {
    const points = outlineOf(frame);
    const previous = run.restPoints;
    run.restPoints = points;
    if (previous === null || previous.length !== points.length) {
      run.restTicks = 0;
      return;
    }
    let most = 0;
    for (let i = 0; i < points.length; i++) {
      const dx = points[i]![0] - previous[i]![0];
      const dy = points[i]![1] - previous[i]![1];
      most = Math.max(most, Math.sqrt(dx * dx + dy * dy));
    }
    run.restTicks = most / PHYSICS_DT_S < REST_SPEED_CM_S ? run.restTicks + 1 : 0;
  };

  const atRest = (run: ActiveRun) => run.status === 'finished' && run.restTicks >= REST_HOLD_TICKS;

  /**
   * Whether a realtime frame publishes, and with which score: null for no publish; undefined to publish with the scorer's score (read by
   * `publishRun`); a score, to publish with the one read here. A frame of a run at rest publishes for its clock once REST_CLOCK_TICKS have
   * gone since the last publish, and otherwise only for a change besides the ticks, the scorer's points or a goal's verdict among them;
   * the score read to tell is the one published, so a scorer that throws there is read once and fails the run once (with the empty score).
   */
  const publication = (run: ActiveRun): ScoreState | undefined | null => {
    if (run.dirty || (run.moved && !atRest(run))) {
      return undefined;
    }
    if (!run.moved) {
      return null;
    }
    if (run.world.tick - run.publishedTick >= REST_CLOCK_TICKS) {
      return undefined;
    }
    if (!run.scorer) {
      return null;
    }
    let score: ScoreState;
    try {
      score = structuredClone(run.scorer.score());
    } catch (error) {
      if (current === run) {
        failRun(run, error);
      }
      return current === run ? noScore : null;
    }
    return verdictOf(score) !== run.publishedVerdict ? score : null;
  };

  /** Applies the button inputs of tick k's interval [k·dt, (k+1)·dt): the UI's presses, then the scenario's script. */
  const applyInputs = (run: ActiveRun, k: number) => {
    for (const [role, down] of run.pendingPresses) {
      run.buttons.set(role, down);
    }
    run.pendingPresses.length = 0;
    if (scenario.inputs.length > 0) {
      for (const input of inputsDueBetween(scenario, k / PHYSICS_HZ, (k + 1) / PHYSICS_HZ)) {
        if (buttonRoles.has(input.role)) {
          run.buttons.set(input.role, input.action === 'press');
        }
      }
    }
  };

  /** One tick (see the top of this file). False when the run cannot go on: stopped, replaced, ended in an error or by the scenario. */
  const tick = async (run: ActiveRun): Promise<boolean> => {
    const k = run.world.tick;
    if (k >= (run.teleop === null ? limitTick : teleopLimitTick)) {
      endRun(run, { reason: 'time-limit', atS: run.world.t });
      return false;
    }
    applyInputs(run, k);
    if (run.teleop !== null) {
      // N18 R4.8: no program; the commands given since the last tick make their drive calls at its start, where a program's would.
      try {
        run.teleop.apply(k, run.modules);
      } catch (error) {
        if (current === run) {
          failRun(run, error);
        }
        return false;
      }
    } else {
      run.startProgram();
      try {
        await run.scheduler.advanceTo((k * 1000) / PHYSICS_HZ);
      } catch (error) {
        // A timer task that throws (a charge while the program is blocked) rejects the tick: the run fails, the loop goes on living.
        if (current === run) {
          failRun(run, error);
        }
        return false;
      }
    }
    if (!ticking(run)) {
      return false;
    }
    run.livedThrough(k);
    let frame: GoalFrame | undefined;
    try {
      const pins = run.uno.pins();
      run.world.applyActuators(models.targets(pins));
      run.world.step(PHYSICS_DT_S);
      run.recordLight();
      run.moved = true;
      // The goal frame is built when something reads it: the scorer, the scenario's end on a contact, the rest of a finished run.
      if (run.scorer || endsOnContact || run.status === 'finished') {
        frame = run.world.goalFrame({ leds: models.leds(pins), buzzerHz: models.buzzerHz(pins) });
        run.scorer?.update(frame, PHYSICS_DT_S);
      }
    } catch (error) {
      if (current === run) {
        failRun(run, error);
      }
      return false;
    }
    if (!ticking(run) || frame === undefined) {
      return ticking(run);
    }
    const tag = endsOnContact ? runEndingContact(scenario, frame.contacts) : null;
    if (tag !== null) {
      endRun(run, { reason: 'contact', atS: frame.tS, tag }, frame.contacts.find((contact) => contact.tags.includes(tag)) ?? null);
      return false;
    }
    if (run.status === 'finished') {
      trackRest(run, frame);
    }
    return true;
  };

  /**
   * One realtime frame: the whole ticks owed (see the top of this file for the jitter allowance and the drop), then one publish, unless
   * the run is finished and at rest with nothing else to show.
   */
  const frame = async (run: ActiveRun) => {
    if (ticking(run)) {
      const due = Math.floor((run.owedMs + OWED_EPSILON_MS) / TICK_MS);
      run.owedMs = Math.max(0, run.owedMs - due * TICK_MS);
      const drops = due > MAX_TICKS_PER_FRAME + JITTER_TICKS;
      run.slowFrames = drops ? run.slowFrames + 1 : 0;
      run.fitFrames = drops ? 0 : run.fitFrames + 1;
      const slower = run.slower ? run.fitFrames < slowBadgeFrames : run.slowFrames >= slowBadgeFrames;
      if (slower !== run.slower) {
        run.slower = slower;
        run.dirty = true;
      }
      // Within the allowance every owed tick runs; beyond it the frame runs its cap and the rest is dropped.
      const ticks = drops ? MAX_TICKS_PER_FRAME : due;
      for (let done = 0; done < ticks; done++) {
        if (!(await tick(run))) {
          break;
        }
      }
    }
    const shown = current === run ? publication(run) : null;
    if (current === run && shown !== null) {
      publishRun(run, shown);
    }
  };

  /** Headless: ticks until the world's time reaches `tS`, a fresh MessageChannel turn every EXEC_SLICE_MS of wall time, then one publish. */
  const headless = async (run: ActiveRun, tS: number) => {
    let sliceStart = wallNow();
    while (ticking(run) && run.world.t < tS) {
      if (!(await tick(run))) {
        break;
      }
      if (wallNow() - sliceStart >= EXEC_SLICE_MS) {
        await run.scheduler.yieldNow();
        sliceStart = wallNow();
      }
    }
    // A headless run owes nothing to real time: no time is left owed, and it is not slower than real time.
    run.owedMs = 0;
    clearBadge(run);
    if (current === run && (run.dirty || run.moved)) {
      publishRun(run);
    }
  };

  /** Runs `work` as the run's one drive in flight, after the current call returns (so `driving` is set before any of it runs). */
  const drive = (run: ActiveRun, work: () => Promise<void>): Promise<void> => {
    const driving: Promise<void> = Promise.resolve()
      .then(work)
      .finally(() => {
        if (run.driving === driving) {
          run.driving = null;
        }
      });
    run.driving = driving;
    return driving;
  };

  /** The run of a compiled program on a new world: the virtual UNO, its sources, setup(), the services. The program starts at `go`. */
  const createRun = (prepared: Prepared, world: World, variantIndex: number, check: boolean, teleop: TeleopController | null): ActiveRun => {
    const controller = new AbortController();
    const { signal } = controller;
    const scheduler = createVirtualScheduler({ signal, delayOverheadUs: board.costsUs.delayOverhead, wallNow });
    /** The end of the last tick the program lived through, ms: the hardware's time is never before it (see the top of this file). */
    let livedMs = 0;
    /**
     * N18 R4.8: with no program (teleop), the board does only what the commands say, at the start of the tick they apply in: its time is
     * that tick's start, plus what its calls cost since (µs). The scheduler's program clock, which only a running program may be charged,
     * is not used.
     */
    let boardUs = 0;
    const hardwareClock: ProgramClock =
      teleop === null
        ? {
            now: () => Math.max(scheduler.programClock.now(), livedMs),
            charge: (us) => scheduler.programClock.charge(us),
          }
        : {
            now: () => Math.max(boardUs / 1000, livedMs),
            charge(us) {
              if (!(us >= 0) || !Number.isFinite(us)) {
                throw new RangeError(`A charge is a finite number of µs, 0 or more, not ${us}.`);
              }
              boardUs = Math.max(boardUs, livedMs * 1000) + us;
            },
          };
    /** N19 B4: where the virtual UNO's bus time starts (its creation), and its cycle: a peek at the colour model uses the bus's own time. */
    const originMs = hardwareClock.now();
    const cyclesPerUs = board.clockHz / 1_000_000;
    const uno = createVirtualUno(board, hardwareClock);
    const runConsole = createRunConsole();
    const timers = createRunScheduler(scheduler.timers);
    const holder: { run?: ActiveRun } = {};
    /**
     * Whether this run owns the session. A source of a run that does not reads the neutral value: no echo, 0 on a line pin (level and
     * ADC), the button released. It is never read in practice: an aborted program throws at its next step or module op, before a read.
     */
    const live = () => holder.run !== undefined && current === holder.run;
    /** N19 B4: the light history and register model of each colour sensor of the kit (one TCS34725 at its fixed address). */
    const lightHistories: { readonly role: string; readonly history: LightHistory; readonly device: Tcs34725 }[] = [];

    for (const module of kit.modules) {
      const port = kitPort(kit, module.port);
      const { role } = module;
      if (module.kind === 'ultrasonic' && port?.pins.ECHO !== undefined) {
        uno.attachPulseSource(port.pins.ECHO, () => (live() ? world.sense.ultrasonic(role).echoUs : 0));
      } else if (module.kind === 'line-sensor' && port?.pins.PIN !== undefined) {
        uno.attachDigitalSource(port.pins.PIN, () => (live() ? world.sense.line(role).level : 0));
        uno.attachAnalogSource(port.pins.PIN, () => (live() ? world.sense.line(role).raw : 0));
      } else if (module.kind === 'button' && port?.pins.PIN !== undefined) {
        // To GND, read through the pull-up the driver sets (U-30): pressed is LOW, released HIGH.
        uno.attachDigitalSource(port.pins.PIN, () => (live() && holder.run?.buttons.get(role) === true ? 0 : 1));
      } else if (module.kind === 'ir-obstacle' && port?.pins.PIN !== undefined) {
        // N19 B4: the comparator's output; a run that does not own the session reads nothing seen (ir-digital: active low unless the kit says not).
        const idle = portParam(port, 'activeLow') === false ? 0 : 1;
        uno.attachDigitalSource(port.pins.PIN, () => (live() ? world.sense.ir(role).level : idle));
      } else if (module.kind === 'color-sensor' && port !== undefined) {
        const history = createLightHistory();
        history.record(world.tick, world.sense.color(role).light);
        const device = createTcs34725(history.integral);
        lightHistories.push({ role, history, device });
        uno.attachWireDevice(device.address, device);
      }
    }
    // setup(): the module ops the program uses, then its raw pins (hardware/binding.ts).
    const io = createProgramIO(kit, uno, prepared.uses);
    const services = createRuntimeServices({
      signal,
      console: {
        write(line) {
          runConsole.write(line);
          const run = holder.run;
          if (run) {
            run.consoleDirty = true;
            run.dirty = true;
          }
        },
      },
      clock: scheduler.programClock,
      sleep: scheduler.sleep,
      scheduler: timers,
      budget: scheduler.budget(signal),
      randomInt: createSeededRandomInt(world.variant?.seed ?? 0),
      warn: (warning) => {
        if (holder.run) {
          addWarning(holder.run, warning);
        }
      },
      trace: (blockId) => {
        if (holder.run) {
          holder.run.activeBlockId = blockId;
        }
      },
    });
    const unsubscribe = uno.onDiagnostic((diagnostic) => {
      if (holder.run) {
        addWarning(holder.run, { code: diagnostic.code, message: diagnostic.message });
      }
    });
    let started = false;
    const run: ActiveRun = {
      prepared,
      variantIndex,
      check,
      teleop,
      world,
      uno,
      modules: io.modules,
      scheduler,
      controller,
      timers,
      console: runConsole,
      scorer: undefined,
      unsubscribe,
      livedThrough(k) {
        livedMs = ((k + 1) * 1000) / PHYSICS_HZ;
      },
      recordLight() {
        for (const { role, history } of lightHistories) history.record(world.tick, world.sense.color(role).light);
      },
      colorCounts() {
        const counts = new Map<string, Rgbc>();
        if (lightHistories.length === 0) return counts;
        // The bus's time now, as the virtual UNO stamps its events (whole cycles since its creation), but never past the farthest a colour
        // read's bus runs ahead of the world (world.t + dt + colorReadLastEventUs, plan §4.7): the program may be far ahead of the world
        // (setup() charges its 58 ms of delays in tick 0 and the program parks until tick 7), and a window the model closed that early would
        // read ticks not measured yet. Every bus event comes before both, so the model still only runs forward, every window it closes is
        // decided by the history (light-history.ts), and peeking changes nothing the program reads.
        const busUs = Math.round((hardwareClock.now() - originMs) * 1000 * cyclesPerUs) / cyclesPerUs;
        const leadUs = ((world.tick + 1) * 1_000_000) / PHYSICS_HZ + colorReadLastEventUs(uno.io);
        for (const { role, device } of lightHistories) {
          const registers = device.peek(Math.min(busUs, leadUs));
          if ((registers.status & TCS_STATUS_AVALID) !== 0) counts.set(role, registers.data);
        }
        return counts;
      },
      startScore() {
        const scorer = options.scorer?.({ scenario, arena: world.arena, program: prepared.program, variantIndex, check });
        run.scorer = scorer;
        if (!scorer) {
          return noScore;
        }
        // Tick 0 for the goals: the world at t = 0 with the pins setup() left.
        const pins = uno.pins();
        scorer.update(world.goalFrame({ leds: models.leds(pins), buzzerHz: models.buzzerHz(pins) }), 0);
        return structuredClone(scorer.score());
      },
      startProgram() {
        if (started || prepared.ir === null) {
          return;
        }
        started = true;
        const { done } = runYbcProgram(prepared.ir, io, services);
        void done.then((outcome) => {
          // A stopped or replaced run, or one the simulation already failed or the scenario ended, changes nothing more.
          if (current !== run || run.status === 'error' || run.end !== null) {
            return;
          }
          if (outcome.status === 'finished') {
            run.status = 'finished';
          } else if (outcome.status === 'error') {
            run.status = 'error';
            run.error = { message: outcome.message, ...(outcome.blockId === undefined ? {} : { blockId: outcome.blockId }), code: outcome.code };
            timers.dispose();
          } else {
            return;
          }
          run.activeBlockId = null;
          clearBadge(run);
          run.dirty = true;
        });
      },
      status: 'running',
      error: null,
      activeBlockId: null,
      diagnostics: [...prepared.diagnostics],
      consoleSnapshot: emptyConsole,
      consoleDirty: false,
      dirty: true,
      buttons: new Map([...buttonRoles].map((role) => [role, false])),
      pendingPresses: [],
      owedMs: 0,
      slower: false,
      slowFrames: 0,
      fitFrames: 0,
      moved: false,
      end: null,
      endContact: null,
      objectColors:
        scenario.variants.objectColors === undefined
          ? null
          : Object.freeze(Object.fromEntries(world.arena.objects.flatMap((object) => (object.color === undefined ? [] : [[object.id, object.color] as const])))),
      colorSensorsOn: colorSensorsSetUp(kit, prepared.uses.modules),
      restPoints: null,
      restTicks: 0,
      publishedVerdict: '',
      publishedTick: 0,
      headlessRuns: 0,
      driving: null,
    };
    holder.run = run;
    return run;
  };

  /** A start that failed after any current run was retired: the session is idle, and says so if it showed something else. */
  const failStart = (reason: RobotStartFailureReason, diagnostics: RunDiagnostic[]): RobotStartResult => {
    if (snapshot !== idle) {
      publish(idle);
    }
    return { ok: false, reason, diagnostics };
  };

  const superseded: RobotStartResult = { ok: false, reason: 'superseded', diagnostics: [] };

  /**
   * Replaces the current run with a run of `prepared` on a new world of the variant (start, resetRobot, startTeleop and placeRobot); a
   * teleop run with `teleop`, its controller. The learner's runs start where the robot was placed; a check's never do.
   */
  const launch = async (prepared: Prepared, variantIndex: number, check: boolean, teleop: TeleopController | null = null): Promise<RobotStartResult> => {
    const ticket = { teleop };
    pendingStart = ticket;
    // The run this one replaces ends now, without an idle snapshot in between.
    const replaced = current;
    current = null;
    if (replaced) {
      retire(replaced);
    }
    const from = check || placement === null ? scenario : { ...scenario, start: placement };
    let world: World;
    try {
      world = await createScenarioWorld(from, kit, variantIndex);
    } catch (error) {
      if (pendingStart !== ticket) {
        return superseded;
      }
      pendingStart = null;
      return failStart('world-error', [{ severity: 'error', code: 'internal-error', message: `The robot world could not be built: ${detailOf(error)}` }]);
    }
    if (pendingStart !== ticket) {
      world.dispose();
      return superseded;
    }
    let run: ActiveRun;
    try {
      run = createRun(prepared, world, variantIndex, check, teleop);
    } catch (error) {
      pendingStart = null;
      world.dispose();
      return failStart('world-error', [{ severity: 'error', code: 'internal-error', message: `The robot could not be set up: ${detailOf(error)}` }]);
    }
    let score: ScoreState;
    try {
      score = run.startScore();
    } catch (error) {
      retire(run);
      if (pendingStart !== ticket) {
        return superseded;
      }
      pendingStart = null;
      return failStart('scorer-error', [{ severity: 'error', code: 'internal-error', message: `The run's scorer failed: ${detailOf(error)}` }]);
    }
    // The scorer is foreign code: a stop or a start it made supersedes this one.
    if (pendingStart !== ticket) {
      retire(run);
      return superseded;
    }
    pendingStart = null;
    current = run;
    publishRun(run, score);
    return { ok: true };
  };

  const stop = () => {
    pendingStart = null;
    const retiring = current;
    current = null;
    if (retiring) {
      retire(retiring);
    }
    if (snapshot !== idle) {
      publish(idle);
    }
  };

  const start = async (project: ProjectDocument, variantIndex = 0, startOptions: RobotStartOptions = {}): Promise<RobotStartResult> => {
    if (!Number.isInteger(variantIndex) || variantIndex < 0 || variantIndex >= scenario.variants.count) {
      throw new RangeError(`Scenario "${scenario.key}" has variants 0..${scenario.variants.count - 1}, not ${variantIndex}.`);
    }
    const compiled = compileUnoProject(project, { registry, profiles, packs, kits });
    if (!compiled.ok) {
      stop();
      return { ok: false, reason: compiled.reason, diagnostics: compiled.diagnostics.map(toRunDiagnostic) };
    }
    const prepared: Prepared = { ir: compiled.ir, uses: compiled.uses, diagnostics: compiled.diagnostics.map(toRunDiagnostic), program: project.program.blocks };
    return launch(prepared, variantIndex, startOptions.check === true);
  };

  let preparing: Promise<boolean> | null = null;
  /** A run, or a start building its world: the scratch world would only add to their work. */
  const running = () => current !== null || pendingStart !== null;
  const preparePhysics = (): Promise<boolean> => {
    preparing ??= (async () => {
      if (isPhysicsReady() || running()) return false;
      const world = await createScenarioWorld(scenario, kit, 0);
      try {
        world.applyActuators(PREPARE_DRIVE);
        for (let tick = 0; tick < PREPARE_TICKS; tick++) {
          if (tick % PREPARE_TICKS_A_TURN === 0) await nextTurn();
          if (running()) return false;
          world.step(PHYSICS_DT_S);
        }
        world.snapshot();
        world.goalFrame({ leds: {}, buzzerHz: null });
        return true;
      } finally {
        world.dispose();
      }
    })().catch(() => false);
    return preparing;
  };

  return {
    start,
    stop,
    preparePhysics,
    advance(wallMs, speed = 1) {
      if (!(Number.isFinite(wallMs) && wallMs >= 0) || !(Number.isFinite(speed) && speed > 0)) {
        throw new RangeError(`advance takes a time of 0 ms or more and a speed above 0, not ${wallMs} ms at ${speed}×.`);
      }
      const run = current;
      if (!run) {
        return Promise.resolve();
      }
      if (ticking(run) && run.headlessRuns === 0) {
        run.owedMs += wallMs * speed;
      }
      return run.driving ?? drive(run, () => frame(run));
    },
    runUntil(tS) {
      if (!Number.isFinite(tS)) {
        throw new RangeError(`runUntil takes a finite time in s, not ${tS}.`);
      }
      const run = current;
      if (!run) {
        return Promise.resolve();
      }
      const previous = run.driving;
      run.headlessRuns += 1;
      return drive(run, async () => {
        try {
          if (previous) {
            await previous;
          }
          await headless(run, tS);
        } finally {
          run.headlessRuns -= 1;
        }
      });
    },
    async resetRobot() {
      const run = current;
      if (!run) {
        return { ok: false, reason: 'idle', diagnostics: [] };
      }
      return launch(run.prepared, run.variantIndex, run.check, run.teleop === null ? null : createTeleopController());
    },
    pressButton(role, down) {
      const run = current;
      if (!run || !ticking(run) || run.check || !buttonRoles.has(role) || typeof down !== 'boolean') {
        return;
      }
      run.pendingPresses.push([role, down]);
    },
    async startTeleop() {
      if (!drivable) {
        return { ok: false, reason: 'no-drive', diagnostics: [] };
      }
      if (current !== null && current.check && ticking(current)) {
        return { ok: false, reason: 'check', diagnostics: [] };
      }
      return launch(teleopPrepared(kit, board), 0, false, createTeleopController());
    },
    teleop(command) {
      const run = current;
      // The teleop run's while its ticks go on; while a teleop start builds its world, that one's (for its tick 0).
      const controller = run !== null ? (ticking(run) ? run.teleop : null) : (pendingStart?.teleop ?? null);
      controller?.push(command);
    },
    stopTeleop() {
      if (current !== null ? current.teleop !== null : (pendingStart?.teleop ?? null) !== null) {
        stop();
      }
    },
    teleopLog: () => current?.teleop?.log() ?? Object.freeze([]),
    async placeRobot(pose) {
      if (current !== null && current.check) {
        return { ok: false, reason: 'check', issues: [] };
      }
      let next: PlacementPose | null = null;
      if (pose !== null) {
        if (!Number.isFinite(pose.xCm) || !Number.isFinite(pose.yCm) || !Number.isFinite(pose.yawDeg)) {
          return { ok: false, reason: 'invalid', issues: [] };
        }
        const placed = checkPlacement(scenario.arena, kit, pose);
        if (placed.issues.length > 0) {
          return { ok: false, reason: 'overlap', issues: placed.issues.map((issue) => ({ ...issue })) };
        }
        next = placed.pose;
      }
      placement = next;
      const shown: PlacementPose = { ...(next ?? scenario.start) };
      const run = current;
      if (run === null) {
        return { ok: true, pose: shown };
      }
      const restarted = await launch(run.prepared, run.variantIndex, run.check, run.teleop === null ? null : createTeleopController());
      return restarted.ok ? { ok: true, pose: shown } : restarted;
    },
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/**
 * The kits a robot lab compiles a project against: its own kit only. Another kit, even one the app knows, is not the robot this lab has
 * (L-1 unknown-kit). The session's compile and the check's (R6.2, for the program's hash) use it.
 */
export function robotKitCatalog(kit: Kit, board: BoardProfile): KitCatalog {
  return {
    get: (ref) => (kitKey(ref) === kitKey(kit) ? kit : undefined),
    boardOf: (ref) => (kitKey(ref) === kitKey(kit) ? board : undefined),
    refs: () => [{ id: kit.id, version: kit.version }],
  };
}

/** What an error says, for a diagnostic. */
const detailOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** What a snapshot shows of a score that the ticks alone do not change: the points and each goal's verdict and reason. */
const verdictOf = (score: ScoreState): string =>
  `${score.points}|${score.goals.map((goal) => `${goal.id}:${goal.passed ? 1 : 0}:${goal.reasonKey ?? ''}`).join(',')}`;

/** The points of the robot on the floor whose speeds tell whether it is at rest: its middle and its outline (the goal frame's footprint). */
function outlineOf(frame: GoalFrame): readonly (readonly [number, number])[] {
  const { robot } = frame;
  const middle = [robot.xCm, robot.yCm] as const;
  if (robot.footprint.kind === 'polygon') {
    return [middle, ...robot.footprint.pointsCm];
  }
  // A round footprint: its middle and the point of its rim ahead, which a turn moves.
  const yawRad = (robot.yawDeg * Math.PI) / 180;
  return [middle, [robot.xCm + robot.footprint.radiusCm * Math.cos(yawRad), robot.yCm + robot.footprint.radiusCm * Math.sin(yawRad)] as const];
}

/** A diagnostic of the compile or the validity layers as the run reports it (its code, severity, message and block). */
export function toRunDiagnostic(diagnostic: { severity: 'error' | 'warning'; code: string; message: string; blockId?: string }): RunDiagnostic {
  return {
    severity: diagnostic.severity,
    code: diagnostic.code,
    message: diagnostic.message,
    ...(diagnostic.blockId === undefined ? {} : { blockId: diagnostic.blockId }),
  };
}

/** Freezes a JSON value and everything in it that is not frozen yet; returns it. */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const item of Object.values(value)) {
      deepFreeze(item);
    }
  }
  return value;
}
