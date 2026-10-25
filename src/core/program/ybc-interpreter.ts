import { blankFrame, type Frame, type HexColour } from '../capabilities/frame';
import type { ButtonId, Capabilities, CapabilityKey } from '../capabilities/io';
import type { RuntimeServices } from '../capabilities/services';
import { DEFAULT_COLOUR, IMAGE_SIZE, isDisplayText, paletteColourOf } from '../constructs/ybc.display';
import { isBuiltinImageName } from '../constructs/ybc.images';
import { isAxisName, isGestureName } from '../constructs/ybc.input';
import { clampWarning, runPinCall, runPinRead, type ClampedValue } from '../constructs/ybc.pins';
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
import { loopPauseUsOf, numericOf, type ButtonOperand, type CallStatement, type ColourOperand, type Expr, type ImageOperand, type NumericModel, type RandomExpr, type ReadExpr, type YbcProgramIR, type YbcStatement } from './ybc-ir';

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

/** One note or rest of a melody (or a tone), for `ms`; `hz` null is silence. */
type Sounding = { hz: number | null; ms: number };

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
        switch (expr.op) {
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
        break;
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
        const length = parts.reduce((total, piece) => total + piece.length, 0);
        if (length > MAX_TEXT_CHARS) {
          throw new RuntimeFault('limit-exceeded', `A text is limited to ${MAX_TEXT_CHARS} characters.`);
        }
        return values.str(parts.join(''));
      }
      case 'read': {
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

  /** An int the program computed, checked against the domain of the construct that uses it. */
  const intWithin = (expr: Expr, low: number, high: number, what: string): number => {
    const value = values.asInt(evaluate(expr));
    blockId = expr.blockId;
    if (value < low || value > high) {
      throw new RuntimeFault('out-of-domain', `${what} must be between ${low} and ${high}, not ${value}.`);
    }
    return value;
  };

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

  const runStatements = async (statements: readonly YbcStatement[]): Promise<void> => {
    for (const statement of statements) {
      // One budget step per statement; it throws when Stop was pressed.
      await budget.step();
      blockId = statement.blockId;
      switch (statement.kind) {
        case 'noop':
          break;
        case 'set': {
          const value = evaluate(statement.value);
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
            if (values.asBool(evaluate(branch.condition))) {
              chosen = branch.body;
              break;
            }
          }
          await runStatements(chosen);
          break;
        }
        case 'print': {
          const text = ops.toText(evaluate(statement.value));
          blockId = statement.blockId;
          services.console.write(text);
          break;
        }
        case 'repeat': {
          // Evaluated once. Zero or less runs zero times, as Python's range does (and C++'s `_r < _n`).
          const times = intWithin(statement.times, domains.repeat[0], domains.repeat[1], 'The number of repetitions');
          for (let done = 0; done < times; done++) {
            await budget.step();
            await runStatements(statement.body);
          }
          break;
        }
        case 'while': {
          for (;;) {
            await budget.step();
            if (!values.asBool(evaluate(statement.condition))) {
              break;
            }
            await runStatements(statement.body);
          }
          break;
        }
        case 'countUp': {
          // Contract §3.3: the start is evaluated and checked, then the end is evaluated and checked,
          // each once, before the loop. The bounds are not looked at again.
          const from = intWithin(statement.from, domains.countUpFrom[0], domains.countUpFrom[1], 'The start');
          const to = intWithin(statement.to, domains.countUpTo[0], domains.countUpTo[1], 'The end');
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
          const ms = intWithin(statement.ms, 0, MAX_WAIT_MS, 'A wait');
          blockId = statement.blockId;
          await services.sleep(ms, signal);
          budget.startSlice();
          break;
        }
        case 'call': {
          if (statement.op === 'digital.write' || statement.op === 'pwm.write' || statement.op === 'servo.write') {
            // A header pin (YB-4; N17 B5: PWM and servo): the arguments first, left to right, each once; then the one call into the
            // board, with a PWM duty or an angle outside its range clamped and the run warned.
            const args = statement.args.map((arg) => values.asInt(evaluate(arg)));
            blockId = statement.blockId;
            runPinCall(statement.op, args, capabilities, warnClamped);
            break;
          }
          await runCall(statement);
          break;
        }
      }
    }
  };

  try {
    if (!isNumericModel(numeric) || !Number.isFinite(loopPauseUs) || loopPauseUs < 0) {
      throw new RuntimeFault('internal-error', 'The program asks for a number model or a loop pause that does not exist.');
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
