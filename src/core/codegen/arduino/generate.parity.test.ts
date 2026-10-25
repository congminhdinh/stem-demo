import { describe, expect, it } from 'vitest';
import { createProgramIO, createVirtualUno } from '../../hardware';
import { startVirtualRun } from '../../run/__fixtures__/virtual-run';
import { add32, div32, INT32_MAX, INT32_MIN, mod32, mul32, sub32 } from './__fixtures__/contract-int32';
import { compileCase, sketchCases, type SketchCase } from './__fixtures__/sketch-cases';
import { generateUnoSketch } from './generate';

// N18 C1: the simulator runs what the sketch says. The IR of each golden that ends on its own runs in the interpreter, on the virtual
// clock and the virtual UNO, as the robot lab runs it (run/__fixtures__/virtual-run.ts); what it prints must be what the contract's
// arithmetic (contract UNO §3, __fixtures__/contract-int32.ts, which is not the simulator's code) says the sketch prints. The trace of
// the compiled HEX on avr8js is C2's.

async function simulate(sketchCase: SketchCase) {
  const compiled = compileCase(sketchCase);
  const run = startVirtualRun(compiled.ir, {
    scheduler: { delayOverheadUs: compiled.board.costsUs.delayOverhead },
    capabilities: ({ scheduler }) => {
      const uno = createVirtualUno(compiled.board, scheduler.programClock);
      sketchCase.world?.(uno);
      return createProgramIO(compiled.kit, uno, compiled.uses);
    },
  });
  const endedAt = await run.runUntilDone(240);
  return { endedAt, outcome: run.outcome(), lines: run.lines(), warnings: run.warnings.map((warning) => warning.code) };
}

const parityCases = sketchCases.filter((c) => c.console !== undefined);

describe('the interpreter prints what the contract says the sketch prints', () => {
  it('runs the language goldens, the names golden, the deepest nesting and the sequenced reads (contract §3.5)', () => {
    expect(parityCases.map((c) => c.name)).toEqual([
      'empty-program', 'mul-literal', 'int32-wrap', 'division-by-zero', 'count-up-bounds-once', 'millis-compare', 'print-mixed', 'nested-control', 'names', 'deep-nesting',
      'sequenced-reads', 'while-two-reads', 'logic-reads',
    ]);
  });

  it.each(parityCases)('$name', async (sketchCase) => {
    const { ir, kit, board } = compileCase(sketchCase);
    expect(generateUnoSketch(ir, { kit, board }).ok).toBe(true);
    const { endedAt, outcome, lines } = await simulate(sketchCase);
    expect(endedAt).not.toBeNull();
    expect(outcome).toEqual({ status: 'finished' });
    expect(lines).toEqual(sketchCase.console);
  });

  it('checks something: the wrap, the truncation and the zero of the board, not of JavaScript or Python', async () => {
    const wrap = parityCases.find((c) => c.name === 'int32-wrap') as SketchCase;
    expect(wrap.console).toEqual(['-2147483648', '2147483647', '0', '1', '-1073741824', '0', '-2147483648', '-2147483648']);
    expect([add32(INT32_MAX, 1), sub32(INT32_MIN, 1), mul32(300, 200), div32(-7, 2), mod32(-7, 2), mod32(7, -2), div32(INT32_MIN, -1), mod32(INT32_MIN, -1), div32(7, 0)]).toEqual([
      INT32_MIN, INT32_MAX, 60_000, -3, -1, 1, INT32_MIN, 0, 0,
    ]);
    const byZero = await simulate(parityCases.find((c) => c.name === 'division-by-zero') as SketchCase);
    // A division or a remainder by zero gives 0 and warns once per block (contract §13, division-by-zero).
    expect(byZero.warnings).toEqual(['division-by-zero', 'division-by-zero', 'division-by-zero', 'division-by-zero']);
  });
});
