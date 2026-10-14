import type { ProjectDocument } from '../../circuit/document';
import { boardTargetOf } from '../../devices/board-pins';
import type { DeviceRegistry } from '../../devices/registry';
import { resolveBoardContext } from '../../profiles/board-context';
import type { ProfileCatalog } from '../../profiles/profile';
import { checkBoardReadiness, checkProfileBlocks, type ValidityLayer } from '../../profiles/validity';
import type { BlockPackCatalog } from '../../program/block-packs';
import { exceedsBlockLimit } from '../../program/block-walk';
import { compileYbcProgram } from '../../program/compile-ybc-program';
import { MAX_PROGRAM_BLOCKS } from '../../program/limits';
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
 * generic document: it has no Python generation (R-F5).
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
  // The same board target Run compiles for, so a program that runs is a program that generates (and vice versa).
  const target = context.readiness.ok ? boardTargetOf(registry.get(context.readiness.board.deviceType), context.readiness.capabilities) : undefined;
  const compiled = compileYbcProgram(project.program.blocks, packs.typesOf(context.blockPacks), noopBlockTypes, target);
  if (!compiled.ok) {
    return blocked('L-3', compiled.diagnostics);
  }
  const generated = generateYbcMicroPython(compiled.ir);
  return generated.ok ? generated : blocked('L-4', generated.diagnostics);
}
