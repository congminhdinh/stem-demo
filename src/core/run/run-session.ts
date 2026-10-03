import type { Circuit, ProjectDocument } from '../circuit/document';
import type { DeviceRegistry } from '../devices/registry';
import { compileProgram, type Diagnostic } from '../program/compile-program';
import { runProgram, timerSleep, type HardwareIO, type ProgramRun } from '../program/interpreter';
import { isContact, simulateCircuit, type SimulationResult } from '../simulation/simulate-circuit';

// The only place that connects a program to the simulation (plan §5.1 B5,
// §6.4). Runtime state lives here and in the snapshots; the project document
// is only read (B2).

export type RunStatus = 'idle' | 'running' | 'finished' | 'error';

/** Plain JSON; a new object on every change. */
export type RunSnapshot = {
  status: RunStatus;
  /** Compile warnings of the current run. */
  diagnostics: Diagnostic[];
  error: { message: string; blockId?: string } | null;
  /** null while idle; otherwise the powered board and the pins written so far. */
  simulation: SimulationResult | null;
};

export type StartResult =
  | { ok: true }
  | { ok: false; reason: 'no-board' | 'multiple-boards' | 'compile-error'; diagnostics: Diagnostic[] };

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
};

// Listeners may call start or stop synchronously; the latest call wins. That
// holds because every operation settles `current` (aborting the run it
// replaces) before it publishes, and publishing is always its last step.

export function createRunSession(registry: DeviceRegistry): RunSession {
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

  const simulate = (run: ActiveRun) =>
    simulateCircuit(run.circuit, registry, { powered: true, pinOutputs: run.pinOutputs, contacts: run.contacts });

  const stop = () => {
    if (!current) {
      return;
    }
    current.program.stop();
    current = null;
    publish(idle);
  };

  const start = (project: ProjectDocument): StartResult => {
    const fail = (reason: 'no-board' | 'multiple-boards' | 'compile-error', diagnostics: Diagnostic[] = []): StartResult => {
      stop();
      return { ok: false, reason, diagnostics };
    };

    // A board is a device with a board profile: its pin names are what the program sees.
    const [board, ...otherBoards] = project.circuit.components.flatMap(
      (component) => registry.get(component.deviceType).board ?? [],
    );
    if (!board) {
      return fail('no-board');
    }
    if (otherBoards.length > 0) {
      return fail('multiple-boards');
    }
    const compiled = compileProgram(project.program.blocks, board.pins.map((pin) => pin.name));
    if (!compiled.ok) {
      return fail('compile-error', compiled.diagnostics);
    }

    const io: HardwareIO = {
      digitalWrite(pin, level) {
        // A run that lost ownership is aborted and never touches the circuit again.
        if (current !== run || run.pinOutputs[pin] === level) {
          return;
        }
        run.pinOutputs = { ...run.pinOutputs, [pin]: level };
        publish({ ...snapshot, simulation: simulate(run) });
      },
    };

    // The replaced run is aborted without an idle snapshot in between. The
    // program starts after runProgram returns, so `io` never sees `run` unset.
    current?.program.stop();
    // The editor is locked while running, so the circuit stays the one shown.
    const run: ActiveRun = {
      program: runProgram(compiled.ir, io, { sleep: timerSleep }),
      circuit: project.circuit,
      pinOutputs: {},
      contacts: {},
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
