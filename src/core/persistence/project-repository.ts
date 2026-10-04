import { createNewProject, projectDocumentSchema, type Circuit, type ProjectDocument } from '../circuit/document';
import { connectWire } from '../circuit/wires';
import type { DeviceRegistry } from '../devices/registry';

// Where the current project is kept between sessions (plan §7, B8). The UI
// and the store only know this interface; the app bootstrap picks the
// implementation (Dexie today, an API later). Implementations store the
// document whole and never look inside it: checking it is done here, once,
// when it comes back (plan §6.1).

export type ProjectRepository = {
  /** Keeps `document` as the latest project, replacing what was kept for its id. */
  save(document: ProjectDocument): Promise<void>;
  /**
   * The document saved last, exactly as stored: unchecked, maybe corrupt or
   * from another schema version. null when nothing was ever saved.
   */
  loadLast(): Promise<{ document: unknown } | null>;
};

/**
 * Whether the program editor can open these blocks. Only the editor knows
 * (Blockly throws on structures that no schema here describes), so the app
 * passes in the editor's own check; core stays free of Blockly (B1, B4).
 */
export type ProgramCheck = (blocks: unknown) => boolean;

/**
 * A stored document the app can open, or null. Besides the schema (which
 * pins `schemaVersion` to 1) it checks what would otherwise break the editor
 * later: invariants I1–I3 (plan §6.1), device types the registry knows, and
 * a program the editor can open.
 */
export function readStoredProject(
  stored: unknown,
  registry: DeviceRegistry,
  canOpenProgram: ProgramCheck,
): ProjectDocument | null {
  const parsed = projectDocumentSchema.safeParse(stored);
  if (!parsed.success) {
    return null;
  }
  const document = parsed.data;
  return isOpenableCircuit(document.circuit, registry) && canOpenProgram(document.program.blocks) ? document : null;
}

/** Why the app did not open the saved project, as shown to the user. */
export type Notice = {
  message: string;
  /**
   * What it is about, which decides how long it stays: the project the app
   * opened (gone once another project is loaded, e.g. by New), or the whole
   * session (stays until dismissed: saving stays off whatever is loaded).
   */
  about: 'opened-project' | 'session';
};

export type OpenedProject = {
  document: ProjectDocument;
  notice: Notice | null;
  /** False when the browser storage failed: the session then saves nothing. */
  canSave: boolean;
};

/**
 * What the app opens at startup (plan §7): the last saved project; the
 * sample when nothing was saved; a new project, with a notice, when the
 * saved one is corrupt or from an unknown version. Never throws.
 */
export async function openLastProject(
  repository: ProjectRepository,
  registry: DeviceRegistry,
  options: { sample(): ProjectDocument; newId(): string; canOpenProgram: ProgramCheck },
): Promise<OpenedProject> {
  let stored: { document: unknown } | null;
  try {
    stored = await repository.loadLast();
  } catch {
    return {
      document: options.sample(),
      notice: { message: 'Projects cannot be saved in this browser.', about: 'session' },
      canSave: false,
    };
  }
  if (!stored) {
    return { document: options.sample(), notice: null, canSave: true };
  }
  const document = readStoredProject(stored.document, registry, options.canOpenProgram);
  return document
    ? { document, notice: null, canSave: true }
    : {
        document: createNewProject(options.newId()),
        notice: {
          message: 'The saved project could not be opened, so a new project was started.',
          about: 'opened-project',
        },
        canSave: true,
      };
}

/** I1–I3, rebuilt with the same operation the editor wires with, on known device types. */
function isOpenableCircuit(circuit: Circuit, registry: DeviceRegistry): boolean {
  const deviceTypes = new Set(registry.list().map((definition) => definition.id));
  const componentIds = new Set(circuit.components.map((component) => component.id));
  if (
    componentIds.size !== circuit.components.length ||
    !circuit.components.every((component) => deviceTypes.has(component.deviceType))
  ) {
    return false;
  }
  let rebuilt: Circuit = { components: circuit.components, wires: [] };
  for (const wire of circuit.wires) {
    const result = connectWire(rebuilt, registry, wire);
    if (!result.ok) {
      return false;
    }
    rebuilt = result.circuit;
  }
  return true;
}
