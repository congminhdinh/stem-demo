import { blankFrame, type Frame, type HexColour } from '../capabilities/frame';
import type { ButtonId, Capabilities, CapabilityKey } from '../capabilities/io';
import type { RuntimeServices } from '../capabilities/services';
import { DEFAULT_COLOUR, IMAGE_SIZE, isDisplayText, paletteColourOf } from '../constructs/ybc.display';
import { isBuiltinImageName } from '../constructs/ybc.images';
import { isAxisName, isGestureName } from '../constructs/ybc.input';
import { clampWarning, runPinCall, runPinRead, type ClampedValue } from '../constructs/ybc.pins';
import { runBoardPinCall, runBoardPinRead, runModuleCall, runModuleRead, type UnoClamp } from '../constructs/uno.run';
import { isMelodyName, noteTicks, PITCH_MAX_HZ, PITCH_MAX_MS, PITCH_MIN_HZ } from '../constructs/ybc.sound';
import {
  charactersOf,
  clearPixelFrame,
  iconFrame,
  imageFrame,
  SCROLL_STEP_MS,
  scrollFrame,
  scrollSteps,
  setAllFrame,
  setPixelFrame,
} from '../simulation/peripherals/display';
import { ACCELERATION_LIMIT_MG } from '../simulation/peripherals/accelerometer';
import { LIGHT_LEVEL_MAX, LIGHT_LEVEL_MIN } from '../simulation/peripherals/light';
import { TEMPERATURE_MAX, TEMPERATURE_MIN } from '../simulation/peripherals/temperature';
import { melodySteps } from '../simulation/peripherals/melodies';
import { NOTE_TICK_MS, noteHz } from '../simulation/peripherals/sound';
import type { RunOutcome } from './interpreter';
import { MAX_RANDOM_ABS, MAX_RANDOM_SPAN, MAX_TEXT_CHARS, MAX_WAIT_MS, numericDomains } from './limits';
import * as values from './values';
import { RuntimeFault, type Value } from './values';
import {
  isBoardPinOp,
  isModuleCall,
  isModuleRead,
  loopPauseUsOf,
  numericOf,
  type ArithOp,
  type BoardPinOperand,
  type ButtonOperand,
  type CallStatement,
  type ColourOperand,
  type Expr,
  type ImageOperand,
  type ModuleCallStatement,
  type NumericModel,
  type PinCallStatement,
  type RandomExpr,
  type ReadExpr,
  type YbcProgramIR,
  type YbcStatement,
} from './ybc-ir';

// The YBC interpreter (YB plan §9.0, §9.3): runs a `YbcProgramIR`. It reaches
// the world only through `services` and knows nothing about circuits or UI.
// Every operation is the one in `values.ts` (Python's semantics on the supported
// domain), `and` / `or` short-circuit, and a fault ends the program at the block
// that caused it. The legacy `runProgram` is not touched.
//
// It is one async function on the main thread. Loops are plain loops, not
// recursion, so a million iterations use no more stack than one. Every statement
// and every loop iteration is a budget step, and every expression node counts as
// work towards the next one (execution-budget.ts): Stop is seen at the next step,
// and a program that computes for longer than a slice lets the browser run before
// it goes on. That yield is not program semantics; the
// program's own pauses are `wait` and the 10 ms at the end of each `forever`
// iteration, and those go through `services.sleep`, which Stop also interrupts.
//
// The onboard hardware (YB-3) is reached only through `capabilities`: the display, the buttons, the light
// sensor and the sound. A scrolling text and a note take time, and that time is the statement's own
// (contract C-07, C-50): the interpreter waits with `services.sleep`, one column or one note at a time, so
// Stop interrupts it at the next step and no timer outlives the run.
//
// N17 B1: the display keeps what it shows. Every frame the program gives it goes through `show`, so set / clear
// pixel change one light of the frame on the display (a picture, a still character, a fill) and leave the rest.
// A colour comes from the compiler as one of the palette; IR from anywhere else with another value is shown red,
// never a crash (Review Focus 3).
//
// N17 B2: the temperature, the acceleration and the gesture are reads of the `temperature` and `motion` capabilities at the
// moment of the call; a reading outside its domain (a broken capability) is an internal error, never a crash.
//
// N17 B3: the buzzer plays one sound at a time, as the micro:bit `music` module does. A note, a rest, a melody that waits, a
// melody in the background, a tone and stop each end the sound that plays first. What sounds in the background (a melody that
// does not wait, a tone: music.pitch does not wait, EVD-06) plays on the run's scheduler while the program goes on; it plays out
// after a program that finished, and ends at once with a program that is stopped, replaced or ends in an error (Review Focus 1).
//
// N17 B4: the running time is the whole milliseconds on the run's clock since the program started. A random number evaluates its
// ends in their order, each once, checks each as soon as it is known, then their distance, and draws from the run's `randomInt`
// with the lower end first (the ends may come in either order); a number outside them is an internal error, never a crash.
//
// N17 B5: an analog write (a PWM duty) and a servo's angle are pin calls, their arguments evaluated as a digital write's are. A value
// outside 0..1023 / 0..180 is clamped (constructs/ybc.pins.ts) and the run is warned through `services.warn`, once per pin and kind;
// the program goes on.
//
// N18 R2.3: the numeric model and the forever pause come from the IR (robot plan §4.4). `python` and 10 ms (a ybc IR) are exactly
// what they always were. A uno IR computes with C++'s `long` (values.ts `valuesFor`, contract UNO §3: a division by zero gives 0 and
// warns once per block in the run, U-06), takes the loop domains of its model (limits.ts `numericDomains`), and its forever has no pause of its own:
// every iteration is a `budget.loopIteration()`, which the virtual budget of a robot run charges (run/virtual-clock.ts). Every
// statement still begins with its budget step, then names its block: the one place a per-statement hook belongs.
//
// N18 R2.4: that hook is `services.trace(blockId)`, called right after the statement names its block (so a Stop that the step sees
// reports nothing), and once more with the `forever` hat at the end of every iteration when the IR names it (`foreverBlockId`: a uno
// IR does; that is the time between two loop() iterations, and the loop's pause if it has one). A ybc IR has no hat name, so its
// 10 ms pause tells nothing new: the last statement of the body stays the one reported. A `wait`, a scrolling text or a note is its
// own statement, so while it waits it is the block the last report named. `trace` is optional and only ever told a block id: a run
// without it is what it was.
//
// N18 R2.2: the module ops of a uno program (robot plan §4.4) reach the robot through `capabilities.modules` (role → port → driver,
// hardware/binding.ts), its raw pins through the virtual UNO's `digital`, `pwm` and `analogIn`. An int argument outside its range is
// clamped and the run warned once per role (a raw pin: per pin) in a run, with the block (constructs/uno.run.ts). Every module op,
// and every read of one inside an expression, first gives the budget its `atHardware()`: the virtual budget parks a program whose
// clock has reached world.t + dt, so the op happens inside the tick of its time even after an earlier read of the same statement
// took the clock past it (an ultrasonic read without an echo charges 20.8 ms). An expression with such a read is evaluated by
// `evaluateReading`, which waits there; every other expression, and every expression of a ybc program, as before.
//
// N18 P1: a uno program runs some 100 to 300 statements and hardware reads in every tick of the robot lab (120 Hz), so its path
// allocates nothing unless it really waits. Its statements run in `runUno`, one async function over an explicit stack of frames (a
// block, a loop), instead of an async call per block and an `await` per statement: what each statement does, in what order, with which
// budget steps, block names and traces, is `runStatements`'s, and the program awaits only a promise it is given (a step that parks or
// yields, a read or an op that waits for the world, a wait). Only the turns of the event loop between statements are gone, and nothing
// observes them: a robot run's clock moves by what is charged to it alone (run/virtual-clock.ts), and a run waits for the program to be
// blocked. `evaluateReading` and `runModule` give their result at once when nothing waits, and a promise of it when something does. A
// ybc program keeps `runStatements`, as it was.

/** One note or rest of a melody (or a tone), for `ms`; `hz` null is silence. */
type Sounding = { hz: number | null; ms: number };

/**
 * N18 P1: a block of statements or a loop under way in `runUno`'s stack, reused from one push at its depth to the next (a frame per
 * depth, made once). Each kind reads its own fields.
 */
type StackFrame = {
  kind: 'block' | 'repeat' | 'while' | 'countUp';
  /** A block's statements; a loop's body. */
  statements: readonly YbcStatement[];
  /** block: the next statement. */
  index: number;
  /** repeat: the iterations begun; countUp: the counter. */
  count: number;
  /** repeat: the number of repetitions; countUp: the end. */
  limit: number;
  /** while: its condition. */
  condition: Expr | null;
  /** countUp: its variable and step, and whether the first iteration has begun (the counter moves before each one after it). */
  variable: string;
  step: number;
  started: boolean;
};

/** The arguments of an op that has none. */
const NO_VALUES: readonly Value[] = Object.freeze([]);

/** N18 R2.2: a raw pin op of a uno program, its pin an operand. */
type BoardPinCall = PinCallStatement & { operand: BoardPinOperand };

const isNumericModel = (numeric: unknown): numeric is NumericModel => numeric === 'python' || numeric === 'cxx-int32';

/** N18 R2.3: the warning of a division or a remainder by zero in a cxx-int32 program (contract UNO §3.1, U-06): once per block in a run. */
const divisionByZeroWarning = { code: 'division-by-zero', message: 'A division or a remainder by 0 gave 0, as on the board.' } as const;

/** A runtime fault carries a diagnostic code that the legacy outcome has no field for. */
export type YbcRunOutcome =
  | Exclude<RunOutcome, { status: 'error' }>
  | { status: 'error'; code: RuntimeFault['code']; message: string; blockId?: string };

/** The program starts after `runYbcProgram` returns. Stop is the abort of `services.signal`, owned by the run's creator. */
export type YbcProgramRun = { done: Promise<YbcRunOutcome> };

/**
 * Runs a program with the capabilities of its board and the services of its run (plan §9.0, §10). Both come from
 * RunSession and are the run's own. The language needs no capability; the hardware operations of the IR (YB-3: the
 * onboard parts; YB-4: the header pins) reach the board through them, and nowhere else. A capability the board has
 * not got is an internal error, never a crash (the compiler has already refused such a program with
 * `capability-unavailable`). Like `runProgram`, `done` never rejects.
 */
export function runYbcProgram(ir: YbcProgramIR, capabilities: Capabilities, services: RuntimeServices): YbcProgramRun {
  return { done: Promise.resolve().then(() => execute(ir, capabilities, services)) };
}

async function execute(ir: YbcProgramIR, capabilities: Capabilities, services: RuntimeServices): Promise<YbcRunOutcome> {
  const { budget, signal } = services;
  // The slice of a run starts when the program does, not when its services were built.
  budget.startSlice();
  // N17 B4: what the running time counts from.
  const startedAt = services.clock.now();
  let blockId: string | undefined;
  const variables = new Map<string, Value>(ir.variables.map((variable) => [variable.id, values.int(0)]));

  // N18 R2.3: the numeric model and the forever pause of the board family. IR that is not the compiler's is refused when the program
  // starts (an internal error, never a crash); until then the python model stands in.
  const numeric = numericOf(ir);
  const loopPauseUs = loopPauseUsOf(ir);
  /** The blocks whose division by zero the run was warned about. */
  const divisionByZeroWarned = new Set<string | undefined>();
  const ops = values.valuesFor(isNumericModel(numeric) ? numeric : 'python', {
    divisionByZero() {
      // The arithmetic block that divides: `evaluate` names it just before the operation.
      const at = blockId;
      if (!divisionByZeroWarned.has(at)) {
        divisionByZeroWarned.add(at);
        services.warn(at === undefined ? divisionByZeroWarning : { ...divisionByZeroWarning, blockId: at });
      }
    },
  });
  const domains = numericDomains[ops.model];

  /** A part of the board the program reaches. Missing means the factory did not provide what the board promised. */
  const part = <Key extends CapabilityKey>(key: Key): NonNullable<Capabilities[Key]> => {
    const found = capabilities[key];
    if (found === undefined) {
      throw new RuntimeFault('internal-error', 'The board is missing a part this block needs.');
    }
    return found;
  };

  /** N17 B5: the pins and kinds (`pwm.write:P0`) whose clamped value the run was warned about: once each in a run. */
  const clampWarned = new Set<string>();
  const warnClamped = (clamped: ClampedValue) => {
    const key = `${clamped.op}:${clamped.pin}`;
    if (!clampWarned.has(key)) {
      clampWarned.add(key);
      services.warn(clampWarning(clamped));
    }
  };

  /** N18 R2.2: the roles and pins whose clamped value the run was warned about (contract UNO §0.5): once each in a run. */
  const unoClampWarned = new Set<string>();
  const warnUnoClamp = (clamp: UnoClamp) => {
    if (!unoClampWarned.has(clamp.key)) {
      unoClampWarned.add(clamp.key);
      services.warn(blockId === undefined ? clamp.warning : { ...clamp.warning, blockId });
    }
  };

  /**
   * N18 R2.2: the program reaches the hardware; the virtual budget may first hold it until the world is at its time. N18 P1: undefined
   * when it goes on at once, else the promise to await first.
   */
  const atHardware = (): Promise<void> | undefined => {
    const wait = budget.atHardware?.();
    return wait ? Promise.resolve(wait) : undefined;
  };

  /** N18 R2.2: the expressions of a uno program that read the hardware, at any depth: what `evaluateReading` evaluates. */
  const reading = ops.model === 'cxx-int32' ? readingExpressions(ir) : new WeakSet<Expr>();

  /** What the display shows now: the frame the program gave it last. It starts dark, as RunSession's display does. */
  let shown: Frame = blankFrame();
  const show = (frame: Frame) => {
    part('display').setFrame(frame);
    shown = frame;
  };

  /** The colour of an operand: the compiler's palette colour, or red for IR that is not the compiler's (never a crash). */
  const colourOf = (operand: ColourOperand | undefined): HexColour => (operand === undefined ? DEFAULT_COLOUR : (paletteColourOf(operand.colour) ?? DEFAULT_COLOUR));

  /** The frame of a picture operand: the learner's own in its colour (red when it has none), or a built-in one. */
  const pictureOf = (operand: ImageOperand): Frame => {
    const { image } = operand;
    if (image.source === 'builtin') {
      if (!isBuiltinImageName(image.name)) {
        throw new RuntimeFault('internal-error', 'A picture block names a picture that does not exist.');
      }
      return iconFrame(image.name);
    }
    return imageFrame(image.pixels, image.colour === undefined ? DEFAULT_COLOUR : (paletteColourOf(image.colour) ?? DEFAULT_COLOUR));
  };

  /** C-10, C-42: the column and the row, evaluated left to right, each once, then checked against 0..4 (contract domain). */
  const cellOf = (args: readonly Expr[]): [x: number, y: number] => {
    const [xExpr, yExpr] = args;
    if (args.length !== 2 || xExpr === undefined || yExpr === undefined) {
      throw new RuntimeFault('internal-error', 'A light block was given the wrong number of values.');
    }
    const x = values.asInt(evaluate(xExpr));
    const y = values.asInt(evaluate(yExpr));
    for (const [what, value, expr] of [['The column', x, xExpr], ['The row', y, yExpr]] as const) {
      if (value < 0 || value > IMAGE_SIZE - 1) {
        blockId = expr.blockId;
        throw new RuntimeFault('out-of-domain', `${what} must be between 0 and ${IMAGE_SIZE - 1}, not ${value}.`);
      }
    }
    return [x, y];
  };

  const buttonOf = (operand: ButtonOperand): ButtonId => {
    if (operand.button !== 'A' && operand.button !== 'B') {
      throw new RuntimeFault('internal-error', 'A button block names a button that does not exist.');
    }
    return operand.button === 'A' ? 'a' : 'b';
  };

  /** C-12, C-13, C-15, and C-16…C-18 (N17 B2): what the learner reads from an onboard part, at the moment of the call. */
  const readPart = (expr: ReadExpr): Value => {
    switch (expr.op) {
      case 'button.isPressed':
        return values.bool(part('buttons').isPressed(buttonOf(expr.operand)));
      case 'button.getPresses': {
        const buttons = part('buttons');
        if (buttons.takePresses === undefined) {
          throw new RuntimeFault('internal-error', 'The board cannot count presses.');
        }
        const presses = buttons.takePresses(buttonOf(expr.operand));
        if (!Number.isSafeInteger(presses) || presses < 0) {
          throw new RuntimeFault('internal-error', 'The press count is not a whole number.');
        }
        return values.int(presses);
      }
      case 'light.level': {
        const level = part('light').lightLevel();
        if (!Number.isInteger(level) || level < LIGHT_LEVEL_MIN || level > LIGHT_LEVEL_MAX) {
          throw new RuntimeFault('internal-error', 'The light level is not a whole number from 0 to 100.');
        }
        return values.int(level);
      }
      case 'temperature.read': {
        const degrees = part('temperature').temperature();
        if (!Number.isInteger(degrees) || degrees < TEMPERATURE_MIN || degrees > TEMPERATURE_MAX) {
          throw new RuntimeFault('internal-error', `The temperature is not a whole number from ${TEMPERATURE_MIN} to ${TEMPERATURE_MAX}.`);
        }
        return values.int(degrees);
      }
      case 'motion.acceleration': {
        const { axis } = expr.operand;
        if (!isAxisName(axis)) {
          throw new RuntimeFault('internal-error', 'An acceleration block names an axis that does not exist.');
        }
        const reading = part('motion').acceleration(axis);
        if (!Number.isInteger(reading) || Math.abs(reading) > ACCELERATION_LIMIT_MG) {
          throw new RuntimeFault('internal-error', `The acceleration is not a whole number from -${ACCELERATION_LIMIT_MG} to ${ACCELERATION_LIMIT_MG}.`);
        }
        return values.int(reading);
      }
      case 'motion.isGesture': {
        const { gesture } = expr.operand;
        if (!isGestureName(gesture)) {
          throw new RuntimeFault('internal-error', 'A gesture block names a gesture that does not exist.');
        }
        const motion = part('motion');
        if (motion.gesture === undefined) {
          throw new RuntimeFault('internal-error', 'The board cannot tell its gesture.');
        }
        return values.bool(motion.gesture() === gesture);
      }
      case 'time.runningTime':
        return values.checkedInt(Math.max(0, Math.floor(services.clock.now() - startedAt)), 'The running time');
    }
  };

  /** C-40 (N17 B4): the ends in their order, each once and checked when it is known, then their distance; low first to the service. */
  const randomNumber = (expr: Expr & RandomExpr): Value => {
    const [fromExpr, toExpr] = expr.args;
    if (expr.args.length !== 2 || fromExpr === undefined || toExpr === undefined) {
      throw new RuntimeFault('internal-error', 'A random block was given the wrong number of values.');
    }
    const first = intWithin(fromExpr, -MAX_RANDOM_ABS, MAX_RANDOM_ABS, 'A bound of a random number');
    const second = intWithin(toExpr, -MAX_RANDOM_ABS, MAX_RANDOM_ABS, 'A bound of a random number');
    blockId = expr.blockId;
    const low = Math.min(first, second);
    const high = Math.max(first, second);
    if (high - low > MAX_RANDOM_SPAN) {
      throw new RuntimeFault('out-of-domain', `The bounds of a random number must be at most ${MAX_RANDOM_SPAN} apart, not ${high - low}.`);
    }
    const drawn = services.randomInt(low, high);
    if (!Number.isSafeInteger(drawn) || drawn < low || drawn > high) {
      throw new RuntimeFault('internal-error', 'The random number is not between its bounds.');
    }
    return values.int(drawn === 0 ? 0 : drawn);
  };

  const arithmetic = (op: ArithOp, left: Value, right: Value): Value => {
    switch (op) {
      case '+':
        return ops.add(left, right);
      case '-':
        return ops.subtract(left, right);
      case '*':
        return ops.multiply(left, right);
      case '//':
        return ops.divide(left, right);
      case '%':
        return ops.remainder(left, right);
    }
  };

  /** A join of parts already through str(): at most MAX_TEXT_CHARS characters. */
  const joined = (parts: readonly string[]): Value => {
    const length = parts.reduce((total, piece) => total + piece.length, 0);
    if (length > MAX_TEXT_CHARS) {
      throw new RuntimeFault('limit-exceeded', `A text is limited to ${MAX_TEXT_CHARS} characters.`);
    }
    return values.str(parts.join(''));
  };

  /** N18 R2.2: a module read or a raw pin read of a uno program, at this moment of the program clock; a fault names its block. */
  const readHardware = (expr: Expr): Value => {
    blockId = expr.blockId;
    let value: Value;
    if (isModuleRead(expr)) {
      value = runModuleRead(expr, capabilities);
    } else if (expr.kind === 'read' && (expr.op === 'digital.read' || expr.op === 'analogIn.read') && isBoardPinOp(expr)) {
      value = runBoardPinRead(expr.op, expr.operand, capabilities);
    } else {
      throw new RuntimeFault('internal-error', 'This block is not known to the board.');
    }
    if (value.t !== expr.type) {
      throw new RuntimeFault('internal-error', 'A read gave another type than its block says.');
    }
    return value;
  };

  /**
   * N18 R2.2: `evaluate` for an expression of a uno program that reads the hardware: the same nodes, the same order, the same budget
   * work and block names, with a wait for the world (`atHardware`) before each read. A part without a read is `evaluate`'s.
   *
   * N18 P1: the value at once when no read waits; else a promise of it, the rest of the expression evaluated once the wait is over (a
   * node goes on from where it was: its left side is not evaluated again). What comes after a wait is a function of its own (`after`,
   * `binaryAfter`, …): a function with a closure over its parameters gets a context on every call, a wait or not.
   */
  const evaluateReading = (expr: Expr): Value | Promise<Value> => {
    if (!reading.has(expr)) {
      return evaluate(expr);
    }
    budget.work();
    blockId = expr.blockId;
    switch (expr.kind) {
      case 'arith':
      case 'compare': {
        const left = evaluateReading(expr.left);
        return left instanceof Promise ? after(left, expr, withRight) : withRight(expr, left);
      }
      case 'logic': {
        const left = evaluateReading(expr.left);
        return left instanceof Promise ? after(left, expr, logicWith) : logicWith(expr, left);
      }
      case 'not': {
        const inner = evaluateReading(expr.value);
        return inner instanceof Promise ? after(inner, expr, negated) : negated(expr, inner);
      }
      case 'join':
        return joinFrom(expr, [], 0);
      case 'read': {
        const wait = atHardware();
        return wait ? readAfter(wait, expr) : readHardware(expr);
      }
      default:
        throw new RuntimeFault('internal-error', 'Unexpected runtime error.');
    }
  };

  /** N18 P1: what comes after a wait in `evaluateReading`: `next` of the node, given the value the wait gave. */
  const after = <Node extends Expr>(waiting: Promise<Value>, expr: Node, next: (expr: Node, known: Value) => Value | Promise<Value>): Promise<Value> =>
    waiting.then((known) => next(expr, known));
  const readAfter = (wait: Promise<void>, expr: Expr): Promise<Value> => wait.then(() => readHardware(expr));
  const binaryAfter = (waiting: Promise<Value>, expr: Extract<Expr, { kind: 'arith' | 'compare' }>, left: Value): Promise<Value> =>
    waiting.then((right) => binary(expr, left, right));

  /** N18 P1: an arith or compare node of `evaluateReading` whose left side is known: its right side, then the operation. */
  const withRight = (expr: Extract<Expr, { kind: 'arith' | 'compare' }>, left: Value): Value | Promise<Value> => {
    const right = evaluateReading(expr.right);
    return right instanceof Promise ? binaryAfter(right, expr, left) : binary(expr, left, right);
  };
  const binary = (expr: Extract<Expr, { kind: 'arith' | 'compare' }>, left: Value, right: Value): Value => {
    blockId = expr.blockId;
    return expr.kind === 'arith' ? arithmetic(expr.op, left, right) : values.compare(expr.op, left, right);
  };

  /** N18 P1: a logic node of `evaluateReading` whose left side is known; the right side is not evaluated when the left decides. */
  const logicWith = (expr: Extract<Expr, { kind: 'logic' }>, known: Value): Value | Promise<Value> => {
    const left = values.asBool(known);
    if (expr.op === 'and' ? !left : left) {
      return values.bool(left);
    }
    const right = evaluateReading(expr.right);
    return right instanceof Promise ? right.then(truthOf) : truthOf(right);
  };
  const truthOf = (value: Value): Value => values.bool(values.asBool(value));

  const negated = (expr: Extract<Expr, { kind: 'not' }>, inner: Value): Value => {
    blockId = expr.blockId;
    return values.not(inner);
  };

  /** N18 P1: a join node of `evaluateReading` from its part `index` on, `parts` the texts of the parts before it. */
  const joinFrom = (expr: Extract<Expr, { kind: 'join' }>, parts: string[], index: number): Value | Promise<Value> => {
    for (let next = index; next < expr.parts.length; next++) {
      const piece = evaluateReading(expr.parts[next] as Expr);
      if (piece instanceof Promise) {
        return joinAfter(piece, expr, parts, next + 1);
      }
      parts.push(ops.toText(piece));
    }
    blockId = expr.blockId;
    return joined(parts);
  };
  const joinAfter = (waiting: Promise<Value>, expr: Extract<Expr, { kind: 'join' }>, parts: string[], next: number): Promise<Value> =>
    waiting.then((known) => {
      parts.push(ops.toText(known));
      return joinFrom(expr, parts, next);
    });

  /** N18 P1: the value of an expression of a uno program (`evaluateReading` when it reads the hardware); a promise only when it waits. */
  const valueOf = (expr: Expr): Value | Promise<Value> => (reading.has(expr) ? evaluateReading(expr) : evaluate(expr));

  const evaluate = (expr: Expr): Value => {
    // An expression node is a step too (it only counts; the checkpoint is the next statement or iteration).
    budget.work();
    blockId = expr.blockId;
    switch (expr.kind) {
      case 'int':
        return values.int(expr.value);
      case 'bool':
        return values.bool(expr.value);
      case 'str':
        return values.str(expr.value);
      case 'variable': {
        const value = variables.get(expr.variable);
        if (!value) {
          throw new RuntimeFault('internal-error', 'A variable has no value.');
        }
        return value;
      }
      case 'arith': {
        const left = evaluate(expr.left);
        const right = evaluate(expr.right);
        blockId = expr.blockId;
        return arithmetic(expr.op, left, right);
      }
      case 'compare': {
        const left = evaluate(expr.left);
        const right = evaluate(expr.right);
        blockId = expr.blockId;
        return values.compare(expr.op, left, right);
      }
      case 'logic': {
        // Short-circuit, as in Python: the right side is not evaluated when the left decides.
        const left = values.asBool(evaluate(expr.left));
        if (expr.op === 'and' ? !left : left) {
          return values.bool(left);
        }
        return values.bool(values.asBool(evaluate(expr.right)));
      }
      case 'not': {
        const inner = evaluate(expr.value);
        blockId = expr.blockId;
        return values.not(inner);
      }
      case 'join': {
        // Every part goes through str(), left to right. The length is known before any text is built.
        const parts = expr.parts.map((piece) => ops.toText(evaluate(piece)));
        blockId = expr.blockId;
        return joined(parts);
      }
      case 'read': {
        if (isModuleRead(expr) || ((expr.op === 'digital.read' || expr.op === 'analogIn.read') && isBoardPinOp(expr))) {
          // N18 R2.2: a read of the robot is `evaluateReading`'s, after its wait for the world. Reading here would read ahead of the
          // world (the virtual-clock invariant): only an IR that is not the compiler's gets here (a uno read in a ybc program, or in
          // an argument of a ybc op), and it is refused.
          throw new RuntimeFault('internal-error', 'A read of the robot came without its wait for the world.');
        }
        if (expr.op === 'digital.read' || expr.op === 'analogIn.read') {
          // A header pin (YB-4): the arguments first, left to right, each once; then the one call into the board.
          // A fault names this block.
          const args = expr.args.map((arg) => values.asInt(evaluate(arg)));
          blockId = expr.blockId;
          const value = runPinRead(expr.op, args, capabilities);
          if (value.t !== expr.type) {
            throw new RuntimeFault('internal-error', 'A read gave another type than its block says.');
          }
          return value;
        }
        if (expr.op === 'random.int') {
          return randomNumber(expr);
        }
        return readPart(expr);
      }
    }
  };

  /** An int the program computed (the value of `expr`), checked against the domain of the construct that uses it. */
  const within = (computed: Value, expr: Expr, low: number, high: number, what: string): number => {
    const value = values.asInt(computed);
    blockId = expr.blockId;
    if (value < low || value > high) {
      throw new RuntimeFault('out-of-domain', `${what} must be between ${low} and ${high}, not ${value}.`);
    }
    return value;
  };
  const intWithin = (expr: Expr, low: number, high: number, what: string): number => within(evaluate(expr), expr, low, high, what);

  /**
   * C-07 / C-08 (contract §4.2): nothing for an empty text; one character is shown and stays; two or more scroll, one
   * column every SCROLL_STEP_MS, 6 columns per character, and end on an empty frame. Each column is a step of the
   * budget and a wait that Stop interrupts, so the statement blocks for 1200 ms × n and no longer.
   *
   * The columns are due at fixed times counted from the first one, not one wait after the other: a timer is always a
   * little late, and that lateness would otherwise add up along a long text (plan §19: ±20 ms per frame). A wake-up
   * that is late makes the next wait shorter; one that is a whole column late (a hidden tab, a stalled machine) is not
   * made up for with a burst of frames, the text goes on from there at its own pace.
   */
  const scroll = async (text: string, colour: HexColour): Promise<void> => {
    // A board without a display is an internal error before anything else, as it always was.
    part('display');
    // Domain guard: the display shows ASCII 0x20–0x7E. A typed-in text outside it was refused at compile time.
    if (!isDisplayText(text)) {
      throw new RuntimeFault('out-of-domain', 'The display shows only the characters from space to ~ (ASCII).');
    }
    const characters = charactersOf(text);
    if (characters.length === 0) {
      return;
    }
    if (characters.length === 1) {
      show(scrollFrame(characters, 0, colour));
      return;
    }
    const steps = scrollSteps(characters.length);
    let due = services.clock.now();
    for (let step = 0; step < steps; step++) {
      await budget.step();
      show(scrollFrame(characters, step, colour));
      due += SCROLL_STEP_MS;
      const now = services.clock.now();
      if (now - due >= SCROLL_STEP_MS) {
        due = now + SCROLL_STEP_MS;
      }
      await services.sleep(Math.max(0, due - now), signal);
      budget.startSlice();
    }
    show(blankFrame());
  };

  /**
   * N17 B3: the one tone of the buzzer. `toneOn` says whether this run has a tone on, so a tone is stopped before the next one
   * starts (two notes of one pitch stay two notes) and stopping stops only what plays. It is on before the capability is told, so a
   * report that fails after it stored the tone still has it stopped.
   */
  let toneOn = false;
  const startTone = (hz: number) => {
    const sound = part('sound');
    if (toneOn) {
      toneOn = false;
      sound.stopTone();
    }
    toneOn = true;
    sound.startTone(hz);
  };
  const stopTone = () => {
    if (toneOn) {
      toneOn = false;
      part('sound').stopTone();
    }
  };

  /** What plays in the background (a melody that does not wait, a tone), until it ends or something ends it. */
  let background: { cancel(): void } | null = null;

  /** Ends the sound that plays in the background, at once: its timer is cancelled and its tone stopped. */
  const endBackground = () => {
    const playing = background;
    background = null;
    playing?.cancel();
    stopTone();
  };

  /**
   * Plays the steps one after the other on the run's scheduler, the first one now, while the program goes on. The steps are due at
   * fixed times from the first one, as the columns of a scroll are; one that comes a tick or more late (a hidden tab) is played from
   * then on, not caught up with a burst. A buzzer that fails here is silence, never a throw into a timer.
   */
  const playInBackground = (steps: readonly Sounding[]) => {
    let index = 0;
    let due = services.clock.now();
    let cancelTimer: (() => void) | null = null;
    const handle = {
      cancel() {
        cancelTimer?.();
        cancelTimer = null;
      },
    };
    const next = () => {
      cancelTimer = null;
      if (background !== handle) {
        return;
      }
      try {
        const step = steps[index];
        index += 1;
        if (step === undefined) {
          background = null;
          stopTone();
          return;
        }
        if (step.hz === null) {
          stopTone();
        } else {
          startTone(step.hz);
        }
        const now = services.clock.now();
        if (now - due >= NOTE_TICK_MS) {
          due = now;
        }
        due += step.ms;
        cancelTimer = services.scheduler.schedule(next, Math.max(0, due - now));
      } catch {
        background = null;
        try {
          stopTone();
        } catch {
          // Nothing more can be done for a buzzer that will not stop; the run's end drops its state.
        }
      }
    };
    background = handle;
    next();
  };

  /**
   * C-20 until done: the steps one after the other, the statement waiting for each, at fixed times from the first (a late wake-up
   * shortens the next wait; one a tick or more late goes on from there). Each step is a budget step, and Stop ends the wait; the tone
   * never outlives the melody.
   */
  const playUntilDone = async (steps: readonly Sounding[]): Promise<void> => {
    let due = services.clock.now();
    try {
      for (const step of steps) {
        await budget.step();
        if (step.hz === null) {
          stopTone();
        } else {
          startTone(step.hz);
        }
        const now = services.clock.now();
        if (now - due >= NOTE_TICK_MS) {
          due = now;
        }
        due += step.ms;
        await services.sleep(Math.max(0, due - now), signal);
        budget.startSlice();
      }
    } finally {
      stopTone();
    }
  };

  /** Whatever sounds when the program ends by Stop, a replacement or an error: silence, never a throw on the way out. */
  const silence = () => {
    try {
      endBackground();
    } catch {
      // The outcome of the program is what matters here; the run's end drops the buzzer's state.
    }
  };

  /** The length of a note or a rest in ticks, from a program that may not be the compiler's own. */
  const waitTicks = (ticks: number): number => {
    if (!noteTicks.some((allowed) => allowed === ticks)) {
      throw new RuntimeFault('internal-error', 'A note or rest has a length that does not exist.');
    }
    return ticks * NOTE_TICK_MS;
  };

  const runCall = async (statement: CallStatement): Promise<void> => {
    switch (statement.op) {
      case 'display.show':
        show(pictureOf(statement.operand));
        return;
      case 'display.clear':
        show(blankFrame());
        return;
      case 'display.scrollText': {
        const text = evaluate(statement.args[0]);
        blockId = statement.blockId;
        if (text.t !== 'str') {
          throw new RuntimeFault('internal-error', 'A text block was given another type.');
        }
        await scroll(text.v, colourOf(statement.operand));
        return;
      }
      case 'display.scrollNumber': {
        const number = evaluate(statement.args[0]);
        blockId = statement.blockId;
        if (number.t !== 'int') {
          throw new RuntimeFault('internal-error', 'A number block was given another type.');
        }
        await scroll(ops.toText(number), colourOf(statement.operand));
        return;
      }
      case 'display.setPixel': {
        const [x, y] = cellOf(statement.args);
        blockId = statement.blockId;
        show(setPixelFrame(shown, x, y, colourOf(statement.operand)));
        return;
      }
      case 'display.clearPixel': {
        const [x, y] = cellOf(statement.args);
        blockId = statement.blockId;
        show(clearPixelFrame(shown, x, y));
        return;
      }
      case 'display.setAll':
        show(setAllFrame(colourOf(statement.operand)));
        return;
      case 'sound.playNote': {
        part('sound');
        const { note, ticks } = statement.operand;
        if (!Object.hasOwn(noteHz, note)) {
          throw new RuntimeFault('internal-error', 'A note block names a note that does not exist.');
        }
        const ms = waitTicks(ticks);
        endBackground();
        try {
          startTone(noteHz[note]);
          await services.sleep(ms, signal);
        } finally {
          // Also when Stop ends the wait, or the report of the tone failed after it was stored: the tone never outlives its note.
          stopTone();
        }
        budget.startSlice();
        return;
      }
      case 'sound.rest': {
        const ms = waitTicks(statement.operand.ticks);
        // A rest is a sound of the module too (music.play(['R:t'])): it ends the one that plays.
        endBackground();
        await services.sleep(ms, signal);
        budget.startSlice();
        return;
      }
      case 'sound.playMelody': {
        part('sound');
        const { melody, wait } = statement.operand;
        if (!isMelodyName(melody) || typeof wait !== 'boolean') {
          throw new RuntimeFault('internal-error', 'A melody block names a melody that does not exist.');
        }
        const steps = melodySteps(melody).map(({ hz, ticks }) => ({ hz, ms: ticks * NOTE_TICK_MS }));
        endBackground();
        if (wait) {
          await playUntilDone(steps);
          budget.startSlice();
        } else {
          playInBackground(steps);
        }
        return;
      }
      case 'sound.pitch': {
        const [hzExpr, msExpr] = statement.args;
        if (statement.args.length !== 2 || hzExpr === undefined || msExpr === undefined) {
          throw new RuntimeFault('internal-error', 'A tone block was given the wrong number of values.');
        }
        // The Hz, then the ms, each evaluated once and checked against the domain of C-21; a fault names the value's block.
        const hz = intWithin(hzExpr, PITCH_MIN_HZ, PITCH_MAX_HZ, 'The frequency');
        const ms = intWithin(msExpr, 0, PITCH_MAX_MS, 'The length of a tone');
        blockId = statement.blockId;
        part('sound');
        endBackground();
        if (ms > 0) {
          playInBackground([{ hz, ms }]);
        }
        return;
      }
      case 'sound.stop':
        part('sound');
        endBackground();
        return;
      default:
        // The compiler writes only the ops above; a program that is not its own must not be skipped without a word.
        throw new RuntimeFault('internal-error', 'This block is not known to the board.');
    }
  };

  /**
   * N18 R2.2: the arguments of a uno op, left to right, each once (waited for when one reads the hardware). N18 P1: at once when none
   * waits, else a promise of them.
   */
  const evaluatedArgs = (args: readonly Expr[]): Value[] | Promise<Value[]> => {
    // As long as the arguments (N18 P1: an empty array that grows on its first push takes room for 17).
    const evaluated = new Array<Value>(args.length);
    for (let index = 0; index < args.length; index++) {
      const value = valueOf(args[index] as Expr);
      if (value instanceof Promise) {
        return restOfArgs(args, evaluated, value, index);
      }
      evaluated[index] = value;
    }
    return evaluated;
  };
  const restOfArgs = async (args: readonly Expr[], evaluated: Value[], waiting: Promise<Value>, at: number): Promise<Value[]> => {
    evaluated[at] = await waiting;
    for (let index = at + 1; index < args.length; index++) {
      const value = valueOf(args[index] as Expr);
      evaluated[index] = value instanceof Promise ? await value : value;
    }
    return evaluated;
  };

  /**
   * N18 R2.2: a module op (contract UNO U-20…U-26): its arguments, then the wait for the world, then the one call into the robot. N18 P1:
   * undefined when it ran at once, else the promise of it.
   */
  const runModule = (statement: ModuleCallStatement): Promise<void> | undefined => {
    const args = 'args' in statement ? evaluatedArgs(statement.args) : NO_VALUES;
    return args instanceof Promise ? moduleAfterArgs(args, statement) : moduleCall(statement, args);
  };
  const moduleCall = (statement: ModuleCallStatement, args: readonly Value[]): Promise<void> | undefined => {
    blockId = statement.blockId;
    const wait = atHardware();
    if (wait) {
      return moduleAfterWait(wait, statement, args);
    }
    blockId = statement.blockId;
    runModuleCall(statement, args, capabilities, warnUnoClamp);
    return undefined;
  };
  const moduleAfterArgs = (waiting: Promise<Value[]>, statement: ModuleCallStatement): Promise<void> =>
    waiting.then((args) => moduleCall(statement, args));
  const moduleAfterWait = (wait: Promise<void>, statement: ModuleCallStatement, args: readonly Value[]): Promise<void> =>
    wait.then(() => {
      blockId = statement.blockId;
      runModuleCall(statement, args, capabilities, warnUnoClamp);
    });

  /** N18 R2.2: a raw pin op of a uno program, its pin an operand: as a module op. N18 P1: undefined when it ran at once. */
  const runBoardPin = (statement: BoardPinCall): Promise<void> | undefined => {
    const args = evaluatedArgs(statement.args);
    return args instanceof Promise ? boardPinAfterArgs(args, statement) : boardPinCall(statement, args);
  };
  const boardPinCall = (statement: BoardPinCall, args: readonly Value[]): Promise<void> | undefined => {
    blockId = statement.blockId;
    const wait = atHardware();
    if (wait) {
      return boardPinAfterWait(wait, statement, args);
    }
    blockId = statement.blockId;
    runBoardPinCall(statement.op, statement.operand, args, capabilities, warnUnoClamp);
    return undefined;
  };
  const boardPinAfterArgs = (waiting: Promise<Value[]>, statement: BoardPinCall): Promise<void> =>
    waiting.then((args) => boardPinCall(statement, args));
  const boardPinAfterWait = (wait: Promise<void>, statement: BoardPinCall, args: readonly Value[]): Promise<void> =>
    wait.then(() => {
      blockId = statement.blockId;
      runBoardPinCall(statement.op, statement.operand, args, capabilities, warnUnoClamp);
    });

  /** A header pin call (YB-4; N17 B5: PWM and servo): the arguments first, left to right, each once; then the one call into the board. */
  const runHeaderPin = (statement: PinCallStatement): void => {
    // A PWM duty or an angle outside its range is clamped and the run warned.
    const args = statement.args.map((arg) => values.asInt(evaluate(arg)));
    blockId = statement.blockId;
    runPinCall(statement.op, args, capabilities, warnClamped);
  };

  const runStatements = async (statements: readonly YbcStatement[]): Promise<void> => {
    for (const statement of statements) {
      // One budget step per statement; it throws when Stop was pressed.
      await budget.step();
      blockId = statement.blockId;
      services.trace?.(statement.blockId);
      switch (statement.kind) {
        case 'noop':
          break;
        case 'set': {
          const value = reading.has(statement.value) ? await evaluateReading(statement.value) : evaluate(statement.value);
          if (value.t !== 'int') {
            throw new RuntimeFault('internal-error', 'An int variable was given another type.');
          }
          variables.set(statement.variable, value);
          break;
        }
        case 'if': {
          // Top to bottom; the first true condition wins and the ones after it are not evaluated.
          let chosen: readonly YbcStatement[] = statement.else;
          for (const branch of statement.branches) {
            if (values.asBool(reading.has(branch.condition) ? await evaluateReading(branch.condition) : evaluate(branch.condition))) {
              chosen = branch.body;
              break;
            }
          }
          await runStatements(chosen);
          break;
        }
        case 'print': {
          const text = ops.toText(reading.has(statement.value) ? await evaluateReading(statement.value) : evaluate(statement.value));
          blockId = statement.blockId;
          services.console.write(text);
          break;
        }
        case 'repeat': {
          // Evaluated once. Zero or less runs zero times, as Python's range does (and C++'s `_r < _n`).
          const times = within(reading.has(statement.times) ? await evaluateReading(statement.times) : evaluate(statement.times), statement.times, domains.repeat[0], domains.repeat[1], 'The number of repetitions');
          for (let done = 0; done < times; done++) {
            await budget.step();
            await runStatements(statement.body);
          }
          break;
        }
        case 'while': {
          for (;;) {
            await budget.step();
            if (!values.asBool(reading.has(statement.condition) ? await evaluateReading(statement.condition) : evaluate(statement.condition))) {
              break;
            }
            await runStatements(statement.body);
          }
          break;
        }
        case 'countUp': {
          // Contract §3.3: the start is evaluated and checked, then the end is evaluated and checked,
          // each once, before the loop. The bounds are not looked at again.
          const from = within(reading.has(statement.from) ? await evaluateReading(statement.from) : evaluate(statement.from), statement.from, domains.countUpFrom[0], domains.countUpFrom[1], 'The start');
          const to = within(reading.has(statement.to) ? await evaluateReading(statement.to) : evaluate(statement.to), statement.to, domains.countUpTo[0], domains.countUpTo[1], 'The end');
          // Python's `for i in range(...)`: the variable is set at the start of every iteration, so
          // a change made in the body does not move the count. After the loop it keeps the last
          // value, or is untouched when the loop did not run.
          for (let counter = from; counter <= to; counter += statement.step) {
            await budget.step();
            variables.set(statement.variable, values.int(counter));
            await runStatements(statement.body);
          }
          break;
        }
        case 'waitMs': {
          const ms = within(reading.has(statement.ms) ? await evaluateReading(statement.ms) : evaluate(statement.ms), statement.ms, 0, MAX_WAIT_MS, 'A wait');
          blockId = statement.blockId;
          await services.sleep(ms, signal);
          budget.startSlice();
          break;
        }
        case 'call': {
          if (isModuleCall(statement)) {
            await runModule(statement);
            break;
          }
          if (statement.op === 'digital.write' || statement.op === 'pwm.write' || statement.op === 'servo.write') {
            if (isBoardPinOp(statement)) {
              // N18 R2.2: a raw pin of a uno program, its pin an operand.
              await runBoardPin(statement);
              break;
            }
            runHeaderPin(statement);
            break;
          }
          await runCall(statement);
          break;
        }
      }
    }
  };

  /** N18 P1: a call of a uno program (`runStatements`' own branches): undefined when it ran at once, else the promise of it. */
  const unoCall = (statement: Extract<YbcStatement, { kind: 'call' }>): Promise<void> | undefined => {
    if (isModuleCall(statement)) {
      return runModule(statement);
    }
    if (statement.op === 'digital.write' || statement.op === 'pwm.write' || statement.op === 'servo.write') {
      if (isBoardPinOp(statement)) {
        return runBoardPin(statement);
      }
      runHeaderPin(statement);
      return undefined;
    }
    return runCall(statement);
  };

  /**
   * N18 P1: a uno program, `onStart` then `forever`, as `runStatements` and the forever loop below run a ybc program: the same steps in
   * the same order, over an explicit stack of frames (a frame per depth, reused), awaiting only a promise it is given (see the top of
   * this file). One async call for the whole run: a statement, an iteration and a read that do not wait allocate nothing here.
   */
  const runUno = async (): Promise<void> => {
    const frames: StackFrame[] = [];
    let depth = 0;
    const push = (kind: StackFrame['kind'], statements: readonly YbcStatement[]): StackFrame => {
      let frame = frames[depth];
      if (frame === undefined) {
        frame = { kind, statements, index: 0, count: 0, limit: 0, condition: null, variable: '', step: 0, started: false };
        frames.push(frame);
      } else {
        frame.kind = kind;
        frame.statements = statements;
        frame.index = 0;
        frame.count = 0;
        frame.limit = 0;
        frame.condition = null;
        frame.variable = '';
        frame.step = 0;
        frame.started = false;
      }
      depth += 1;
      return frame;
    };
    const { forever } = ir;
    let iterating = false;
    push('block', ir.onStart);
    for (;;) {
      if (depth === 0) {
        // `onStart` has run, or an iteration of `forever` has.
        if (!forever) {
          return;
        }
        if (iterating) {
          blockId = undefined;
          signal.throwIfAborted();
          // N18 R2.4: the end of an iteration is the forever hat's own.
          if (ir.foreverBlockId !== undefined) {
            services.trace?.(ir.foreverBlockId);
          }
          if (loopPauseUs > 0) {
            await services.sleep(loopPauseUs / 1000, signal);
            budget.startSlice();
          }
        }
        iterating = true;
        budget.loopIteration();
        const step = budget.step();
        if (step !== undefined) {
          await step;
        }
        push('block', forever);
        continue;
      }
      const frame = frames[depth - 1] as StackFrame;
      switch (frame.kind) {
        case 'block': {
          const statement = frame.statements[frame.index];
          if (statement === undefined) {
            depth -= 1;
            break;
          }
          frame.index += 1;
          // One budget step per statement; it throws when Stop was pressed.
          const step = budget.step();
          if (step !== undefined) {
            await step;
          }
          blockId = statement.blockId;
          services.trace?.(statement.blockId);
          switch (statement.kind) {
            case 'noop':
              break;
            case 'set': {
              let value = valueOf(statement.value);
              if (value instanceof Promise) {
                value = await value;
              }
              if (value.t !== 'int') {
                throw new RuntimeFault('internal-error', 'An int variable was given another type.');
              }
              variables.set(statement.variable, value);
              break;
            }
            case 'if': {
              // Top to bottom; the first true condition wins and the ones after it are not evaluated.
              let chosen: readonly YbcStatement[] = statement.else;
              for (let index = 0; index < statement.branches.length; index++) {
                const branch = statement.branches[index] as (typeof statement.branches)[number];
                let condition = valueOf(branch.condition);
                if (condition instanceof Promise) {
                  condition = await condition;
                }
                if (values.asBool(condition)) {
                  chosen = branch.body;
                  break;
                }
              }
              push('block', chosen);
              break;
            }
            case 'print': {
              let value = valueOf(statement.value);
              if (value instanceof Promise) {
                value = await value;
              }
              const text = ops.toText(value);
              blockId = statement.blockId;
              services.console.write(text);
              break;
            }
            case 'repeat': {
              // Evaluated once. Zero or less runs zero times (C++'s `_r < _n`).
              let times = valueOf(statement.times);
              if (times instanceof Promise) {
                times = await times;
              }
              const limit = within(times, statement.times, domains.repeat[0], domains.repeat[1], 'The number of repetitions');
              push('repeat', statement.body).limit = limit;
              break;
            }
            case 'while':
              push('while', statement.body).condition = statement.condition;
              break;
            case 'countUp': {
              // Contract §3.3: the start is evaluated and checked, then the end, each once, before the loop.
              let start = valueOf(statement.from);
              if (start instanceof Promise) {
                start = await start;
              }
              const from = within(start, statement.from, domains.countUpFrom[0], domains.countUpFrom[1], 'The start');
              let end = valueOf(statement.to);
              if (end instanceof Promise) {
                end = await end;
              }
              const to = within(end, statement.to, domains.countUpTo[0], domains.countUpTo[1], 'The end');
              const loop = push('countUp', statement.body);
              loop.count = from;
              loop.limit = to;
              loop.variable = statement.variable;
              loop.step = statement.step;
              break;
            }
            case 'waitMs': {
              let wait = valueOf(statement.ms);
              if (wait instanceof Promise) {
                wait = await wait;
              }
              const ms = within(wait, statement.ms, 0, MAX_WAIT_MS, 'A wait');
              blockId = statement.blockId;
              await services.sleep(ms, signal);
              budget.startSlice();
              break;
            }
            case 'call': {
              const pending = unoCall(statement);
              if (pending !== undefined) {
                await pending;
              }
              break;
            }
          }
          break;
        }
        case 'repeat': {
          if (frame.count >= frame.limit) {
            depth -= 1;
            break;
          }
          frame.count += 1;
          const step = budget.step();
          if (step !== undefined) {
            await step;
          }
          push('block', frame.statements);
          break;
        }
        case 'while': {
          const step = budget.step();
          if (step !== undefined) {
            await step;
          }
          let condition = valueOf(frame.condition as Expr);
          if (condition instanceof Promise) {
            condition = await condition;
          }
          if (!values.asBool(condition)) {
            depth -= 1;
            break;
          }
          push('block', frame.statements);
          break;
        }
        case 'countUp': {
          // The variable is set at the start of every iteration, so a change made in the body does not move the count; after the
          // loop it keeps the last value, or is untouched when the loop did not run.
          if (frame.started) {
            frame.count += frame.step;
          }
          frame.started = true;
          if (!(frame.count <= frame.limit)) {
            depth -= 1;
            break;
          }
          const step = budget.step();
          if (step !== undefined) {
            await step;
          }
          variables.set(frame.variable, values.int(frame.count));
          push('block', frame.statements);
          break;
        }
      }
    }
  };

  try {
    if (!isNumericModel(numeric) || !Number.isFinite(loopPauseUs) || loopPauseUs < 0) {
      throw new RuntimeFault('internal-error', 'The program asks for a number model or a loop pause that does not exist.');
    }
    if (ops.model === 'cxx-int32') {
      // N18 P1: a uno program.
      await runUno();
      signal.throwIfAborted();
      return { status: 'finished' };
    }
    await runStatements(ir.onStart);
    const { forever } = ir;
    if (forever) {
      for (;;) {
        budget.loopIteration();
        await budget.step();
        await runStatements(forever);
        blockId = undefined;
        signal.throwIfAborted();
        // N18 R2.4: the end of an iteration is the forever hat's own (a uno IR names it; a ybc IR has no name and tells nothing new).
        if (ir.foreverBlockId !== undefined) {
          services.trace?.(ir.foreverBlockId);
        }
        // E3 (Yolo:Bit): 10 ms at the end of every iteration. Arduino's loop() has none (contract UNO §4.1).
        if (loopPauseUs > 0) {
          await services.sleep(loopPauseUs / 1000, signal);
          budget.startSlice();
        }
      }
    }
    signal.throwIfAborted();
    return { status: 'finished' };
  } catch (error) {
    // Stop, a replacing run or an error: the sound ends with the program. A program that finished lets its melody play out.
    silence();
    if (signal.aborted) {
      return { status: 'stopped' };
    }
    const fault =
      error instanceof RuntimeFault ? error : new RuntimeFault('internal-error', 'Unexpected runtime error.');
    return blockId === undefined
      ? { status: 'error', code: fault.code, message: fault.message }
      : { status: 'error', code: fault.code, message: fault.message, blockId };
  }
}

/**
 * N18 R2.2: the expressions of `ir` that read the hardware (a module read or a raw pin read of a uno program) or have such a read
 * inside them. An explicit walk of the statements; an expression is a tree as deep as the compiler lets it be.
 */
function readingExpressions(ir: YbcProgramIR): WeakSet<Expr> {
  const reading = new WeakSet<Expr>();
  const mark = (expr: Expr): boolean => {
    let reads = false;
    for (const child of childrenOf(expr)) {
      reads = mark(child) || reads;
    }
    if (isModuleRead(expr) || (expr.kind === 'read' && (expr.op === 'digital.read' || expr.op === 'analogIn.read') && isBoardPinOp(expr))) {
      reads = true;
    }
    if (reads) {
      reading.add(expr);
    }
    return reads;
  };
  const pending: YbcStatement[] = [...ir.onStart, ...(ir.forever ?? [])];
  for (let statement = pending.pop(); statement !== undefined; statement = pending.pop()) {
    switch (statement.kind) {
      case 'set':
      case 'print':
        mark(statement.value);
        break;
      case 'if':
        for (const branch of statement.branches) {
          mark(branch.condition);
          pending.push(...branch.body);
        }
        pending.push(...statement.else);
        break;
      case 'repeat':
        mark(statement.times);
        pending.push(...statement.body);
        break;
      case 'while':
        mark(statement.condition);
        pending.push(...statement.body);
        break;
      case 'countUp':
        mark(statement.from);
        mark(statement.to);
        pending.push(...statement.body);
        break;
      case 'waitMs':
        mark(statement.ms);
        break;
      case 'call':
        if ('args' in statement) {
          statement.args.forEach(mark);
        }
        break;
      case 'noop':
        break;
    }
  }
  return reading;
}

function childrenOf(expr: Expr): readonly Expr[] {
  switch (expr.kind) {
    case 'arith':
    case 'compare':
    case 'logic':
      return [expr.left, expr.right];
    case 'not':
      return [expr.value];
    case 'join':
      return expr.parts;
    case 'read':
      return 'args' in expr ? expr.args : [];
    default:
      return [];
  }
}
