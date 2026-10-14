import { describe, expect, it } from 'vitest';
import { createRunConsole } from '../../program/console';
import type { Sleep } from '../../program/interpreter';
import { runYbc } from '../../program/__fixtures__/run-ybc';
import { compileBlocks } from './__fixtures__/compile-case';
import { langCases } from './__fixtures__/lang-cases';
import { runUnderCpython } from './__fixtures__/cpython-run';
import { python } from './__fixtures__/python';
import { generateYbcMicroPython } from './generate';

// Simulator <-> generator parity for the language (plan §1, §18.3 "khớp Python").
// The SAME IR is run by the interpreter and generated; the generated source is then
// run by CPython with a fake `time` whose 10 ms pause (the idle / forever pause)
// ends the program, and both must print the same lines. This checks the language
// semantics the generated code shares with the simulator (`//`, `%`, short-circuit,
// range, str()); it is NOT a check on MicroPython or on a Yolo:Bit (plan §6.9).

/** Ends the program at its first 10 ms pause: the end of the first forever iteration, or the idle loop. */
async function simulate(blocks: unknown): Promise<string[]> {
  const runConsole = createRunConsole();
  let stop = () => {};
  const sleep: Sleep = (ms, signal) =>
    new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      if (ms === 10) {
        stop();
      }
    });
  const running = runYbc(compileBlocks(blocks), { sleep, console: runConsole });
  stop = running.stop;
  const outcome = await running.done;
  expect(['finished', 'stopped']).toContain(outcome.status);
  return runConsole.snapshot().lines;
}

const parityCases = langCases.filter((c) => c.parity);

describe.skipIf(python === null)('the generated Python prints what the simulator prints (CPython)', () => {
  const sources = Object.fromEntries(
    parityCases.map(({ name, blocks }) => {
      const generated = generateYbcMicroPython(compileBlocks(blocks));
      if (!generated.ok) {
        throw new Error(`${name}: ${JSON.stringify(generated.diagnostics)}`);
      }
      return [name, generated.source];
    }),
  );
  const results = python ? runUnderCpython(sources) : {};

  it('runs every case without a Python error', () => {
    expect(Object.values(results).map((run) => run.error)).toEqual(parityCases.map(() => null));
  });

  const outputs = Object.fromEntries(Object.entries(results).map(([name, run]) => [name, run.lines]));
  it.each(parityCases.map((c) => [c.name, c.blocks] as const))('%s', async (name, blocks) => {
    expect(outputs[name]).toEqual(await simulate(blocks));
  });

  it('checks something: the cases print, and Python sees the same numbers as the simulator for // and %', async () => {
    const arithmetic = parityCases.find((c) => c.name === 'arithmetic');
    expect(outputs['arithmetic']).toEqual(await simulate(arithmetic?.blocks));
    expect(outputs['arithmetic']?.slice(0, 7)).toEqual(['4', '10', '-21', '-3', '-2', '-2', '1']);
    expect(outputs['count-up-expressions']).toEqual(['3', '4', '5', '6', '2', '3', '77']);
  });
});
