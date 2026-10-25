import {
  claimLevels,
  ofFields,
  rulesOf,
  type AnyEvidenceKind,
  type Claim,
  type CompatContract,
  type ConstructContract,
  type ContractRules,
  type Domain,
  type FieldEntry,
  type ModuleContract,
  type OfField,
  type Pred,
  type ProfileId,
  type Term,
  type UnoContract,
  type YolobitContract,
} from './contract-types';

// The rules that turn the contract's data into decisions (contract §21 invariants,
// plan §6.2 exposure eligibility gate EG, RV-1). Pure functions over the data.
// Since N18 R0.3 they apply to the UNO contract too: every function reads the evidence rules of the contract's
// target (`rulesOf`), so the Yolo:Bit contract is judged exactly as before and the UNO one by its own scope.

/** `REJECTED` is the hypothetical switch of contract §22.3: claims that rest on the simulator alone stop counting. */
export type Rv1Mode = 'ACCEPT_WITH_RESTRICTIONS' | 'REJECTED';

// --- Relational predicates (invariant 10) -------------------------------------------

export type PredContext = {
  /** The values of the arguments the predicate names. */
  values: Readonly<Record<string, number | string>>;
  /** The arguments known at compile time; a `literal` rule holds for these. */
  literals?: ReadonlySet<string>;
};

export function evaluateTerm(term: Term, context: PredContext): number {
  if ('const' in term) {
    return term.const;
  }
  if ('arg' in term) {
    const value = context.values[term.arg];
    if (typeof value !== 'number') {
      throw new Error(`Argument "${term.arg}" is not a number`);
    }
    return value;
  }
  if ('add' in term) {
    return evaluateTerm(term.add[0], context) + evaluateTerm(term.add[1], context);
  }
  return evaluateTerm(term.sub[0], context) - evaluateTerm(term.sub[1], context);
}

/** Whether the arguments satisfy the predicate. Pure; the compiler (literals) and the interpreter (runtime) share it. */
export function evaluatePred(pred: Pred, context: PredContext): boolean {
  if ('le' in pred) {
    return evaluateTerm(pred.le[0], context) <= evaluateTerm(pred.le[1], context);
  }
  if ('lt' in pred) {
    return evaluateTerm(pred.lt[0], context) < evaluateTerm(pred.lt[1], context);
  }
  if ('eq' in pred) {
    return evaluateTerm(pred.eq[0], context) === evaluateTerm(pred.eq[1], context);
  }
  if ('all' in pred) {
    return pred.all.every((part) => evaluatePred(part, context));
  }
  if ('oneOf' in pred) {
    const value = context.values[pred.oneOf.arg];
    return value !== undefined && pred.oneOf.values.includes(value);
  }
  if ('ascii' in pred) {
    const value = context.values[pred.ascii.arg];
    return (
      typeof value === 'string' &&
      [...value].every((char) => {
        const code = char.codePointAt(0) ?? -1;
        return code >= pred.ascii.from && code <= pred.ascii.to;
      })
    );
  }
  return context.literals?.has(pred.literal.arg) === true;
}

// --- Evidence ---------------------------------------------------------------------

/** "A or B", "A, B or C": how the messages name a list of evidence kinds. */
const orList = (kinds: readonly AnyEvidenceKind[]) =>
  kinds.length > 1 ? `${kinds.slice(0, -1).join(', ')} or ${kinds[kinds.length - 1]}` : (kinds[0] ?? '');

/** The text the generator of a target writes for a row, and that target's name for it. */
const mappingOf = (construct: ConstructContract, rules: ContractRules) => (rules.mapping === 'python' ? construct.python : construct.cpp);
const mappingName = (rules: ContractRules) => (rules.mapping === 'python' ? 'Python' : 'C++');

/** Problems with one claim's sources, independent of RV-1 (invariant 2). */
export function claimProblems(claim: Claim, contract: CompatContract): string[] {
  if (claim.sources.length === 0) {
    return ['a claim has no source'];
  }
  const rules = rulesOf(contract);
  return claim.sources.flatMap((id) => {
    const source = contract.evidence[id];
    if (!source) {
      return [`claim "${claim.kind}" cites unknown evidence ${id}`];
    }
    const problems: string[] = [];
    if (!(rules.evidenceScope[source.kind] ?? []).includes(claim.kind)) {
      problems.push(`${id} (${source.kind}) may not establish a "${claim.kind}" claim`);
    }
    if (!source.supports.includes(claim.kind)) {
      problems.push(`${id} does not list "${claim.kind}" among the claims it supports`);
    }
    return problems;
  });
}

/**
 * A claim counts when its sources are sound. If RV-1 were rejected, sources
 * of kind SIM would not count, so a claim with nothing else behind it fails.
 * For the UNO contract the same switch withdraws the emulator (EMU).
 */
export function isClaimEstablished(claim: Claim, contract: CompatContract, rv1: Rv1Mode = contract.rv1): boolean {
  if (claimProblems(claim, contract).length > 0) {
    return false;
  }
  const { emulator } = rulesOf(contract);
  return rv1 === 'REJECTED' ? claim.sources.some((id) => contract.evidence[id]?.kind !== emulator) : true;
}

/** True when a claim of the field rests on the public simulator (UNO: the emulator) alone (derived, never written by hand). */
export function isFieldSimDependent(entry: FieldEntry, contract: CompatContract): boolean {
  const { emulator } = rulesOf(contract);
  return (
    (entry.label === 'VERIFIED' || entry.label === 'DOCUMENTED') &&
    entry.claims.some((claim) => claim.sources.every((id) => contract.evidence[id]?.kind === emulator))
  );
}

export function simDependentFields(item: ConstructContract | ModuleContract, contract: CompatContract): string[] {
  return Object.entries(item.fields)
    .filter(([, entry]) => isFieldSimDependent(entry, contract))
    .map(([field]) => field);
}

/**
 * Whether a VERIFIED or DOCUMENTED field is really established: the one rule
 * the contract audit (`validateContract`) and the exposure gate both apply.
 * Every claim must (1) be of a kind that can establish THIS field, (2) rest on
 * sources whose kind and ledger entry allow that kind (RV-1), and (3) rest on
 * sources that record the observation of THIS field. The label must match the
 * sources it names. Other labels have nothing to check here.
 */
export function entrySemanticProblems(name: string, field: OfField, entry: FieldEntry, contract: CompatContract): string[] {
  if (entry.label !== 'VERIFIED' && entry.label !== 'DOCUMENTED') {
    return [];
  }
  const rules = rulesOf(contract);
  const problems: string[] = [];
  for (const claim of entry.claims) {
    if (!rules.fieldClaimKinds[field].includes(claim.kind)) {
      problems.push(`${name}: a "${claim.kind}" claim cannot establish ${field}`);
    }
    problems.push(...claimProblems(claim, contract).map((problem) => `${name}: ${problem}`));
    for (const id of claim.sources) {
      const source = contract.evidence[id];
      if (source && !source.establishes.includes(field)) {
        problems.push(`${name}: ${id} does not record an observation of ${field}`);
      }
    }
  }
  const kinds = entry.claims.flatMap((claim) => claim.sources.map((id) => contract.evidence[id]?.kind));
  if (entry.label === 'VERIFIED' && !kinds.some((kind) => kind !== undefined && rules.verifiedBy.includes(kind))) {
    problems.push(`${name} is VERIFIED without a ${orList(rules.verifiedBy)} source`);
  }
  if (entry.label === 'DOCUMENTED' && !kinds.some((kind) => kind !== undefined && rules.documentedBy.includes(kind))) {
    problems.push(`${name} is DOCUMENTED without a ${orList(rules.documentedBy)} source`);
  }
  for (const id of entry.corroboratedBy ?? []) {
    if (!contract.evidence[id]) {
      problems.push(`${name} cites unknown evidence ${id}`);
    }
  }
  return problems;
}

// --- Exposure eligibility gate (EG, plan §6.2) -------------------------------------------

/**
 * What a field may rest on to count: UNKNOWN and INFERRED never do, except a field the row (or the module, N17 B4) names as
 * UNVERIFIED by the owner's N17 decision (`unverifiedFields`): that one is let through, and only that one.
 */
function fieldProblems(
  name: string,
  field: OfField,
  entry: FieldEntry,
  owner: {
    python?: ConstructContract['python'];
    cpp?: ConstructContract['cpp'];
    domain?: Domain;
    preamble?: readonly string[];
    unverifiedFields?: Readonly<Partial<Record<OfField, string>>>;
  },
  contract: CompatContract,
  rv1: Rv1Mode,
): string[] {
  switch (entry.label) {
    case 'INFERRED':
    case 'UNKNOWN':
      if (owner.unverifiedFields !== undefined && Object.hasOwn(owner.unverifiedFields, field)) {
        return [];
      }
      return [`field ${name} is ${entry.label}: ${entry.note}`];
    case 'n/a':
      if (entry.reason === 'domain-restricted' && !owner.domain) {
        return [`field ${name} is n/a by domain but there is no domain`];
      }
      if (entry.reason === 'explicit-parameter' && !owner.python && !owner.cpp && !owner.preamble) {
        return [`field ${name} is n/a by explicit parameter but nothing passes it explicitly`];
      }
      return [];
    case 'VERIFIED':
    case 'DOCUMENTED':
      return [
        ...entrySemanticProblems(`field ${name}`, field, entry, contract),
        ...entry.claims
          .filter((claim) => !isClaimEstablished(claim, contract, rv1))
          .map((claim) => `field ${name}: the "${claim.kind}" claim is not established`),
      ];
  }
}

/** Why a module may not be relied on yet; empty when it may. */
export function moduleViolations(module: ModuleContract, contract: CompatContract, rv1: Rv1Mode = contract.rv1): string[] {
  const problems: string[] = [];
  if (module.eligibility !== 'ELIGIBLE') {
    problems.push(`module ${module.id} is ${module.eligibility}`);
  }
  for (const field of ['import', 'module'] as const) {
    problems.push(
      ...fieldProblems(`${module.id}.${field}`, field, module.fields[field], { preamble: module.preamble, ...(module.unverifiedFields ? { unverifiedFields: module.unverifiedFields } : {}) }, contract, rv1),
    );
  }
  return problems;
}

/**
 * Why a construct may not be shown to a learner; empty when it may. This is
 * the gate: an EXCLUDED or DEFERRED row, a blocked one, a field that is
 * UNKNOWN or INFERRED, a claim the evidence cannot carry, or a module that is
 * not itself eligible, each keeps it out.
 */
export function exposureViolations(
  construct: ConstructContract,
  contract: CompatContract,
  rv1: Rv1Mode = contract.rv1,
): string[] {
  const rules = rulesOf(contract);
  const problems: string[] = [];
  if (construct.eligibility !== 'ELIGIBLE' && construct.eligibility !== 'RESTRICTED') {
    problems.push(`${construct.id} is ${construct.eligibility}`);
  }
  if ((construct.blockedBy?.length ?? 0) > 0) {
    problems.push(`${construct.id} is blocked by ${construct.blockedBy?.join(', ')}`);
  }
  if (construct.eligibility === 'RESTRICTED' && !construct.domain) {
    problems.push(`${construct.id} is RESTRICTED without a domain`);
  }
  if (!mappingOf(construct, rules)) {
    problems.push(`${construct.id} has no ${mappingName(rules)} mapping`);
  }
  const preambles = construct.modules.flatMap((id) => contract.modules.find((module) => module.id === id)?.preamble ?? []);
  for (const field of ofFields) {
    problems.push(
      ...fieldProblems(`${construct.id}.${field}`, field, construct.fields[field], { ...construct, preamble: preambles }, contract, rv1),
    );
  }
  for (const id of construct.modules) {
    const module = contract.modules.find((candidate) => candidate.id === id);
    problems.push(...(module ? moduleViolations(module, contract, rv1) : [`${construct.id} needs unknown module ${id}`]));
  }
  return problems;
}

export function isExposable(construct: ConstructContract, contract: CompatContract, rv1: Rv1Mode = contract.rv1): boolean {
  return exposureViolations(construct, contract, rv1).length === 0;
}

/** The constructs that pass the gate for a profile. */
export function exposableConstructs(
  contract: CompatContract,
  profileId: ProfileId,
  rv1: Rv1Mode = contract.rv1,
): ConstructContract[] {
  return contract.constructs.filter((construct) => construct.profiles.includes(profileId) && isExposable(construct, contract, rv1));
}

/**
 * The gate for a profile's construct list: every id must be a contract row
 * that passes EG and is meant for that profile. A construct the contract does
 * not know, or that fails the gate, cannot be put in a profile.
 */
export function profileConstructViolations(
  profileId: string,
  constructIds: readonly string[],
  contract: CompatContract,
  rv1: Rv1Mode = contract.rv1,
): string[] {
  const rules = rulesOf(contract);
  return constructIds.flatMap((id) => {
    const construct = contract.constructs.find((candidate) => candidate.id === id);
    if (!construct) {
      return [`${profileId} lists ${id}, which is not a contract row`];
    }
    const problems = exposureViolations(construct, contract, rv1).map((problem) => `${profileId}: ${problem}`);
    const profile = rules.profiles.find((candidate) => candidate === profileId);
    if (!profile) {
      return [`${profileId} is not a ${rules.family} profile`, ...problems];
    }
    if (!construct.profiles.includes(profile)) {
      problems.push(`${profileId}: ${id} is not meant for this profile`);
    }
    return problems;
  });
}

/**
 * Plan §13.9, invariant 9: the Python text a generator may write is exactly what exposable rows list: their verified form and,
 * since N17, the UNVERIFIED forms a row names explicitly (`unverifiedForms`).
 */
export function generatorAllowlist(contract: YolobitContract): { forms: string[]; imports: string[]; preamble: string[]; builtins: string[] } {
  const constructs = contract.constructs.filter((construct) => isExposable(construct, contract));
  const modules = contract.modules.filter((module) => moduleViolations(module, contract).length === 0);
  const unique = (values: (string | undefined)[]) => [...new Set(values.filter((value): value is string => value !== undefined))];
  return {
    forms: unique(constructs.flatMap((construct) => [construct.python?.form, ...(construct.unverifiedForms ?? []).map((extra) => extra.form)])),
    imports: unique(modules.map((module) => module.importForm ?? undefined)),
    preamble: unique(modules.flatMap((module) => module.preamble ?? [])),
    builtins: unique(constructs.flatMap((construct) => construct.python?.builtins ?? [])),
  };
}

/**
 * UNO contract §15 invariant 9: the C++ a generator may write is exactly what exposable rows list: their forms (with their
 * variants, N18 C1), the includes, globals and setup lines they need, the helpers they name, and the pinned libraries.
 */
export function cppAllowlist(contract: UnoContract): { forms: string[]; includes: string[]; libraries: string[]; helpers: string[]; globals: string[]; setup: string[] } {
  const rows = contract.constructs.filter((construct) => isExposable(construct, contract));
  const unique = (values: (string | undefined)[]) => [...new Set(values.filter((value): value is string => value !== undefined))];
  return {
    forms: unique(rows.flatMap((row) => [row.cpp?.form, ...(row.cpp?.variants ?? [])])),
    includes: unique(rows.flatMap((row) => row.cpp?.includes ?? [])),
    libraries: unique(rows.flatMap((row) => (row.cpp?.libraries ?? []).map((library) => `${library.name}@${library.version}`))),
    helpers: unique(rows.flatMap((row) => row.cpp?.helpers ?? [])),
    globals: unique(rows.flatMap((row) => row.cpp?.globals ?? [])),
    setup: unique(rows.flatMap((row) => row.cpp?.setup ?? [])),
  };
}

/**
 * What the UNO contract adds to the shared invariants (its §15): no INFERRED label and no owner-opened UNVERIFIED
 * field or form (an open row has evidence for every field, R0.3 acceptance); every row carries its claim levels, a
 * PASS names evidence of the right kind (L2 compile, L2e emulator), L3 is never PASS; a C++ mapping names only known
 * helpers and the libraries of its modules; no Python mapping.
 */
function unoProblems(contract: UnoContract): string[] {
  const problems: string[] = [];
  const levelKind: Record<'L2' | 'L2e', AnyEvidenceKind> = { L2: 'CC', L2e: 'EMU' };
  for (const construct of contract.constructs) {
    for (const [field, entry] of Object.entries(construct.fields)) {
      if (entry.label === 'INFERRED') {
        problems.push(`${construct.id}.${field} is INFERRED: the UNO contract uses VERIFIED, DOCUMENTED, UNKNOWN or n/a only`);
      }
    }
    if (construct.unverifiedFields !== undefined || construct.unverifiedForms !== undefined) {
      problems.push(`${construct.id} names UNVERIFIED fields or forms: the UNO contract opens a row on evidence only`);
    }
    if (construct.python) {
      problems.push(`${construct.id} has a Python mapping in the UNO contract`);
    }
    if (!construct.levels) {
      problems.push(`${construct.id} has no claim levels`);
    } else {
      for (const level of claimLevels) {
        const status = construct.levels[level];
        if (status.status !== 'PASS') {
          continue;
        }
        if (level === 'L1' || level === 'L3') {
          problems.push(`${construct.id}.${level} is PASS, but no ${level === 'L1' ? 'simulator test' : 'physical'} evidence exists in contract v0`);
          continue;
        }
        for (const id of status.evidence) {
          const kind = contract.evidence[id]?.kind;
          if (kind !== levelKind[level]) {
            problems.push(`${construct.id}.${level} cites ${id}, which is not ${levelKind[level]} evidence`);
          }
        }
      }
      const exposed = construct.eligibility === 'ELIGIBLE' || construct.eligibility === 'RESTRICTED';
      if (exposed && construct.levels.L2.status !== 'PASS') {
        problems.push(`${construct.id} is ${construct.eligibility} but its C++ form has not compiled (L2)`);
      }
    }
    const libraries = new Set(
      construct.modules.flatMap((id) => {
        const library = contract.modules.find((module) => module.id === id)?.library;
        return library ? [`${library.name}@${library.version}`] : [];
      }),
    );
    for (const library of construct.cpp?.libraries ?? []) {
      if (!libraries.has(`${library.name}@${library.version}`)) {
        problems.push(`${construct.id} needs ${library.name}@${library.version}, which none of its modules pins`);
      }
    }
    for (const helper of construct.cpp?.helpers ?? []) {
      if (!contract.helpers[helper]) {
        problems.push(`${construct.id} names unknown helper ${helper}`);
      } else if (!contract.helpers[helper].usedBy.includes(construct.id)) {
        problems.push(`helper ${helper} does not list ${construct.id} among its users`);
      }
    }
  }
  for (const [id, helper] of Object.entries(contract.helpers)) {
    for (const user of helper.usedBy) {
      if (!contract.constructs.find((construct) => construct.id === user)?.cpp?.helpers?.includes(id)) {
        problems.push(`helper ${id} lists ${user}, which does not use it`);
      }
    }
  }
  for (const id of [...contract.costsEvidence, ...contract.millis.evidence]) {
    if (contract.evidence[id]?.kind !== 'EMU') {
      problems.push(`${id} is cited for a measured number but is not EMU evidence`);
    }
  }
  return problems;
}

// --- The invariants of contract §21 (the contract's own consistency) -------------------------

/** Every way the data breaks the frozen invariants; empty when it is consistent. */
export function validateContract(contract: CompatContract): string[] {
  const rules = rulesOf(contract);
  const problems: string[] = contract.contractId === 'uno-arduino-avr' ? unoProblems(contract) : [];
  const check = (owner: string, name: OfField, entry: FieldEntry) => {
    problems.push(...entrySemanticProblems(`${owner}.${name}`, name, entry, contract));
  };

  const ids = new Set<string>();
  for (const module of contract.modules) {
    if (ids.has(module.id)) {
      problems.push(`duplicate id ${module.id}`);
    }
    ids.add(module.id);
    for (const field of ['import', 'module'] as const) {
      check(module.id, field, module.fields[field]);
    }
    // An ELIGIBLE module is held to the gate's own rule, so the audit never certifies what the gate refuses.
    if (module.eligibility === 'ELIGIBLE') {
      problems.push(...moduleViolations(module, contract));
    }
    if ((module.eligibility === 'EXCLUDED' || module.eligibility === 'DEFERRED') && !module.exclusionReason) {
      problems.push(`${module.id} is ${module.eligibility} without a reason`);
    }
    // As for a construct: the owner's list names only fields no evidence establishes, and only on a module that is relied on.
    for (const field of Object.keys(module.unverifiedFields ?? {}) as ('import' | 'module')[]) {
      const label = module.fields[field]?.label;
      if (module.eligibility !== 'ELIGIBLE') {
        problems.push(`${module.id} is ${module.eligibility} but has UNVERIFIED fields`);
      } else if (label !== 'UNKNOWN' && label !== 'INFERRED') {
        problems.push(`${module.id} names ${field} as UNVERIFIED, but it is ${label ?? 'not a field'}`);
      }
    }
  }

  for (const construct of contract.constructs) {
    if (ids.has(construct.id)) {
      problems.push(`duplicate id ${construct.id}`);
    }
    ids.add(construct.id);
    for (const field of Object.keys(construct.fields) as OfField[]) {
      check(construct.id, field, construct.fields[field]);
    }
    const exposed = construct.eligibility === 'ELIGIBLE' || construct.eligibility === 'RESTRICTED';
    if (exposed) {
      problems.push(...exposureViolations(construct, contract));
      if (construct.profiles.length === 0) {
        problems.push(`${construct.id} is ${construct.eligibility} but no profile shows it`);
      }
      const unverified = construct.unverifiedFields ?? {};
      for (const field of ofFields) {
        const label = construct.fields[field].label;
        if ((label === 'INFERRED' || label === 'UNKNOWN') && !Object.hasOwn(unverified, field)) {
          problems.push(`${construct.id}.${field} is ${label} on an ${construct.eligibility} construct (EG)`);
        }
      }
      // The owner's N17 list names only fields that no evidence establishes (UNKNOWN, or INFERRED since N17 B4): a field with
      // evidence is not UNVERIFIED.
      for (const field of Object.keys(unverified) as OfField[]) {
        const label = construct.fields[field]?.label;
        if (label !== 'UNKNOWN' && label !== 'INFERRED') {
          problems.push(`${construct.id} names ${field} as UNVERIFIED, but it is ${label ?? 'not a field'}`);
        }
      }
      for (const id of construct.modules) {
        const module = contract.modules.find((candidate) => candidate.id === id);
        if (module?.eligibility !== 'ELIGIBLE') {
          problems.push(`${construct.id} needs module ${id}, which is not ELIGIBLE`);
        }
      }
      if (!mappingOf(construct, rules)) {
        problems.push(`${construct.id} is ${construct.eligibility} without a ${mappingName(rules)} mapping`);
      }
    } else {
      if (!construct.exclusionReason) {
        problems.push(`${construct.id} is ${construct.eligibility} without a reason`);
      }
      if (mappingOf(construct, rules)) {
        problems.push(`${construct.id} is ${construct.eligibility} but has a ${mappingName(rules)} mapping`);
      }
      if ((construct.unverifiedForms?.length ?? 0) > 0) {
        problems.push(`${construct.id} is ${construct.eligibility} but has UNVERIFIED forms`);
      }
      if (Object.keys(construct.unverifiedFields ?? {}).length > 0) {
        problems.push(`${construct.id} is ${construct.eligibility} but has UNVERIFIED fields`);
      }
      if (construct.profiles.length > 0) {
        problems.push(`${construct.id} is ${construct.eligibility} but a profile lists it`);
      }
    }
    if (construct.eligibility === 'RESTRICTED' && !construct.domain) {
      problems.push(`${construct.id} is RESTRICTED without a domain`);
    }
    for (const [field, entry] of Object.entries(construct.fields)) {
      if (entry.label === 'n/a' && entry.reason === 'domain-restricted' && !construct.domain) {
        problems.push(`${construct.id}.${field} is n/a by domain but has no domain`);
      }
    }
  }
  return problems;
}
