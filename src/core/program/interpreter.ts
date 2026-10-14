import type { DigitalIO } from '../capabilities/io';
import type { Expression, ProgramIR, Statement } from './ir';

// Async IR interpreter (plan §6.4). It touches the virtual hardware only
// through HardwareIO (B5) and knows nothing about circuits, simulation or UI.

/** The runtime's only way to reach the hardware. Pin modes are implicit: writing makes a pin an output. */
/** Since YB-CP an alias of the capability interface `DigitalIO` (plan §10): the same two methods, nothing changed. */
export type HardwareIO = DigitalIO;

/** Resolves after `ms`; rejects as soon as `signal` aborts. */
export type Sleep = (ms: number, signal: AbortSignal) => Promise<void>;

export type RunOutcome =
  | { status: 'finished' | 'stopped' }
  | { status: 'error'; message: string; blockId?: string };

export type ProgramRun = { done: Promise<RunOutcome>; stop(): void };

/** E3: every forever iteration ends with at least this long a macrotask pause. */
const foreverYieldMs = 10;

/**
 * Runs `onStart` once, then `forever` until stopped (E2). The program starts
 * after this returns, so the caller holds `stop` before any pin is written.
 * After `stop` no statement runs, so no pin is written (E5).
 *
 * `done` never rejects. It is `stopped` whenever `stop` came before the
 * program completed, even during its last statement; `finished` only otherwise.
 */
export function runProgram(ir: ProgramIR, io: HardwareIO, options: { sleep: Sleep }): ProgramRun {
  const controller = new AbortController();
  const done = Promise.resolve().then(() => execute(ir, io, options.sleep, controller.signal));
  return { done, stop: () => controller.abort() };
}

async function execute(ir: ProgramIR, io: HardwareIO, sleep: Sleep, signal: AbortSignal): Promise<RunOutcome> {
  let blockId: string | undefined;
  // Synchronous: a condition reads the pins as they are at that moment.
  const evaluate = (expression: Expression): boolean => {
    blockId = expression.blockId;
    switch (expression.kind) {
      case 'digitalRead':
        return io.digitalRead(expression.pin) === 1;
      case 'not':
        return !evaluate(expression.value);
    }
  };
  const runStatements = async (statements: readonly Statement[]) => {
    for (const statement of statements) {
      signal.throwIfAborted();
      blockId = statement.blockId;
      switch (statement.kind) {
        case 'digitalWrite':
          io.digitalWrite(statement.pin, statement.level);
          break;
        case 'wait':
          await sleep(statement.ms, signal);
          break;
        case 'if': {
          // Conditions are tested in order, each only if the ones before it were false.
          const branch = statement.branches.find(({ condition }) => evaluate(condition));
          await runStatements(branch ? branch.body : statement.else);
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
        await runStatements(forever);
        blockId = undefined;
        signal.throwIfAborted();
        await sleep(foreverYieldMs, signal);
      }
    }
    // A stop during the last statement (or before an empty program) still counts.
    signal.throwIfAborted();
    // E6: finishing leaves the pins as they are; only the caller's stop resets them.
    return { status: 'finished' };
  } catch (error) {
    if (signal.aborted) {
      return { status: 'stopped' };
    }
    // E7: a runtime error ends the program at the statement that failed.
    const message = messageOf(error);
    return blockId === undefined ? { status: 'error', message } : { status: 'error', message, blockId };
  }
}

/**
 * Anything can be thrown, including values whose conversion to a string
 * throws, so this never converts: it keeps an Error's message or a string.
 */
function messageOf(error: unknown): string {
  try {
    const message = error instanceof Error ? error.message : error;
    if (typeof message === 'string' && message !== '') {
      return message;
    }
  } catch {
    // A throwing `message` getter or a hostile proxy: use the generic message.
  }
  return 'Unexpected runtime error';
}

/** The real `Sleep`: a cancellable setTimeout, so waits and forever pauses are macrotasks (E3, E4). */
export function timerSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}
