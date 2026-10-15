// YBC IR (YB plan §9.0, §9.1): the program dialect of Yolo:Bit-compatible
// projects. It is a separate type from the legacy `ProgramIR` in `ir.ts`,
// which stays exactly as it is; neither dialect is converted to the other.
//
// YB-2: typed expressions over int, bool and str, integer variables, `if` with
// `elif`, `repeat`, `while`, `count up`, `wait`, `print`, text `join`. Every
// `Expr` carries its static `type`, decided by the compiler; the interpreter
// checks it defensively. The IR says WHAT the learner program means; when it
// yields to the browser is the interpreter's business. Functions and
// handlers arrive with the later phases. Hardware
// operands (images, notes, buttons, pins) are never values. The IR holds no Blockly
// object and is never persisted.
//
// YB-3 adds the onboard hardware (contract §4–§8): `call` statements and `read`
// expressions, one `op` per contract row, each carrying what the block fixed in
// its own fields as an operand. An operand is not a value: it cannot be stored in
// a variable, compared, printed or passed on (plan §9.1, F3-A).

import type { ButtonName } from '../constructs/ybc.input';
import type { NoteName, NoteTicks } from '../constructs/ybc.sound';

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
  | { kind: 'waitMs'; ms: Expr; blockId: string }
  | CallStatement;

/**
 * An operation on an onboard part (YB-3). The contract row of each is in `constructs/ybc.*.ts`.
 * Timing (a scrolling text, a note) belongs to the operation, not to the part: the interpreter waits.
 */
export type CallStatement =
  /** C-06: the picture replaces the whole frame; does not wait. */
  | { kind: 'call'; op: 'display.show'; operand: ImageOperand; blockId: string }
  /** C-07: a text of the display's characters (ASCII 0x20–0x7E, else out-of-domain). One character stays; two or more scroll and block. */
  | { kind: 'call'; op: 'display.scrollText'; args: [text: Expr]; blockId: string }
  /** C-08: an int, shown as str(n). */
  | { kind: 'call'; op: 'display.scrollNumber'; args: [value: Expr]; blockId: string }
  /** C-09: every light off; does not wait. */
  | { kind: 'call'; op: 'display.clear'; blockId: string }
  /** C-50: the note sounds for `ticks` ticks, and the statement waits that long. */
  | { kind: 'call'; op: 'sound.playNote'; operand: NoteOperand; blockId: string }
  /** C-51: silence for `ticks` ticks, and the statement waits that long. */
  | { kind: 'call'; op: 'sound.rest'; operand: RestOperand; blockId: string };

/** C-06: the learner's own picture, 25 cells row by row from the top left; a lit cell is red (digit 1), the others off (digit 0). */
export type ImageOperand = { kind: 'image'; image: { source: 'custom'; pixels: readonly boolean[] } };
export type NoteOperand = { kind: 'note'; note: NoteName; ticks: NoteTicks };
export type RestOperand = { kind: 'rest'; ticks: NoteTicks };
export type ButtonOperand = { kind: 'button'; button: ButtonName };

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
  | ReadExpr
);

/**
 * A read of an onboard part (YB-3). The `type` of the node is fixed by the op: bool for `button.isPressed`,
 * int for the others.
 */
export type ReadExpr =
  /** C-12: true while the button is held at the call; not latched. */
  | { kind: 'read'; op: 'button.isPressed'; operand: ButtonOperand }
  /** C-13: the presses since the last read of this button, which resets the count to 0. */
  | { kind: 'read'; op: 'button.getPresses'; operand: ButtonOperand }
  /** C-15: an int from 0 (darkest) to 100 (brightest). */
  | { kind: 'read'; op: 'light.level' };
