import type { Circuit, ComponentInstance, ProjectDocument } from '../circuit/document';
import { composeCapabilities } from '../capabilities/compose';
import type { Capabilities } from '../capabilities/io';
import { createRuntimeServices, type RunScheduler, type RuntimeServices } from '../capabilities/services';
import type { DeviceRegistry } from '../devices/registry';
import { resolveBoardContext, type BoardContext } from '../profiles/board-context';
import { productionProfiles } from '../profiles';
import type { ProfileCatalog } from '../profiles/profile';
import { checkBoardReadiness, checkProfileBlocks, type LayerDiagnostic } from '../profiles/validity';
import { createBlockPackCatalog, type BlockPackCatalog } from '../program/block-packs';
import { exceedsBlockLimit } from '../program/block-walk';
import { compileProgram } from '../program/compile-program';
import { compileYbcProgram } from '../program/compile-ybc-program';
import { createRunConsole, type ConsoleSnapshot, type RunConsole } from '../program/console';
import { MAX_PROGRAM_BLOCKS } from '../program/limits';
import { runProgram, timerSleep, type HardwareIO, type ProgramRun } from '../program/interpreter';
import { runYbcProgram } from '../program/ybc-interpreter';
import type { YbcProgramIR } from '../program/ybc-ir';
import {
  inputKindOfModel,
  isComponentInput,
  isContact,
  simulateCircuit,
  splitPeripheralComponentId,
  type ComponentInput,
  type SimulationResult,
} from '../simulation/simulate-circuit';

// The only place that connects a program to the simulation (plan §5.1 B5,
// §6.4). Runtime state lives here and in the snapshots; the project document
// is only read (B2).

export type RunStatus = 'idle' | 'running' | 'finished' | 'error';

/**
 * What the compilers and the validity layers report. Both dialects' compile
 * diagnostics fit it: the legacy `Diagnostic` and the YBC one are structurally
 * this, only their `code` sets differ.
 */
export type RunDiagnostic = {
  severity: 'error' | 'warning';
  code: string;
  message: string;
  blockId?: string;
};

export type StartFailureReason = 'no-board' | 'multiple-boards' | 'incompatible-devices' | 'compile-error';

/** Plain JSON; a new object on every change. */
export type RunSnapshot = {
  status: RunStatus;
  /** Compile warnings of the current run. */
  diagnostics: RunDiagnostic[];
  error: { message: string; blockId?: string; /** A YBC fault's diagnostic code. */ code?: string } | null;
  /** null while idle; otherwise the powered board and the pins written so far. */
  simulation: SimulationResult | null;
  /** Yolo:Bit-compatible runs only (generic snapshots have no such key): what the program printed, newest lines. */
  console?: ConsoleSnapshot;
};

export type StartResult =
  | { ok: true }
  | { ok: false; reason: StartFailureReason; diagnostics: RunDiagnostic[] };

export type RunSession = {
  /** Replaces any current run. A failed start stops it and leaves the session idle. */
  start(project: ProjectDocument): StartResult;
  /** Ends the run and drops all runtime state (E5). */
  stop(): void;
  /**
   * Holds a contact of the running circuit (a push button) closed, or lets it
   * open, then simulates again (plan §6.4 step 6). Like the pins, this is
   * runtime state of the run, dropped with it. Ignored while idle, for a
   * component that is not a contact of the run, and when nothing changes.
   */
  setContactInput(componentId: string, closed: boolean): void;
  /**
   * The general runtime input (plan §11.3, YB-CP): a contact of the circuit takes `hold` (this is
   * `setContactInput`); an onboard part of a Yolo:Bit-compatible board, addressed `<board>/<peripheral>`,
   * takes the input of its model (button: hold, light and temperature sensor: slider, accelerometer: tilt).
   * Ignored while idle, for a component or a part of another run, for the wrong kind of input, and when
   * nothing changes. Like every input it is state of the run, dropped with it (B2).
   */
  setComponentInput(componentId: string, input: ComponentInput): void;
  getSnapshot(): RunSnapshot;
  subscribe(listener: (snapshot: RunSnapshot) => void): () => void;
};

const idle: RunSnapshot = { status: 'idle', diagnostics: [], error: null, simulation: null };

/** A run and the runtime inputs of its simulation; all of it goes when the run does (B2). */
type ActiveRun = {
  program: ProgramRun;
  /** Documents are never mutated, so keeping the circuit is the snapshot of it. */
  circuit: Circuit;
  /** Levels the program wrote, by pin name. */
  pinOutputs: Record<string, 0 | 1>;
  /** Contacts held closed, by component id. */
  contacts: Record<string, boolean>;
  /** The latest simulation of these inputs: what `digitalRead` reads. */
  simulation: SimulationResult | null;
  /** YBC runs only; runtime state, dropped with the run (B2). */
  console?: RunConsole;
  /** YBC runs only: the timers of this run, cancelled when it ends (YB-CP, plan §10). */
  scheduler?: RunScheduler;
  /** YBC runs only: what the board offers to this run, composed from the board's capabilities (YB-CP). */
  capabilities?: Capabilities;
  /** YBC runs only: the board and its onboard parts, for `setComponentInput`. */
  board?: { id: string; onboard: readonly { id: string; model: string }[] };
  /** Inputs of onboard parts, by `<board>/<peripheral>`. */
  inputs: Record<string, ComponentInput>;
};

// Listeners may call start or stop synchronously; the latest call wins. That
// holds because every operation settles `current` (aborting the run it
// replaces) before it publishes, and publishing is always its last step.

/**
 * The catalogs default to the production ones. Tests inject their own to
 * exercise the profile mechanism with fixtures (YB plan §8.7).
 */
export type RunSessionOptions = {
  profiles?: ProfileCatalog;
  packs?: BlockPackCatalog;
  /** Block types the YBC compiler turns into a no-op: only the test-only marker of the profile fixtures. */
  noopBlockTypes?: ReadonlySet<string>;
  /**
   * The extension point YB-3 and YB-4 plug their peripherals into (plan §10, YB-CP): called once for every
   * Yolo:Bit-compatible run that compiled, after the board is known and before the program starts. What it
   * returns is composed with the board's capabilities: an implementation of a capability the board does not
   * have is dropped. Without it a run has no capabilities, as at YB-2. Never called for a generic run.
   */
  capabilities?: CapabilityFactory;
};

/** What a capability factory is given. `services` is every runtime service the session owns; the budget is the interpreter's own. */
export type RunEnvironment = {
  board: ComponentInstance;
  /** Capability ids the board has (pin capabilities and onboard ones). */
  capabilitySet: readonly string[];
  services: RuntimeServices;
  /** The latest input of an onboard part (`<board>/<peripheral>`), or undefined. Reads the run as it is now. */
  input(componentId: string): ComponentInput | undefined;
};

export type CapabilityFactory = (environment: RunEnvironment) => Capabilities;


export function createRunSession(registry: DeviceRegistry, options: RunSessionOptions = {}): RunSession {
  const profiles = options.profiles ?? productionProfiles;
  const packs = options.packs ?? createBlockPackCatalog(registry);
  let snapshot = idle;
  /**
   * The console whose newest lines `snapshot` does not hold yet. A print only marks it: copying up to 500
   * lines for every print of a tight loop would be the cost of the loop. The copy is made when somebody
   * reads the snapshot, which the run store does at most once per frame.
   */
  let staleConsole: RunConsole | null = null;
  /** The snapshot with its console brought up to date. */
  const fresh = (): RunSnapshot => {
    if (staleConsole) {
      snapshot = { ...snapshot, console: staleConsole.snapshot() };
      staleConsole = null;
    }
    return snapshot;
  };
  /** The run that owns the session: set from start until stop, also after it finished (E6). */
  let current: ActiveRun | null = null;
  const listeners = new Set<(snapshot: RunSnapshot) => void>();

  const publish = (next: RunSnapshot) => {
    snapshot = next;
    staleConsole = null;
    for (const listener of [...listeners]) {
      listener(snapshot);
    }
  };

  /** Every input change goes through here, so `run.simulation` is always the current one. */
  const simulate = (run: ActiveRun) => {
    const { circuit, pinOutputs, contacts } = run;
    run.simulation = simulateCircuit(circuit, registry, { powered: true, pinOutputs, contacts });
    return run.simulation;
  };

  /**
   * A line was written to the console of `run`. One notice per burst: listeners read the snapshot when they
   * need it, and that brings the console up to date. A run that lost ownership notices nothing.
   */
  const noteConsoleWrite = (run: ActiveRun | undefined, runConsole: RunConsole) => {
    if (current === run && staleConsole === null) {
      staleConsole = runConsole;
      for (const listener of [...listeners]) {
        listener(snapshot);
      }
    }
  };

  /**
   * Ends a run: the cancellation first (the budget, `sleep` and the interpreter all see it), then its timers. It
   * touches only the run it is given and is safe to repeat. Aborting can run the run's own abort handlers, and a
   * handler may write to the console, which notifies the listeners, who may call `start` or `stop` (the latest call
   * wins): so whatever the caller does afterwards must not assume `current` is still `retiring`.
   */
  const retire = (retiring: ActiveRun) => {
    retiring.program.stop();
    retiring.scheduler?.dispose();
  };

  const stop = () => {
    const retiring = current;
    if (!retiring) {
      return;
    }
    // `current` stays the retiring run while it is retired, so its last console writes still notify.
    retire(retiring);
    // A listener that stopped or started something meanwhile has already settled the session (and published
    // last): the newer state stands, this stop must not clear it or publish idle over it.
    if (current === retiring) {
      current = null;
      publish(idle);
    }
  };

  const start = (project: ProjectDocument): StartResult => {
    const fail = (reason: StartFailureReason, diagnostics: RunDiagnostic[] = []): StartResult => {
      stop();
      return { ok: false, reason, diagnostics };
    };

    // The family comes from the document's profile, never from the boards on
    // the canvas (R-F1). Only the board context decides what may run.
    const context = resolveBoardContext(project, registry, profiles);
    if (!context.readiness.ok) {
      // no-board and multiple-boards are the reason itself; a device of the wrong family is named.
      return fail(
        context.readiness.reason,
        context.readiness.reason === 'incompatible-devices' ? checkBoardReadiness(context).map(toRunDiagnostic) : [],
      );
    }
    // YBC programs only (generic documents keep opening and running as they were, GB6): refuse an
    // oversized one before anything walks it further. The compiler asks the same question.
    if (context.family === 'ybc' && exceedsBlockLimit(project.program.blocks)) {
      return fail('compile-error', [
        { severity: 'error', code: 'program-too-large', message: `A program is limited to ${MAX_PROGRAM_BLOCKS} blocks.` },
      ]);
    }
    const outOfProfile = checkProfileBlocks(project.program.blocks, context, packs);
    if (outOfProfile.length > 0) {
      return fail('compile-error', outOfProfile.map(toRunDiagnostic));
    }
    const compiled = compileFor(context, context.readiness.board.deviceType, project);
    if (!compiled.ok) {
      return fail('compile-error', compiled.diagnostics);
    }

    // A Yolo:Bit-compatible run gets its own services and the capabilities its board offers (YB-CP, plan §10),
    // composed in this order: the run's cancellation, then its services (budget, scheduler, console, clock,
    // sleep), then the capabilities from the factory, composed with what the board has. The same `services`
    // and `capabilities` go to the factory and to the interpreter. Nothing is composed for a generic run: it
    // keeps its single DigitalIO (GB4).
    const board = context.readiness.board;
    const holder: { run?: ActiveRun } = {};
    let ybcRun: { services: RuntimeServices; capabilities: Capabilities; controller: AbortController } | undefined;
    let launch: (getRun: () => ActiveRun) => ProgramRun;
    if (compiled.kind === 'ybc') {
      const controller = new AbortController();
      const runConsole = compiled.console;
      const services = createRuntimeServices({
        signal: controller.signal,
        // What the program or a capability writes shows in the snapshot, and a run that lost ownership notices nothing.
        console: {
          write(line) {
            runConsole.write(line);
            noteConsoleWrite(holder.run, runConsole);
          },
        },
      });
      try {
        const provided = options.capabilities?.({
          board,
          capabilitySet: context.readiness.capabilities,
          services,
          input: (componentId) => (current === holder.run ? holder.run?.inputs[componentId] : undefined),
        });
        const composed = composeCapabilities(context.readiness.capabilities, provided ?? {}).capabilities;
        ybcRun = { services, capabilities: composed, controller };
        launch = () => ({ done: runYbcProgram(compiled.ir, composed, services).done, stop: () => controller.abort() });
      } catch {
        services.scheduler.dispose();
        controller.abort();
        return fail('compile-error', [{ severity: 'error', code: 'internal-error', message: 'The board could not be set up.' }]);
      }
    } else {
      launch = compiled.launch;
    }

    // The replaced run is aborted without an idle snapshot in between. The
    // program starts after launch returns, so the callbacks never see `run` unset.
    const replaced = current;
    if (replaced) {
      retire(replaced);
    }
    // A listener may have called `start` or `stop` while the old run was retired (its abort handler wrote to the
    // console). The latest call wins, and this one is the older: what it prepared is thrown away and the state the
    // newer call established stands.
    if (current !== replaced) {
      ybcRun?.services.scheduler.dispose();
      ybcRun?.controller.abort();
      return { ok: true };
    }
    // The editor is locked while running, so the circuit stays the one shown.
    const run: ActiveRun = {
      program: launch(() => run),
      circuit: project.circuit,
      pinOutputs: {},
      contacts: {},
      simulation: null,
      inputs: {},
      ...(compiled.kind === 'ybc' ? { console: compiled.console } : {}),
      ...(ybcRun ? { scheduler: ybcRun.services.scheduler, capabilities: ybcRun.capabilities } : {}),
      ...(ybcRun
        ? {
            board: {
              id: board.id,
              onboard: (registry.get(board.deviceType).board?.onboard ?? []).map((part) => ({ id: part.id, model: part.model })),
            },
          }
        : {}),
    };
    holder.run = run;
    current = run;
    void run.program.done.then((outcome) => {
      // A stopped or replaced run must not touch the snapshot any more.
      if (current !== run) {
        return;
      }
      // E6/E7: the board stays powered and the pins keep their levels until stop.
      if (outcome.status === 'finished') {
        publish({ ...fresh(), status: 'finished' });
      } else if (outcome.status === 'error') {
        const { message, blockId } = outcome;
        const code = 'code' in outcome && typeof outcome.code === 'string' ? { code: outcome.code } : {};
        publish({
          ...fresh(),
          status: 'error',
          error: blockId === undefined ? { message, ...code } : { message, blockId, ...code },
        });
      }
    });
    // E1: the board is powered before the program writes its first pin.
    publish({
      status: 'running',
      diagnostics: compiled.diagnostics,
      error: null,
      simulation: simulate(run),
      ...(run.console ? { console: run.console.snapshot() } : {}),
    });
    return { ok: true };
  };

  /**
   * Compiles for the dialect of the context's family (YB plan §9.0): generic
   * projects go through the legacy compiler and interpreter, unchanged, and `launch`
   * starts the program (it receives the run lazily because the hardware callbacks belong
   * to the run they start); YBC projects give their IR, and `start` composes the run's
   * services and capabilities and runs it.
   */
  const compileFor = (
    context: BoardContext,
    boardType: string,
    project: ProjectDocument,
  ):
    | { ok: false; diagnostics: RunDiagnostic[] }
    | { ok: true; kind: 'ybc'; diagnostics: RunDiagnostic[]; ir: YbcProgramIR; console: RunConsole }
    | { ok: true; kind: 'generic'; diagnostics: RunDiagnostic[]; launch: (getRun: () => ActiveRun) => ProgramRun } => {
    if (context.family === 'ybc') {
      const compiled = compileYbcProgram(project.program.blocks, packs.typesOf(context.blockPacks), options.noopBlockTypes);
      if (!compiled.ok) {
        return compiled;
      }
      return { ok: true, kind: 'ybc', diagnostics: compiled.diagnostics, ir: compiled.ir, console: createRunConsole() };
    }
    const pins = registry.get(boardType).board?.pins ?? [];
    const compiled = compileProgram(project.program.blocks, pins.map((pin) => pin.name));
    if (!compiled.ok) {
      return compiled;
    }
    return {
      ok: true,
      kind: 'generic',
      diagnostics: compiled.diagnostics,
      launch(getRun) {
        const io: HardwareIO = {
          digitalWrite(pin, level) {
            const run = getRun();
            // A run that lost ownership is aborted and never touches the circuit again.
            if (current !== run || run.pinOutputs[pin] === level) {
              return;
            }
            run.pinOutputs = { ...run.pinOutputs, [pin]: level };
            publish({ ...fresh(), simulation: simulate(run) });
          },
          // Step 5 (§6.4): the pins as last simulated, so a press or the
          // program's own write is what the next read sees. A run that lost
          // ownership reads nothing but 0.
          digitalRead(pin) {
            const run = getRun();
            return current === run && run.simulation?.pinReads[pin] === 1 ? 1 : 0;
          },
        };
        return runProgram(compiled.ir, io, { sleep: timerSleep });
      },
    };
  };

  // Works in every status of a run, also once the program finished or failed:
  // the board stays powered until Stop (E6, E7), as a real button would.
  const setComponentInput = (componentId: string, input: ComponentInput) => {
    const run = current;
    if (!run || !isComponentInput(input)) {
      return;
    }
    // The circuit wins: a component id is free text (it may well contain a slash), so an id that names a
    // component of this run's circuit is always handled as that component, never read as `<board>/<part>`.
    const component = run.circuit.components.find((candidate) => candidate.id === componentId);
    if (component) {
      // Strictly true, as in the simulation: ids are data, e.g. "constructor".
      if (!isContact(registry.get(component.deviceType)) || input.kind !== 'hold' || (run.contacts[componentId] === true) === input.closed) {
        return;
      }
      run.contacts = { ...run.contacts, [componentId]: input.closed };
      publish({ ...fresh(), simulation: simulate(run) });
      return;
    }
    // Otherwise an onboard part of this run's board, taking the input of its model. There is no peripheral
    // model at YB-CP, so this only keeps the input for the capability the board's factory provides (YB-3, YB-4).
    const peripheral = splitPeripheralComponentId(componentId);
    const part = peripheral && peripheral.boardId === run.board?.id ? run.board.onboard.find((candidate) => candidate.id === peripheral.peripheralId) : undefined;
    if (!part || inputKindOfModel[part.model] !== input.kind || JSON.stringify(run.inputs[componentId]) === JSON.stringify(input)) {
      return;
    }
    run.inputs = { ...run.inputs, [componentId]: input };
  };

  const setContactInput = (componentId: string, closed: boolean) => setComponentInput(componentId, { kind: 'hold', closed });

  return {
    start,
    stop,
    setContactInput,
    setComponentInput,
    getSnapshot: fresh,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

function toRunDiagnostic(diagnostic: LayerDiagnostic): RunDiagnostic {
  return {
    severity: diagnostic.severity,
    code: diagnostic.code,
    message: diagnostic.message,
    ...(diagnostic.blockId === undefined ? {} : { blockId: diagnostic.blockId }),
  };
}
