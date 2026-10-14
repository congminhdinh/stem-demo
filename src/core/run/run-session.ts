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
  copyComponentInput,
  inputKindOfModel,
  isComponentInput,
  isContact,
  sameComponentState,
  simulateCircuit,
  splitPeripheralComponentId,
  type ComponentInput,
  type ComponentInputKind,
  type ComponentState,
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
   * `setContactInput`); any other component of the circuit takes the input of its simulation model, which the
   * simulation reads; an onboard part of a Yolo:Bit-compatible board, addressed `<board>/<peripheral>`,
   * takes the input of its model (button: hold, light and temperature sensor: slider, accelerometer: tilt).
   * An id that names a component of the circuit is always that component (it may contain a slash). Ignored
   * while idle, for a component or a part of another run, for the wrong kind of input, and when nothing
   * changes. Like every input it is state of the run, dropped with it (B2).
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
  /** The latest simulation of these inputs: what `digitalRead` reads. The run's own: snapshots and `environment.simulation` get copies of it. */
  simulation: SimulationResult | null;
  /** YBC runs only; runtime state, dropped with the run (B2). */
  console?: RunConsole;
  /** YBC runs only: the timers of this run, cancelled when it ends (YB-CP, plan §10). */
  scheduler?: RunScheduler;
  /** YBC runs only: what the board offers to this run, composed from the board's capabilities (YB-CP). */
  capabilities?: Capabilities;
  /** YBC runs only: the board and its onboard parts, for `setComponentInput`. */
  board?: { id: string; onboard: readonly { id: string; model: string }[] };
  /**
   * Inputs other than a contact's hold, by component id: the circuit's components and the onboard parts
   * (`<board>/<peripheral>`). The run's own copies (nothing else holds them), in a `Map` because an id is free text:
   * "constructor" or "__proto__" is an id, not a member of an object.
   */
  inputs: Map<string, ComponentInput>;
  /** Presses of onboard `hold` parts not taken yet: the `closed` edges of `inputs`, which a latest value cannot hold (C-13). */
  presses: Map<string, number>;
  /** The state onboard parts report for the snapshot, by `<board>/<peripheral>`; the run's own copies, as `inputs`. */
  reported: Map<string, ComponentState>;
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

/**
 * What a capability factory is given. `services` is every runtime service the session owns; the budget is the
 * interpreter's own.
 *
 * Everything below `services` belongs to the ONE run this environment was made for (YB-CP amendment 1, shared by
 * YB-3 and YB-4): once that run is stopped or replaced, or if it never started, each member does nothing and
 * returns nothing, so a capability a test or a late timer still holds cannot touch the run that came after. They
 * are pull and push of state, never events: nothing here calls a capability back.
 */
export type RunEnvironment = {
  board: ComponentInstance;
  /** Capability ids the board has (pin capabilities and onboard ones). */
  capabilitySet: readonly string[];
  services: RuntimeServices;
  /**
   * The latest input of an onboard part (`<board>/<peripheral>`) or of a circuit component that takes one (not a
   * contact: that is the circuit's own), or undefined. Reads the run as it is now. A copy: changing it changes nothing.
   */
  input(componentId: string): ComponentInput | undefined;
  /**
   * The presses of an onboard `hold` part since the last call, then counts from 0 again; before the first call,
   * since the run began (contract C-13 `get_presses`: read and reset). A press is the edge from open to `closed`,
   * so presses that begin and end between two calls are all counted, and a part that is still held counts once.
   * 0 for anything that is not a part of this run.
   */
  takePresses(componentId: string): number;
  /**
   * Sets the state an onboard part (`<board>/<peripheral>`) shows in the snapshot, in place of the one before
   * it, or removes it with `null`. The snapshot is published when it changed. Ignored for an id that is not an
   * onboard part of this board, and for one that names a component of the circuit: the circuit's own state wins.
   * Not honoured while the factory is still running, because the run does not exist yet.
   */
  report(componentId: string, state: ComponentState | null): void;
  /**
   * The latest simulation of this run, what the snapshot shows; null once the run is over. A copy for every call:
   * a capability that changes it changes nothing of the run, of a snapshot already published or of the next
   * simulation, and nobody is notified.
   */
  simulation(): SimulationResult | null;
  /** Drives a pin of this run's board and simulates again. A name that is not a pin of the board is ignored. */
  drivePin(pin: string, level: 0 | 1): void;
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

  /**
   * Every input change goes through here, so `run.simulation` is always the current one. What the onboard parts
   * reported joins the circuit's own states, and the circuit's come last: an onboard part never overwrites a
   * component of the circuit. Nothing is reported on a generic run, so its states are exactly the circuit's.
   * `run.simulation` is the run's own (what `digitalRead` and `environment.simulation` read) and what is returned,
   * to be published, is a copy of it: a subscriber that edits its snapshot cannot reach the state the run keeps.
   */
  const simulate = (run: ActiveRun) => {
    const { circuit, pinOutputs, contacts } = run;
    const result = simulateCircuit(circuit, registry, { powered: true, pinOutputs, contacts, inputs: inputsOf(run) });
    run.simulation = { ...result, components: { ...Object.fromEntries(run.reported), ...result.components } };
    return structuredClone(run.simulation);
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

  /**
   * The environment of ONE run (YB-CP amendment 1). `holder.run` is set when the run is created and `current` is the
   * run that owns the session, so an environment whose run lost ownership, or whose run was never created (the factory
   * threw, or a newer start won), is inert: that single check is what keeps a stale capability from reaching the run
   * that came after. A write that publishes does so last, as every operation does, because a listener may call `start`
   * or `stop` from it.
   */
  const environmentFor = (
    holder: { run?: ActiveRun },
    base: Pick<RunEnvironment, 'board' | 'capabilitySet' | 'services'>,
  ): RunEnvironment => {
    const live = () => (holder.run !== undefined && current === holder.run ? holder.run : undefined);
    const pins = new Set((registry.get(base.board.deviceType).board?.pins ?? []).map((pin) => pin.name));
    return {
      ...base,
      input(componentId) {
        const kept = live()?.inputs.get(componentId);
        return kept && copyComponentInput(kept);
      },
      takePresses(componentId) {
        const run = live();
        const presses = run?.presses.get(componentId) ?? 0;
        run?.presses.delete(componentId);
        return presses;
      },
      report(componentId, state) {
        const run = live();
        // The circuit wins a shared id, as it does for inputs.
        if (!run || circuitComponentOf(run, componentId) || !onboardPartOf(run, componentId)) {
          return;
        }
        if (state === null) {
          if (!run.reported.delete(componentId)) {
            return;
          }
        } else {
          // A copy: the caller may go on using its object, and the state the run keeps must not change under it.
          const next = structuredClone(state);
          const kept = run.reported.get(componentId);
          if (kept && sameComponentState(kept, next)) {
            return;
          }
          run.reported.set(componentId, next);
        }
        publish({ ...fresh(), simulation: simulate(run) });
      },
      // A copy for every read: what a capability does to it changes nothing of the run, of a snapshot already
      // published or of the next simulation, and notifies nobody.
      simulation() {
        const run = live();
        return run?.simulation ? structuredClone(run.simulation) : null;
      },
      drivePin(pin, level) {
        const run = live();
        if (!run || !pins.has(pin) || run.pinOutputs[pin] === level) {
          return;
        }
        run.pinOutputs = { ...run.pinOutputs, [pin]: level };
        publish({ ...fresh(), simulation: simulate(run) });
      },
    };
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
        const provided = options.capabilities?.(
          environmentFor(holder, { board, capabilitySet: context.readiness.capabilities, services }),
        );
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
      inputs: new Map(),
      presses: new Map(),
      reported: new Map(),
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
  const setComponentInput = (componentId: string, given: ComponentInput) => {
    const run = current;
    if (!run || !isComponentInput(given)) {
      return;
    }
    // From here the run works on its own copy: the caller may go on editing, and submitting, the object it passed.
    const input = copyComponentInput(given);
    // The circuit wins: a component id is free text (it may well contain a slash), so an id that names a
    // component of this run's circuit is always handled as that component, never read as `<board>/<part>`.
    const component = circuitComponentOf(run, componentId);
    if (component) {
      const definition = registry.get(component.deviceType);
      if (!isContact(definition)) {
        // Any other component takes the input of its model, which the simulation reads. No model of the
        // catalog is listed in `inputKindOfModel` yet, so nothing is kept for them today.
        if (keepInput(run, componentId, inputKindOfModel[definition.simulation.model], input)) {
          publish({ ...fresh(), simulation: simulate(run) });
        }
        return;
      }
      // Strictly true, as in the simulation: ids are data, e.g. "constructor".
      if (input.kind !== 'hold' || (run.contacts[componentId] === true) === input.closed) {
        return;
      }
      run.contacts = { ...run.contacts, [componentId]: input.closed };
      publish({ ...fresh(), simulation: simulate(run) });
      return;
    }
    // Otherwise an onboard part of this run's board, taking the input of its model. The circuit does not see it:
    // the capability the board's factory provides reads it (`environment.input`, `environment.takePresses`).
    const part = onboardPartOf(run, componentId);
    if (!part) {
      return;
    }
    // A hold that is kept is a hold that changed, so one that is now closed was open (or unset) before: that edge is
    // a press. It is counted here, when it happens, because the latest value alone cannot say that the part was
    // pressed and released in between two reads.
    if (keepInput(run, componentId, inputKindOfModel[part.model], input) && input.kind === 'hold' && input.closed) {
      run.presses.set(componentId, (run.presses.get(componentId) ?? 0) + 1);
    }
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

const circuitComponentOf = (run: ActiveRun, componentId: string) => run.circuit.components.find((candidate) => candidate.id === componentId);

/** The onboard part `<board>/<peripheral>` names on the board of this run, or undefined. Only a Yolo:Bit-compatible run has parts. */
function onboardPartOf(run: ActiveRun, componentId: string) {
  const peripheral = splitPeripheralComponentId(componentId);
  return peripheral && peripheral.boardId === run.board?.id ? run.board.onboard.find((candidate) => candidate.id === peripheral.peripheralId) : undefined;
}

/**
 * Keeps `input`, which must be the run's own copy (`copyComponentInput`), as the latest of the component when it is
 * the kind the component takes and differs from the one kept. Both are copies, so they have the same property order
 * and equal inputs compare equal as text.
 */
function keepInput(run: ActiveRun, componentId: string, takes: ComponentInputKind | undefined, input: ComponentInput): boolean {
  const kept = run.inputs.get(componentId);
  if (takes !== input.kind || (kept !== undefined && JSON.stringify(kept) === JSON.stringify(input))) {
    return false;
  }
  run.inputs.set(componentId, input);
  return true;
}

/** What the simulation reads: copies, by component id, in a record with no prototype, so that an id such as "constructor" is not a member of it. */
function inputsOf(run: ActiveRun): Readonly<Record<string, ComponentInput>> {
  const inputs: Record<string, ComponentInput> = Object.create(null);
  for (const [id, input] of run.inputs) {
    inputs[id] = copyComponentInput(input);
  }
  return inputs;
}

function toRunDiagnostic(diagnostic: LayerDiagnostic): RunDiagnostic {
  return {
    severity: diagnostic.severity,
    code: diagnostic.code,
    message: diagnostic.message,
    ...(diagnostic.blockId === undefined ? {} : { blockId: diagnostic.blockId }),
  };
}
