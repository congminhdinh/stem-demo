import { boardTargetOf } from '../../../devices/board-pins';
import { localDeviceDefinitions } from '../../../devices/local-catalog';
import { createDeviceRegistry } from '../../../devices/registry';
import { productionProfiles } from '../../../profiles';
import { capabilitiesOf } from '../../../profiles/board-context';
import { createBlockPackCatalog } from '../../../program/block-packs';
import { compileYbcProgram } from '../../../program/compile-ybc-program';
import type { YbcProgramIR } from '../../../program/ybc-ir';

// Blockly JSON to the YBC IR, the way an Advanced project does it (tests only): for the ybc-board, as Run compiles. Advanced shows
// every block Basic shows and compiles it the same way; since N17 B2 it also shows the sensors.

export const registry = createDeviceRegistry(localDeviceDefinitions);
export const packs = createBlockPackCatalog(registry);
const exposed = packs.typesOf(productionProfiles.get('ybc-advanced')?.blockPacks ?? []);
const ybcBoard = registry.get('ybc-board');
/** The board the cases are compiled for: what RunSession hands the compiler for a ybc-board. */
export const ybcTarget = boardTargetOf(ybcBoard, capabilitiesOf(ybcBoard));

export function compileBlocks(blocks: unknown): YbcProgramIR {
  const compiled = compileYbcProgram(blocks, exposed, undefined, ybcTarget);
  if (!compiled.ok) {
    throw new Error(`Does not compile: ${JSON.stringify(compiled.diagnostics)}`);
  }
  return compiled.ir;
}
