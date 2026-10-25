import { createNewProject, projectDocumentSchema, type Circuit, type ProjectDocument } from '../circuit/document';
import { connectWire } from '../circuit/wires';
import type { DeviceRegistry } from '../devices/registry';
import { productionKits, type KitCatalog } from '../hardware/catalog';
import { kitKey } from '../hardware/kit';
import { productionProfiles } from '../profiles';
import type { ProfileCatalog } from '../profiles/profile';

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

/** Why a stored document is not loadable (layer L-1, YB plan §8.6). */
export type LoadProblem = {
  code: 'invalid-document' | 'unknown-profile' | 'unknown-kit' | 'invalid-circuit' | 'unknown-device' | 'program-not-openable';
  message: string;
};

export type LoadResult = { ok: true; document: ProjectDocument } | { ok: false; problem: LoadProblem };

/**
 * Layer L-1, loadable: the structure, and nothing else. Besides the schema
 * (which pins `schemaVersion` to 1) it checks what would otherwise break the
 * editor later: a `profile` the catalog knows (R-F2), (N18 R2.2) a robot `kit`
 * the kit catalog knows (`id@version`; a document without one has
 * ref-uno-rover@0, plan §4.0), invariants I1–I3 (plan §6.1), device types the
 * registry knows, and a program the editor can open (with the blocks of every
 * known pack, not only the profile's). An unknown kit falls back as an unknown
 * profile does: the app opens a new project or the lab's template, with its
 * notice.
 *
 * It does not look at how many boards there are, at devices or blocks outside
 * the profile, or at compile errors. Those are layers L-2…L-4: the document
 * stays a valid, editable one (R-F4, R-F11).
 */
export function inspectStoredProject(
  stored: unknown,
  registry: DeviceRegistry,
  canOpenProgram: ProgramCheck,
  profiles: ProfileCatalog = productionProfiles,
  kits: KitCatalog = productionKits,
): LoadResult {
  const parsed = projectDocumentSchema.safeParse(stored);
  if (!parsed.success) {
    return fail('invalid-document', 'The document does not match the project schema.');
  }
  const document = parsed.data;
  if (document.profile !== undefined && !profiles.get(document.profile)) {
    return fail('unknown-profile', `"${document.profile}" is not a known profile.`);
  }
  if (document.kit !== undefined && !kits.get(document.kit)) {
    return fail('unknown-kit', `The robot kit "${kitKey(document.kit)}" is not one this app knows.`);
  }
  const circuit = checkCircuit(document.circuit, registry);
  if (circuit) {
    return { ok: false, problem: circuit };
  }
  return canOpenProgram(document.program.blocks)
    ? { ok: true, document }
    : fail('program-not-openable', 'The program editor cannot open the program.');
}

/** A stored document the app can open, or null (`inspectStoredProject` says why not). */
export function readStoredProject(
  stored: unknown,
  registry: DeviceRegistry,
  canOpenProgram: ProgramCheck,
  profiles: ProfileCatalog = productionProfiles,
): ProjectDocument | null {
  const result = inspectStoredProject(stored, registry, canOpenProgram, profiles);
  return result.ok ? result.document : null;
}

const fail = (code: LoadProblem['code'], message: string): LoadResult => ({ ok: false, problem: { code, message } });

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
  options: { sample(): ProjectDocument; newId(): string; canOpenProgram: ProgramCheck; profiles?: ProfileCatalog },
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
  const document = readStoredProject(stored.document, registry, options.canOpenProgram, options.profiles);
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
function checkCircuit(circuit: Circuit, registry: DeviceRegistry): LoadProblem | null {
  const deviceTypes = new Set(registry.list().map((definition) => definition.id));
  const componentIds = new Set(circuit.components.map((component) => component.id));
  if (componentIds.size !== circuit.components.length) {
    return { code: 'invalid-circuit', message: 'Two components share an id.' };
  }
  if (!circuit.components.every((component) => deviceTypes.has(component.deviceType))) {
    return { code: 'unknown-device', message: 'The circuit has a device the app does not know.' };
  }
  let rebuilt: Circuit = { components: circuit.components, wires: [] };
  for (const wire of circuit.wires) {
    const result = connectWire(rebuilt, registry, wire);
    if (!result.ok) {
      return { code: 'invalid-circuit', message: `Wire ${wire.id} is invalid: ${result.error}.` };
    }
    rebuilt = result.circuit;
  }
  return null;
}
