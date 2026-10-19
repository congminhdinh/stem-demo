import { describe, expect, it } from 'vitest';
import { exposureViolations, generatorAllowlist } from '../../compat/contract-validation';
import { yolobitContract } from '../../compat/yolobit-contract';
import { langConstructs } from '../../constructs/lang';
import { productionProfiles } from '../../profiles';
import { compileBlocks } from './__fixtures__/compile-case';
import { hardwareCases } from './__fixtures__/hardware-cases';
import { langCases } from './__fixtures__/lang-cases';
import { pinCases } from './__fixtures__/pin-cases';
import { generatedConstructs, generateYbcMicroPython } from './generate';
import { defaultTarget } from './target';

// Completeness and the exposure gate (plan §9.2 YB-5A, R1): a construct a profile shows must be
// generated, must be a contract row that passes EG, and must have a golden. A row that is
// excluded, deferred or of a later phase must not be generated. YB-3 opens the onboard hardware
// (display C-06…C-09, buttons C-12 and C-13, light C-15, sound C-50 and C-51), whose goldens are
// the `hardwareCases`; the rows of the later phases stay out.

const contract = yolobitContract;
const profiles = ['ybc-basic', 'ybc-advanced'].map((id) => productionProfiles.get(id));
const generated = new Set<string>(generatedConstructs);

describe('what the generator covers', () => {
  it('names the contract it was written against', () => {
    expect(defaultTarget).toEqual({ id: contract.contractId, contract: contract.version });
  });

  it('is exactly the constructs Advanced lists, and Basic all but the sensors of N17 B2 and the music of N17 B3: nothing shown without Python, no Python for what is not shown', () => {
    const [basic, advanced] = profiles;
    expect([...(advanced?.constructs ?? [])].sort()).toEqual([...generatedConstructs].sort());
    expect([...(basic?.constructs ?? [])].sort()).toEqual([...generatedConstructs].filter((id) => !['C-16', 'C-17', 'C-18', 'C-20', 'C-21', 'C-22'].includes(id)).sort());
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
    // The language goldens (YB-5A), the onboard hardware goldens (YB-3) and the pin goldens (YB-4, in pins/__golden__).
    const covered = new Set([...langCases, ...hardwareCases, ...pinCases].flatMap((c) => c.covers));
    expect([...generated].filter((id) => !covered.has(id))).toEqual([]);
    expect([...covered].filter((id) => !generated.has(id))).toEqual([]);
  });

  it('covers every language block of the packs: each block type belongs to a generated construct', () => {
    for (const construct of langConstructs) {
      expect(generated.has(construct.contractId), construct.contractId).toBe(true);
    }
  });

  it('does not cover what the contract excludes or defers, nor the hardware rows of the later phases', () => {
    const notGenerated = contract.constructs.filter((row) => !generated.has(row.id));
    expect(notGenerated.length).toBeGreaterThan(0);
    // N17 B4 opened random (C-40) and the running time (C-19); A+B is C-12 written twice, C-47 stays excluded.
    for (const id of ['C-26', 'C-14', 'C-47']) {
      const row = contract.constructs.find((candidate) => candidate.id === id);
      expect(generated.has(id), id).toBe(false);
      expect(row === undefined || row.eligibility === 'EXCLUDED' || row.eligibility === 'DEFERRED', id).toBe(true);
    }
    // Servo (YB-7), text variables, `len` and functions (YB-7); every other hardware row waits for its phase. The onboard
    // hardware (YB-3), the header pins (YB-4), the RGB display of N17 B1 (C-05, C-10, C-42, C-43), the sensors of N17 B2
    // (C-16, C-17, C-18) and the melodies, the tone and stop of N17 B3 (C-20, C-21, C-22) are generated.
    for (const id of ['C-27', 'C-57', 'C-58', 'C-59']) {
      expect(generated.has(id), id).toBe(false);
    }
    for (const id of ['C-05', 'C-10', 'C-42', 'C-43', 'C-16', 'C-17', 'C-18', 'C-20', 'C-21', 'C-22']) {
      expect(generated.has(id), id).toBe(true);
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

  it('writes the module headers exactly as the contract has them: IM-2 yolobit with its preamble, IM-3 music, IM-4 the tempo', () => {
    const module = (id: string) => contract.modules.find((candidate) => candidate.id === id);
    const yolobit = module('C-03b');
    const music = module('C-03c');
    const lines = (name: string) => {
      const found = hardwareCases.find((c) => c.name === name);
      const result = found ? generateYbcMicroPython(compileBlocks(found.blocks)) : null;
      if (!result?.ok) {
        throw new Error(`${name}: ${JSON.stringify(result)}`);
      }
      return result.source.split('\n');
    };
    // Both modules: time, then yolobit and exactly its preamble, then music and its tempo, directly after one another.
    expect(lines('alarm-both-modules').slice(1, 8)).toEqual([
      'import time',
      yolobit?.importForm,
      ...(yolobit?.preamble ?? []),
      music?.importForm,
      ...(music?.preamble ?? []),
    ]);
    // One module: only its own lines.
    expect(lines('melody').slice(1, 4)).toEqual(['import time', music?.importForm, ...(music?.preamble ?? [])]);
    expect(lines('night-light').slice(1, 6)).toEqual(['import time', yolobit?.importForm, ...(yolobit?.preamble ?? [])]);
    expect(lines('melody').join('\n')).not.toMatch(/yolobit|on_pressed/);
    expect(lines('night-light').join('\n')).not.toMatch(/music/);
    // The contract keeps the preamble at exactly three lines (IM-2) and the tempo at (4, 120) (IM-4).
    expect(yolobit?.preamble).toHaveLength(3);
    expect(music?.preamble).toEqual(['music.set_tempo(4, 120)']);
  });

  it('writes no import and no preamble beyond `import time` while no row needs the yolobit module', () => {
    for (const { blocks } of langCases) {
      const result = generateYbcMicroPython(compileBlocks(blocks));
      expect(result.ok && result.source.match(/^(import|from) .*/gm)).toEqual(['import time']);
      expect(result.ok && result.source).not.toMatch(/on_pressed/);
    }
  });
});
