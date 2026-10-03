import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Expression, ProgramIR, Statement } from './ir';
import { runProgram, timerSleep, type HardwareIO, type Sleep } from './interpreter';

const write = (pin: string, level: 0 | 1, blockId = `write-${pin}-${level}`): Statement => ({
  kind: 'digitalWrite',
  pin,
  level,
  blockId,
});
const wait = (ms: number, blockId = `wait-${ms}`): Statement => ({ kind: 'wait', ms, blockId });
const read = (pin: string, blockId = `read-${pin}`): Expression => ({ kind: 'digitalRead', pin, blockId });
const when = (
  branches: [Expression, Statement[]][],
  otherwise: Statement[] = [],
  blockId = 'if',
): Statement => ({
  kind: 'if',
  branches: branches.map(([condition, body]) => ({ condition, body })),
  else: otherwise,
  blockId,
});
const blink: ProgramIR = { onStart: [], forever: [write('D13', 1), wait(1000), write('D13', 0), wait(1000)] };

/**
 * Records every pin write and read; `onWrite` may react to a write (e.g.
 * stop the program). Reads return `levels`, which a test may change.
 */
function recordingIO(onWrite?: (count: number) => void, levels: Record<string, 0 | 1> = {}) {
  const writes: [string, 0 | 1][] = [];
  const reads: string[] = [];
  const io: HardwareIO = {
    digitalWrite(pin, level) {
      writes.push([pin, level]);
      onWrite?.(writes.length);
    },
    digitalRead(pin) {
      reads.push(pin);
      return levels[pin] ?? 0;
    },
  };
  return { io, writes, reads, levels };
}

/** Never waits; records the requested durations. */
function instantSleep() {
  const durations: number[] = [];
  const sleep: Sleep = async (ms) => {
    durations.push(ms);
  };
  return { sleep, durations };
}

describe('runProgram', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs on start once, in order, then finishes (E2, E6)', async () => {
    const { io, writes } = recordingIO();
    const { sleep, durations } = instantSleep();

    const run = runProgram({ onStart: [write('D13', 1), wait(500), write('D12', 1)], forever: null }, io, { sleep });

    await expect(run.done).resolves.toEqual({ status: 'finished' });
    expect(writes).toEqual([
      ['D13', 1],
      ['D12', 1],
    ]);
    expect(durations).toEqual([500]);
  });

  it('writes nothing before it returns, so a stop right away leaves the pins untouched', async () => {
    const { io, writes } = recordingIO();

    const run = runProgram({ onStart: [write('D13', 1)], forever: null }, io, instantSleep());
    expect(writes).toEqual([]);
    run.stop();

    await expect(run.done).resolves.toEqual({ status: 'stopped' });
    expect(writes).toEqual([]);
  });

  it('repeats forever after on start, pausing 10 ms after each iteration (E3)', async () => {
    const { sleep, durations } = instantSleep();
    // The program starts after runProgram returns, so `run` exists by the first write.
    const { io, writes } = recordingIO((count) => {
      if (count === 5) {
        run.stop();
      }
    });

    const run = runProgram({ onStart: [write('D2', 1)], forever: blink.forever }, io, { sleep });

    await expect(run.done).resolves.toEqual({ status: 'stopped' });
    // Stopped inside the fifth write: nothing runs after it (E5).
    expect(writes).toEqual([
      ['D2', 1],
      ['D13', 1],
      ['D13', 0],
      ['D13', 1],
      ['D13', 0],
    ]);
    expect(durations).toEqual([1000, 1000, 10, 1000]);
  });

  it('interrupts a wait at once on stop and writes nothing after it (E4, E5)', async () => {
    vi.useFakeTimers();
    const { io, writes } = recordingIO();
    const run = runProgram(blink, io, { sleep: timerSleep });

    await vi.advanceTimersByTimeAsync(500);
    run.stop();

    await expect(run.done).resolves.toEqual({ status: 'stopped' });
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(5000);
    expect(writes).toEqual([['D13', 1]]);
  });

  it('reports stopped, not finished, for an empty program stopped right away', async () => {
    const run = runProgram({ onStart: [], forever: null }, recordingIO().io, instantSleep());
    run.stop();

    await expect(run.done).resolves.toEqual({ status: 'stopped' });
  });

  it('reports stopped, not finished, when stopped during the last statement', async () => {
    const { io, writes } = recordingIO(() => run.stop());

    const run = runProgram({ onStart: [write('D13', 1)], forever: null }, io, instantSleep());

    await expect(run.done).resolves.toEqual({ status: 'stopped' });
    expect(writes).toEqual([['D13', 1]]);
  });

  const throwingMessage = Object.defineProperty(new Error(), 'message', {
    get() {
      throw new Error('message getter');
    },
  });

  it.each<[string, unknown, string]>([
    ['an Error', new Error('pin is broken'), 'pin is broken'],
    ['a string', 'pin is broken', 'pin is broken'],
    ['an object whose toString is not callable', { toString: 0 }, 'Unexpected runtime error'],
    ['an Error whose message getter throws', throwingMessage, 'Unexpected runtime error'],
    ['undefined', undefined, 'Unexpected runtime error'],
  ])('ends with an error on the failing statement when HardwareIO throws %s (E7)', async (_, thrown, message) => {
    const { io, writes } = recordingIO((count) => {
      if (count === 2) {
        throw thrown;
      }
    });

    const run = runProgram(
      { onStart: [write('D13', 1), write('D12', 1, 'bad-write'), write('D11', 1)], forever: null },
      io,
      instantSleep(),
    );

    // `done` resolves even when the thrown value cannot be turned into a string.
    await expect(run.done).resolves.toEqual({ status: 'error', message, blockId: 'bad-write' });
    expect(writes).toEqual([
      ['D13', 1],
      ['D12', 1],
    ]);
  });

  describe('if (M3)', () => {
    const ifElseIfElse: ProgramIR = {
      onStart: [
        when([[read('D2'), [write('D13', 1)]], [read('D3'), [write('D12', 1)]]], [write('D11', 1)]),
        write('D10', 1),
      ],
      forever: null,
    };

    it.each<[string, Record<string, 0 | 1>, string[], [string, 0 | 1][]]>([
      ['the if branch when its condition holds, without testing the next', { D2: 1, D3: 1 }, ['D2'], [['D13', 1]]],
      ['the else-if branch when only its condition holds', { D3: 1 }, ['D2', 'D3'], [['D12', 1]]],
      ['the else when no condition holds', {}, ['D2', 'D3'], [['D11', 1]]],
    ])('runs %s, then goes on after the block', async (_, levels, reads, branchWrites) => {
      const recording = recordingIO(undefined, levels);

      await expect(runProgram(ifElseIfElse, recording.io, instantSleep()).done).resolves.toEqual({
        status: 'finished',
      });
      expect(recording.reads).toEqual(reads);
      expect(recording.writes).toEqual([...branchWrites, ['D10', 1]]);
    });

    it('negates a condition with not', async () => {
      const { io, writes } = recordingIO(undefined, { D2: 0 });
      const program: ProgramIR = {
        onStart: [when([[{ kind: 'not', value: read('D2'), blockId: 'not' }, [write('D13', 1)]]])],
        forever: null,
      };

      await runProgram(program, io, instantSleep()).done;

      expect(writes).toEqual([['D13', 1]]);
    });

    it('reads the pin again on every forever iteration, so a change shows within one iteration', async () => {
      vi.useFakeTimers();
      const { io, writes, reads, levels } = recordingIO();
      const program: ProgramIR = {
        onStart: [],
        forever: [when([[read('D2'), [write('D13', 1)]]], [write('D13', 0)])],
      };
      const run = runProgram(program, io, { sleep: timerSleep });
      await vi.advanceTimersByTimeAsync(0);
      expect(writes).toEqual([['D13', 0]]);

      levels.D2 = 1;
      await vi.advanceTimersByTimeAsync(10);

      expect(writes.at(-1)).toEqual(['D13', 1]);
      expect(reads).toHaveLength(2);
      run.stop();
      await expect(run.done).resolves.toEqual({ status: 'stopped' });
    });

    it('stops at once inside a branch, during its wait: nothing after it runs (E4, E5)', async () => {
      vi.useFakeTimers();
      const { io, writes } = recordingIO(undefined, { D2: 1 });
      const program: ProgramIR = { onStart: [when([[read('D2'), [wait(1000), write('D13', 1)]]])], forever: null };
      const run = runProgram(program, io, { sleep: timerSleep });

      await vi.advanceTimersByTimeAsync(500);
      run.stop();

      await expect(run.done).resolves.toEqual({ status: 'stopped' });
      expect(vi.getTimerCount()).toBe(0);
      expect(writes).toEqual([]);
    });

    it('ends with an error on the read block when HardwareIO throws while reading (E7)', async () => {
      const { io, writes } = recordingIO();
      io.digitalRead = () => {
        throw new Error('pin is broken');
      };
      const program: ProgramIR = { onStart: [when([[read('D2', 'bad-read'), [write('D13', 1)]]])], forever: null };

      await expect(runProgram(program, io, instantSleep()).done).resolves.toEqual({
        status: 'error',
        message: 'pin is broken',
        blockId: 'bad-read',
      });
      expect(writes).toEqual([]);
    });
  });
});
