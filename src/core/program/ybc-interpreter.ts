import type { Capabilities } from '../capabilities/io';
import type { RuntimeServices } from '../capabilities/services';
import type { RunOutcome } from './interpreter';
import { MAX_RANGE_VALUE, MAX_REPEAT_ABS, MAX_TEXT_CHARS, MAX_WAIT_MS } from './limits';
import * as values from './values';
import { RuntimeFault, type Value } from './values';
import type { Expr, YbcProgramIR, YbcStatement } from './ybc-ir';

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
 * RunSession and are the run's own. YB-2's language needs no capability, so `capabilities` is not read yet: the
 * IR has no capability operation until YB-3 and YB-4. Like `runProgram`, `done` never rejects.
 */
export function runYbcProgram(ir: YbcProgramIR, _capabilities: Capabilities, services: RuntimeServices): YbcProgramRun {
  return { done: Promise.resolve().then(() => execute(ir, services)) };
}

async function execute(ir: YbcProgramIR, services: RuntimeServices): Promise<YbcRunOutcome> {
  const { budget, signal } = services;
  // The slice of a run starts when the program does, not when its services were built.
  budget.startSlice();
  let blockId: string | undefined;
  const variables = new Map<string, Value>(ir.variables.map((variable) => [variable.id, values.int(0)]));

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
        const parts = expr.parts.map((part) => values.toText(evaluate(part)));
        blockId = expr.blockId;
        const length = parts.reduce((total, part) => total + part.length, 0);
        if (length > MAX_TEXT_CHARS) {
          throw new RuntimeFault('limit-exceeded', `A text is limited to ${MAX_TEXT_CHARS} characters.`);
        }
        return values.str(parts.join(''));
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
