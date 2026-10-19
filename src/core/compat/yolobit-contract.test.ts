import { describe, expect, it } from 'vitest';
import {
  EVIDENCE_SCOPE,
  claimKinds,
  ofFields,
  simForbiddenClaims,
  yolobitContractSchema,
  type ConstructContract,
  type FieldEntry,
  type OfField,
  type YolobitContract,
} from './contract-types';
import {
  claimProblems,
  entrySemanticProblems,
  evaluatePred,
  exposableConstructs,
  exposureViolations,
  generatorAllowlist,
  isExposable,
  moduleViolations,
  profileConstructViolations,
  simDependentFields,
  validateContract,
} from './contract-validation';
import { yolobitContract } from './yolobit-contract';

// The machine-readable contract against the frozen document (YB-1, contract §21 invariants).

const contract = yolobitContract;
const row = (id: string): ConstructContract => {
  const found = contract.constructs.find((construct) => construct.id === id);
  if (!found) {
    throw new Error(`No contract row ${id}`);
  }
  return found;
};
/** A copy of the contract in which row `id` has `field` replaced. */
const withField = (id: string, field: OfField, entry: FieldEntry): YolobitContract => ({
  ...contract,
  constructs: contract.constructs.map((construct) =>
    construct.id === id ? { ...construct, fields: { ...construct.fields, [field]: entry } } : construct,
  ),
});

describe('the contract data', () => {
  it('has the shape of contract §21', () => {
    expect(yolobitContractSchema.safeParse(contract).success).toBe(true);
  });

  it('keeps every invariant of contract §21', () => {
    expect(validateContract(contract)).toEqual([]);
  });

  it('has the 15 observable fields on every row, and the 2 module fields on every module', () => {
    for (const construct of contract.constructs) {
      expect(Object.keys(construct.fields).sort()).toEqual([...ofFields].sort());
    }
    for (const module of contract.modules) {
      expect(Object.keys(module.fields).sort()).toEqual(['import', 'module']);
    }
  });

  it('is pinned to the public snapshot, with the firmware and MicroPython versions UNKNOWN', () => {
    expect(contract.contractId).toBe('yolobit-micropython');
    expect(contract.rv1).toBe('ACCEPT_WITH_RESTRICTIONS');
    expect(contract.snapshot).toMatchObject({
      observedOn: '2026-10-14',
      editorBuildMarker: '20261007130057',
      blocklyVersion: '8.0.1',
      firmwareListing: ['Yolo:Bit v1.12', 'Yolo:Bit S3 v1.14'],
      firmwareExact: 'UNKNOWN',
      micropythonVersion: 'UNKNOWN',
    });
    expect(contract.snapshot.statement).toContain('not a timeless compatibility guarantee');
  });

  it('records the owner decisions: 5×5 RGB from the top-left, native analog 0–4095', () => {
    expect(contract.display).toMatchObject({
      width: 5,
      height: 5,
      indexBase: 0,
      origin: 'top-left',
      x: 'column',
      y: 'row',
      colourFormat: '#rrggbb',
      defaultColour: '#FF0000',
    });
    expect(contract.display.palette).toHaveLength(8);
    expect(contract.analog).toMatchObject({ nativeMax: 4095, uiPercentMax: 100, normalisedTo1023: false });
    expect(contract.constants).toMatchObject({ MAX_RANGE_VALUE: 1_000_000, MAX_REPEAT_ABS: 1_000_000 });
  });
});

describe('rows and eligibility (contract §15)', () => {
  const eligibleOrRestricted: [string, 'ELIGIBLE' | 'RESTRICTED'][] = [
    ['C-01', 'ELIGIBLE'], ['C-02', 'ELIGIBLE'], ['C-04', 'ELIGIBLE'], ['C-05', 'RESTRICTED'], ['C-06', 'RESTRICTED'], ['C-07', 'RESTRICTED'],
    ['C-08', 'RESTRICTED'], ['C-09', 'ELIGIBLE'], ['C-10', 'RESTRICTED'], ['C-42', 'RESTRICTED'], ['C-43', 'RESTRICTED'],
    ['C-12', 'RESTRICTED'], ['C-13', 'RESTRICTED'], ['C-15', 'ELIGIBLE'], ['C-16', 'RESTRICTED'], ['C-17', 'RESTRICTED'], ['C-18', 'RESTRICTED'], ['C-50', 'RESTRICTED'],
    ['C-51', 'RESTRICTED'], ['C-23', 'RESTRICTED'], ['C-24', 'RESTRICTED'], ['C-25', 'RESTRICTED'], ['C-27', 'RESTRICTED'],
    ['C-29', 'ELIGIBLE'], ['C-30', 'ELIGIBLE'], ['C-31', 'ELIGIBLE'], ['C-32', 'ELIGIBLE'], ['C-33', 'ELIGIBLE'],
    ['C-34', 'ELIGIBLE'], ['C-35', 'ELIGIBLE'], ['C-36', 'ELIGIBLE'], ['C-37', 'RESTRICTED'], ['C-38', 'ELIGIBLE'],
    ['C-39', 'RESTRICTED'], ['C-56', 'ELIGIBLE'], ['C-57', 'ELIGIBLE'], ['C-58', 'RESTRICTED'], ['C-59', 'RESTRICTED'],
  ];
  const excluded = [
    'C-11', 'C-19', 'C-20', 'C-21', 'C-22', 'C-26', 'C-28', 'C-40', 'C-41', 'C-44', 'C-45',
    'C-46', 'C-47', 'C-48', 'C-49', 'C-52', 'C-53', 'C-54', 'C-55', 'C-60', 'C-69', 'C-70',
  ];

  it.each(eligibleOrRestricted)('%s is %s', (id, eligibility) => {
    expect(row(id).eligibility).toBe(eligibility);
  });

  it.each(excluded)('%s is EXCLUDED', (id) => {
    expect(row(id).eligibility).toBe('EXCLUDED');
  });

  it('defers the events (C-14) and nothing else', () => {
    expect(contract.constructs.filter((c) => c.eligibility === 'DEFERRED').map((c) => c.id)).toEqual(['C-14']);
  });

  it('lists exactly the rows of the document, the grouped one standing for C-61…C-66', () => {
    expect(contract.constructs.map((c) => c.id).sort()).toEqual([...eligibleOrRestricted.map(([id]) => id), ...excluded, 'C-14'].sort());
    expect(row('C-55').alsoCovers).toEqual(['C-61', 'C-62', 'C-63', 'C-64', 'C-65', 'C-66']);
  });

  it('keeps the frozen YB-0 decisions: random, running time, PWM excluded; events deferred', () => {
    expect(row('C-40')).toMatchObject({ eligibility: 'EXCLUDED', observedPython: 'random.randint(1, 6)' });
    expect(row('C-19').eligibility).toBe('EXCLUDED');
    expect(row('C-26').eligibility).toBe('EXCLUDED');
    expect(contract.modules.find((m) => m.id === 'C-03d')?.eligibility).toBe('EXCLUDED');
    expect(row('C-14').eligibility).toBe('DEFERRED');
  });

  it('carries the random domain, inactive, for the day it is reopened', () => {
    const { preSpecifiedDomain } = row('C-40');
    expect(preSpecifiedDomain?.evaluation?.order).toEqual(['a', 'b']);
    expect(row('C-40').domain).toBeUndefined();
    const inDomain = (a: number, b: number) =>
      preSpecifiedDomain ? evaluatePred(preSpecifiedDomain.runtime, { values: { a, b } }) : false;
    expect(inDomain(1, 6)).toBe(true);
    expect(inDomain(-1_000_000, 0)).toBe(true);
    expect(inDomain(6, 1)).toBe(false);
    expect(inDomain(0, 1_000_001)).toBe(false);
    expect(inDomain(-1_000_000, 1_000_000)).toBe(false); // span 2 000 000 > MAX_RANDOM_SPAN
  });

  it('gives an excluded or deferred row a reason, no Python mapping and no profile', () => {
    for (const construct of contract.constructs.filter((c) => c.eligibility === 'EXCLUDED' || c.eligibility === 'DEFERRED')) {
      expect(construct.exclusionReason, construct.id).toBeTruthy();
      expect(construct.python, construct.id).toBeUndefined();
      expect(construct.profiles, construct.id).toEqual([]);
    }
  });

  it('keeps the Advanced-only constructs out of Basic', () => {
    expect(row('C-16').profiles).toEqual(['ybc-advanced']);
    expect(row('C-17').profiles).toEqual(['ybc-advanced']);
    expect(row('C-18').profiles).toEqual(['ybc-advanced']);
    expect(row('C-27').profiles).toEqual(['ybc-advanced']);
    expect(row('C-06').profiles).toEqual(['ybc-basic', 'ybc-advanced']);
  });

  it('opens the RGB display to both profiles (N17 B1): built-in pictures, set pixel, clear pixel, set all', () => {
    for (const id of ['C-05', 'C-10', 'C-42', 'C-43']) {
      expect(row(id).profiles, id).toEqual(['ybc-basic', 'ybc-advanced']);
    }
  });

  it('names the UNVERIFIED forms of N17 B1 on the rows that write them, each with a reason, and on no other row', () => {
    const named = contract.constructs.filter((c) => (c.unverifiedForms?.length ?? 0) > 0);
    expect(named.map((c) => [c.id, c.unverifiedForms?.map((extra) => extra.form)])).toEqual([
      ['C-06', ['display.show(Image("<c0>:<c1>:<c2>:<c3>:<c4>"))']],
      ['C-07', ["display.scroll('<text>', color='<#rrggbb>')"]],
      ['C-08', ["display.scroll(<n>, color='<#rrggbb>')"]],
      ['C-17', ['accelerometer.get_y()', 'accelerometer.get_z()']],
      ['C-18', ['accelerometer.is_gesture("<gesture>")']],
    ]);
    for (const construct of named) {
      for (const extra of construct.unverifiedForms ?? []) {
        expect(extra.reason, `${construct.id}: ${extra.form}`).toMatch(/UNVERIFIED/);
      }
    }
  });

  it('opens the temperature, the accelerometer and the gestures to Advanced (N17 B2) in the forms the editor writes', () => {
    expect(row('C-16').python).toEqual({ form: 'int(temperature())', builtins: ['int'] });
    expect(row('C-17').python).toEqual({ form: 'accelerometer.get_x()' });
    expect(row('C-18').python).toEqual({ form: 'accelerometer.is_gesture("shake")' });
    for (const id of ['C-16', 'C-17', 'C-18']) {
      expect(isExposable(row(id), contract), id).toBe(true);
      expect(profileConstructViolations('ybc-advanced', [id], contract), id).toEqual([]);
      expect(profileConstructViolations('ybc-basic', [id], contract), id).not.toEqual([]);
    }
  });

  it('names the fields N17 B2 opened without evidence on the rows that have them, each UNKNOWN in the data and UNVERIFIED with a reason', () => {
    const named = contract.constructs.filter((c) => Object.keys(c.unverifiedFields ?? {}).length > 0);
    expect(named.map((c) => [c.id, Object.keys(c.unverifiedFields ?? {}).sort()])).toEqual([
      ['C-17', ['block', 'coord', 'return']],
      ['C-18', ['block', 'content', 'return']],
    ]);
    for (const construct of named) {
      for (const [field, reason] of Object.entries(construct.unverifiedFields ?? {})) {
        expect(construct.fields[field as OfField].label, `${construct.id}.${field}`).toBe('UNKNOWN');
        expect(reason, `${construct.id}.${field}`).toMatch(/UNVERIFIED/);
      }
    }
  });

  it('lets an UNVERIFIED field through the gate only where the row names it: the same field of another row still keeps that row out', () => {
    const unnamed = withField('C-15', 'block', { label: 'UNKNOWN', note: 'not established' });
    const c15 = unnamed.constructs.find((c) => c.id === 'C-15') as ConstructContract;
    expect(exposureViolations(c15, unnamed).join('\n')).toContain('C-15.block is UNKNOWN');
    // C-17 without its list is refused for each field the list names.
    const bare: ConstructContract = { ...row('C-17'), unverifiedFields: undefined };
    const problems = exposureViolations(bare, contract).join('\n');
    for (const field of ['block', 'coord', 'return']) {
      expect(problems).toContain(`C-17.${field} is UNKNOWN`);
    }
  });

  it('refuses a list of UNVERIFIED fields on an excluded row, and one that names a field that is not UNKNOWN', () => {
    const onExcluded = { ...contract, constructs: contract.constructs.map((c) => (c.id === 'C-19' ? { ...c, unverifiedFields: { range: 'UNVERIFIED' } } : c)) };
    expect(validateContract(onExcluded).join('\n')).toContain('C-19 is EXCLUDED but has UNVERIFIED fields');
    const onVerified = { ...contract, constructs: contract.constructs.map((c) => (c.id === 'C-17' ? { ...c, unverifiedFields: { ...c.unverifiedFields, call: 'UNVERIFIED' } } : c)) };
    expect(validateContract(onVerified).join('\n')).toContain('C-17 names call as UNVERIFIED, but it is VERIFIED');
  });

  it('refuses UNVERIFIED forms on an excluded row: they are never a way around the gate', () => {
    const broken = { ...contract, constructs: contract.constructs.map((c) => (c.id === 'C-40' ? { ...c, unverifiedForms: [{ form: 'random.randint(<a>, <b>)', reason: 'UNVERIFIED' }] } : c)) };
    expect(validateContract(broken).join('\n')).toContain('C-40 is EXCLUDED but has UNVERIFIED forms');
  });
});

describe('simDependent, derived per field (contract §15.1 last column)', () => {
  const expected: Record<string, string[]> = {
    'C-01': [], 'C-02': [], 'C-04': [],
    'C-05': ['module', 'block', 'content'],
    'C-06': ['module', 'block', 'content'],
    'C-07': ['module', 'unit', 'range', 'block', 'coord', 'content'],
    'C-08': ['module', 'unit', 'range', 'block', 'coord', 'content'],
    'C-09': ['module', 'block'], 'C-10': ['module', 'block'], 'C-42': ['module', 'block'], 'C-43': ['module', 'block'],
    'C-12': ['module', 'block', 'return'], 'C-13': ['module', 'block', 'return'],
    'C-15': ['module', 'round', 'block'], 'C-16': ['module', 'block'], 'C-17': ['module', 'round'], 'C-18': ['module'],
    'C-50': ['module', 'unit', 'range', 'content'], 'C-51': ['module', 'unit', 'range', 'block'],
    'C-23': ['module', 'block'], 'C-24': ['module', 'block'], 'C-25': ['module', 'block'], 'C-27': ['module', 'block'],
    'C-29': [], 'C-30': [], 'C-31': [], 'C-32': [], 'C-33': [], 'C-34': [], 'C-35': [], 'C-36': [], 'C-37': [],
    'C-38': [], 'C-39': [], 'C-56': [], 'C-57': [], 'C-58': [], 'C-59': [],
  };

  it.each(Object.entries(expected))('%s', (id, fields) => {
    expect(simDependentFields(row(id), contract).sort()).toEqual([...fields].sort());
  });

  it('marks the yolobit and music modules, and only them, as depending on the simulator', () => {
    expect(contract.modules.map((m) => [m.id, simDependentFields(m, contract)])).toEqual([
      ['C-03a', []],
      ['C-03b', ['module']],
      ['C-03c', ['module']],
      ['C-03d', []],
      ['C-03e', []],
    ]);
  });

  it('keeps the timing of the simulator labelled as observed, never physical', () => {
    for (const construct of contract.constructs.filter((c) => c.timing)) {
      expect(construct.timing?.source, construct.id).toBe('SIM-observed');
    }
    expect(row('C-07').restrictions.join(' ')).toContain('NOT a physical timing verification');
  });
});

describe('RV-1: what the simulator may establish', () => {
  it('lets the simulator establish only observed library behaviour', () => {
    expect(EVIDENCE_SCOPE.SIM).toEqual(['blocking', 'return-reset', 'display-transition', 'sound-indicator', 'yield-observed', 'sim-module']);
    for (const forbidden of simForbiddenClaims) {
      expect(EVIDENCE_SCOPE.SIM).not.toContain(forbidden);
    }
  });

  it.each(simForbiddenClaims)('refuses a "%s" claim resting on a simulator entry', (kind) => {
    const problems = claimProblems({ kind, statement: 'x', sources: ['EVD-06'] }, contract);
    expect(problems.length).toBeGreaterThan(0);
  });

  it('refuses a claim whose ledger entry does not list it, such as a range read from a widget (EVD-14)', () => {
    expect(claimProblems({ kind: 'return-reset', statement: 'range from the widget', sources: ['EVD-14'] }, contract)).not.toEqual([]);
    expect(claimProblems({ kind: 'sim-module', statement: 'x', sources: ['EVD-14'] }, contract)).not.toEqual([]);
  });

  it('refuses a claim from an unknown source or with none', () => {
    expect(claimProblems({ kind: 'documented', statement: 'x', sources: ['DOC-W99'] }, contract)).not.toEqual([]);
    expect(claimProblems({ kind: 'documented', statement: 'x', sources: [] }, contract)).not.toEqual([]);
  });

  it('never lets the context-only ledger entries establish a claim', () => {
    for (const id of ['EVD-14', 'EVD-15', 'DOC-M5', 'DOC-M6', 'DOC-M7']) {
      for (const kind of claimKinds) {
        expect(claimProblems({ kind, statement: 'x', sources: [id] }, contract), `${id}/${kind}`).not.toEqual([]);
      }
    }
  });

  it('does not take firmware availability from the import line (N2)', () => {
    const broken = withField('C-06', 'module', {
      label: 'VERIFIED',
      claims: [{ kind: 'import-syntax', statement: 'the import line exists', sources: ['EVD-03'] }],
    });
    expect(validateContract(broken).join('\n')).toContain('cannot establish module');
  });

  it('would drop every hardware construct, and keep the language, if RV-1 were rejected (contract §22.3)', () => {
    const hardware = ['C-05', 'C-06', 'C-07', 'C-08', 'C-09', 'C-10', 'C-42', 'C-43', 'C-12', 'C-13', 'C-15', 'C-16', 'C-17', 'C-18', 'C-23', 'C-24', 'C-25', 'C-27', 'C-50', 'C-51'];
    for (const id of hardware) {
      expect(isExposable(row(id), contract, 'REJECTED'), id).toBe(false);
    }
    for (const id of ['C-01', 'C-02', 'C-04', 'C-29', 'C-30', 'C-31', 'C-32', 'C-33', 'C-34', 'C-35', 'C-36', 'C-37', 'C-38', 'C-39', 'C-56']) {
      expect(isExposable(row(id), contract, 'REJECTED'), id).toBe(true);
    }
    const moduleStates = contract.modules.map((m) => [m.id, m.eligibility === 'ELIGIBLE' && simDependentFields(m, contract).length === 0]);
    expect(moduleStates).toEqual([['C-03a', true], ['C-03b', false], ['C-03c', false], ['C-03d', false], ['C-03e', true]]);
  });
});

describe('the exposure eligibility gate (EG)', () => {
  it('lets through every ELIGIBLE and RESTRICTED row', () => {
    for (const construct of contract.constructs.filter((c) => c.eligibility === 'ELIGIBLE' || c.eligibility === 'RESTRICTED')) {
      expect(exposureViolations(construct, contract), construct.id).toEqual([]);
    }
  });

  it('refuses every EXCLUDED and DEFERRED row', () => {
    for (const construct of contract.constructs.filter((c) => c.eligibility === 'EXCLUDED' || c.eligibility === 'DEFERRED')) {
      expect(isExposable(construct, contract), construct.id).toBe(false);
    }
  });

  it('shows no excluded or deferred row to either profile', () => {
    const shown = new Set([...exposableConstructs(contract, 'ybc-basic'), ...exposableConstructs(contract, 'ybc-advanced')].map((c) => c.id));
    for (const id of ['C-14', 'C-19', 'C-26', 'C-40', 'C-47', 'C-70']) {
      expect(shown.has(id), id).toBe(false);
    }
  });

  it('is a strict superset for Advanced over Basic', () => {
    const basic = exposableConstructs(contract, 'ybc-basic').map((c) => c.id);
    const advanced = exposableConstructs(contract, 'ybc-advanced').map((c) => c.id);
    expect(basic.length).toBeGreaterThan(0);
    for (const id of basic) {
      expect(advanced).toContain(id);
    }
    expect(advanced.length).toBeGreaterThan(basic.length);
  });

  it.each(['UNKNOWN', 'INFERRED'] as const)('refuses an exposed row with a required field that is %s', (label) => {
    const broken = withField('C-04', 'unit', { label, note: 'not established' });
    const changed = broken.constructs.find((c) => c.id === 'C-04');
    expect(changed && exposureViolations(changed, broken).join('\n')).toContain(`C-04.unit is ${label}`);
    // The contract's own audit flags it too: an ELIGIBLE row may not carry one.
    expect(validateContract(broken).join('\n')).toContain(`C-04.unit is ${label}`);
  });

  it('treats INFERRED as UNKNOWN: random.randint stays out while its module field is INFERRED', () => {
    expect(row('C-40').fields.module.label).toBe('INFERRED');
    expect(isExposable(row('C-40'), contract)).toBe(false);
  });

  it('refuses a row whose module is not itself eligible (random)', () => {
    const lifted: YolobitContract = {
      ...contract,
      constructs: contract.constructs.map((c) =>
        c.id === 'C-40'
          ? {
              ...c,
              eligibility: 'ELIGIBLE',
              python: { form: 'random.randint(<a>, <b>)' },
              fields: { ...c.fields, ...Object.fromEntries(ofFields.map((f) => [f, { label: 'n/a', reason: 'not-applicable', note: 'x' }])) },
            }
          : c,
      ),
    };
    const lifted40 = lifted.constructs.find((c) => c.id === 'C-40');
    expect(lifted40 && exposureViolations(lifted40, lifted).join('\n')).toContain('module C-03d is EXCLUDED');
  });

  it('refuses a row blocked by an unresolved gate', () => {
    const blocked: ConstructContract = { ...row('C-04'), blockedBy: ['OQ-X'] };
    expect(exposureViolations(blocked, contract).join('\n')).toContain('blocked by OQ-X');
  });

  it('refuses a RESTRICTED row without a domain', () => {
    const withoutDomain: ConstructContract = { ...row('C-37'), domain: undefined };
    expect(exposureViolations(withoutDomain, contract).join('\n')).toContain('RESTRICTED without a domain');
  });

  it('refuses a claim that its evidence cannot carry', () => {
    const broken = withField('C-12', 'return', {
      label: 'VERIFIED',
      claims: [{ kind: 'physical-range', statement: 'the button works on the board', sources: ['EVD-09'] }],
    });
    const changed = broken.constructs.find((c) => c.id === 'C-12');
    expect(changed && exposureViolations(changed, broken).join('\n')).toContain('C-12.return');
    expect(validateContract(broken).join('\n')).toContain('may not establish');
  });
});

/** A copy of the contract with module `id`'s `field` replaced. */
const withModuleField = (id: string, field: 'import' | 'module', entry: FieldEntry): YolobitContract => ({
  ...contract,
  modules: contract.modules.map((module) =>
    module.id === id ? { ...module, fields: { ...module.fields, [field]: entry } } : module,
  ),
});
const importOnly: FieldEntry = {
  label: 'VERIFIED',
  claims: [{ kind: 'import-syntax', statement: 'the import line exists', sources: ['EVD-03'] }],
};

describe('one evidence rule for the audit and the gate (review R1)', () => {
  it('case A: a module established by import syntax alone fails the audit AND the gate', () => {
    const broken = withModuleField('C-03b', 'module', importOnly);
    const module = broken.modules.find((m) => m.id === 'C-03b');
    const c06 = broken.constructs.find((c) => c.id === 'C-06');
    expect(validateContract(broken)).not.toEqual([]);
    expect(module && moduleViolations(module, broken)).not.toEqual([]);
    expect(c06 && exposureViolations(c06, broken)).not.toEqual([]);
    expect(c06 && isExposable(c06, broken)).toBe(false);
  });

  it('case B: a unit established by an import claim fails the audit AND the gate', () => {
    const broken = withField('C-04', 'unit', importOnly);
    const c04 = broken.constructs.find((c) => c.id === 'C-04');
    expect(validateContract(broken)).not.toEqual([]);
    expect(c04 && exposureViolations(c04, broken)).not.toEqual([]);
    expect(c04 && isExposable(c04, broken)).toBe(false);
  });

  const substitutes: [string, FieldEntry][] = [
    ['an import claim', importOnly],
    ['a blocking trace', { label: 'VERIFIED', claims: [{ kind: 'blocking', statement: 'x', sources: ['EVD-06'] }] }],
    ['a language citation', { label: 'DOCUMENTED', claims: [{ kind: 'documented', statement: 'x', sources: ['DOC-M8'] }] }],
    ['a tooltip', { label: 'DOCUMENTED', claims: [{ kind: 'ui-statement', statement: 'x', sources: ['EVD-02U'] }] }],
    ['a sim-module claim', { label: 'VERIFIED', claims: [{ kind: 'sim-module', statement: 'x', sources: ['EVD-06'] }] }],
    ['a context-only source', { label: 'DOCUMENTED', claims: [{ kind: 'documented', statement: 'x', sources: ['DOC-M5'] }] }],
    ['UNKNOWN', { label: 'UNKNOWN', note: 'not established' }],
    ['INFERRED', { label: 'INFERRED', note: 'not established' }],
    ['n/a by domain with no domain', { label: 'n/a', reason: 'domain-restricted', note: 'x' }],
    ['n/a by explicit parameter with nothing explicit', { label: 'n/a', reason: 'explicit-parameter', note: 'x' }],
    ['a label with no matching source', { label: 'DOCUMENTED', claims: [{ kind: 'call-shape', statement: 'x', sources: ['EVD-03'] }] }],
  ];
  const cases = ['C-04', 'C-06', 'C-12', 'C-25', 'C-39'].flatMap((id) =>
    ofFields.flatMap((field) => substitutes.map(([name, entry]) => [id, field, name, entry] as const)),
  );

  it.each(cases)('%s.%s ← %s: the audit and the gate agree', (id, field, _name, entry) => {
    const mutated = withField(id, field, entry);
    const construct = mutated.constructs.find((c) => c.id === id) as ConstructContract;
    const auditRejects = validateContract(mutated).some((problem) => problem.includes(`${id}.${field}`));
    const gateRejects = exposureViolations(construct, mutated).some((problem) => problem.includes(`${id}.${field}`));
    expect(auditRejects).toBe(gateRejects);
  });

  const moduleCases = contract.modules
    .filter((module) => module.eligibility === 'ELIGIBLE')
    .flatMap((module) =>
      (['import', 'module'] as const).flatMap((field) => substitutes.map(([name, entry]) => [module.id, field, name, entry] as const)),
    );

  it.each(moduleCases)('module %s.%s ← %s: the audit and the gate agree', (id, field, _name, entry) => {
    const mutated = withModuleField(id, field, entry);
    const module = mutated.modules.find((m) => m.id === id) as (typeof mutated.modules)[number];
    const auditRejects = validateContract(mutated).some((problem) => problem.includes(`${id}.${field}`));
    const gateRejects = moduleViolations(module, mutated).some((problem) => problem.includes(`${id}.${field}`));
    expect(auditRejects).toBe(gateRejects);
  });

  it.each([
    ['UNKNOWN', { label: 'UNKNOWN', note: 'x' } as FieldEntry],
    ['INFERRED', { label: 'INFERRED', note: 'x' } as FieldEntry],
    ['n/a by domain', { label: 'n/a', reason: 'domain-restricted', note: 'x' } as FieldEntry],
    ['import syntax alone', importOnly],
  ])('an eligible module whose OF-module is %s is refused by all three APIs', (_name, entry) => {
    const broken = withModuleField('C-03b', 'module', entry);
    const module = broken.modules.find((m) => m.id === 'C-03b') as (typeof broken.modules)[number];
    const c06 = broken.constructs.find((c) => c.id === 'C-06') as ConstructContract;
    expect(validateContract(broken).some((p) => p.includes('C-03b.module'))).toBe(true);
    expect(moduleViolations(module, broken)).not.toEqual([]);
    expect(exposureViolations(c06, broken)).not.toEqual([]);
    expect(isExposable(c06, broken)).toBe(false);
  });

  it('still accepts the shipped C-03b', () => {
    const module = contract.modules.find((m) => m.id === 'C-03b') as (typeof contract.modules)[number];
    expect(moduleViolations(module, contract)).toEqual([]);
    expect(validateContract(contract)).toEqual([]);
  });

  it('keeps the data it ships with valid under the very same rule', () => {
    for (const construct of contract.constructs) {
      for (const field of ofFields) {
        expect(entrySemanticProblems(`${construct.id}.${field}`, field, construct.fields[field], contract), `${construct.id}.${field}`).toEqual([]);
      }
    }
  });

  it('lets no context-only ledger entry establish any field', () => {
    for (const id of ['EVD-14', 'EVD-15', 'DOC-M5', 'DOC-M6', 'DOC-M7']) {
      expect(contract.evidence[id]?.establishes, id).toEqual([]);
    }
  });
});

describe('OF-block evidence (review R2)', () => {
  /** The `kind:source` pairs of an OF-block claim of a row. */
  const blockSources = (id: string) => {
    const entry = row(id).fields.block;
    return entry.label === 'VERIFIED' || entry.label === 'DOCUMENTED'
      ? entry.claims.flatMap((c) => c.sources.map((source) => `${c.kind}:${source}`))
      : [];
  };

  it.each([
    ['C-05', 'show', ['blocking:EVD-06']],
    ['C-06', 'show', ['blocking:EVD-06']],
    ['C-09', 'clear', ['blocking:EVD-06']],
    ['C-10', 'set_pixel', ['blocking:EVD-06']],
    ['C-42', 'clear_pixel', ['blocking:EVD-06']],
    ['C-43', 'set_all', ['blocking:EVD-28']],
    ['C-12', 'is_pressed', ['blocking:EVD-24']],
    ['C-13', 'get_presses', ['blocking:EVD-25']],
    ['C-15', 'light_level', ['blocking:EVD-26']],
    ['C-16', 'temperature', ['blocking:EVD-26']],
    ['C-23', 'write_digital', ['blocking:EVD-16']],
    ['C-24', 'read_digital', ['blocking:EVD-16']],
    ['C-25', 'read_analog', ['blocking:EVD-27']],
    ['C-27', 'servo_write', ['blocking:EVD-16']],
  ])('%s (%s) rests on the trace that ran that call', (id, _call, expected) => {
    expect(blockSources(id)).toEqual(expected);
  });

  it('rests every "blocking" claim on a simulator entry that records a blocking observation of OF-block', () => {
    const blocking = contract.constructs.flatMap((c) => blockSources(c.id).filter((ref) => ref.startsWith('blocking:')).map((ref) => [c.id, ref.slice(9)]));
    expect(blocking.length).toBeGreaterThan(10);
    for (const [id, source] of blocking) {
      const entry = contract.evidence[source as string];
      expect(entry?.kind, `${id}/${source}`).toBe('SIM');
      expect(entry?.supports, `${id}/${source}`).toContain('blocking');
      expect(entry?.establishes, `${id}/${source}`).toContain('block');
    }
  });

  it('keeps every such claim a simulator observation, labelled non-physical', () => {
    for (const id of ['EVD-24', 'EVD-25', 'EVD-26', 'EVD-27', 'EVD-28']) {
      expect(contract.evidence[id]?.kind).toBe('SIM');
      expect(EVIDENCE_SCOPE.SIM).toContain('blocking');
    }
  });
});

describe('profiles against the contract', () => {
  it('rejects a profile that lists a construct the contract does not know, excludes, or meant for the other profile', () => {
    expect(profileConstructViolations('ybc-basic', ['C-99'], contract)).not.toEqual([]);
    expect(profileConstructViolations('ybc-basic', ['C-40'], contract)).not.toEqual([]);
    expect(profileConstructViolations('ybc-basic', ['C-14'], contract)).not.toEqual([]);
    expect(profileConstructViolations('ybc-basic', ['C-16'], contract)).not.toEqual([]);
    expect(profileConstructViolations('ybc-advanced', ['C-16'], contract)).toEqual([]);
    expect(profileConstructViolations('ybc-basic', ['C-10'], contract)).toEqual([]);
    expect(profileConstructViolations('test-base', ['C-01'], contract)).not.toEqual([]);
  });
});

describe('relational restrictions (contract §21 invariant 10)', () => {
  const countUp = row('C-39').domain;
  const valid = (start: number, end: number) =>
    countUp ? evaluatePred(countUp.runtime, { values: { start, end } }) : false;

  it.each([
    [0, 0, true],
    [0, 1_000_000, true],
    [1_000_000, 1_000_000, true],
    [-1, 5, false],
    [5, -1, false],
    [0, 1_000_001, false],
    [1_000_001, 3, false],
    [7, 3, true], // start > end at run time is zero iterations, not a violation
  ])('count up start=%d end=%d → in domain: %s', (start, end, expected) => {
    expect(valid(start, end)).toBe(expected);
  });

  it('requires a literal step at compile time', () => {
    const rule = countUp?.compileTime.find((r) => r.diagnostic === 'literal-required');
    expect(rule && evaluatePred(rule.when, { values: { step: 1 }, literals: new Set(['step']) })).toBe(true);
    expect(rule && evaluatePred(rule.when, { values: { step: 1 }, literals: new Set() })).toBe(false);
  });

  it('keeps the explicit evaluation order of count up: start, then end, each once', () => {
    expect(countUp?.evaluation).toEqual({ order: ['start', 'end'], once: true, checkEach: 'after-own-evaluation', temporaries: 'unless-all-literal' });
  });

  it.each([
    [0, true],
    [1_000_000, true],
    [-1_000_000, true],
    [1_000_001, false],
    [-1_000_001, false],
  ])('repeat N=%d → in domain: %s', (n, expected) => {
    const domain = row('C-37').domain;
    expect(domain && evaluatePred(domain.runtime, { values: { n } })).toBe(expected);
  });

  it('restricts text to ASCII 0x20–0x7E', () => {
    const domain = row('C-07').domain;
    const ok = (text: string) => domain !== undefined && evaluatePred(domain.runtime, { values: { text } });
    expect(ok('Hello, world ~')).toBe(true);
    expect(ok('')).toBe(true);
    expect(ok('à')).toBe(false);
    expect(ok('tab\t')).toBe(false);
  });

  it('keeps the analog scale native and pins to P0–P2', () => {
    const domain = row('C-25').domain;
    const ok = (pin: number, raw: number) => domain !== undefined && evaluatePred(domain.runtime, { values: { pin, raw } });
    expect(ok(0, 4095)).toBe(true);
    expect(ok(2, 0)).toBe(true);
    expect(ok(3, 0)).toBe(false);
    expect(ok(0, 4096)).toBe(false);
    expect(ok(0, 1023 + 4000)).toBe(false);
  });

  it('allows display coordinates 0..4 only; the colour is not in the domain since N17: it is never refused, only shown red', () => {
    const domain = row('C-10').domain;
    const ok = (x: number, y: number) => domain !== undefined && evaluatePred(domain.runtime, { values: { x, y } });
    expect(ok(0, 0)).toBe(true);
    expect(ok(4, 4)).toBe(true);
    expect(ok(5, 0)).toBe(false);
    expect(ok(0, -1)).toBe(false);
    expect(domain?.args).toEqual({ x: 'int', y: 'int' });
    expect(row('C-10').restrictions.join(' ')).toMatch(/shown red with a warning, never an error/);
    expect(row('C-43').restrictions.join(' ')).toMatch(/shown red with a warning, never an error/);
  });

  it('allows −10..50 °C (N17 B2: the slider of the simulator, not a physical range), the axes x, y, z within ±2048 mg and the seven gestures', () => {
    const temperature = row('C-16').domain;
    const degrees = (celsius: number) => temperature !== undefined && evaluatePred(temperature.runtime, { values: { celsius } });
    expect([-11, -10, 0, 25, 50, 51].map(degrees)).toEqual([false, true, true, true, true, false]);
    const acceleration = row('C-17').domain;
    const reading = (axis: string, mg: number) => acceleration !== undefined && evaluatePred(acceleration.runtime, { values: { axis, mg } });
    expect([reading('x', -2048), reading('y', 2048), reading('z', 0), reading('x', 2049), reading('w', 0)]).toEqual([true, true, true, false, false]);
    const gesture = row('C-18').domain;
    const named = (name: string) => gesture !== undefined && evaluatePred(gesture.runtime, { values: { gesture: name } });
    for (const name of ['shake', 'tilt_left', 'tilt_right', 'face_up', 'face_down', 'logo_up', 'logo_down']) {
      expect(named(name), name).toBe(true);
    }
    for (const name of ['freefall', 'up', 'SHAKE', '']) {
      expect(named(name), name).toBe(false);
    }
  });

  it('allows the thirteen built-in pictures of N17 B1 and no other name', () => {
    const domain = row('C-05').domain;
    const ok = (name: string) => domain !== undefined && evaluatePred(domain.runtime, { values: { name } });
    for (const name of ['HEART', 'HEART_SMALL', 'HAPPY', 'SAD', 'CONFUSED', 'ANGRY', 'SURPRISED', 'YES', 'NO', 'ARROW_N', 'ARROW_E', 'ARROW_S', 'ARROW_W']) {
      expect(ok(name), name).toBe(true);
    }
    for (const name of ['SMILE', 'ASLEEP', 'heart', '', 'ARROW_NE']) {
      expect(ok(name), name).toBe(false);
    }
  });
});

describe('the generator allowlist (contract §21 invariant 9)', () => {
  const allowlist = generatorAllowlist(contract);

  it('is exactly what the exposable rows and modules list', () => {
    expect(allowlist.imports).toEqual(['import time', 'from yolobit import *', 'import music']);
    expect(allowlist.preamble).toEqual([
      'button_a.on_pressed = None',
      'button_b.on_pressed = None',
      'button_a.on_pressed_ab = button_b.on_pressed_ab = -1',
      'music.set_tempo(4, 120)',
    ]);
    expect(allowlist.builtins.sort()).toEqual(['int', 'len', 'print', 'range', 'str']);
  });

  it('has nothing from an excluded or deferred row, nor the random module', () => {
    const text = JSON.stringify(allowlist);
    for (const word of ['random', 'running_time', 'on_pressed = f', 'write_analog', 'show_graph', 'set_brightness', 'pitch', 'is_pressed_ab']) {
      expect(text, word).not.toContain(word);
    }
    // The verified form of every exposable row, and the UNVERIFIED forms that N17 rows name.
    expect(allowlist.forms.length).toBe(
      new Set(contract.constructs.filter((c) => isExposable(c, contract)).flatMap((c) => [c.python?.form, ...(c.unverifiedForms ?? []).map((extra) => extra.form)])).size,
    );
  });
});
