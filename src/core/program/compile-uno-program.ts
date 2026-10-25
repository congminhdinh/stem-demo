import type { ProjectDocument } from '../circuit/document';
import type { DeviceRegistry } from '../devices/registry';
import { boardPin, type BoardProfile } from '../hardware/board';
import { kitBoardContext, kitBoardTarget, type KitBoardTarget } from '../hardware/board-target';
import { kitRefOf, type KitCatalog } from '../hardware/catalog';
import { kitKey, type Kit } from '../hardware/kit';
import { checkKit, type HardwareDiagnostic, type KitUsage } from '../hardware/pin-rules';
import { resolveBoardContext } from '../profiles/board-context';
import type { ProfileCatalog } from '../profiles/profile';
import { checkBoardReadiness, checkProfileBlocks, type LayerDiagnostic } from '../profiles/validity';
import type { BlockPackCatalog } from './block-packs';
import { compileYbcProgram, type YbcDiagnostic } from './compile-ybc-program';
import { unoUsesAndBlocks, type UnoProgramUses, type UsageBlocks } from './uno-uses';
import type { YbcProgramIR } from './ybc-ir';

// The compile of a robot project (N18 R2.2, robot plan §4.2): against its kit. The kit is the project's `kit` or, when it names
// none, the reference kit (plan §4.0); its board target (kitBoardTarget) goes to the compiler with the capabilities of the resolved
// board context with the kit (`kitBoardContext(resolveBoardContext(…), kit)`, which puts `modules` in them). In the order of Run
// (run-session.ts): the board's readiness and the profile's blocks (validity layers L-2, L-3), then the program, then the kit's own
// pin rules for what the program uses (`checkKit`: a port needing PWM on a timer the program's servo or tone takes, a port on D0/D1
// while it prints), each on the first block of that use. The robot lab's run session (R3.6) and the C++ generator (C1) start here.

export type UnoProjectRules = {
  registry: DeviceRegistry;
  profiles: ProfileCatalog;
  packs: BlockPackCatalog;
  kits: KitCatalog;
};

export type UnoCompileResult =
  | { ok: true; ir: YbcProgramIR; diagnostics: YbcDiagnostic[]; kit: Kit; board: BoardProfile; uses: UnoProgramUses }
  /** The board is not ready or a block is not of the profile (L-2, L-3): the program was not compiled. */
  | { ok: false; reason: 'layer'; diagnostics: LayerDiagnostic[] }
  | { ok: false; reason: 'compile'; diagnostics: YbcDiagnostic[] };

/**
 * Compiles a project of the uno family. Throws for a project of another family and for a kit the catalog does not know: such a
 * document did not pass L-1 (persistence/project-repository.ts `inspectStoredProject`), so it is a programmer error, like
 * `resolveBoardContext` for an unknown profile.
 */
export function compileUnoProject(project: ProjectDocument, rules: UnoProjectRules): UnoCompileResult {
  const ref = kitRefOf(project);
  const kit = rules.kits.get(ref);
  const board = rules.kits.boardOf(ref);
  if (!kit || !board) {
    throw new Error(`Unknown kit ${kitKey(ref)}: a project with it does not pass L-1`);
  }
  const resolved = resolveBoardContext(project, rules.registry, rules.profiles);
  if (resolved.family !== 'uno') {
    throw new Error(`The project is not of the uno family (${resolved.family})`);
  }
  const context = kitBoardContext(resolved, kit);
  if (!context.readiness.ok) {
    return { ok: false, reason: 'layer', diagnostics: checkBoardReadiness(context) };
  }
  const outOfProfile = checkProfileBlocks(project.program.blocks, context, rules.packs);
  if (outOfProfile.length > 0) {
    return { ok: false, reason: 'layer', diagnostics: outOfProfile };
  }
  const target: KitBoardTarget = { ...kitBoardTarget(kit, board), capabilities: context.readiness.capabilities };
  const compiled = compileYbcProgram(project.program.blocks, rules.packs.typesOf(context.blockPacks), undefined, target, 'uno');
  if (!compiled.ok) {
    return { ok: false, reason: 'compile', diagnostics: compiled.diagnostics };
  }
  const { uses, blocks } = unoUsesAndBlocks(compiled.ir);
  const kitDiagnostics = checkKit(kit, board, uses.usage).map((diagnostic) => onFirstUse(diagnostic, board, uses.usage, blocks));
  const diagnostics = [...compiled.diagnostics, ...kitDiagnostics];
  if (kitDiagnostics.some((diagnostic) => diagnostic.severity === 'error')) {
    return { ok: false, reason: 'compile', diagnostics };
  }
  return { ok: true, ir: compiled.ir, diagnostics, kit, board, uses };
}

/** A diagnostic of the kit's rules on the block whose use caused it: the servo or tone that takes the timer, the print. */
function onFirstUse(diagnostic: HardwareDiagnostic, board: BoardProfile, usage: KitUsage, blocks: UsageBlocks): YbcDiagnostic {
  let blockId: string | undefined;
  if (diagnostic.code === 'timer-claimed') {
    const timer = boardPin(board, diagnostic.pin ?? '')?.pwmTimer;
    const claimer = (['servo', 'tone'] as const).find((candidate) => usage[candidate] && board.timerClaims[candidate] === timer);
    blockId = claimer === undefined ? undefined : blocks[claimer];
  } else if (diagnostic.code === 'pin-reserved') {
    blockId = blocks.serial;
  }
  // checkKit reports only these three (hardware/pin-rules.ts).
  const code = diagnostic.code as 'pin-conflict' | 'timer-claimed' | 'pin-reserved';
  return blockId === undefined
    ? { severity: diagnostic.severity, code, message: diagnostic.message }
    : { severity: diagnostic.severity, code, message: diagnostic.message, blockId };
}
