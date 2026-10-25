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
//
// N17 B4 adds the running time (a read of the run's clock) and a random number, whose two ends are expressions, evaluated in
// their order, each once. "A+B is pressed" needs no node of its own: the compiler writes the `and` of the two button reads.
//
// N17 B5 adds the two outputs of the Advanced board's pins, pin calls like a digital write: an analog write (a PWM duty) and a
// servo's angle, whose value is an expression; outside 0..1023 / 0..180 it is clamped when it runs, with a warning.
//
// N18 R2.3 (robot plan §4.4) adds what a board family decides about the language: the numeric model (Python's ints on Yolo:Bit,
// C++'s 32-bit `long` on the UNO) and the pause at the end of every forever iteration (10 ms on Yolo:Bit, none in Arduino's
// loop()). The compiler writes both for the uno family. A ybc IR leaves them out and means python and 10 000 µs: that is the IR
// every ybc program has compiled to since YB-2, kept byte for byte.
//
// N18 R2.2 (robot plan §4.4) adds the module ops of a uno program: `call` statements and `read` expressions on a role of the kit
// (`motor.set(motorLeft, speed)`), on the drive (both motors), on a raw pin of the board (Advanced), and the board's millis. The
// role, the direction and the pin are operands the block fixed; the speed, the angle, the Hz and ms, the PWM value and the on / off
// level are typed arguments. A typed-in number outside its range is written clamped by the compiler (with a warning), so the IR
// holds only numbers the generator can write as they are; a computed one is clamped when it runs. The raw pin ops are the header
// pin ops of YB-4 (same names, same node) with the pin as an operand instead of the argument `args[0]`: the operand tells them apart.

import type { HexColour } from '../capabilities/frame';
import type { BuiltinImageName } from '../constructs/ybc.images';
import type { AxisName, ButtonName, GestureName } from '../constructs/ybc.input';
import type { MelodyName, NoteName, NoteTicks } from '../constructs/ybc.sound';
import type { DriveDirection } from '../hardware/drivers';
import type { RobotRole } from '../hardware/kit';

export type Type = 'int' | 'bool' | 'str';

/**
 * The header-pin operations (plan §9.1 `OpId`). Each belongs to exactly one construct and one capability;
 * an op names what the program means, not the Python that says it. YB-4: the header pins (contract C-23,
 * C-24, C-25); the onboard ops of YB-3 are named in `CallStatement` and `ReadExpr`. A statement op and a value
 * op are different kinds of op.
 */
export type CallOp = 'digital.write' | 'pwm.write' | 'servo.write';
export type ReadOp = 'digital.read' | 'analogIn.read';

/**
 * N18 R2.3: what the ints of a program are. `python`: Python's ints on the safe-integer range, `//` floors, `%` takes the sign of
 * the divisor, a truth value prints True / False (Yolo:Bit, values.ts). `cxx-int32`: C++'s `long`, every result wrapped to 32
 * bits, `//` truncates, `%` takes the sign of the dividend, a division by zero gives 0, a truth value prints 1 / 0 (contract UNO §3).
 */
export type NumericModel = 'python' | 'cxx-int32';

export type YbcProgramIR = {
  onStart: YbcStatement[];
  /** null when the program has no forever block. */
  forever: YbcStatement[] | null;
  /**
   * N18 R2.4: the id of the `forever` hat block, when the program has one. The pause at the end of every forever iteration (Yolo:Bit's
   * 10 ms) is that block's, so it is the block the trace reports while the program waits there (`services.trace`). The compiler sets it
   * NON-ENUMERABLE (`withForeverBlockId`): the shape of a ybc IR is frozen since YB-2 (its keys are asserted by name, and a uno IR is
   * that IR plus the two keys of its family), and this is a name for tracing, not a part of the program. So it is not in `Object.keys`,
   * a spread, `toEqual` or JSON; an IR that lost it (a copy, a hand-made one) is paused with no report of its own, and the last
   * statement stays the one reported.
   */
  foreverBlockId?: string;
  /** Every variable of the workspace; all start at 0 (Basic: int only). */
  variables: { id: string; name: string; type: 'int' }[];
  /** N18 R2.3: the numeric model of the board family. Absent: `python` (every ybc IR). Read it with `numericOf`. */
  numeric?: NumericModel;
  /**
   * N18 R2.3: the program's own pause after every forever iteration, in µs: YBC_LOOP_PAUSE_US on Yolo:Bit (contract C-02, E3), 0 in
   * Arduino's loop() (contract UNO §4.1). Absent: YBC_LOOP_PAUSE_US (every ybc IR). Read it with `loopPauseUsOf`.
   */
  loopPauseUs?: number;
};

/** E3, contract C-02: every forever iteration of a Yolo:Bit program ends with a 10 ms sleep (`time.sleep_ms(10)`). */
export const YBC_LOOP_PAUSE_US = 10_000;

/** N18 R2.4: `ir` with its `foreverBlockId` set, the way the type says: a property of the object that no enumeration sees. */
export function withForeverBlockId(ir: YbcProgramIR, blockId: string): YbcProgramIR {
  return Object.defineProperty(ir, 'foreverBlockId', { value: blockId, enumerable: false });
}

export const numericOf = (ir: Pick<YbcProgramIR, 'numeric'>): NumericModel => ir.numeric ?? 'python';
export const loopPauseUsOf = (ir: Pick<YbcProgramIR, 'loopPauseUs'>): number => ir.loopPauseUs ?? YBC_LOOP_PAUSE_US;

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
  | PinCallStatement
  | ModuleCallStatement;

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
 * then checked against the construct's domain (contract C-23: `args` = [pin 0..2, value 0|1]; N17 B5, C-26 `pwm.write`:
 * [pin 0..2, duty, clamped to 0..1023]; C-27 `servo.write`: [pin 0..2, angle, clamped to 0..180]). One member per op, so
 * that a check of `op` tells a pin call from an onboard one.
 */
export type PinCallStatement = {
  [Op in CallOp]: {
    kind: 'call';
    op: Op;
    args: Expr[];
    /**
     * N18 R2.2: the pin of a uno program's raw pin op (Advanced: `digital.write`, contract UNO U-31: `args` = [level, a truth
     * value]; `pwm.write`, U-32: `args` = [value, clamped to 0..255]). Absent for a header pin of YB-4, whose pin is `args[0]`.
     */
    operand?: BoardPinOperand;
    blockId: string;
  };
}[CallOp];

/** N18 R2.2: a role of the kit (robot plan §4.2) the block names, in its dropdown or by itself (the LED, the buzzer). */
export type RoleOperand = { kind: 'role'; role: RobotRole };
/** N18 R2.2: where the drive goes (contract UNO U-21): (left, right) = (+s, +s), (−s, −s), (−s, +s), (+s, −s). */
export type DriveOperand = { kind: 'drive'; direction: DriveDirection };
/** N18 R2.2: a pin of the board the block names (`D5`, `A3`), Advanced only (contract UNO §9). */
export type BoardPinOperand = { kind: 'pin'; pin: string };

/**
 * N18 R2.2: a module op of a uno program (robot plan §4.4, contract UNO U-20…U-26), through the kit: role → port → driver. The
 * arguments are evaluated left to right, each once; an int outside its range is clamped (a typed-in one already by the compiler),
 * and the run warns once per role. `drive.move` evaluates the speed once and clamps it per motor after the sign of the direction.
 */
export type ModuleCallStatement =
  /** U-20: speed −100..100 (%), clamped. */
  | { kind: 'call'; op: 'motor.set'; operand: RoleOperand; args: [speed: Expr]; blockId: string }
  /** U-21: both motors, by the direction; the speed once, then each motor clamps its own. */
  | { kind: 'call'; op: 'drive.move'; operand: DriveOperand; args: [speed: Expr]; blockId: string }
  /** U-22: both motors 0. */
  | { kind: 'call'; op: 'drive.stop'; blockId: string }
  /** U-23: angle 0..180 (°), clamped. */
  | { kind: 'call'; op: 'servo.set'; operand: RoleOperand; args: [angle: Expr]; blockId: string }
  /** U-24: a truth value: on or off. */
  | { kind: 'call'; op: 'led.set'; operand: RoleOperand; args: [on: Expr]; blockId: string }
  /** U-25: hz 31..4000, ms 1..60000, clamped; plays in the background. */
  | { kind: 'call'; op: 'buzzer.tone'; operand: RoleOperand; args: [hz: Expr, ms: Expr]; blockId: string }
  /** U-26 (Advanced): the tone stops at once. */
  | { kind: 'call'; op: 'buzzer.stop'; operand: RoleOperand; blockId: string };

export type ModuleCallOp = ModuleCallStatement['op'];

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
  | RandomExpr
  | ModuleReadExpr
);

/**
 * N18 R2.2: a module read of a uno program (robot plan §4.4, contract UNO U-19, U-27…U-30). The `type` of the node is fixed by the
 * op: bool for `line.dark` and `button.pressed`, int for the others. Every read is a call into the board, which charges the program
 * clock what the board spends on it.
 */
export type ModuleReadExpr =
  /** U-27: whole cm, 2..400; no echo is 400. */
  | { kind: 'read'; op: 'ultrasonic.cm'; operand: RoleOperand }
  /** U-28: the sensor sees the dark line (the driver knows the kit's polarity). */
  | { kind: 'read'; op: 'line.dark'; operand: RoleOperand }
  /** U-29 (Advanced): the sensor's analog value, 0..1023. */
  | { kind: 'read'; op: 'line.raw'; operand: RoleOperand }
  /** U-30: the button is held down (its pin reads LOW). */
  | { kind: 'read'; op: 'button.pressed'; operand: RoleOperand }
  /** U-19 (Advanced): `(long)millis()`, the board's whole ms since setup() began. */
  | { kind: 'read'; op: 'time.millis' };

export type ModuleReadOp = ModuleReadExpr['op'];

/** N18 R2.2: the ops of a uno program (robot plan §4.4): through the kit, and on a raw pin of the board (Advanced). */
export type UnoCallOp = ModuleCallOp | 'digital.write' | 'pwm.write';
export type UnoReadOp = ModuleReadOp | 'digital.read' | 'analogIn.read';

const moduleCallOps: ReadonlySet<string> = new Set<ModuleCallOp>(['motor.set', 'drive.move', 'drive.stop', 'servo.set', 'led.set', 'buzzer.tone', 'buzzer.stop']);
const moduleReadOps: ReadonlySet<string> = new Set<ModuleReadOp>(['ultrasonic.cm', 'line.dark', 'line.raw', 'button.pressed', 'time.millis']);

/** N18 R2.2: whether a statement is a module op of a uno program. */
export function isModuleCall(statement: YbcStatement): statement is ModuleCallStatement {
  return statement.kind === 'call' && moduleCallOps.has(statement.op);
}

/** N18 R2.2: whether an expression is a module read of a uno program. */
export function isModuleRead(expr: Expr): expr is Expr & ModuleReadExpr {
  return expr.kind === 'read' && moduleReadOps.has(expr.op);
}

/** N18 R2.2: whether a pin op is a uno program's raw pin (its pin an operand), not a header pin of YB-4. */
export const isBoardPinOp = (node: PinCallStatement | PinReadExpr): node is (PinCallStatement | PinReadExpr) & { operand: BoardPinOperand } =>
  node.operand?.kind === 'pin';

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
  | { kind: 'read'; op: 'motion.isGesture'; operand: GestureOperand }
  /** C-19 (N17 B4): the whole milliseconds since the program started, on the run's clock. */
  | { kind: 'read'; op: 'time.runningTime' };

/**
 * C-40 (N17 B4): a whole number from one end to the other, both included. The ends are evaluated in their order, each once, and
 * checked (each within ±MAX_RANDOM_ABS, at most MAX_RANDOM_SPAN apart); they may come in either order. An int.
 */
export type RandomExpr = { kind: 'read'; op: 'random.int'; args: [from: Expr, to: Expr] };

/**
 * A header-pin read (YB-4, plan §9.1). `digital.read` is a bool (the pin is high), `analogIn.read` an int on the
 * board's native scale 0..4095 (contract C-24, C-25). The argument is the pin number. One member per op, so that a
 * check of `op` tells a pin read from an onboard one.
 */
export type PinReadExpr = {
  [Op in ReadOp]: {
    kind: 'read';
    op: Op;
    args: Expr[];
    /**
     * N18 R2.2: the pin of a uno program's raw pin read (Advanced: `digital.read`, contract UNO U-33, a bool; `analogIn.read`, U-34,
     * an int 0..1023), with no argument. Absent for a header pin of YB-4, whose pin is `args[0]`.
     */
    operand?: BoardPinOperand;
  };
}[ReadOp];
