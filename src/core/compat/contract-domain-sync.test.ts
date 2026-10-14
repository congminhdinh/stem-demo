import { describe, expect, it } from 'vitest';
import { localDeviceDefinitions } from '../devices/local-catalog';
import { createDeviceRegistry } from '../devices/registry';
import { productionProfiles } from '../profiles';
import { createBlockPackCatalog } from '../program/block-packs';
import { compileYbcProgram } from '../program/compile-ybc-program';
import { createRunConsole } from '../program/console';
import { MAX_RANGE_VALUE, MAX_REPEAT_ABS, MAX_WAIT_MS } from '../program/limits';
import { add, countUp, num, program, repeat, wait, type Json } from '../program/__fixtures__/ybc-blocks';
import { runYbcProgram } from '../program/ybc-interpreter';
import { evaluatePred } from './contract-validation';
import { yolobitContract } from './yolobit-contract';

// The limits of the loops and of wait are named constants in limits.ts (the compiler and the interpreter
// use them), and the contract holds the same limits as predicates (section 21, invariant 10). A contract
// edit must not make them drift apart silently: these tests run the real compiler and interpreter at the
// boundary values the predicates name, and require the same verdict.

const packs = createBlockPackCatalog(createDeviceRegistry(localDeviceDefinitions));
const exposed = packs.typesOf(productionProfiles.get('ybc-basic')?.blockPacks ?? []);
const prog = (statements: Json[]) => program(statements, undefined, ['x', 'y', 'z', 'i']);
const row = (id: string) => {
  const found = yolobitContract.constructs.find((construct) => construct.id === id);
  if (!found?.domain) {
    throw new Error(`No domain for ${id}`);
  }
  return found.domain;
};

/** Whether the contract's predicate allows `values`, at run time (the arguments as evaluated). */
const runtimeAllows = (id: string, values: Record<string, number>) => evaluatePred(row(id).runtime, { values });

/** What the compiler says about typed-in numbers: true when it accepts them. */
const compiles = (statement: Json) => compileYbcProgram(prog([statement]), exposed).ok;

/** What the interpreter says about computed numbers (a literal plus 0 is computed): true when it ran without a domain fault. */
async function runs(statement: Json) {
  const compiled = compileYbcProgram(prog([statement]), exposed);
  if (!compiled.ok) {
    throw new Error(`Does not compile: ${JSON.stringify(compiled.diagnostics)}`);
  }
  const outcome = await runYbcProgram(compiled.ir, {
    sleep: () => Promise.resolve(),
    console: createRunConsole(),
    yieldNow: () => Promise.resolve(),
  }).done;
  return outcome.status === 'finished';
}
const computed = (value: number) => add(num(value), num(0));

describe('the constants are the contract constants', () => {
  it('has the same repeat and range limits', () => {
    expect(MAX_REPEAT_ABS).toBe(yolobitContract.constants.MAX_REPEAT_ABS);
    expect(MAX_RANGE_VALUE).toBe(yolobitContract.constants.MAX_RANGE_VALUE);
  });
});

describe('wait (C-04): compiler and interpreter agree with the contract predicate', () => {
  const values = [-1, 0, 1, MAX_WAIT_MS - 1, MAX_WAIT_MS, MAX_WAIT_MS + 1];

  it('pins the limit: the predicate allows exactly 0..60000', () => {
    expect(values.filter((ms) => runtimeAllows('C-04', { ms }))).toEqual([0, 1, MAX_WAIT_MS - 1, MAX_WAIT_MS]);
  });

  it.each(values)('%d ms', async (ms) => {
    const allowed = runtimeAllows('C-04', { ms });
    expect(compiles(wait(num(ms)))).toBe(allowed);
    expect(await runs(wait(computed(ms)))).toBe(allowed);
  });
});

describe('repeat (C-37): compiler and interpreter agree with the contract predicate', () => {
  const values = [-MAX_REPEAT_ABS - 1, -MAX_REPEAT_ABS, -1, 0, 1, MAX_REPEAT_ABS, MAX_REPEAT_ABS + 1];

  it.each(values)('%d times', async (n) => {
    const allowed = runtimeAllows('C-37', { n });
    expect(compiles(repeat(num(n), []))).toBe(allowed);
    // Only a count the contract allows is run in full: the bodies are empty, so the large ones are quick.
    if (allowed) {
      expect(await runs(repeat(computed(n), []))).toBe(true);
    } else {
      expect(await runs(repeat(computed(n), []))).toBe(false);
    }
  });
});

describe('count up (C-39): compiler and interpreter agree with the contract predicate', () => {
  const bounds = [-1, 0, 1, MAX_RANGE_VALUE - 1, MAX_RANGE_VALUE, MAX_RANGE_VALUE + 1];

  it.each(bounds)('start %d', async (start) => {
    // A typed-in start above the end is refused for another reason; the end 1 000 000 avoids that.
    const end = MAX_RANGE_VALUE;
    const inDomain = runtimeAllows('C-39', { start, end });
    expect(compiles(countUp('i', num(start), num(end), MAX_RANGE_VALUE, []))).toBe(inDomain);
    expect(await runs(countUp('i', computed(start), computed(end), MAX_RANGE_VALUE, []))).toBe(inDomain);
  });

  it.each(bounds)('end %d', async (end) => {
    const start = 0;
    const inDomain = runtimeAllows('C-39', { start, end });
    expect(compiles(countUp('i', num(start), num(end), MAX_RANGE_VALUE, []))).toBe(inDomain);
    expect(await runs(countUp('i', computed(start), computed(end), MAX_RANGE_VALUE, []))).toBe(inDomain);
  });

  it('keeps the step a typed-in number in 1..MAX_RANGE_VALUE: the contract requires a literal', () => {
    const rules = row('C-39').compileTime;
    expect(rules.some((rule) => 'literal' in rule.when && rule.diagnostic === 'literal-required')).toBe(true);
    for (const step of [0, 1, MAX_RANGE_VALUE, MAX_RANGE_VALUE + 1]) {
      const allowed = rules
        .filter((rule) => rule.diagnostic === 'value-out-of-range' && JSON.stringify(rule.when).includes('"step"'))
        .every((rule) => evaluatePred(rule.when, { values: { step }, literals: new Set(['step']) }));
      expect(compiles(countUp('i', num(1), num(5), step, [])), `step ${step}`).toBe(allowed);
    }
  });

  it('evaluates the start before the end, each once: the contract order is the interpreter order', () => {
    expect(row('C-39').evaluation).toEqual({
      order: ['start', 'end'],
      once: true,
      checkEach: 'after-own-evaluation',
      temporaries: 'unless-all-literal',
    });
  });
});
