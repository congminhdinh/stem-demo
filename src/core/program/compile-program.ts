import { blockTypes, builtInBlockTypes } from './blocks';
import type { Expression, ProgramIR, Statement } from './ir';

// Compiles Blockly serialization JSON to the IR (plan §6.3, rules C1–C8).
// Pure: it reads the JSON only and never imports Blockly. It never throws:
// anything it cannot understand becomes a diagnostic.

export type DiagnosticCode =
  | 'malformed-program'
  | 'unknown-block'
  | 'unknown-pin'
  | 'duplicate-hat'
  | 'missing-condition'
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
  /** Mutator state, e.g. the else-if count and the else of "if". */
  extraState?: unknown;
};

/**
 * Bodies and conditions nested deeper than this are reported instead of
 * followed, so no stored program can overflow the stack (C4).
 */
const maxNesting = 100;

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

  const isTooDeep = (depth: number, blockId: string | undefined) => {
    if (depth > maxNesting) {
      report('error', 'malformed-program', 'The program is nested too deeply.', blockId);
    }
    return depth > maxNesting;
  };

  const compileChain = (first: unknown, depth: number): Statement[] => {
    const statements: Statement[] = [];
    if (first !== undefined && isTooDeep(depth, blockIdOf(first))) {
      return statements;
    }
    for (let current = first; current !== undefined; ) {
      const block = asBlock(current);
      if (!block) {
        report('error', 'malformed-program', 'A block in the program is malformed.', blockIdOf(current));
        break;
      }
      // A disabled statement does not run, but the blocks after it still do.
      const statement = isDisabled(block) ? null : compileStatement(block, depth);
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

  /**
   * C8: a Boolean input that is absent, empty or holds a disabled block is a
   * missing condition (an error, not a silent `false`). A shadow block counts
   * until a real block covers it, as in Blockly.
   */
  const compileCondition = (owner: RawBlock, inputName: string, label: string, depth: number): Expression | null => {
    const input = owner.inputs?.[inputName];
    const record = input === undefined ? null : asRecord(input);
    if (input !== undefined && !record) {
      report('error', 'malformed-program', `The "${inputName}" input is malformed.`, owner.id);
      return null;
    }
    const raw = record?.block ?? record?.shadow;
    if (raw === undefined) {
      report('error', 'missing-condition', `"${label}" needs a condition.`, owner.id);
      return null;
    }
    const block = asBlock(raw);
    if (!block) {
      report('error', 'malformed-program', 'A block in the program is malformed.', blockIdOf(raw));
      return null;
    }
    if (isDisabled(block)) {
      report('error', 'missing-condition', `"${label}" needs a condition; the one it has is disabled.`, owner.id);
      return null;
    }
    if (isTooDeep(depth, block.id)) {
      return null;
    }
    switch (block.type) {
      case blockTypes.digitalRead: {
        const pin = block.fields?.PIN;
        if (typeof pin !== 'string') {
          report('error', 'malformed-program', 'digital read needs a pin name.', block.id);
          return null;
        }
        if (!boardPins.includes(pin)) {
          report('error', 'unknown-pin', `The board has no pin "${pin}".`, block.id);
          return null;
        }
        return { kind: 'digitalRead', pin, blockId: block.id };
      }
      case builtInBlockTypes.not: {
        const value = compileCondition(block, 'BOOL', 'not', depth + 1);
        return value && { kind: 'not', value, blockId: block.id };
      }
      default:
        report('error', 'unknown-block', `Unknown condition block "${block.type}".`, block.id);
        return null;
    }
  };

  const compileIf = (block: RawBlock, depth: number): Statement | null => {
    const shape = ifShape(block);
    if (!shape) {
      report('error', 'malformed-program', 'The else-if count or the else of "if" is malformed.', block.id);
      return null;
    }
    // Each branch needs its own condition input, so a count past the number
    // of inputs is already an error at the first missing one; never loop on.
    const branchCount = Math.min(shape.elseIfCount, Object.keys(block.inputs ?? {}).length) + 1;
    const branches: { condition: Expression; body: Statement[] }[] = [];
    for (let index = 0; index < branchCount; index++) {
      const condition = compileCondition(block, `IF${index}`, index === 0 ? 'if' : 'else if', depth + 1);
      const body = compileChain(firstStatementIn(block, `DO${index}`), depth + 1);
      if (condition) {
        branches.push({ condition, body });
      }
    }
    const otherwise = shape.hasElse ? compileChain(firstStatementIn(block, 'ELSE'), depth + 1) : [];
    // A branch that failed was reported, and an error keeps the program from running.
    return branches.length === shape.elseIfCount + 1
      ? { kind: 'if', branches, else: otherwise, blockId: block.id }
      : null;
  };

  const compileStatement = (block: RawBlock, depth: number): Statement | null => {
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
      case builtInBlockTypes.if:
        return compileIf(block, depth);
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
    const body = compileChain(firstStatementIn(block, 'DO'), 0);
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

/** The "if" mutator's state. Blockly leaves out the defaults: no else-if, no else. */
function ifShape(block: RawBlock): { elseIfCount: number; hasElse: boolean } | null {
  const state = block.extraState === undefined ? {} : asRecord(block.extraState);
  if (!state) {
    return null;
  }
  const { elseIfCount = 0, hasElse = false } = state;
  if (typeof elseIfCount !== 'number' || !Number.isSafeInteger(elseIfCount) || elseIfCount < 0) {
    return null;
  }
  return typeof hasElse === 'boolean' ? { elseIfCount, hasElse } : null;
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
