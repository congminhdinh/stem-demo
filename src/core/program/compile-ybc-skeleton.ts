import { blockTypes } from './blocks';
import type { YbcProgramIR, YbcStatement } from './ybc-ir';

// The YBC skeleton compiler (YB plan §9.0): Blockly JSON to `YbcProgramIR`,
// for the two hats and the blocks a profile exposes. The profile exposes no
// statement block yet, so every real program is two empty hats; a block the
// profile does expose compiles to a `noop`. The language compiler
// (`compileYbcProgram`, typed, construct table) replaces this in YB-2; the
// legacy `compileProgram` is not involved and stays as it is.
//
// Like the legacy compiler it never throws and never imports Blockly: what it
// cannot understand becomes a diagnostic with the block's id.

export type YbcDiagnosticCode = 'malformed-program' | 'unknown-block' | 'duplicate-hat' | 'ignored-block';

export type YbcDiagnostic = {
  severity: 'error' | 'warning';
  code: YbcDiagnosticCode;
  message: string;
  blockId?: string;
};

export type YbcCompileResult =
  | { ok: true; ir: YbcProgramIR; diagnostics: YbcDiagnostic[] }
  | { ok: false; diagnostics: YbcDiagnostic[] };

type RawBlock = {
  type: string;
  id: string;
  inputs?: Record<string, unknown>;
  next?: Record<string, unknown>;
  disabledReasons?: unknown[];
};

/** Deeper chains are reported instead of followed, so no stored program can overflow the stack. */
const maxChain = 10_000;

/**
 * @param exposedBlockTypes the block types the profile exposes (from its packs); the hats always compile.
 */
export function compileYbcSkeleton(blocksJson: unknown, exposedBlockTypes: ReadonlySet<string>): YbcCompileResult {
  const diagnostics: YbcDiagnostic[] = [];
  const report = (severity: YbcDiagnostic['severity'], code: YbcDiagnosticCode, message: string, blockId?: string) => {
    diagnostics.push(blockId === undefined ? { severity, code, message } : { severity, code, message, blockId });
  };

  const topBlocks = topLevelBlocks(blocksJson);
  if (!topBlocks) {
    report('error', 'malformed-program', 'The program is not a Blockly workspace.');
    return { ok: false, diagnostics };
  }

  const compileChain = (first: unknown): YbcStatement[] => {
    const statements: YbcStatement[] = [];
    let count = 0;
    for (let current = first; current !== undefined; ) {
      const block = asBlock(current);
      if (!block) {
        report('error', 'malformed-program', 'A block in the program is malformed.', blockIdOf(current));
        break;
      }
      if (++count > maxChain) {
        report('error', 'malformed-program', 'The program is nested too deeply.', block.id);
        break;
      }
      // A disabled statement does not run, but the blocks after it still do.
      if (!isDisabled(block)) {
        if (exposedBlockTypes.has(block.type)) {
          statements.push({ kind: 'noop', blockId: block.id });
        } else {
          report('error', 'unknown-block', `Unknown block "${block.type}".`, block.id);
        }
      }
      current = asRecord(block.next)?.block;
    }
    return statements;
  };

  let onStart: YbcStatement[] | null = null;
  let forever: YbcStatement[] | null = null;
  for (const raw of topBlocks) {
    const block = asBlock(raw);
    if (!block) {
      report('error', 'malformed-program', 'A block in the program is malformed.', blockIdOf(raw));
      continue;
    }
    if (isDisabled(block)) {
      continue;
    }
    if (block.type !== blockTypes.onStart && block.type !== blockTypes.forever) {
      report('warning', 'ignored-block', 'Blocks outside "on start" and "forever" do not run.', block.id);
      continue;
    }
    if ((block.type === blockTypes.onStart ? onStart : forever) !== null) {
      report('error', 'duplicate-hat', `Only one "${block.type}" block is allowed.`, block.id);
      continue;
    }
    const input = block.inputs?.DO;
    const record = input === undefined ? null : asRecord(input);
    if (input !== undefined && !record) {
      report('error', 'malformed-program', 'The "DO" input is malformed.', block.id);
    }
    const body = compileChain(record?.block);
    if (block.type === blockTypes.onStart) {
      onStart = body;
    } else {
      forever = body;
    }
  }

  if (diagnostics.some((diagnostic) => diagnostic.severity === 'error')) {
    return { ok: false, diagnostics };
  }
  return { ok: true, ir: { onStart: onStart ?? [], forever }, diagnostics };
}

function topLevelBlocks(json: unknown): unknown[] | null {
  const workspace = asRecord(json);
  if (!workspace) {
    return null;
  }
  if (workspace.blocks === undefined) {
    return [];
  }
  const blocks = asRecord(workspace.blocks)?.blocks;
  return Array.isArray(blocks) ? blocks : null;
}

function asBlock(value: unknown): RawBlock | null {
  const record = asRecord(value);
  if (!record || typeof record.type !== 'string' || typeof record.id !== 'string') {
    return null;
  }
  for (const key of ['inputs', 'next'] as const) {
    if (record[key] !== undefined && !asRecord(record[key])) {
      return null;
    }
  }
  if (record.disabledReasons !== undefined && !Array.isArray(record.disabledReasons)) {
    return null;
  }
  return record as RawBlock;
}

function isDisabled(block: RawBlock): boolean {
  return (block.disabledReasons?.length ?? 0) > 0;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function blockIdOf(value: unknown): string | undefined {
  const id = asRecord(value)?.id;
  return typeof id === 'string' ? id : undefined;
}
