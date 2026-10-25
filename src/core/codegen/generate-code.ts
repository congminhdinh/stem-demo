import type { ProjectDocument } from '../circuit/document';
import type { DeviceDefinition } from '../devices/device-definition';
import type { DeviceRegistry } from '../devices/registry';
import { resolveBoardContext } from '../profiles/board-context';
import type { ProfileCatalog } from '../profiles/profile';
import type { ValidityLayer } from '../profiles/validity';
import { compileUnoProject, type UnoProjectRules } from '../program/compile-uno-program';
import { generateUnoSketch, type UnoSketchOptions, type UnoSketchResult } from './arduino/generate';
import { generateForDocument, type DocumentDiagnostic, type DocumentGeneration } from './yolobit/generate-document';

// The code of a document, whichever board family it is (N18 C1): the dispatch by the family's code target. It lives apart from
// `yolobit/generate-document.ts` (the Python panel's, which every lab loads) so that the Arduino sketch generator is imported only
// by what writes sketches (the robot lab's C++ tab): were this in that module, the generator would be a shared module that the main
// bundle carries for every lab (measured in N18 R4.5: +36 kB, +13.8 kB gzip).

/** N18 C1: the code a board family's programs are generated for (`board.codeTarget` of devices/definitions/*.json). */
export type CodeTarget = NonNullable<NonNullable<DeviceDefinition['board']>['codeTarget']>;

/** N18 C1: the Arduino sketch of a uno document, or the layer that stopped it (L-4: the program compiles, the generator says no). */
export type UnoDocumentGeneration =
  | Extract<UnoSketchResult, { ok: true }>
  | { ok: false; layer: ValidityLayer; diagnostics: DocumentDiagnostic[] };

export type DocumentCode =
  | { codeTarget: 'yolobit-micropython'; generation: DocumentGeneration }
  | { codeTarget: 'arduino-avr'; generation: UnoDocumentGeneration };

/** The code target of a document: the one the boards its family may hold are generated for; none for a generic project. */
function codeTargetOf(project: Pick<ProjectDocument, 'profile' | 'circuit'>, registry: DeviceRegistry, profiles: ProfileCatalog): CodeTarget | undefined {
  const { allowedDeviceTypes } = resolveBoardContext(project, registry, profiles);
  const definitions = new Map(registry.list().map((definition) => [definition.id, definition]));
  return allowedDeviceTypes.map((deviceType) => definitions.get(deviceType)?.board?.codeTarget).find((target) => target !== undefined);
}

/**
 * N18 C1: the code of a document, dispatched by its family's code target: the MicroPython of a Yolo:Bit document (exactly
 * `generateForDocument`), the Arduino sketch of a uno document (`compileUnoProject`, then `generateUnoSketch`, with the scenario the
 * lab names), or null for a generic project, which has no generated code (R-F5).
 */
export function generateCodeForDocument(
  project: ProjectDocument,
  rules: UnoProjectRules & { noopBlockTypes?: ReadonlySet<string>; scenario?: UnoSketchOptions['scenario'] },
): DocumentCode | null {
  const codeTarget = codeTargetOf(project, rules.registry, rules.profiles);
  if (codeTarget === 'yolobit-micropython') {
    const generation = generateForDocument(project, rules.registry, rules.profiles, rules.packs, rules.noopBlockTypes);
    return generation === null ? null : { codeTarget, generation };
  }
  if (codeTarget !== 'arduino-avr') {
    return null;
  }
  const compiled = compileUnoProject(project, rules);
  if (!compiled.ok) {
    const layer: ValidityLayer = compiled.reason === 'layer' ? (compiled.diagnostics[0]?.layer ?? 'L-3') : 'L-3';
    return { codeTarget, generation: { ok: false, layer, diagnostics: compiled.diagnostics } };
  }
  const generated = generateUnoSketch(compiled.ir, { kit: compiled.kit, board: compiled.board, ...(rules.scenario ? { scenario: rules.scenario } : {}) });
  return { codeTarget, generation: generated.ok ? generated : { ok: false, layer: 'L-4', diagnostics: generated.diagnostics } };
}
