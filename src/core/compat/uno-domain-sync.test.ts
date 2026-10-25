import { describe, expect, it } from 'vitest';
import type { RunWarning } from '../capabilities/services';
import { createRunConsole } from '../program/console';
import { INT32_MAX, INT32_MIN, MAX_WAIT_MS } from '../program/limits';
import { compileUno } from '../program/__fixtures__/uno-language';
import { runYbc } from '../program/__fixtures__/run-ybc';
import { add, countUp, idiv, num, print, program, repeat, wait, type Json } from '../program/__fixtures__/ybc-blocks';
import { evaluatePred } from './contract-validation';
import { unoContract } from './uno-contract';

// N18 R2.3: the domains of the language rows of contract UNO (§3, §4.3) are predicates in uno-contract.ts (test-only data). The
// compiler of the uno family (typed-in values) and the interpreter on a cxx-int32 IR (computed values) must give the verdict of the
// predicate at its boundary values, as contract-domain-sync.test.ts requires of the Yolo:Bit rows.

const prog = (statements: Json[]) => program(statements, undefined, ['x', 'i']);
const row = (id: string) => {
  const found = unoContract.constructs.find((construct) => construct.id === id);
  if (!found) {
    throw new Error(`No row ${id}`);
  }
  return found;
};
const domainOf = (id: string) => {
  const { domain } = row(id);
  if (!domain) {
    throw new Error(`No domain for ${id}`);
  }
  return domain;
};
const runtimeAllows = (id: string, values: Record<string, number>) => evaluatePred(domainOf(id).runtime, { values });
const compiles = (statement: Json) => compileUno(prog([statement])).ok;
/** A value the program computes (a literal plus 0), which only the interpreter checks. */
const computed = (value: number) => add(num(value), num(0));

async function runs(statement: Json, warnings: RunWarning[] = []) {
  const compiled = compileUno(prog([statement]));
  if (!compiled.ok) {
    throw new Error(`Does not compile: ${JSON.stringify(compiled.diagnostics)}`);
  }
  const outcome = await runYbc(compiled.ir, {
    sleep: () => Promise.resolve(),
    console: createRunConsole(),
    yieldNow: () => Promise.resolve(),
    warn: (warning) => void warnings.push(warning),
  }).done;
  return outcome.status === 'finished';
}

describe('the constants and the numeric model are the contract’s', () => {
  it('has the wait limit and the int32 range of the contract', () => {
    expect(MAX_WAIT_MS).toBe(unoContract.constants.MAX_WAIT_MS);
    expect([INT32_MIN, INT32_MAX]).toEqual([unoContract.numeric.min, unoContract.numeric.max]);
  });

  it('warns with the code the contract names when a division by zero gives 0', async () => {
    const warnings: RunWarning[] = [];
    expect(await runs(print(idiv(num(1), num(0))), warnings)).toBe(true);
    expect(warnings.map((warning) => warning.code)).toEqual([unoContract.numeric.divisionByZero.warning]);
    expect(unoContract.diagnostics.find((diagnostic) => diagnostic.id === 'division-by-zero')?.severity).toBe('warning');
  });
});

describe('integer literal (U-04): the compiler agrees with the contract predicate', () => {
  const values = [INT32_MIN - 1, INT32_MIN, -1, 0, INT32_MAX, INT32_MAX + 1];

  it('pins the range: the predicate allows exactly the int32 values', () => {
    expect(values.filter((n) => runtimeAllows('U-04', { n }))).toEqual([INT32_MIN, -1, 0, INT32_MAX]);
  });

  it.each(values)('%d', (n) => {
    expect(compiles(print(num(n)))).toBe(runtimeAllows('U-04', { n }));
  });
});

describe('repeat (U-12): no domain, any long count', () => {
  it('has no domain in the contract, and every int32 count compiles and runs (the large ones run zero times)', async () => {
    expect(row('U-12').domain).toBeUndefined();
    for (const n of [INT32_MIN, -1, 0, 3]) {
      expect(compiles(repeat(num(n), []))).toBe(true);
      expect(await runs(repeat(computed(n), []))).toBe(true);
    }
    expect(compiles(repeat(num(INT32_MAX), []))).toBe(true);
  });
});

describe('count up (U-14): compiler and interpreter agree with the contract predicate', () => {
  const ends = [INT32_MIN, -1, 0, 2_147_483_645, 2_147_483_646, 2_147_483_647];

  it.each(ends)('end %d', async (end) => {
    // The start is the end, so a run is one iteration whatever the end is, and a typed-in range is never descending.
    const allowed = runtimeAllows('U-14', { start: end, end });
    expect(compiles(countUp('i', num(end), num(end), 1, []))).toBe(allowed);
    expect(await runs(countUp('i', computed(end), computed(end), 1, []))).toBe(allowed);
  });

  it('refuses a typed-in start above a typed-in end, as the contract says, and runs zero times for a computed one', async () => {
    const descending = domainOf('U-14').compileTime.find((rule) => rule.diagnostic === 'descending-range-not-supported');
    expect(descending && evaluatePred(descending.when, { values: { start: 5, end: 1 } })).toBe(false);
    expect(compileUno(prog([countUp('i', num(5), num(1), 1, [])])).diagnostics.map((d) => d.code)).toEqual(['descending-range-not-supported']);
    expect(await runs(countUp('i', computed(5), computed(1), 1, []))).toBe(true);
  });

  it('evaluates the start before the end, each once: the contract order is the interpreter order', () => {
    expect(domainOf('U-14').evaluation).toEqual({ order: ['start', 'end'], once: true, checkEach: 'after-own-evaluation' });
  });
});

describe('wait (U-18): compiler and interpreter agree with the contract predicate', () => {
  const values = [-1, 0, 1, MAX_WAIT_MS - 1, MAX_WAIT_MS, MAX_WAIT_MS + 1];

  it.each(values)('%d ms', async (ms) => {
    const allowed = runtimeAllows('U-18', { ms });
    expect(compiles(wait(num(ms)))).toBe(allowed);
    expect(await runs(wait(computed(ms)))).toBe(allowed);
  });
});
