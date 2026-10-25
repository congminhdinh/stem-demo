import type { ProjectDocument } from '../../circuit/document';
import { boardTargetOf } from '../../devices/board-pins';
import type { DeviceDefinition } from '../../devices/device-definition';
import type { DeviceRegistry } from '../../devices/registry';
import { resolveBoardContext } from '../../profiles/board-context';
import type { ProfileCatalog } from '../../profiles/profile';
import { checkBoardReadiness, checkProfileBlocks, type ValidityLayer } from '../../profiles/validity';
import type { BlockPackCatalog } from '../../program/block-packs';
import { exceedsBlockLimit } from '../../program/block-walk';
import { compileYbcProgram } from '../../program/compile-ybc-program';
import { MAX_PROGRAM_BLOCKS } from '../../program/limits';
import { compileUnoProject, type UnoProjectRules } from '../../program/compile-uno-program';
import { generateUnoSketch, type UnoSketchOptions, type UnoSketchResult } from '../arduino/generate';
import { generateYbcMicroPython, type GenerateResult } from './generate';

// L-4 generator-ready (YB plan §8.6): L-3 plus a generator that says `ok`. A
// document walks the same layers as Run does, with the same diagnostics (R-F5);
// the layer that stopped it is reported, so a program that runs but cannot be
// generated is told apart from one that cannot run.

export type DocumentDiagnostic = {
  severity: 'error' | 'warning';
  code: string;
  message: string;
  blockId?: string;
};

export type DocumentGeneration =
  | Extract<GenerateResult, { ok: true }>
  | { ok: false; layer: ValidityLayer; diagnostics: DocumentDiagnostic[] };

/**
 * The Python of a Yolo:Bit-compatible document, or why there is none. Null for a
 * document of another family: a generic one has no Python generation (R-F5), and a
 * uno one (N18) is C++ for Arduino AVR, which this generator never writes (C1 does).
 */
export function generateForDocument(
  project: Pick<ProjectDocument, 'profile' | 'circuit' | 'program'>,
  registry: DeviceRegistry,
  profiles: ProfileCatalog,
  packs: BlockPackCatalog,
  noopBlockTypes: ReadonlySet<string> = new Set(),
): DocumentGeneration | null {
  const context = resolveBoardContext(project, registry, profiles);
  if (context.family !== 'ybc') {
    return null;
  }
  const blocked = (layer: ValidityLayer, diagnostics: DocumentDiagnostic[]): DocumentGeneration => ({ ok: false, layer, diagnostics });

  const readiness = checkBoardReadiness(context);
  const [firstReadiness] = readiness;
  if (firstReadiness) {
    return blocked(firstReadiness.layer, readiness);
  }
  if (exceedsBlockLimit(project.program.blocks)) {
    return blocked('L-3', [
      { severity: 'error', code: 'program-too-large', message: `A program is limited to ${MAX_PROGRAM_BLOCKS} blocks.` },
    ]);
  }
  const outOfProfile = checkProfileBlocks(project.program.blocks, context, packs);
  if (outOfProfile.length > 0) {
    return blocked('L-2', outOfProfile);
  }
  // Readiness holds here (checked above), so the board and its capabilities are known: the same board target Run
  // compiles for, so a program that runs is a program that generates (and vice versa).
  const target = context.readiness.ok ? boardTargetOf(registry.get(context.readiness.board.deviceType), context.readiness.capabilities) : undefined;
  const compiled = compileYbcProgram(project.program.blocks, packs.typesOf(context.blockPacks), noopBlockTypes, target);
  if (!compiled.ok) {
    return blocked('L-3', compiled.diagnostics);
  }
  const generated = generateYbcMicroPython(compiled.ir);
  return generated.ok ? generated : blocked('L-4', generated.diagnostics);
}

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
