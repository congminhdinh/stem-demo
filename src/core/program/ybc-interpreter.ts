import { blankFrame } from '../capabilities/frame';
import type { ButtonId, Capabilities, CapabilityKey } from '../capabilities/io';
import type { RuntimeServices } from '../capabilities/services';
import { isDisplayText } from '../constructs/ybc.display';
import { runPinCall, runPinRead } from '../constructs/ybc.pins';
import { noteTicks } from '../constructs/ybc.sound';
import { charactersOf, imageFrame, SCROLL_STEP_MS, scrollFrame, scrollSteps } from '../simulation/peripherals/display';
import { LIGHT_LEVEL_MAX, LIGHT_LEVEL_MIN } from '../simulation/peripherals/light';
import { NOTE_TICK_MS, noteHz } from '../simulation/peripherals/sound';
import type { RunOutcome } from './interpreter';
import { MAX_RANGE_VALUE, MAX_REPEAT_ABS, MAX_TEXT_CHARS, MAX_WAIT_MS } from './limits';
import * as values from './values';
import { RuntimeFault, type Value } from './values';
import type { ButtonOperand, CallStatement, Expr, ReadExpr, YbcProgramIR, YbcStatement } from './ybc-ir';

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

/** E3, as in the legacy interpreter: every forever iteration ends with at least this pause. */
const foreverYieldMs = 10;

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
  let blockId: string | undefined;
  const variables = new Map<string, Value>(ir.variables.map((variable) => [variable.id, values.int(0)]));

  /** A part of the board the program reaches. Missing means the factory did not provide what the board promised. */
  const part = <Key extends CapabilityKey>(key: Key): NonNullable<Capabilities[Key]> => {
    const found = capabilities[key];
    if (found === undefined) {
      throw new RuntimeFault('internal-error', 'The board is missing a part this block needs.');
    }
    return found;
  };

  const buttonOf = (operand: ButtonOperand): ButtonId => {
    if (operand.button !== 'A' && operand.button !== 'B') {
      throw new RuntimeFault('internal-error', 'A button block names a button that does not exist.');
    }
    return operand.button === 'A' ? 'a' : 'b';
  };

  /** C-12, C-13, C-15: what the learner reads from an onboard part, at the moment of the call. */
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
    }
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
            return values.add(left, right);
          case '-':
            return values.subtract(left, right);
          case '*':
            return values.multiply(left, right);
          case '//':
            return values.floorDivide(left, right);
          case '%':
            return values.remainder(left, right);
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
        const parts = expr.parts.map((piece) => values.toText(evaluate(piece)));
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
  const scroll = async (text: string): Promise<void> => {
    const display = part('display');
    // Domain guard: the display shows ASCII 0x20–0x7E. A typed-in text outside it was refused at compile time.
    if (!isDisplayText(text)) {
      throw new RuntimeFault('out-of-domain', 'The display shows only the characters from space to ~ (ASCII).');
    }
    const characters = charactersOf(text);
    if (characters.length === 0) {
      return;
    }
    if (characters.length === 1) {
      display.setFrame(scrollFrame(characters, 0));
      return;
    }
    const steps = scrollSteps(characters.length);
    let due = services.clock.now();
    for (let step = 0; step < steps; step++) {
      await budget.step();
      display.setFrame(scrollFrame(characters, step));
      due += SCROLL_STEP_MS;
      const now = services.clock.now();
      if (now - due >= SCROLL_STEP_MS) {
        due = now + SCROLL_STEP_MS;
      }
      await services.sleep(Math.max(0, due - now), signal);
      budget.startSlice();
    }
    display.setFrame(blankFrame());
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
        part('display').setFrame(imageFrame(statement.operand.image.pixels));
        return;
      case 'display.clear':
        part('display').setFrame(blankFrame());
        return;
      case 'display.scrollText': {
        const text = evaluate(statement.args[0]);
        blockId = statement.blockId;
        if (text.t !== 'str') {
          throw new RuntimeFault('internal-error', 'A text block was given another type.');
        }
        await scroll(text.v);
        return;
      }
      case 'display.scrollNumber': {
        const number = evaluate(statement.args[0]);
        blockId = statement.blockId;
        if (number.t !== 'int') {
          throw new RuntimeFault('internal-error', 'A number block was given another type.');
        }
        await scroll(values.toText(number));
        return;
      }
      case 'sound.playNote': {
        const sound = part('sound');
        const { note, ticks } = statement.operand;
        if (!Object.hasOwn(noteHz, note)) {
          throw new RuntimeFault('internal-error', 'A note block names a note that does not exist.');
        }
        const ms = waitTicks(ticks);
        try {
          sound.startTone(noteHz[note]);
          await services.sleep(ms, signal);
        } finally {
          // Also when Stop ends the wait, or the report of the tone failed after it was stored: the tone never outlives its note.
          sound.stopTone();
        }
        budget.startSlice();
        return;
      }
      case 'sound.rest':
        await services.sleep(waitTicks(statement.operand.ticks), signal);
        budget.startSlice();
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
          const text = values.toText(evaluate(statement.value));
          blockId = statement.blockId;
          services.console.write(text);
          break;
        }
        case 'repeat': {
          // Evaluated once. Zero or less runs zero times, as Python's range does.
          const times = intWithin(statement.times, -MAX_REPEAT_ABS, MAX_REPEAT_ABS, 'The number of repetitions');
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
          const from = intWithin(statement.from, 0, MAX_RANGE_VALUE, 'The start');
          const to = intWithin(statement.to, 0, MAX_RANGE_VALUE, 'The end');
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
          if (statement.op === 'digital.write') {
            // A header pin (YB-4): the arguments first, left to right, each once; then the one call into the board.
            const args = statement.args.map((arg) => values.asInt(evaluate(arg)));
            blockId = statement.blockId;
            runPinCall(statement.op, args, capabilities);
            break;
          }
          await runCall(statement);
          break;
        }
      }
    }
  };

  try {
    await runStatements(ir.onStart);
    const { forever } = ir;
    if (forever) {
      for (;;) {
        await budget.step();
        await runStatements(forever);
        blockId = undefined;
        signal.throwIfAborted();
        await services.sleep(foreverYieldMs, signal);
        budget.startSlice();
      }
    }
    signal.throwIfAborted();
    return { status: 'finished' };
  } catch (error) {
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
