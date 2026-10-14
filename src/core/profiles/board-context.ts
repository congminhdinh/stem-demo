import type { ComponentInstance, ProjectDocument } from '../circuit/document';
import { deviceFamily, type DeviceDefinition } from '../devices/device-definition';
import type { DeviceRegistry } from '../devices/registry';
import { genericPackId } from '../program/block-packs';
import type { CurriculumProfile, ProfileCatalog } from './profile';

// Board context resolution (YB plan §8.5, R-F1…R-F11). One function decides
// the family, the profile, the allowed devices and whether the board is
// ready; load, persistence, palette, toolbox, Run and (from YB-5A) the Python
// panel all ask it. Nothing else may derive any of it from the boards that
// happen to be on the canvas.

export type BoardFamily = 'generic' | 'ybc';

/** What a board offers to programs: its pin capabilities and onboard parts, as capability ids. */
export type CapabilitySet = readonly string[];

export type BoardReadiness =
  | { ok: true; board: ComponentInstance; capabilities: CapabilitySet }
  | { ok: false; reason: 'no-board' | 'multiple-boards' | 'incompatible-devices'; componentIds: string[] };

export type BoardContext = {
  /** `ybc` exactly when the document has a profile (R-F1); never from the boards present. */
  family: BoardFamily;
  /** The effective profile; null for a generic project. */
  profile: CurriculumProfile | null;
  /** The palette: the device types a project of this context may contain, in palette order. */
  allowedDeviceTypes: readonly string[];
  /** The block packs of the toolbox, in order. A generic project has the generic pack. */
  blockPacks: readonly string[];
  /** Components that are boards of this context (their device has a `board` and is allowed). */
  boards: ComponentInstance[];
  /** Components whose device type is not allowed here. They are kept and marked, never removed (R-F4). */
  incompatible: ComponentInstance[];
  readiness: BoardReadiness;
};

/**
 * The context of a document. Throws for a profile the catalog does not know:
 * such a document did not pass L-1 (R-F2), so it is a programmer error, like
 * `registry.get` for an unknown device type.
 *
 * Editing never depends on `readiness`: a document with no board, several
 * boards or devices of another family is a valid, editable document (R-F4).
 */
export function resolveBoardContext(
  document: Pick<ProjectDocument, 'profile' | 'circuit'>,
  registry: DeviceRegistry,
  profiles: ProfileCatalog,
): BoardContext {
  const profile = document.profile === undefined ? null : (profiles.get(document.profile) ?? null);
  if (document.profile !== undefined && profile === null) {
    throw new Error(`Unknown profile "${document.profile}"`);
  }

  const definitions = new Map(registry.list().map((definition) => [definition.id, definition]));
  // R-F3: generic = every generic device; ybc = exactly the profile's palette.
  const allowedDeviceTypes = profile
    ? profile.palette.filter((deviceType) => definitions.has(deviceType))
    : registry.list().filter((definition) => deviceFamily(definition) === 'generic').map((definition) => definition.id);
  const allowed = new Set(allowedDeviceTypes);

  const components = document.circuit.components;
  const incompatible = components.filter((component) => !allowed.has(component.deviceType));
  const boards = components.filter(
    (component) => allowed.has(component.deviceType) && definitions.get(component.deviceType)?.board !== undefined,
  );

  return {
    family: profile ? 'ybc' : 'generic',
    profile,
    allowedDeviceTypes,
    blockPacks: profile ? profile.blockPacks : [genericPackId],
    boards,
    incompatible,
    readiness: readinessOf(boards, incompatible, definitions),
  };
}

/** R-F5. A device of another family comes first: it is what the user has to fix. */
function readinessOf(
  boards: ComponentInstance[],
  incompatible: ComponentInstance[],
  definitions: ReadonlyMap<string, DeviceDefinition>,
): BoardReadiness {
  const ids = (components: ComponentInstance[]) => components.map((component) => component.id);
  const [board, ...otherBoards] = boards;
  if (incompatible.length > 0) {
    return { ok: false, reason: 'incompatible-devices', componentIds: ids(incompatible) };
  }
  if (!board) {
    return { ok: false, reason: 'no-board', componentIds: [] };
  }
  if (otherBoards.length > 0) {
    return { ok: false, reason: 'multiple-boards', componentIds: ids(boards) };
  }
  const definition = definitions.get(board.deviceType);
  return { ok: true, board, capabilities: definition ? capabilitiesOf(definition) : [] };
}

/** Pin capabilities (digital when a pin lists none) and onboard capabilities, each once. */
export function capabilitiesOf(definition: DeviceDefinition): CapabilitySet {
  const fromPins = definition.board?.pins.flatMap((pin) => pin.capabilities ?? ['digital']) ?? [];
  const fromOnboard = definition.board?.onboard?.map((part) => part.capability) ?? [];
  return [...new Set([...fromPins, ...fromOnboard])];
}
