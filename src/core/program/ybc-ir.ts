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
//
// YB-4 adds the header pins (contract C-23…C-25): `call` / `read` ops whose
// arguments are expressions, evaluated left to right, each once.
//
// N17 B1 adds the RGB display: a colour is an operand (the compiler has already
// made it one of the palette, as a frame holds it), the built-in pictures are a
// second source of image, and set / clear pixel take the column and the row as
// expressions, like the pins.
//
// N17 B2 adds the sensors of the Advanced board: the temperature, the acceleration along an axis and whether the board
// makes a gesture, each a read; the axis and the gesture are operands, as the button is.
//
// N17 B3 adds the rest of the buzzer for the Advanced board: a built-in melody (its name and whether the program waits for it
// are an operand, from the block's fields), a tone whose Hz and ms are expressions, and stop.

import type { HexColour } from '../capabilities/frame';
import type { BuiltinImageName } from '../constructs/ybc.images';
import type { AxisName, ButtonName, GestureName } from '../constructs/ybc.input';
import type { MelodyName, NoteName, NoteTicks } from '../constructs/ybc.sound';

export type Type = 'int' | 'bool' | 'str';

/**
 * The header-pin operations (plan §9.1 `OpId`). Each belongs to exactly one construct and one capability;
 * an op names what the program means, not the Python that says it. YB-4: the header pins (contract C-23,
 * C-24, C-25); the onboard ops of YB-3 are named in `CallStatement` and `ReadExpr`. A statement op and a value
 * op are different kinds of op.
 */
export type CallOp = 'digital.write';
export type ReadOp = 'digital.read' | 'analogIn.read';

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
  | CallStatement
  | PinCallStatement;

/**
 * An operation on an onboard part (YB-3). The contract row of each is in `constructs/ybc.*.ts`.
 * Timing (a scrolling text, a note) belongs to the operation, not to the part: the interpreter waits.
 */
export type CallStatement =
  /** C-06 / C-05: the picture replaces the whole frame; does not wait. */
  | { kind: 'call'; op: 'display.show'; operand: ImageOperand; blockId: string }
  /**
   * C-07: a text of the display's characters (ASCII 0x20–0x7E, else out-of-domain). One character stays; two or more scroll and
   * block. The colour (N17) is red when absent: a block saved before N17.
   */
  | { kind: 'call'; op: 'display.scrollText'; args: [text: Expr]; operand?: ColourOperand; blockId: string }
  /** C-08: an int, shown as str(n), in the colour (red when absent). */
  | { kind: 'call'; op: 'display.scrollNumber'; args: [value: Expr]; operand?: ColourOperand; blockId: string }
  /** C-09: every light off; does not wait. */
  | { kind: 'call'; op: 'display.clear'; blockId: string }
  /** C-10: the light at column x, row y (each 0..4, else out-of-domain) in the colour; the rest of the frame stays. */
  | { kind: 'call'; op: 'display.setPixel'; args: [x: Expr, y: Expr]; operand: ColourOperand; blockId: string }
  /** C-42: the light at column x, row y off; the rest of the frame stays. */
  | { kind: 'call'; op: 'display.clearPixel'; args: [x: Expr, y: Expr]; blockId: string }
  /** C-43: all 25 lights in the colour. */
  | { kind: 'call'; op: 'display.setAll'; operand: ColourOperand; blockId: string }
  /** C-50: the note sounds for `ticks` ticks, and the statement waits that long. */
  | { kind: 'call'; op: 'sound.playNote'; operand: NoteOperand; blockId: string }
  /** C-51: silence for `ticks` ticks, and the statement waits that long. */
  | { kind: 'call'; op: 'sound.rest'; operand: RestOperand; blockId: string }
  /**
   * C-20 (N17 B3): a built-in melody. `wait`: the statement waits until its last note; otherwise it plays in the background, on
   * timers of the run, while the program goes on. Either way it first ends the sound that plays (one sound at a time).
   */
  | { kind: 'call'; op: 'sound.playMelody'; operand: MelodyOperand; blockId: string }
  /**
   * C-21 (N17 B3): a tone of `hz` (20..20000, else out-of-domain) for `ms` (0..60000, else out-of-domain), evaluated in that order,
   * each once. It does not wait (EVD-06): it ends the sound that plays and sounds in the background for `ms`.
   */
  | { kind: 'call'; op: 'sound.pitch'; args: [hz: Expr, ms: Expr]; blockId: string }
  /** C-22 (N17 B3): silence at once, whatever plays in the background. */
  | { kind: 'call'; op: 'sound.stop'; blockId: string };

/**
 * A header-pin operation with side effects (YB-4, plan §9.1). The arguments are evaluated left to right, each once,
 * then checked against the construct's domain (contract C-23: `args` = [pin 0..2, value 0|1]). One member per op, so
 * that a check of `op` tells a pin call from an onboard one.
 */
export type PinCallStatement = { [Op in CallOp]: { kind: 'call'; op: Op; args: Expr[]; blockId: string } }[CallOp];

/**
 * C-06: the learner's own picture, 25 cells row by row from the top left; a lit cell is in `colour` (red when absent: a picture
 * saved before N17), the others off. C-05: one of the built-in pictures, in red.
 */
export type ImageOperand = {
  kind: 'image';
  image: { source: 'custom'; pixels: readonly boolean[]; colour?: HexColour } | { source: 'builtin'; name: BuiltinImageName };
};
/** A colour of the palette, as a frame holds it ('#RRGGBB'). */
export type ColourOperand = { kind: 'colour'; colour: HexColour };
export type NoteOperand = { kind: 'note'; note: NoteName; ticks: NoteTicks };
export type RestOperand = { kind: 'rest'; ticks: NoteTicks };
export type MelodyOperand = { kind: 'melody'; melody: MelodyName; wait: boolean };
export type ButtonOperand = { kind: 'button'; button: ButtonName };
export type AxisOperand = { kind: 'axis'; axis: AxisName };
export type GestureOperand = { kind: 'gesture'; gesture: GestureName };

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
  | PinReadExpr
);

/**
 * A read of an onboard part (YB-3, N17 B2). The `type` of the node is fixed by the op: bool for `button.isPressed` and
 * `motion.isGesture`, int for the others.
 */
export type ReadExpr =
  /** C-12: true while the button is held at the call; not latched. */
  | { kind: 'read'; op: 'button.isPressed'; operand: ButtonOperand }
  /** C-13: the presses since the last read of this button, which resets the count to 0. */
  | { kind: 'read'; op: 'button.getPresses'; operand: ButtonOperand }
  /** C-15: an int from 0 (darkest) to 100 (brightest). */
  | { kind: 'read'; op: 'light.level' }
  /** C-16 (N17 B2): whole degrees Celsius, −10..50 in the simulator. */
  | { kind: 'read'; op: 'temperature.read' }
  /** C-17 (N17 B2): the acceleration along the axis, whole mg in −2048..2048. */
  | { kind: 'read'; op: 'motion.acceleration'; operand: AxisOperand }
  /** C-18 (N17 B2): true while the board makes the gesture (shake: for 1 s after it). */
  | { kind: 'read'; op: 'motion.isGesture'; operand: GestureOperand };

/**
 * A header-pin read (YB-4, plan §9.1). `digital.read` is a bool (the pin is high), `analogIn.read` an int on the
 * board's native scale 0..4095 (contract C-24, C-25). The argument is the pin number. One member per op, so that a
 * check of `op` tells a pin read from an onboard one.
 */
export type PinReadExpr = { [Op in ReadOp]: { kind: 'read'; op: Op; args: Expr[] } }[ReadOp];
