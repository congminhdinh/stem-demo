// The diagnostic and error model of the Yolo:Bit-compatible runtime (YB plan §9.4, YB-CP deliverable 5):
// ONE registry of every diagnostic code a learner can meet, by where it comes from, and the shape of a
// runtime error. The compilers, the validity layers, the generator and the interpreter keep emitting
// their own typed codes; tests tie each of those types to this registry, so a code cannot appear
// without being named here (and in the plan).

/** The compile codes of plan §9.4. Some belong to later phases (functions, display text, capabilities). */
export const plannedCompileDiagnosticCodes = [
  'not-in-profile',
  'not-eligible',
  'type-mismatch',
  'float-not-supported',
  'descending-range-not-supported',
  'value-out-of-range',
  'display-char-unsupported',
  'capability-unavailable',
  'program-too-large',
  'missing-return-value',
  'recursion-not-supported',
  'wrong-call-arity',
] as const;

/** Compile codes YB-2 added beyond the §9.4 list (plan, YB-2a implementation note 2). */
export const ybc2CompileDiagnosticCodes = [
  'malformed-program',
  'unknown-block',
  'duplicate-hat',
  'ignored-block',
  'unsupported-construct',
  'missing-input',
  'invalid-condition',
  'undefined-variable',
  'limit-exceeded',
] as const;

export const compileDiagnosticCodes = [...plannedCompileDiagnosticCodes, ...ybc2CompileDiagnosticCodes] as const;

/** Faults of a run: the program stops with one, naming the block (plan §6.3 "Domain guard", §6.7). */
export const runtimeDiagnosticCodes = ['out-of-domain', 'limit-exceeded', 'zero-division', 'internal-error'] as const;

/** The board context (plan §8.5, R-F5): why a document has no usable board. Run and the Python panel show the same. */
export const boardContextDiagnosticCodes = ['no-board', 'multiple-boards', 'incompatible-devices'] as const;

/** What the Python generator reports (YB-5A). */
export const generatorDiagnosticCodes = [
  'unsupported-node',
  'invalid-literal',
  'invalid-identifier',
  'unknown-variable',
  'type-mismatch',
  'value-out-of-range',
  'descending-range-not-supported',
  'limit-exceeded',
  'program-too-large',
] as const;

export type CompileDiagnosticCode = (typeof compileDiagnosticCodes)[number];
export type RuntimeDiagnosticCode = (typeof runtimeDiagnosticCodes)[number];
export type BoardContextDiagnosticCode = (typeof boardContextDiagnosticCodes)[number];
export type GeneratorDiagnosticCode = (typeof generatorDiagnosticCodes)[number];

export type DiagnosticCode = CompileDiagnosticCode | RuntimeDiagnosticCode | BoardContextDiagnosticCode | GeneratorDiagnosticCode;

/** Where a code comes from. */
export type DiagnosticOrigin = 'compile' | 'runtime' | 'board-context' | 'generator';

export const diagnosticCodesByOrigin: Readonly<Record<DiagnosticOrigin, readonly DiagnosticCode[]>> = {
  compile: compileDiagnosticCodes,
  runtime: runtimeDiagnosticCodes,
  'board-context': boardContextDiagnosticCodes,
  generator: generatorDiagnosticCodes,
};

/** A diagnostic as the learner meets it: structured, with the block when there is one, never a stack trace. */
export type Diagnostic<Code extends string = DiagnosticCode> = {
  severity: 'error' | 'warning';
  code: Code;
  message: string;
  blockId?: string;
  /** For the board-context codes: the components that are the problem. */
  componentIds?: string[];
};

/**
 * The runtime error of a run, as the snapshot carries it: the program stopped, with what happened and
 * (for a YBC fault) the code and the block. `code` is absent only for the legacy generic interpreter,
 * whose errors have none (GB4: its snapshot does not change).
 */
export type RuntimeError = { message: string; blockId?: string; code?: RuntimeDiagnosticCode };
