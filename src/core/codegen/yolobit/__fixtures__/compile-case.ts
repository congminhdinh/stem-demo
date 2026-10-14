import { localDeviceDefinitions } from '../../../devices/local-catalog';
import { createDeviceRegistry } from '../../../devices/registry';
import { productionProfiles } from '../../../profiles';
import { createBlockPackCatalog } from '../../../program/block-packs';
import { compileYbcProgram } from '../../../program/compile-ybc-program';
import type { YbcProgramIR } from '../../../program/ybc-ir';

// Blockly JSON to the YBC IR, the way a Basic project does it (tests only).

export const registry = createDeviceRegistry(localDeviceDefinitions);
export const packs = createBlockPackCatalog(registry);
const exposed = packs.typesOf(productionProfiles.get('ybc-basic')?.blockPacks ?? []);

export function compileBlocks(blocks: unknown): YbcProgramIR {
  const compiled = compileYbcProgram(blocks, exposed);
  if (!compiled.ok) {
    throw new Error(`Does not compile: ${JSON.stringify(compiled.diagnostics)}`);
  }
  return compiled.ir;
}
