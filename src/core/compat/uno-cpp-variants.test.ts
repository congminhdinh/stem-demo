import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cppAllowlist, simDependentFields } from './contract-validation';
import { unoContract } from './uno-contract';

// N18 C1: the C++ allowlist (contract §15 invariant 9) has every form the generator writes. U-04's INT32_MIN literal and U-17's text
// part were written by contract-forms.ino (CC-03) and named by the rows' `call` evidence, but were not in the allowlist: they are the
// rows' `variants`, next to their `form`. Contract 0.1.3 (§3.5) adds the sequenced form of the rows whose operands C++ leaves
// unsequenced (U-05, U-06, U-07, U-09) and of the one call with two value arguments (U-25), traced in EMU-15 and compiled in CC-05.

const row = (id: string) => unoContract.constructs.find((construct) => construct.id === id);
const sequenced = ['(_s<k> = <read>, … <expr>)', 'long _s<k>;', 'bool _s<k>;'];

describe('the C++ variants of a row (N18 C1)', () => {
  it('admits the INT32_MIN literal of U-04 and the F() text part of U-17', () => {
    expect(row('U-04')?.cpp?.variants).toEqual(['(-2147483647L - 1L)']);
    expect(row('U-17')?.cpp?.variants).toEqual(['Serial.print(F("<text>"));']);
    const forms = cppAllowlist(unoContract).forms;
    expect(forms).toContain('(-2147483647L - 1L)');
    expect(forms).toContain('Serial.print(F("<text>"));');
  });

  it('admits the sequenced form of contract 0.1.3 §3.5 on the rows whose operands C++ leaves unsequenced, and on buzzerTone', () => {
    expect(unoContract.version).toBe('0.1.4');
    for (const id of ['U-05', 'U-06', 'U-07', 'U-09']) {
      expect(row(id)?.cpp?.variants, id).toEqual(sequenced);
      expect(row(id)?.levels?.L2e, id).toMatchObject({ status: 'PASS', evidence: expect.arrayContaining(['EMU-15']) });
      expect(row(id)?.fields.content, id).toMatchObject({ label: 'DOCUMENTED', corroboratedBy: ['EMU-15'] });
      const call = row(id)?.fields.call;
      expect(call && 'claims' in call ? call.claims.flatMap((claim) => claim.sources) : [], id).toEqual(['CC-03', 'CC-05']);
      // A language row stays standing without the emulator (contract §0.4): the order rests on the C++ draft.
      expect(row(id) && simDependentFields(row(id)!, unoContract), id).toEqual([]);
    }
    expect(row('U-25')?.cpp?.variants).toEqual(['(_s<k> = <read>, … buzzerTone(<ROLE>_PIN, <hz>, <ms>));']);
    expect(cppAllowlist(unoContract).forms).toEqual(expect.arrayContaining([...sequenced, '(_s<k> = <read>, … buzzerTone(<ROLE>_PIN, <hz>, <ms>));']));
  });

  it('keeps every other row without variants', () => {
    expect(unoContract.constructs.filter((construct) => construct.cpp?.variants !== undefined).map((construct) => construct.id)).toEqual(['U-04', 'U-05', 'U-06', 'U-07', 'U-09', 'U-17', 'U-25']);
  });

  it('records the order of avr-gcc and of the sequenced form as measured (EMU-15) and compiled (CC-05)', () => {
    expect(unoContract.evidence['EMU-15']?.observed).toContain('plain: add32(se(1L), se(2L)) eval=2, eval=1');
    expect(unoContract.evidence['EMU-15']?.observed).toContain('Sequenced: (_s1 = se(1L), _s2 = se(2L), add32(_s1, _s2)) eval=1, eval=2');
    expect(unoContract.evidence['CC-05']).toMatchObject({ kind: 'CC', supports: ['compile-ok', 'compile-size'], establishes: ['call'] });
    expect(unoContract.evidence['CXX-09']?.observed).toContain('The left expression is sequenced before the right expression');
  });

  it('writes only variants that a sketch of ours compiled: contract-forms.ino (CC-03) and eval-order.ino (CC-05)', () => {
    const forms = readFileSync(join(process.cwd(), 'spikes/avr8js/sketches/contract-forms/contract-forms.ino'), 'utf8');
    expect(forms).toContain('Serial.println((-2147483647L - 1L));');
    expect(forms).toContain('Serial.print(F("x = "));');
    const order = readFileSync(join(process.cwd(), 'spikes/avr8js/sketches/eval-order/eval-order.ino'), 'utf8');
    expect(order).toContain('  long _s1;');
    expect(order).toContain('  bool _s4;');
    expect(order).toContain('Serial.println((_s1 = se(1L), _s2 = se(2L), add32(_s1, _s2)));');
    expect(order).toContain('  (_s1 = se(7L), _s2 = se(8L), f3(10, _s1, _s2));');
    expect(order).toContain('  while ((_s1 = se(x), _s2 = se(2L), (_s1 < _s2))) {');
  });
});
