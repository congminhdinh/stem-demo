import type { ProjectDocument } from '../circuit/document';
import type { BlockPackCatalog } from '../program/block-packs';
import { listBlocks } from '../program/block-walk';
import type { BoardContext } from './board-context';

// The validity layers (YB plan §8.6). One document can pass an earlier layer
// and fail a later one, and that is a valid, editable document, never a load
// error:
//
//   L-1 loadable            structure: schema, circuit, known devices and profile, program opens
//                           (checked where a stored project is read: persistence/project-repository.ts)
//   L-2 profile-compatible  every device and block belongs to the family/profile
//   L-3 runtime-ready       L-2 + exactly one board + the program compiles (compile: RunSession)
//   L-4 generator-ready     YBC only; arrives with the generator (YB-5A)

export type ValidityLayer = 'L-1' | 'L-2' | 'L-3';

export type LayerDiagnostic = {
  layer: ValidityLayer;
  severity: 'error';
  code: 'incompatible-devices' | 'not-in-profile' | 'no-board' | 'multiple-boards';
  message: string;
  /** For `not-in-profile`. */
  blockId?: string;
  /** For the device and board codes. */
  componentIds?: string[];
};

/**
 * L-2, blocks: a block that some known pack owns but that the context does not
 * show. The block stays in the program (never removed or migrated); only Run
 * and generation are refused. Blocks no pack owns (e.g. Blockly built-ins a
 * dialect does not use) are the compiler's `unknown-block`, not this.
 */
export function checkProfileBlocks(blocksJson: unknown, context: BoardContext, packs: BlockPackCatalog): LayerDiagnostic[] {
  const allowed = packs.typesOf(context.blockPacks);
  return listBlocks(blocksJson)
    .filter((block) => packs.isKnown(block.type) && !allowed.has(block.type))
    .map((block) => ({
      layer: 'L-2' as const,
      severity: 'error' as const,
      code: 'not-in-profile' as const,
      message: `"${block.type}" is not available in ${context.profile ? `the ${context.profile.id} profile` : 'a generic project'}.`,
      ...(block.id === undefined ? {} : { blockId: block.id }),
    }));
}

/** L-2, devices, and the board part of L-3 (the resolver's readiness, R-F5). */
export function checkBoardReadiness(context: BoardContext): LayerDiagnostic[] {
  const { readiness } = context;
  if (readiness.ok) {
    return [];
  }
  const where = context.profile ? `a ${context.profile.id} project` : 'a generic project';
  switch (readiness.reason) {
    case 'incompatible-devices':
      return [
        {
          layer: 'L-2',
          severity: 'error',
          code: 'incompatible-devices',
          message: `${readiness.componentIds.join(', ')} cannot be used in ${where}.`,
          componentIds: readiness.componentIds,
        },
      ];
    case 'no-board':
      return [{ layer: 'L-3', severity: 'error', code: 'no-board', message: 'The circuit needs a board.', componentIds: [] }];
    case 'multiple-boards':
      return [
        {
          layer: 'L-3',
          severity: 'error',
          code: 'multiple-boards',
          message: 'The circuit can have only one board.',
          componentIds: readiness.componentIds,
        },
      ];
  }
}

export type LayerReport = {
  /** L-2 holds when this is empty. */
  profileCompatible: LayerDiagnostic[];
  /** L-3 holds when this is empty and the program compiles (the compile result comes from RunSession). */
  runtimeReady: LayerDiagnostic[];
};

/** Both layers for a document in its context. L-3 includes L-2, as in the plan. */
export function reportLayers(
  document: Pick<ProjectDocument, 'program'>,
  context: BoardContext,
  packs: BlockPackCatalog,
): LayerReport {
  const l2 = [...checkProfileBlocks(document.program.blocks, context, packs), ...checkBoardReadiness(context).filter((d) => d.layer === 'L-2')];
  const l3Only = checkBoardReadiness(context).filter((diagnostic) => diagnostic.layer === 'L-3');
  return { profileCompatible: l2, runtimeReady: [...l2, ...l3Only] };
}
