import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  UNO_EVIDENCE_SCOPE,
  arduinoCalls,
  emuForbiddenClaims,
  ofFields,
  rulesOf,
  unoContractSchema,
  yolobitContractSchema,
  type ConstructContract,
  type FieldEntry,
  type OfField,
  type UnoContract,
} from './contract-types';
import {
  claimProblems,
  cppAllowlist,
  evaluatePred,
  exposableConstructs,
  exposureViolations,
  isExposable,
  profileConstructViolations,
  simDependentFields,
  validateContract,
} from './contract-validation';
import { unoContract } from './uno-contract';
import { yolobitContract } from './yolobit-contract';

// The machine-readable UNO contract against docs/uno-compatibility-contract.md (N18 R0.3), validated the way the Yolo:Bit
// contract is: one evidence rule for the audit and the gate, and the R0.3 acceptance that no open row has a field
// without evidence.

const contract = unoContract;
const row = (id: string): ConstructContract => {
  const found = contract.constructs.find((construct) => construct.id === id);
  if (!found) {
    throw new Error(`No contract row ${id}`);
  }
  return found;
};
const withField = (id: string, field: OfField, entry: FieldEntry): UnoContract => ({
  ...contract,
  constructs: contract.constructs.map((construct) => (construct.id === id ? { ...construct, fields: { ...construct.fields, [field]: entry } } : construct)),
});
const exposed = () => contract.constructs.filter((c) => c.eligibility === 'ELIGIBLE' || c.eligibility === 'RESTRICTED');

const BOTH = ['U-01', 'U-02', 'U-03', 'U-04', 'U-05', 'U-06', 'U-07', 'U-08', 'U-09', 'U-10', 'U-11', 'U-12', 'U-13', 'U-14', 'U-15', 'U-16', 'U-17', 'U-18', 'U-20', 'U-21', 'U-22', 'U-23', 'U-24', 'U-25', 'U-27', 'U-28', 'U-30'];
const ADVANCED_ONLY = ['U-19', 'U-26', 'U-29', 'U-31', 'U-32', 'U-33', 'U-34'];
const LANGUAGE = ['U-01', 'U-02', 'U-03', 'U-04', 'U-05', 'U-06', 'U-07', 'U-08', 'U-09', 'U-10', 'U-11', 'U-12', 'U-13', 'U-14', 'U-15', 'U-16', 'U-17', 'U-18'];
const MODULES_AND_PINS = ['U-19', 'U-20', 'U-21', 'U-22', 'U-23', 'U-24', 'U-25', 'U-26', 'U-27', 'U-28', 'U-29', 'U-30', 'U-31', 'U-32', 'U-33', 'U-34'];
const CLOSED: [string, 'EXCLUDED' | 'DEFERRED'][] = [
  ['U-40', 'EXCLUDED'], ['U-41', 'EXCLUDED'], ['U-42', 'DEFERRED'], ['U-43', 'DEFERRED'], ['U-44', 'EXCLUDED'], ['U-45', 'EXCLUDED'],
  ['U-46', 'DEFERRED'], ['U-47', 'EXCLUDED'], ['U-48', 'EXCLUDED'], ['U-49', 'EXCLUDED'], ['U-50', 'EXCLUDED'],
];

describe('the UNO contract data', () => {
  it('has the shape of contract §15', () => {
    const parsed = unoContractSchema.safeParse(contract);
    expect(parsed.success ? [] : parsed.error.issues).toEqual([]);
  });

  it('keeps every invariant, with the evidence rules of its target', () => {
    expect(rulesOf(contract).family).toBe('UNO');
    expect(rulesOf(yolobitContract).family).toBe('Yolo:Bit');
    expect(validateContract(contract)).toEqual([]);
  });

  it('has the 15 observable fields on every row, and the 2 module fields on every module', () => {
    for (const construct of contract.constructs) {
      expect(Object.keys(construct.fields).sort(), construct.id).toEqual([...ofFields].sort());
    }
    for (const module of contract.modules) {
      expect(Object.keys(module.fields).sort()).toEqual(['import', 'module']);
    }
  });

  it('is pinned to arduino-cli 1.5.1, arduino:avr 1.8.8, Servo 1.3.0 and avr8js 0.21.1, each at least two weeks old', () => {
    expect(contract.snapshot).toMatchObject({
      pinnedOn: '2026-10-25',
      fqbn: 'arduino:avr:uno',
      arduinoCli: '1.5.1',
      core: { name: 'arduino:avr', version: '1.8.8', published: '2026-05-21', license: 'LGPL-2.1' },
      toolchain: 'avr-gcc 7.3.0-atmel3.6.1-arduino7',
      libraries: [{ name: 'Servo', version: '1.3.0', published: '2025-11-06', license: 'LGPL-2.1' }],
      emulator: { name: 'avr8js', version: '0.21.1', published: '2026-08-31', license: 'MIT' },
      mcuAssumed: 'atmega328p',
      boardIdentity: 'UNKNOWN',
    });
    const twoWeeksBefore = Date.parse(contract.snapshot.pinnedOn) - 14 * 86_400_000;
    for (const pinned of [contract.snapshot.core, contract.snapshot.emulator, ...contract.snapshot.libraries]) {
      expect(Date.parse(pinned.published), pinned.name).toBeLessThanOrEqual(twoWeeksBefore);
    }
    expect(contract.snapshot.statement).toContain('not a timeless compatibility guarantee');
    expect(contract.modules.map((m) => [m.id, m.library])).toEqual([
      ['U-M1', { name: 'arduino:avr', version: '1.8.8', license: 'LGPL-2.1' }],
      ['U-M2', { name: 'Servo', version: '1.3.0', license: 'LGPL-2.1' }],
    ]);
  });
});

describe('rows and eligibility (contract §10)', () => {
  it('opens exactly the language, module and pin rows, and closes the rest with a reason', () => {
    expect(exposed().map((c) => c.id).sort()).toEqual([...BOTH, ...ADVANCED_ONLY].sort());
    expect(contract.constructs.filter((c) => !exposed().includes(c)).map((c) => [c.id, c.eligibility])).toEqual(CLOSED);
    for (const construct of contract.constructs.filter((c) => !exposed().includes(c))) {
      expect(construct.exclusionReason, construct.id).toBeTruthy();
      expect(construct.cpp, construct.id).toBeUndefined();
      expect(construct.profiles, construct.id).toEqual([]);
    }
  });

  it('leaves no field UNKNOWN or INFERRED on an open row (R0.3 acceptance), and has no UNVERIFIED escape hatch', () => {
    for (const construct of exposed()) {
      for (const field of ofFields) {
        expect(['UNKNOWN', 'INFERRED'], `${construct.id}.${field}`).not.toContain(construct.fields[field].label);
      }
      expect(construct.unverifiedFields, construct.id).toBeUndefined();
      expect(construct.unverifiedForms, construct.id).toBeUndefined();
    }
    for (const construct of contract.constructs) {
      expect(Object.values(construct.fields).filter((entry) => entry.label === 'INFERRED'), construct.id).toEqual([]);
    }
  });

  it('refuses an open row whose field becomes UNKNOWN, in the gate and in the audit', () => {
    const broken = withField('U-20', 'clamp', { label: 'UNKNOWN', note: 'not established' });
    const changed = broken.constructs.find((c) => c.id === 'U-20');
    expect(changed && exposureViolations(changed, broken).join('\n')).toContain('U-20.clamp is UNKNOWN');
    expect(validateContract(broken).join('\n')).toContain('U-20.clamp is UNKNOWN on an ELIGIBLE construct (EG)');
  });

  it('lets every open row through the gate and keeps every closed one out', () => {
    for (const construct of exposed()) {
      expect(exposureViolations(construct, contract), construct.id).toEqual([]);
    }
    for (const [id] of CLOSED) {
      expect(isExposable(row(id), contract), id).toBe(false);
    }
  });

  it('says D3/D11 get PWM back after a tone only with a new analogWrite (U-48, EMU-14; Tone.cpp disableTimer clears the COM bits)', () => {
    const content = row('U-48').fields.content;
    const statements = content.label === 'VERIFIED' ? content.claims.map((c) => c.statement) : [];
    expect(statements).toContain('After noTone, or a tone that ends by itself, D3/D11 have no PWM until a new analogWrite.');
    expect(statements.join(' ')).not.toMatch(/noTone gives the PWM back/);
    expect(contract.evidence['EMU-05']?.observed).toContain('noTone, then a new analogWrite(11/3, 100), gives the PWM back');
    expect(contract.evidence['EMU-14']).toMatchObject({ kind: 'EMU', supports: ['emu-trace'], establishes: ['content'] });
  });

  it('records the timer conflict as VERIFIED behaviour on the excluded row U-48, not as UNKNOWN', () => {
    expect(row('U-48')).toMatchObject({ eligibility: 'EXCLUDED' });
    const content = row('U-48').fields.content;
    expect(content).toMatchObject({ label: 'VERIFIED' });
    const sources = content.label === 'VERIFIED' ? content.claims.flatMap((c) => c.sources) : [];
    expect(sources).toEqual(expect.arrayContaining(['EMU-04', 'EMU-05']));
    expect(contract.board.timerClaims).toEqual({ servo: 'T1', tone: 'T2' });
  });
});

describe('profiles (contract §11)', () => {
  it('shows the basic rows to both profiles and the raw pins, millis, line.raw and buzzer.stop to Advanced only', () => {
    expect(exposableConstructs(contract, 'uno-basic').map((c) => c.id).sort()).toEqual([...BOTH].sort());
    expect(exposableConstructs(contract, 'uno-advanced').map((c) => c.id).sort()).toEqual([...BOTH, ...ADVANCED_ONLY].sort());
    expect(profileConstructViolations('uno-basic', BOTH, contract)).toEqual([]);
    expect(profileConstructViolations('uno-advanced', [...BOTH, ...ADVANCED_ONLY], contract)).toEqual([]);
  });

  it('refuses a profile of the other target, an Advanced row in Basic, and an excluded row', () => {
    expect(profileConstructViolations('ybc-basic', ['U-01'], contract).join('\n')).toContain('ybc-basic is not a UNO profile');
    expect(profileConstructViolations('uno-basic', ['U-31'], contract).join('\n')).toContain('U-31 is not meant for this profile');
    expect(profileConstructViolations('uno-advanced', ['U-48'], contract).join('\n')).toContain('U-48 is EXCLUDED');
    expect(profileConstructViolations('uno-basic', ['C-01'], yolobitContract).join('\n')).toContain('uno-basic is not a Yolo:Bit profile');
  });

  it('leaves the Yolo:Bit shape as it was: a Yolo:Bit row may not name an UNO profile', () => {
    const c01 = yolobitContract.constructs.find((c) => c.id === 'C-01');
    const tampered = { ...yolobitContract, constructs: [{ ...c01, profiles: ['uno-basic'] }] };
    expect(yolobitContractSchema.safeParse(tampered).success).toBe(false);
    expect(yolobitContractSchema.safeParse(yolobitContract).success).toBe(true);
  });
});

describe('claim levels L1 / L2 / L2e / L3 (contract §12)', () => {
  it('has every open row compiled (L2, CC-03), its simulator semantics tested (L1, N18 final fix M4) and the board pending (L3, M06)', () => {
    for (const construct of exposed()) {
      expect(construct.levels?.L2, construct.id).toEqual({ status: 'PASS', evidence: ['CC-03'] });
      // Ruling L110, carried out at N18 final fix M4: L1 is PASS once tests of the simulator run the row.
      const l1 = construct.levels?.L1;
      expect(l1?.status, construct.id).toBe('PASS');
      expect((l1?.status === 'PASS' ? l1.evidence : []).map((id) => contract.evidence[id]?.kind), construct.id).toEqual(expect.arrayContaining(['TST']));
      expect(construct.levels?.L3, construct.id).toEqual({ status: 'PENDING', by: 'M06' });
    }
  });

  it('rests L1 on tests of this repository: each TST entry names a test file that exists and the titles of tests in it, none skipped (N18 final fix M4, review 2 N3)', () => {
    const tests = Object.entries(contract.evidence).filter(([, entry]) => entry.kind === 'TST');
    expect(tests.map(([id]) => id)).toEqual(['TST-01', 'TST-02', 'TST-03', 'TST-04', 'TST-05', 'TST-06', 'TST-07']);
    for (const [id, entry] of tests) {
      expect(entry, id).toMatchObject({ supports: ['sim-semantic'], establishes: [] });
      expect(entry.source, id).toMatch(/^(src|tests)\/[\w./-]+\.test\.tsx?$/);
      const file = readFileSync(join(process.cwd(), entry.source), 'utf8');
      const titles = entry.action.split(' · ');
      expect(titles.length, id).toBeGreaterThan(0);
      // Exactly the title of an it, a test or a describe (not a part of a longer one), in a file where nothing is skipped or left to do.
      expect(file.match(/\.(skip|todo|skipIf|runIf)\b/g), `${id}: ${entry.source} skips a test`).toBeNull();
      for (const title of titles) {
        const called = ['it', 'test', 'describe'].some((call) => file.includes(`${call}('${title}', `));
        expect(called, `${id}: ${entry.source} has no test or describe titled exactly "${title}"`).toBe(true);
      }
    }
    // A test establishes no field: the fields stay on the emulator, the compiler and the documents.
    expect(UNO_EVIDENCE_SCOPE.TST).toEqual([]);
    // U-48 is not offered, but its refusal (timer-claimed) is the simulator's: tested too.
    expect(row('U-48').levels?.L1).toEqual({ status: 'PASS', evidence: ['TST-04', 'TST-06'] });
  });

  it('refuses an L1 PASS that cites anything but a test of this repository, and takes one that does (N18 final fix M4)', () => {
    const withL1 = (evidence: string[]): UnoContract => ({
      ...contract,
      constructs: contract.constructs.map((c) => (c.id === 'U-20' && c.levels ? { ...c, levels: { ...c.levels, L1: { status: 'PASS', evidence } } } : c)),
    });
    expect(validateContract(withL1(['TST-03']))).toEqual([]);
    expect(validateContract(withL1(['TST-03', 'CC-03']))).toEqual(['U-20.L1 cites CC-03, which is not TST evidence']);
    expect(validateContract(withL1(['EMU-13']))).toEqual(['U-20.L1 cites EMU-13, which is not TST evidence']);
    expect(validateContract(withL1(['TST-99']))).toEqual(['U-20.L1 cites TST-99, which is not TST evidence']);
  });

  it('has every open row traced in avr8js (L2e) by the contract-forms run, with the sketches that measured it', () => {
    for (const construct of exposed()) {
      const l2e = construct.levels?.L2e;
      expect(l2e?.status, construct.id).toBe('PASS');
      expect(l2e?.status === 'PASS' ? l2e.evidence : [], construct.id).toContain('EMU-13');
    }
  });

  it('refuses a level PASS that cites evidence of the wrong kind, and an L3 PASS', () => {
    const wrongKind: UnoContract = { ...contract, constructs: contract.constructs.map((c) => (c.id === 'U-20' && c.levels ? { ...c, levels: { ...c.levels, L2e: { status: 'PASS', evidence: ['CC-03'] } } } : c)) };
    expect(validateContract(wrongKind).join('\n')).toContain('U-20.L2e cites CC-03, which is not EMU evidence');
    const physical: UnoContract = { ...contract, constructs: contract.constructs.map((c) => (c.id === 'U-20' && c.levels ? { ...c, levels: { ...c.levels, L3: { status: 'PASS', evidence: ['EMU-13'] } } } : c)) };
    expect(validateContract(physical).join('\n')).toContain('U-20.L3 is PASS, but no physical evidence exists in contract v0');
  });
});

describe('the UNO contract’s own rules each refuse what they say (contract §15, N18 final fix M14)', () => {
  /** The contract with row `id` changed by `change`. */
  const withRow = (id: string, change: (row: ConstructContract) => ConstructContract): UnoContract => ({
    ...contract,
    constructs: contract.constructs.map((c) => (c.id === id ? change(c) : c)),
  });

  it('an INFERRED field, anywhere', () => {
    const broken = withField('U-40', 'range', { label: 'INFERRED', note: 'guessed' });
    expect(validateContract(broken)).toEqual(['U-40.range is INFERRED: the UNO contract uses VERIFIED, DOCUMENTED, UNKNOWN or n/a only']);
  });

  it('an UNVERIFIED field or form on a row (the Yolo:Bit owner’s escape hatch, which the UNO contract has not)', () => {
    const fields = withRow('U-40', (c) => ({ ...c, unverifiedFields: { range: 'not measured' } }));
    expect(validateContract(fields)).toContain('U-40 names UNVERIFIED fields or forms: the UNO contract opens a row on evidence only');
    const forms = withRow('U-20', (c) => ({ ...c, unverifiedForms: [{ form: 'analogWrite(<pin>, <v>)', reason: 'not compiled' }] }));
    expect(validateContract(forms)).toContain('U-20 names UNVERIFIED fields or forms: the UNO contract opens a row on evidence only');
  });

  it('a Python mapping', () => {
    const broken = withRow('U-20', (c) => ({ ...c, python: { form: 'motor.set(<role>, <speed>)' } }) as ConstructContract);
    expect(validateContract(broken)).toContain('U-20 has a Python mapping in the UNO contract');
  });

  it('a row without its claim levels', () => {
    const broken = withRow('U-20', (c) => {
      const { levels, ...rest } = c;
      expect(levels).toBeDefined();
      return rest;
    });
    expect(validateContract(broken)).toEqual(['U-20 has no claim levels']);
  });

  it('an open row whose C++ form has not compiled (L2 not PASS)', () => {
    const broken = withRow('U-20', (c) => ({ ...c, levels: { ...c.levels!, L2: { status: 'PENDING', by: 'C1' } } }));
    expect(validateContract(broken)).toEqual(['U-20 is ELIGIBLE but its C++ form has not compiled (L2)']);
  });

  it('a library none of the row’s modules pins', () => {
    const broken = withRow('U-23', (c) => ({ ...c, cpp: { ...c.cpp!, libraries: [...c.cpp!.libraries, { name: 'Servo', version: '1.2.2', license: 'LGPL-2.1' }] } }));
    expect(validateContract(broken)).toContain('U-23 needs Servo@1.2.2, which none of its modules pins');
  });

  it('a helper the contract does not have, and a helper whose users and rows disagree either way', () => {
    const unknown = withRow('U-20', (c) => ({ ...c, cpp: { ...c.cpp!, helpers: [...(c.cpp!.helpers ?? []), 'pid-loop'] } }));
    expect(validateContract(unknown)).toContain('U-20 names unknown helper pid-loop');
    const unlisted = withRow('U-24', (c) => ({ ...c, cpp: { ...c.cpp!, helpers: [...(c.cpp!.helpers ?? []), 'int32'] } }));
    expect(validateContract(unlisted)).toEqual(['helper int32 does not list U-24 among its users']);
    const stranger: UnoContract = { ...contract, helpers: { ...contract.helpers, int32: { ...contract.helpers.int32!, usedBy: [...contract.helpers.int32!.usedBy, 'U-24'] } } };
    expect(validateContract(stranger)).toEqual(['helper int32 lists U-24, which does not use it']);
  });

  it('a measured number that cites anything but the emulator', () => {
    expect(validateContract({ ...contract, costsEvidence: [...contract.costsEvidence, 'CC-03'] })).toEqual(['CC-03 is cited for a measured number but is not EMU evidence']);
    expect(validateContract({ ...contract, millis: { ...contract.millis, evidence: ['ARD-05'] } })).toEqual(['ARD-05 is cited for a measured number but is not EMU evidence']);
  });

  it('refuses a key a module does not have: a misspelling, or an UNVERIFIED list the UNO contract has not (unoModuleSchema is strict)', () => {
    const [first, ...rest] = contract.modules;
    for (const extra of [{ unverifiedFields: { module: 'not established' } }, { eligibilty: 'ELIGIBLE' }, { preamble: ['#include <Servo.h>'] }]) {
      const parsed = unoContractSchema.safeParse({ ...contract, modules: [{ ...first, ...extra }, ...rest] });
      expect(parsed.success, JSON.stringify(extra)).toBe(false);
      expect(parsed.error?.issues.map((issue) => [issue.code, issue.path.join('.')]), JSON.stringify(extra)).toEqual([['unrecognized_keys', 'modules.0']]);
    }
    expect(unoContractSchema.safeParse(contract).success).toBe(true);
  });
});

describe('the emulator boundary (contract §0.4)', () => {
  it('lets avr8js establish only what a trace shows, never the board', () => {
    expect(UNO_EVIDENCE_SCOPE.EMU).toEqual(['emu-trace']);
    for (const forbidden of emuForbiddenClaims) {
      expect(UNO_EVIDENCE_SCOPE.EMU).not.toContain(forbidden);
      expect(claimProblems({ kind: forbidden, statement: 'x', sources: ['EMU-03'] }, contract).length, forbidden).toBeGreaterThan(0);
    }
  });

  it('does not let a compile establish a timing, nor a document a trace', () => {
    expect(claimProblems({ kind: 'emu-trace', statement: 'x', sources: ['CC-03'] }, contract)).not.toEqual([]);
    expect(claimProblems({ kind: 'emu-trace', statement: 'x', sources: ['ARD-01'] }, contract)).not.toEqual([]);
    const broken = withField('U-20', 'yield', { label: 'VERIFIED', claims: [{ kind: 'compile-ok', statement: 'it compiles', sources: ['CC-03'] }] });
    expect(validateContract(broken).join('\n')).toContain('a "compile-ok" claim cannot establish yield');
  });

  it('would keep the language and drop every module and pin row if avr8js evidence were withdrawn', () => {
    for (const id of LANGUAGE) {
      expect(isExposable(row(id), contract, 'REJECTED'), id).toBe(true);
    }
    for (const id of MODULES_AND_PINS) {
      expect(isExposable(row(id), contract, 'REJECTED'), id).toBe(false);
      expect(simDependentFields(row(id), contract).length, id).toBeGreaterThan(0);
    }
    for (const id of LANGUAGE) {
      expect(simDependentFields(row(id), contract), id).toEqual([]);
    }
  });
});

describe('the numeric model (contract §3)', () => {
  it('is cxx-int32: wrap, truncating division, the sign of the dividend, the two undefined cases decided, bool prints 1 / 0', () => {
    expect(contract.numeric).toEqual({
      model: 'cxx-int32',
      min: -2_147_483_648,
      max: 2_147_483_647,
      overflow: 'wrap',
      division: 'truncate-toward-zero',
      remainder: 'sign-of-dividend',
      int32MinDividedByMinusOne: -2_147_483_648,
      remainderByMinusOne: 0,
      divisionByZero: { quotient: 0, remainder: 0, warning: 'division-by-zero' },
      boolPrints: { true: '1', false: '0' },
      literalSuffix: 'L',
      int32MinLiteral: '(-2147483647L - 1L)',
      float: 'excluded',
    });
  });

  it('writes every operator on a learner value as a helper, never as a plain C++ operator', () => {
    expect(row('U-05').cpp?.form).toBe('add32(<a>, <b>) · sub32(<a>, <b>) · mul32(<a>, <b>)');
    expect(row('U-06').cpp?.form).toBe('div32(<a>, <b>)');
    expect(row('U-07').cpp?.form).toBe('mod32(<a>, <b>)');
    expect(row('U-08').cpp?.form).toBe('neg32(<a>)');
    expect(row('U-04').cpp?.form).toBe('<n>L');
    for (const id of ['U-05', 'U-06', 'U-07', 'U-08']) {
      expect(row(id).cpp?.helpers, id).toEqual(['int32']);
    }
  });

  it('counts up in the contract form: start, then end, each once, before the loop; the variable keeps the last value', () => {
    expect(row('U-14').cpp?.form).toBe('{ const long _from = (<start>); const long _to = (<end>); for (long _c = _from; _c <= _to; _c += 1L) { <var> = _c; <body> } }');
    expect(row('U-14').domain?.evaluation).toEqual({ order: ['start', 'end'], once: true, checkEach: 'after-own-evaluation' });
    const runtime = row('U-14').domain?.runtime;
    expect(runtime && evaluatePred(runtime, { values: { start: -5, end: 2_147_483_646 } })).toBe(true);
    expect(runtime && evaluatePred(runtime, { values: { start: 0, end: 2_147_483_647 } })).toBe(false);
    expect(row('U-12').cpp?.form).toBe('{ const long _n = (<count>); for (long _r = 0L; _r < _n; _r += 1L) { <body> } }');
  });

  it('allows a wait of 0..60000 ms and a literal within int32', () => {
    const wait = row('U-18').domain?.runtime;
    expect([-1, 0, 60_000, 60_001].map((ms) => wait && evaluatePred(wait, { values: { ms } }))).toEqual([false, true, true, false]);
    const literal = row('U-04').domain?.runtime;
    expect([-2_147_483_649, -2_147_483_648, 2_147_483_647, 2_147_483_648].map((n) => literal && evaluatePred(literal, { values: { n } }))).toEqual([false, true, true, false]);
  });
});

describe('time, costs and the board (contract §4, §5)', () => {
  it('charges each Arduino call what avr8js measured, in µs (ADR 0003 §4)', () => {
    expect(Object.keys(contract.costsUs).sort()).toEqual([...arduinoCalls].sort());
    expect(contract.costsUs).toEqual({
      pinMode: 4.375,
      pinModeInputPullup: 4.75,
      digitalWrite: 4.5625,
      digitalWriteTimerPin: 5.625,
      digitalRead: 3.9375,
      digitalReadTimerPin: 5.0625,
      analogRead: 105.8125,
      analogReadFirst: 201.8125,
      analogWrite: 7.6875,
      analogWriteDigital: 11.875,
      millis: 1.1875,
      delayOverhead: 8.5625,
      servoWrite: 49.5,
      tone: 174.0625,
      noTone: 6.375,
      pulseInAfterPulse: 3.25,
      pulseInNoPulse30000: 20_752,
      ultrasonicCmOverhead: 65.5625,
      ultrasonicCmNoEcho: 20_812,
      motorSetOverhead: 43.6875,
      serialWriteByte: 4.625,
      serialQueueByte: 6.28125,
      serialLineByte: 1040,
      serialPrintLongBase: 9.375,
      serialPrintLongDigit: 45.1875,
      serialPrintLongSign: 6.8125,
      serialPrintln: 17.25,
    });
    expect(contract.costsEvidence).toEqual(['EMU-08', 'EMU-03', 'EMU-13', 'EMU-17', 'EMU-18']);
  });

  it('keeps the loop policy of the simulator: no hidden delay, 50 µs per loop() iteration, 1 µs per node', () => {
    expect(contract.constants).toMatchObject({ LOOP_MIN_US: 50, NODE_US: 1 });
    expect(row('U-02').cpp?.form).toBe('void loop() {\n  <body>\n}');
    expect(row('U-02').restrictions.join(' ')).toContain('no hidden delay');
  });

  it('computes millis() as the board does: one count per 1024 µs overflow and 3/125 carried', () => {
    expect(contract.millis).toEqual({ overflowUs: 1024, fractPerOverflow: 3, fractMax: 125, evidence: ['EMU-12', 'EMU-13'] });
    expect(row('U-19').cpp?.form).toBe('(long)millis()');
  });

  it('has the UNO pins and timers of the measured board', () => {
    expect(contract.board).toEqual({
      mcu: 'atmega328p',
      clockHz: 16_000_000,
      adcMax: 1023,
      pwmMax: 255,
      flashBytes: 32_256,
      ramBytes: 2048,
      pwmPins: [
        { pin: 'D3', timer: 'T2', mode: 'phase-correct', frequencyHz: 490.196 },
        { pin: 'D5', timer: 'T0', mode: 'fast', frequencyHz: 976.5625 },
        { pin: 'D6', timer: 'T0', mode: 'fast', frequencyHz: 976.5625 },
        { pin: 'D9', timer: 'T1', mode: 'phase-correct', frequencyHz: 490.196 },
        { pin: 'D10', timer: 'T1', mode: 'phase-correct', frequencyHz: 490.196 },
        { pin: 'D11', timer: 'T2', mode: 'phase-correct', frequencyHz: 490.196 },
      ],
      reserved: [{ pin: 'D0', when: 'serial' }, { pin: 'D1', when: 'serial' }],
      timerClaims: { servo: 'T1', tone: 'T2' },
      nonPwmThreshold: 128,
    });
  });

  it('keeps the module and memory constants of contract §6 and §8', () => {
    expect(contract.constants).toEqual({
      LOOP_MIN_US: 50,
      NODE_US: 1,
      SERIAL_BAUD: 9600,
      SERIAL_FRAME_US: 1040,
      SERIAL_TX_QUEUE_BYTES: 64,
      PULSEIN_TIMEOUT_US: 30_000,
      ULTRASONIC_US_PER_CM: 58,
      ULTRASONIC_MIN_CM: 2,
      ULTRASONIC_MAX_CM: 400,
      ULTRASONIC_NO_ECHO_CM: 400,
      MAX_WAIT_MS: 60_000,
      COUNT_UP_MAX_END: 2_147_483_646,
      MOTOR_SPEED_MAX: 100,
      SERVO_ANGLE_MAX: 180,
      SERVO_START_ANGLE: 90,
      TONE_MIN_HZ: 31,
      TONE_MAX_HZ: 4000,
      TONE_MIN_MS: 1,
      TONE_MAX_MS: 60_000,
      PWM_MAX: 255,
      RAM_SOLUTION_MAX_PERCENT: 75,
      RAM_WARN_ABOVE_BYTES: 1536,
    });
  });
});

describe('the C++ the generator may write (contract §15 invariant 9)', () => {
  it('is exactly what the open rows list', () => {
    const allowed = cppAllowlist(contract);
    expect(allowed.includes).toEqual(['#include <Servo.h>']);
    expect(allowed.libraries.sort()).toEqual(['Servo@1.3.0', 'arduino:avr@1.8.8'].sort());
    expect(allowed.helpers.sort()).toEqual(['buzzer-tone', 'hbridge-en-in1-in2', 'hcsr04-pulsein', 'int32', 'pwm-write', 'servo-lib'].sort());
    expect(allowed.setup).toContain('Serial.begin(9600);');
    expect(allowed.forms).not.toContain(undefined);
    expect(allowed.forms.some((form) => /analogWrite\((9|10|3|11),/.test(form))).toBe(false);
  });

  it('writes each helper exactly as it was compiled and traced in spikes/avr8js/sketches/contract-forms', () => {
    const sketch = readFileSync(join(process.cwd(), 'spikes/avr8js/sketches/contract-forms/contract-forms.ino'), 'utf8');
    const traced = Object.fromEntries(
      [...sketch.matchAll(/\/\/ --- contract helper: ([a-z0-9-]+) ---\n([\s\S]*?)\/\/ --- end contract helper ---/g)].map((match) => [match[1], match[2]?.trimEnd()]),
    );
    expect(Object.keys(traced).sort()).toEqual(Object.keys(contract.helpers).sort());
    for (const [id, helper] of Object.entries(contract.helpers)) {
      expect(helper.text, id).toBe(traced[id]);
    }
  });
});

describe('who reads the contract data', () => {
  it('is read by tests only: no production file imports uno-contract', () => {
    const files = (readdirSync(join(process.cwd(), 'src'), { recursive: true }) as string[]).filter(
      (file) => /\.(ts|tsx)$/.test(file) && !/\.test\.(ts|tsx)$/.test(file) && !file.includes('__fixtures__'),
    );
    const importers = files.filter((file) => /from ['"][^'"]*uno-contract['"]/.test(readFileSync(join(process.cwd(), 'src', file), 'utf8')));
    expect(importers).toEqual([]);
  });
});
