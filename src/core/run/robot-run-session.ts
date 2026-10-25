import type { ProjectDocument } from '../circuit/document';
import { createRunScheduler, createRuntimeServices, createSeededRandomInt, type ProgramClock, type RunScheduler, type RunWarning } from '../capabilities/services';
import type { DeviceRegistry } from '../devices/registry';
import { createProgramIO } from '../hardware/binding';
import type { BoardProfile } from '../hardware/board';
import type { KitCatalog } from '../hardware/catalog';
import { kitKey, kitPort, type Kit } from '../hardware/kit';
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
import type { GoalFrame } from '../scenario/goals/frame';
import { inputsDueBetween, type Scenario } from '../scenario/scenario';
import type { Arena } from '../world/arena/arena-schema';
import { PHYSICS_DT_S, PHYSICS_HZ } from '../world/rapier';
import type { RobotSnapshot, RunStatus, ScoreState } from '../world/snapshot';
import { createScenarioWorld, type World } from '../world/world';
import { createModuleModels } from './robot-modules';
import type { RunDiagnostic } from './run-session';
import { createVirtualScheduler, type VirtualScheduler } from './virtual-clock';

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
//   4. `world.step(PHYSICS_DT_S)`;
//   5. the scorer (R6) is fed the tick's goal frame, built from the world's bodies (`World.goalFrame`), never from a snapshot.
// A snapshot is built only to publish one: at most one per `advance` call (a frame) and one at the end of `runUntil`.
//
// Driving it:
//   - `advance(wallMs, speed)`, the realtime mode (from requestAnimationFrame): the owed virtual time grows by wallMs × speed, and a
//     frame runs the whole ticks it owes. A frame may owe one tick more than MAX_TICKS_PER_FRAME without anything lost (JITTER_TICKS:
//     at 4× a 60 Hz display asks for exactly 8 ticks a frame, and a frame that comes 0.1 ms late owes 8.05): it runs them all. A frame
//     that owes more than MAX_TICKS_PER_FRAME + JITTER_TICKS runs MAX_TICKS_PER_FRAME, drops the rest (a slow machine or a tab coming
//     back runs slower, it does not catch up) and the snapshot says `slowerThanRealtime` until a frame fits again. It is single-flight:
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

/** The most ticks one `advance` runs (one frame) on a machine that keeps up: 4× speed at 60 frames per second. */
export const MAX_TICKS_PER_FRAME = 8;

/**
 * How many ticks more than MAX_TICKS_PER_FRAME a frame may owe and still run them all, with nothing dropped and no flag: the jitter of
 * requestAnimationFrame (16.5–16.9 ms frames at 60 Hz) at 4×, where a frame owes 7.9–8.1 ticks.
 */
export const JITTER_TICKS = 1;

/** One tick of the world, ms. */
const TICK_MS = 1000 / PHYSICS_HZ;

/** Owed time this close to a whole tick counts as one: frame times are floats (16.666… ms is two ticks of 8.333… ms). */
const OWED_EPSILON_MS = 1e-6;

/** What a run's error says: a fault of the program (its code and block) or of the simulation (`internal-error`). */
export type RobotRunError = { message: string; blockId?: string; code?: string };

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
  /** The last frame owed more than MAX_TICKS_PER_FRAME + JITTER_TICKS ticks and dropped some: the simulation runs slower than real time. */
  slowerThanRealtime: boolean;
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
  getSnapshot(): RobotRunSnapshot;
  subscribe(listener: (snapshot: RobotRunSnapshot) => void): () => void;
};

const emptyConsole: ConsoleSnapshot = { lines: [], hidden: 0 };
const idle: RobotRunSnapshot = { status: 'idle', diagnostics: [], error: null, console: emptyConsole, world: null, slowerThanRealtime: false };
const noScore: ScoreState = { points: 0, maxScore: null, goals: [] };

/** What a start compiled, kept for `resetRobot`. */
type Prepared = { ir: YbcProgramIR; uses: UnoProgramUses; diagnostics: RunDiagnostic[]; program: unknown };

type ActiveRun = {
  readonly prepared: Prepared;
  readonly variantIndex: number;
  readonly check: boolean;
  readonly world: World;
  readonly uno: VirtualUno;
  readonly scheduler: VirtualScheduler;
  readonly controller: AbortController;
  readonly timers: RunScheduler;
  readonly console: RunConsole;
  /** Made by `startScore`, before the run is published. */
  scorer: RobotScorer | undefined;
  /** The hardware has lived through tick k's interval: its clock is now at least the tick's end (see the top of this file). */
  readonly livedThrough: (k: number) => void;
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
  /** Headless runs asked for and not ended yet: while there is one, `advance` adds no time. */
  headlessRuns: number;
  /** The frame or headless run in flight, if any. */
  driving: Promise<void> | null;
};

export function createRobotRunSession(options: RobotRunSessionOptions): RobotRunSession {
  const { scenario, kit, board, registry } = options;
  if (scenario.kit !== kit.id) {
    throw new RangeError(`Scenario "${scenario.key}" runs on the kit "${scenario.kit}", not "${kit.id}".`);
  }
  if (kit.board !== board.id) {
    throw new RangeError(`Kit ${kitKey(kit)} is for the board "${kit.board}", not "${board.id}".`);
  }
  const profiles = options.profiles ?? productionProfiles;
  const packs = options.packs ?? createBlockPackCatalog(registry);
  const wallNow = options.wallNow ?? (() => performance.now());
  // A project is compiled against this lab's kit only: another kit, even one the app knows, is not one this robot is (L-1 unknown-kit).
  const kits: KitCatalog = {
    get: (ref) => (kitKey(ref) === kitKey(kit) ? kit : undefined),
    boardOf: (ref) => (kitKey(ref) === kitKey(kit) ? board : undefined),
    refs: () => [{ id: kit.id, version: kit.version }],
  };
  const models = createModuleModels(kit, board);
  const buttonRoles = new Set<string>(kit.modules.filter((module) => module.kind === 'button').map((module) => module.role));

  let snapshot = idle;
  const listeners = new Set<(snapshot: RobotRunSnapshot) => void>();
  /** The run that owns the session: from its start until stop or a replacing start, also once it finished or failed. */
  let current: ActiveRun | null = null;
  /** The start that is building its world; a stop or a newer start replaces it. */
  let pendingStart: object | null = null;

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
    run.dirty = true;
  };

  const ticking = (run: ActiveRun) => current === run && run.status !== 'error';

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
    const world: RobotSnapshot = deepFreeze({
      ...run.world.snapshot(),
      pins,
      leds: models.leds(pins),
      activeBlockId: run.activeBlockId,
      status: run.status,
      score,
    });
    run.dirty = false;
    publish({
      status: run.status,
      diagnostics: run.diagnostics.map((diagnostic) => ({ ...diagnostic })),
      error: run.error === null ? null : { ...run.error },
      console: run.consoleSnapshot,
      world,
      slowerThanRealtime: run.slower,
    });
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

  /** One tick (see the top of this file). False when the run cannot go on: stopped, replaced, or ended in an error. */
  const tick = async (run: ActiveRun): Promise<boolean> => {
    const k = run.world.tick;
    applyInputs(run, k);
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
    if (!ticking(run)) {
      return false;
    }
    run.livedThrough(k);
    try {
      const pins = run.uno.pins();
      run.world.applyActuators(models.targets(pins));
      run.world.step(PHYSICS_DT_S);
      run.dirty = true;
      run.scorer?.update(run.world.goalFrame({ leds: models.leds(pins), buzzerHz: models.buzzerHz(pins) }), PHYSICS_DT_S);
    } catch (error) {
      if (current === run) {
        failRun(run, error);
      }
      return false;
    }
    return current === run;
  };

  /** One realtime frame: the whole ticks owed (see the top of this file for the jitter allowance and the drop), then one publish. */
  const frame = async (run: ActiveRun) => {
    if (ticking(run)) {
      const due = Math.floor((run.owedMs + OWED_EPSILON_MS) / TICK_MS);
      run.owedMs = Math.max(0, run.owedMs - due * TICK_MS);
      const slower = due > MAX_TICKS_PER_FRAME + JITTER_TICKS;
      if (slower !== run.slower) {
        run.slower = slower;
        run.dirty = true;
      }
      // Within the allowance every owed tick runs; beyond it the frame runs its cap and the rest is dropped.
      const ticks = slower ? MAX_TICKS_PER_FRAME : due;
      for (let done = 0; done < ticks; done++) {
        if (!(await tick(run))) {
          break;
        }
      }
    }
    if (current === run && run.dirty) {
      publishRun(run);
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
    if (run.slower) {
      run.slower = false;
      run.dirty = true;
    }
    if (current === run && run.dirty) {
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
  const createRun = (prepared: Prepared, world: World, variantIndex: number, check: boolean): ActiveRun => {
    const controller = new AbortController();
    const { signal } = controller;
    const scheduler = createVirtualScheduler({ signal, delayOverheadUs: board.costsUs.delayOverhead, wallNow });
    /** The end of the last tick the program lived through, ms: the hardware's time is never before it (see the top of this file). */
    let livedMs = 0;
    const hardwareClock: ProgramClock = {
      now: () => Math.max(scheduler.programClock.now(), livedMs),
      charge: (us) => scheduler.programClock.charge(us),
    };
    const uno = createVirtualUno(board, hardwareClock);
    const runConsole = createRunConsole();
    const timers = createRunScheduler(scheduler.timers);
    const holder: { run?: ActiveRun } = {};
    /**
     * Whether this run owns the session. A source of a run that does not reads the neutral value: no echo, 0 on a line pin (level and
     * ADC), the button released. It is never read in practice: an aborted program throws at its next step or module op, before a read.
     */
    const live = () => holder.run !== undefined && current === holder.run;

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
      world,
      uno,
      scheduler,
      controller,
      timers,
      console: runConsole,
      scorer: undefined,
      unsubscribe,
      livedThrough(k) {
        livedMs = ((k + 1) * 1000) / PHYSICS_HZ;
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
        if (started) {
          return;
        }
        started = true;
        const { done } = runYbcProgram(prepared.ir, io, services);
        void done.then((outcome) => {
          // A stopped or replaced run, or one the simulation already failed, changes nothing more.
          if (current !== run || run.status === 'error') {
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

  /** Replaces the current run with a run of `prepared` on a new world of the variant (start and resetRobot). */
  const launch = async (prepared: Prepared, variantIndex: number, check: boolean): Promise<RobotStartResult> => {
    const ticket = {};
    pendingStart = ticket;
    // The run this one replaces ends now, without an idle snapshot in between.
    const replaced = current;
    current = null;
    if (replaced) {
      retire(replaced);
    }
    let world: World;
    try {
      world = await createScenarioWorld(scenario, kit, variantIndex);
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
      run = createRun(prepared, world, variantIndex, check);
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

  return {
    start,
    stop,
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
      return launch(run.prepared, run.variantIndex, run.check);
    },
    pressButton(role, down) {
      const run = current;
      if (!run || !ticking(run) || run.check || !buttonRoles.has(role) || typeof down !== 'boolean') {
        return;
      }
      run.pendingPresses.push([role, down]);
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

/** What an error says, for a diagnostic. */
const detailOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** A diagnostic of the compile or the validity layers as the run reports it (its code, severity, message and block). */
function toRunDiagnostic(diagnostic: { severity: 'error' | 'warning'; code: string; message: string; blockId?: string }): RunDiagnostic {
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
