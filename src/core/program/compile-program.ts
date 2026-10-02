import { blockTypes } from './blocks';
import type { ProgramIR, Statement } from './ir';

// Compiles Blockly serialization JSON to the IR (plan §6.3, rules C1–C6).
// Pure: it reads the JSON only and never imports Blockly. It never throws:
// anything it cannot understand becomes a diagnostic.

export type DiagnosticCode =
  | 'malformed-program'
  | 'unknown-block'
  | 'unknown-pin'
  | 'duplicate-hat'
  | 'ignored-block';

export type Diagnostic = {
  severity: 'error' | 'warning';
  code: DiagnosticCode;
  message: string;
  blockId?: string;
};

export type CompileResult =
  | { ok: true; ir: ProgramIR; diagnostics: Diagnostic[] }
  | { ok: false; diagnostics: Diagnostic[] };

/** The part of a serialized Blockly block the compiler relies on. */
type RawBlock = {
  type: string;
  id: string;
  fields?: Record<string, unknown>;
  inputs?: Record<string, unknown>;
  next?: Record<string, unknown>;
  /** Blockly's disabled state: any reason means the block does not run. */
  disabledReasons?: unknown[];
};

export function compileProgram(blocksJson: unknown, boardPins: readonly string[]): CompileResult {
  const diagnostics: Diagnostic[] = [];
  const report = (severity: Diagnostic['severity'], code: DiagnosticCode, message: string, blockId?: string) => {
    diagnostics.push(blockId === undefined ? { severity, code, message } : { severity, code, message, blockId });
  };

  const topBlocks = topLevelBlocks(blocksJson);
  if (!topBlocks) {
    report('error', 'malformed-program', 'The program is not a Blockly workspace.');
    return { ok: false, diagnostics };
  }

  const compileChain = (first: unknown): Statement[] => {
    const statements: Statement[] = [];
    for (let current = first; current !== undefined; ) {
      const block = asBlock(current);
      if (!block) {
        report('error', 'malformed-program', 'A block in the program is malformed.', blockIdOf(current));
        break;
      }
      // A disabled statement does not run, but the blocks after it still do.
      const statement = isDisabled(block) ? null : compileStatement(block);
      if (statement) {
        statements.push(statement);
      }
      current = block.next?.block;
    }
    return statements;
  };

  /** An absent statement input is an empty body; a present one must be an object. */
  const firstStatementIn = (block: RawBlock, inputName: string): unknown => {
    const input = block.inputs?.[inputName];
    if (input === undefined) {
      return undefined;
    }
    const record = asRecord(input);
    if (!record) {
      report('error', 'malformed-program', `The "${inputName}" input is malformed.`, block.id);
      return undefined;
    }
    return record.block;
  };

  const compileStatement = (block: RawBlock): Statement | null => {
    switch (block.type) {
      case blockTypes.digitalWrite: {
        const pin = block.fields?.PIN;
        const level = block.fields?.LEVEL;
        if (typeof pin !== 'string' || (level !== 'HIGH' && level !== 'LOW')) {
          report('error', 'malformed-program', 'digital write needs a pin name and a HIGH or LOW level.', block.id);
          return null;
        }
        if (!boardPins.includes(pin)) {
          report('error', 'unknown-pin', `The board has no pin "${pin}".`, block.id);
          return null;
        }
        return { kind: 'digitalWrite', pin, level: level === 'HIGH' ? 1 : 0, blockId: block.id };
      }
      case blockTypes.wait: {
        const seconds = block.fields?.SECONDS;
        if (typeof seconds !== 'number') {
          report('error', 'malformed-program', 'wait needs a number of seconds.', block.id);
          return null;
        }
        // C6: negative or non-finite durations count as 0.
        const ms = Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1000) : 0;
        return { kind: 'wait', ms, blockId: block.id };
      }
      default:
        report('error', 'unknown-block', `Unknown block "${block.type}".`, block.id);
        return null;
    }
  };

  let onStart: Statement[] | null = null;
  let forever: Statement[] | null = null;
  for (const raw of topBlocks) {
    const block = asBlock(raw);
    if (!block) {
      report('error', 'malformed-program', 'A block in the program is malformed.', blockIdOf(raw));
      continue;
    }
    // Disabled is a valid Blockly state, not a problem: a disabled hat drops its
    // whole stack, a disabled loose block is simply not there.
    if (isDisabled(block)) {
      continue;
    }
    const isHat = block.type === blockTypes.onStart || block.type === blockTypes.forever;
    if (!isHat) {
      report('warning', 'ignored-block', 'Blocks outside "on start" and "forever" do not run.', block.id);
      continue;
    }
    if ((block.type === blockTypes.onStart ? onStart : forever) !== null) {
      report('error', 'duplicate-hat', `Only one "${block.type}" block is allowed.`, block.id);
      continue;
    }
    const body = compileChain(firstStatementIn(block, 'DO'));
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

/** `{}` (an empty workspace) has no blocks; anything that is not a workspace returns null. */
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
  for (const key of ['fields', 'inputs', 'next'] as const) {
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
