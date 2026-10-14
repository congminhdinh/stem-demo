// YBC IR (YB plan §9.0, §9.1): the program dialect of Yolo:Bit-compatible
// projects. It is a separate type from the legacy `ProgramIR` in `ir.ts`,
// which stays exactly as it is; neither dialect is converted to the other.
//
// YB-2: typed expressions over int, bool and str, integer variables, `if` with
// `elif`, `repeat`, `while`, `count up`, `wait`, `print`, text `join`. Every
// `Expr` carries its static `type`, decided by the compiler; the interpreter
// checks it defensively. The IR says WHAT the learner program means; when it
// yields to the browser is the interpreter's business. Capability ops,
// functions and handlers arrive with the later phases. Hardware
// operands (images, melodies, pins) are never values. The IR holds no Blockly
// object and is never persisted.

export type Type = 'int' | 'bool' | 'str';

export type YbcProgramIR = {
  onStart: YbcStatement[];
  /** null when the program has no forever block. */
  forever: YbcStatement[] | null;
  /** Every variable of the workspace; all start at 0 (Basic: int only). */
  variables: { id: string; name: string; type: 'int' }[];
};

export type YbcStatement =
  /** A block the profile exposes that has no behaviour (the test-only marker of the profile fixtures). */
  | { kind: 'noop'; blockId: string }
  | { kind: 'set'; variable: string; value: Expr; blockId: string }
  /** The first branch whose condition holds runs (later conditions are not evaluated), else `else`. */
  | { kind: 'if'; branches: { condition: Expr; body: YbcStatement[] }[]; else: YbcStatement[]; blockId: string }
  | { kind: 'print'; value: Expr; blockId: string }
  /** `times` is evaluated once; abs(times) ≤ MAX_REPEAT_ABS, else out-of-domain; times ≤ 0 runs zero times (Python range). */
  | { kind: 'repeat'; times: Expr; body: YbcStatement[]; blockId: string }
  | { kind: 'while'; condition: Expr; body: YbcStatement[]; blockId: string }
  /**
   * Python `for variable in range(from, to + 1, step)`, with the evaluation made explicit (contract §3.3):
   * `from` is evaluated and checked, then `to` is evaluated and checked, each exactly once, before the loop.
   * `step` is a literal. The variable is assigned at the start of every iteration.
   */
  | { kind: 'countUp'; variable: string; from: Expr; to: Expr; step: number; body: YbcStatement[]; blockId: string }
  /** `ms` is an int in 0..MAX_WAIT_MS, else out-of-domain. */
  | { kind: 'waitMs'; ms: Expr; blockId: string };

export type ArithOp = '+' | '-' | '*' | '//' | '%';
export type CompareOp = '==' | '!=' | '<' | '<=' | '>' | '>=';

export type Expr = { type: Type; blockId: string } & (
  | { kind: 'int'; value: number }
  | { kind: 'bool'; value: boolean }
  | { kind: 'str'; value: string }
  | { kind: 'variable'; variable: string }
  | { kind: 'arith'; op: ArithOp; left: Expr; right: Expr }
  | { kind: 'compare'; op: CompareOp; left: Expr; right: Expr }
  | { kind: 'logic'; op: 'and' | 'or'; left: Expr; right: Expr }
  | { kind: 'not'; value: Expr }
  /** Text join: every part goes through str(); the result is at most MAX_TEXT_CHARS characters. */
  | { kind: 'join'; parts: Expr[] }
);
