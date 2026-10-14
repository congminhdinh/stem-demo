import type { Circuit, ProjectDocument } from '../circuit/document';
import type { DeviceRegistry } from '../devices/registry';
import { resolveBoardContext, type BoardContext } from '../profiles/board-context';
import { productionProfiles } from '../profiles';
import type { ProfileCatalog } from '../profiles/profile';
import { checkBoardReadiness, checkProfileBlocks, type LayerDiagnostic } from '../profiles/validity';
import { createBlockPackCatalog, type BlockPackCatalog } from '../program/block-packs';
import { compileProgram } from '../program/compile-program';
import { compileYbcSkeleton } from '../program/compile-ybc-skeleton';
import { runProgram, timerSleep, type HardwareIO, type ProgramRun } from '../program/interpreter';
import { runYbcSkeleton } from '../program/run-ybc-skeleton';
import { isContact, simulateCircuit, type SimulationResult } from '../simulation/simulate-circuit';

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
  error: { message: string; blockId?: string } | null;
  /** null while idle; otherwise the powered board and the pins written so far. */
  simulation: SimulationResult | null;
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
};

// Listeners may call start or stop synchronously; the latest call wins. That
// holds because every operation settles `current` (aborting the run it
// replaces) before it publishes, and publishing is always its last step.

/**
 * The catalogs default to the production ones. Tests inject their own to
 * exercise the profile mechanism with fixtures (YB plan §8.7).
 */
export type RunSessionOptions = { profiles?: ProfileCatalog; packs?: BlockPackCatalog };

export function createRunSession(registry: DeviceRegistry, options: RunSessionOptions = {}): RunSession {
  const profiles = options.profiles ?? productionProfiles;
  const packs = options.packs ?? createBlockPackCatalog(registry);
  let snapshot = idle;
  /** The run that owns the session: set from start until stop, also after it finished (E6). */
  let current: ActiveRun | null = null;
  const listeners = new Set<(snapshot: RunSnapshot) => void>();

  const publish = (next: RunSnapshot) => {
    snapshot = next;
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

  const stop = () => {
    if (!current) {
      return;
    }
    current.program.stop();
    current = null;
    publish(idle);
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
    const outOfProfile = checkProfileBlocks(project.program.blocks, context, packs);
    if (outOfProfile.length > 0) {
      return fail('compile-error', outOfProfile.map(toRunDiagnostic));
    }
    const compiled = compileFor(context, context.readiness.board.deviceType, project);
    if (!compiled.ok) {
      return fail('compile-error', compiled.diagnostics);
    }

    // The replaced run is aborted without an idle snapshot in between. The
    // program starts after launch returns, so the callbacks never see `run` unset.
    current?.program.stop();
    // The editor is locked while running, so the circuit stays the one shown.
    const run: ActiveRun = {
      program: compiled.launch(() => run),
      circuit: project.circuit,
      pinOutputs: {},
      contacts: {},
      simulation: null,
    };
    current = run;
    void run.program.done.then((outcome) => {
      // A stopped or replaced run must not touch the snapshot any more.
      if (current !== run) {
        return;
      }
      // E6/E7: the board stays powered and the pins keep their levels until stop.
      if (outcome.status === 'finished') {
        publish({ ...snapshot, status: 'finished' });
      } else if (outcome.status === 'error') {
        const { message, blockId } = outcome;
        publish({ ...snapshot, status: 'error', error: blockId === undefined ? { message } : { message, blockId } });
      }
    });
    // E1: the board is powered before the program writes its first pin.
    publish({ status: 'running', diagnostics: compiled.diagnostics, error: null, simulation: simulate(run) });
    return { ok: true };
  };

  /**
   * Compiles for the dialect of the context's family (YB plan §9.0): generic
   * projects go through the legacy compiler and interpreter, unchanged; YBC
   * projects through the YBC path. `launch` starts the program; it receives
   * the run lazily because the hardware callbacks belong to the run they start.
   */
  const compileFor = (
    context: BoardContext,
    boardType: string,
    project: ProjectDocument,
  ):
    | { ok: false; diagnostics: RunDiagnostic[] }
    | { ok: true; diagnostics: RunDiagnostic[]; launch: (getRun: () => ActiveRun) => ProgramRun } => {
    if (context.family === 'ybc') {
      const compiled = compileYbcSkeleton(project.program.blocks, packs.typesOf(context.blockPacks));
      return compiled.ok
        ? {
            ok: true,
            diagnostics: compiled.diagnostics,
            launch: () => runYbcSkeleton(compiled.ir, { sleep: timerSleep }),
          }
        : compiled;
    }
    const pins = registry.get(boardType).board?.pins ?? [];
    const compiled = compileProgram(project.program.blocks, pins.map((pin) => pin.name));
    if (!compiled.ok) {
      return compiled;
    }
    return {
      ok: true,
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
            publish({ ...snapshot, simulation: simulate(run) });
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
  const setContactInput = (componentId: string, closed: boolean) => {
    const run = current;
    if (!run) {
      return;
    }
    const isRunContact = run.circuit.components.some(
      (component) => component.id === componentId && isContact(registry.get(component.deviceType)),
    );
    // Strictly true, as in the simulation: ids are data, e.g. "constructor".
    if (!isRunContact || (run.contacts[componentId] === true) === closed) {
      return;
    }
    run.contacts = { ...run.contacts, [componentId]: closed };
    publish({ ...snapshot, simulation: simulate(run) });
  };

  return {
    start,
    stop,
    setContactInput,
    getSnapshot: () => snapshot,
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
