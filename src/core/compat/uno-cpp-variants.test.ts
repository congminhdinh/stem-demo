import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cppAllowlist } from './contract-validation';
import { unoContract } from './uno-contract';

// N18 C1: the C++ allowlist (contract §15 invariant 9) has every form the generator writes. U-04's INT32_MIN literal and U-17's text
// part were written by contract-forms.ino (CC-03) and named by the rows' `call` evidence, but were not in the allowlist: they are the
// rows' `variants`, next to their `form`.

const row = (id: string) => unoContract.constructs.find((construct) => construct.id === id);

describe('the C++ variants of a row (N18 C1)', () => {
  it('admits the INT32_MIN literal of U-04 and the F() text part of U-17', () => {
    expect(row('U-04')?.cpp?.variants).toEqual(['(-2147483647L - 1L)']);
    expect(row('U-17')?.cpp?.variants).toEqual(['Serial.print(F("<text>"));']);
    const forms = cppAllowlist(unoContract).forms;
    expect(forms).toContain('(-2147483647L - 1L)');
    expect(forms).toContain('Serial.print(F("<text>"));');
  });

  it('keeps every other row without variants', () => {
    expect(unoContract.constructs.filter((construct) => construct.cpp?.variants !== undefined).map((construct) => construct.id)).toEqual(['U-04', 'U-17']);
  });

  it('writes only variants that contract-forms.ino compiled (CC-03)', () => {
    const sketch = readFileSync(join(process.cwd(), 'spikes/avr8js/sketches/contract-forms/contract-forms.ino'), 'utf8');
    expect(sketch).toContain('Serial.println((-2147483647L - 1L));');
    expect(sketch).toContain('Serial.print(F("x = "));');
  });
});
