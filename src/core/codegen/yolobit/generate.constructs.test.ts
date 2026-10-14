import { describe, expect, it } from 'vitest';
import { exposureViolations, generatorAllowlist } from '../../compat/contract-validation';
import { yolobitContract } from '../../compat/yolobit-contract';
import { langConstructs } from '../../constructs/lang';
import { productionProfiles } from '../../profiles';
import { compileBlocks } from './__fixtures__/compile-case';
import { langCases } from './__fixtures__/lang-cases';
import { pinCases } from './__fixtures__/pin-cases';
import { generatedConstructs, generateYbcMicroPython } from './generate';
import { defaultTarget } from './target';

// Completeness and the exposure gate (plan §9.2 YB-5A, R1): a construct a profile shows must be
// generated, must be a contract row that passes EG, and must have a golden. A row that is
// excluded, deferred or of a later phase must not be generated.

const contract = yolobitContract;
const profiles = ['ybc-basic', 'ybc-advanced'].map((id) => productionProfiles.get(id));
const generated = new Set<string>(generatedConstructs);

describe('what the generator covers', () => {
  it('names the contract it was written against', () => {
    expect(defaultTarget).toEqual({ id: contract.contractId, contract: contract.version });
  });

  it('is exactly the constructs both profiles list: nothing shown without Python, no Python for what is not shown', () => {
    for (const profile of profiles) {
      expect([...(profile?.constructs ?? [])].sort()).toEqual([...generatedConstructs].sort());
    }
  });

  it.each([...generatedConstructs])('%s is a contract row that passes the exposure gate, with a Python form', (id) => {
    const row = contract.constructs.find((candidate) => candidate.id === id);
    expect(row, id).toBeDefined();
    expect(row && exposureViolations(row, contract)).toEqual([]);
    expect(row?.eligibility === 'ELIGIBLE' || row?.eligibility === 'RESTRICTED').toBe(true);
    // The structure rows (C-01, C-02) and the pure operators describe their form in the contract's own words.
    expect(row?.python ?? row?.fields).toBeDefined();
  });

  it('has a golden that exercises every construct', () => {
    // The language goldens (YB-5A) and the pin goldens (YB-4, in pins/__golden__).
    const covered = new Set([...langCases, ...pinCases].flatMap((c) => c.covers));
    expect([...generated].filter((id) => !covered.has(id))).toEqual([]);
    expect([...covered].filter((id) => !generated.has(id))).toEqual([]);
  });

  it('covers every language block of the packs: each block type belongs to a generated construct', () => {
    for (const construct of langConstructs) {
      expect(generated.has(construct.contractId), construct.contractId).toBe(true);
    }
  });

  it('does not cover what the contract excludes or defers, nor any hardware row', () => {
    const notGenerated = contract.constructs.filter((row) => !generated.has(row.id));
    expect(notGenerated.length).toBeGreaterThan(0);
    for (const id of ['C-40', 'C-19', 'C-26', 'C-14']) {
      const row = contract.constructs.find((candidate) => candidate.id === id);
      expect(generated.has(id), id).toBe(false);
      expect(row === undefined || row.eligibility === 'EXCLUDED' || row.eligibility === 'DEFERRED', id).toBe(true);
    }
    // C-23, C-24 and C-25 are generated since YB-4 (the header pins); every other hardware row waits for its phase.
    for (const id of ['C-06', 'C-07', 'C-08', 'C-09', 'C-12', 'C-13', 'C-15', 'C-16', 'C-27', 'C-50', 'C-51', 'C-57', 'C-58', 'C-59']) {
      expect(generated.has(id), id).toBe(false);
    }
  });
});

describe('the builtins and forms of the generated programs come from the contract', () => {
  const allowed = generatorAllowlist(contract);

  it('uses only builtins the exposable rows list', () => {
    const used = new Set<string>();
    for (const { blocks } of langCases) {
      const result = generateYbcMicroPython(compileBlocks(blocks));
      if (!result.ok) {
        throw new Error(JSON.stringify(result.diagnostics));
      }
      for (const builtin of ['print', 'range', 'str', 'int', 'len']) {
        if (new RegExp(`\\b${builtin}\\(`).test(result.source)) {
          used.add(builtin);
        }
      }
    }
    expect([...used].sort()).toEqual(['print', 'range', 'str']);
    for (const builtin of used) {
      expect(allowed.builtins).toContain(builtin);
    }
  });

  it('writes no import and no preamble beyond `import time` while no row needs the yolobit module', () => {
    for (const { blocks } of langCases) {
      const result = generateYbcMicroPython(compileBlocks(blocks));
      expect(result.ok && result.source.match(/^(import|from) .*/gm)).toEqual(['import time']);
      expect(result.ok && result.source).not.toMatch(/on_pressed/);
    }
  });
});
