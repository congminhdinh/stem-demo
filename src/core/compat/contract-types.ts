import { z } from 'zod';

// The machine-readable Yolo:Bit contract: shapes (docs/yolobit-compatibility-contract.md §21).
// The values are in `yolobit-contract.ts`, copied from the frozen contract;
// the rules that decide what a learner may see are in `contract-validation.ts`.
// Pure data and types (B1, B6): nothing here knows about blocks, UI or runtime.

// --- Labels, evidence, claims ---------------------------------------------------

/** The five labels of contract §0.2. INFERRED counts as UNKNOWN for exposure. */
export const contractLabels = ['VERIFIED', 'DOCUMENTED', 'INFERRED', 'UNKNOWN', 'n/a'] as const;
export type ContractLabel = (typeof contractLabels)[number];

/** Where evidence comes from: GEN generated Python of our own program; SIM public vendor simulator; UI text of the public editor; WEB public pages; MPY MicroPython docs. */
export const evidenceKinds = ['GEN', 'SIM', 'UI', 'WEB', 'MPY'] as const;
export type EvidenceKind = (typeof evidenceKinds)[number];

/** The observable fields (plan §6.2, OF-*). Every construct has an entry for each. */
export const ofFields = [
  'call',
  'import',
  'module',
  'unit',
  'range',
  'default',
  'clamp',
  'round',
  'block',
  'yield',
  'return',
  'error',
  'coord',
  'event',
  'content',
] as const;
export type OfField = (typeof ofFields)[number];

export const eligibilities = ['ELIGIBLE', 'RESTRICTED', 'EXCLUDED', 'DEFERRED'] as const;
export type Eligibility = (typeof eligibilities)[number];

/**
 * What a claim says something about. The first group may be established by
 * text evidence; the SIM group only by the public simulator; the last group
 * can never be established by the simulator (RV-1, contract §0.4).
 */
export const claimKinds = [
  'call-shape',
  'import-syntax',
  'preamble-text',
  'encoding',
  'parity-output',
  'ui-statement',
  'documented',
  'blocking',
  'return-reset',
  'display-transition',
  'sound-indicator',
  'yield-observed',
  'sim-module',
  'physical-range',
  'language',
  'electrical',
  'physical-timing',
  'firmware-identity',
  'firmware-module',
] as const;
export type ClaimKind = (typeof claimKinds)[number];

/** Claims the simulator can never establish, whatever the widget or the traceback shows (RV-1). */
export const simForbiddenClaims = [
  'physical-range',
  'language',
  'electrical',
  'physical-timing',
  'firmware-identity',
  'firmware-module',
] as const satisfies readonly ClaimKind[];

/**
 * RV-1 = ACCEPT WITH RESTRICTIONS, as data: the claim kinds each evidence
 * kind may establish. A source may support a claim only if its kind allows it
 * here AND its ledger entry lists it in `supports`.
 */
export const EVIDENCE_SCOPE: Readonly<Record<EvidenceKind, readonly ClaimKind[]>> = {
  GEN: ['call-shape', 'import-syntax', 'preamble-text', 'encoding', 'parity-output'],
  UI: ['ui-statement'],
  WEB: ['documented'],
  MPY: ['documented', 'language'],
  SIM: ['blocking', 'return-reset', 'display-transition', 'sound-indicator', 'yield-observed', 'sim-module'],
};

/**
 * Which kinds of claim can establish each observable field. One table for the
 * contract's own audit and for the exposure gate, so they cannot disagree:
 * import syntax says nothing about a module's availability (N2), a timing
 * observation says nothing about a range, and so on. A label alone never
 * makes a field established.
 */
export const FIELD_CLAIM_KINDS: Readonly<Record<OfField, readonly ClaimKind[]>> = {
  call: ['call-shape', 'parity-output', 'documented', 'language'],
  import: ['import-syntax', 'preamble-text'],
  module: ['documented', 'language', 'sim-module'],
  unit: ['documented', 'ui-statement', 'blocking', 'sound-indicator'],
  range: ['documented', 'ui-statement', 'encoding', 'call-shape', 'display-transition', 'sound-indicator'],
  default: ['documented', 'call-shape'],
  clamp: ['documented', 'display-transition'],
  round: ['documented', 'return-reset'],
  block: ['documented', 'ui-statement', 'blocking'],
  yield: ['yield-observed'],
  return: ['documented', 'ui-statement', 'return-reset'],
  error: ['documented', 'language'],
  coord: ['documented', 'display-transition'],
  event: ['documented'],
  content: ['documented', 'ui-statement', 'encoding', 'call-shape', 'display-transition', 'sound-indicator'],
};

/** Ledger entries may also support things that are not field claims. */
export type LedgerSupport = ClaimKind | 'snapshot' | 'method' | 'context';

export type EvidenceRef = string;

export type EvidenceEntry = {
  kind: EvidenceKind;
  date: string;
  source: string;
  action: string;
  observed: string;
  /** Contract §20 "Claim được đỡ". Empty: context only, supports no claim. */
  supports: readonly LedgerSupport[];
  /** The observable fields this entry can establish (the call or trace it records). Empty: none. */
  establishes: readonly OfField[];
};

export type Claim = {
  kind: ClaimKind;
  /** What is claimed, close to the contract's wording. */
  statement: string;
  /** Non-empty; each source's kind must allow `kind`. */
  sources: readonly EvidenceRef[];
  value?: unknown;
};

/** Why an `n/a` field is not a gap (contract §0.2: `–`, `–ᴰ`, `–ᴱ`). */
export const naReasons = ['not-applicable', 'domain-restricted', 'explicit-parameter'] as const;
export type NaReason = (typeof naReasons)[number];

/**
 * One observable field of one construct. `claims` are all required; a field
 * is only as strong as its weakest claim. `corroboratedBy` lists further
 * evidence that agrees but that the field does not depend on.
 */
export type FieldEntry =
  | { label: 'VERIFIED' | 'DOCUMENTED'; claims: readonly Claim[]; corroboratedBy?: readonly EvidenceRef[] }
  | { label: 'n/a'; reason: NaReason; note: string }
  | { label: 'INFERRED' | 'UNKNOWN'; note: string };

// --- Relational domain restrictions (contract §21: a small closed AST, no code) ---

export type Term = { arg: string } | { const: number } | { add: readonly [Term, Term] } | { sub: readonly [Term, Term] };

export type Pred =
  | { le: readonly [Term, Term] }
  | { lt: readonly [Term, Term] }
  | { eq: readonly [Term, Term] }
  | { all: readonly Pred[] }
  | { oneOf: { arg: string; values: readonly (number | string)[] } }
  | { ascii: { arg: string; from: 0x20; to: 0x7e } }
  /** The argument must be a compile-time literal. */
  | { literal: { arg: string } };

export const domainDiagnostics = [
  'value-out-of-range',
  'descending-range-not-supported',
  'display-char-unsupported',
  'literal-required',
] as const;

export type Domain = {
  args: Readonly<Record<string, 'int' | 'str'>>;
  /** R1: explicit evaluation order, each exactly once, before the operation. */
  evaluation?: {
    order: readonly string[];
    once: true;
    checkEach: 'after-own-evaluation';
    /** Present when the generator needs temporaries (count up); absent for random. */
    temporaries?: 'unless-all-literal';
  };
  /**
   * A `literal` rule is always checked. Every other rule is checked at
   * compile time only when every arg it references is a literal; non-literal
   * args are covered by `runtime`.
   */
  compileTime: readonly { when: Pred; diagnostic: (typeof domainDiagnostics)[number] }[];
  /** Applied to evaluated values (per `evaluation`); a violation is `out-of-domain`. */
  runtime: Pred;
};

// --- Modules and constructs --------------------------------------------------------

export const moduleIds = ['C-03a', 'C-03b', 'C-03c', 'C-03d', 'C-03e'] as const;
export type ModuleId = (typeof moduleIds)[number];

/** Availability of a module is separate from the syntax that imports it (contract §2.2, N2). */
export type ModuleContract = {
  id: ModuleId;
  module: 'time' | 'yolobit' | 'music' | 'random' | 'builtins';
  /** The text a program writes to import it; builtins have none. */
  importForm: string | null;
  /** Exact lines the generator writes after the import (IM-2, IM-4). */
  preamble?: readonly string[];
  fields: { import: FieldEntry; module: FieldEntry };
  eligibility: Eligibility;
  exclusionReason?: string;
  /**
   * N17 B4 (owner, 2026-10-19): the fields of the module no evidence establishes that the owner opened anyway, each with why it is
   * UNVERIFIED (C-03d: whether the firmware has `random.randint`). As for a construct (`ConstructContract.unverifiedFields`).
   */
  unverifiedFields?: Readonly<Partial<Record<'import' | 'module', string>>>;
};

/** The builtins a generated program may call (IM-9; N17 B4: min and max, for the ends of a random number). */
export const generatorBuiltins = ['print', 'range', 'str', 'int', 'len', 'min', 'max'] as const;

export type Profiles = readonly ('ybc-basic' | 'ybc-advanced')[];

export type ConstructContract = {
  /** The contract id, e.g. 'C-39'. */
  id: string;
  /** Further contract ids a grouped row stands for (the contract lists them together). */
  alsoCovers?: readonly string[];
  capability: string;
  /** Curriculum intent (contract §15.1 "Tier"); whether it is shown is the eligibility's decision. */
  tier: { 'ybc-basic'?: 'MUST' | 'NICE'; 'ybc-advanced'?: 'MUST' | 'NICE' };
  /** The profiles that may show the construct once it passes the gate. Empty for EXCLUDED and DEFERRED. */
  profiles: Profiles;
  eligibility: Eligibility;
  /** Human-readable restrictions for RESTRICTED rows (the machine-checkable part is `domain`). */
  restrictions: readonly string[];
  /** Ids of the modules the construct needs; it is only eligible if every one is. */
  modules: readonly ModuleId[];
  /** What the generator emits. Absent for EXCLUDED and DEFERRED: they have no mapping. */
  python?: { form: string; builtins?: readonly (typeof generatorBuiltins)[number][] };
  /** What the public editor generated for it, kept as a note; never an allowlist entry. */
  observedPython?: string;
  /**
   * N17 (owner, 2026-10-19: "Mô phỏng đủ chức năng"): further forms the generator writes for this row that no evidence has
   * checked, each with why it is UNVERIFIED. Never a claim and never a field: the row is exposable on its verified `python`
   * form alone, and the allowlist admits these so that they are written on purpose and nowhere else.
   */
  unverifiedForms?: readonly { form: string; reason: string }[];
  /**
   * N17 B2 (owner, 2026-10-19: "Mô phỏng đủ chức năng"): fields of this row that no evidence establishes and that the owner opened
   * anyway, each with why it is UNVERIFIED and what the simulator does instead. The field stays UNKNOWN (or, since N17 B4, INFERRED,
   * which counts as UNKNOWN at the gate) in `fields`: this is the recorded decision, never a claim. Only an ELIGIBLE or RESTRICTED
   * row may name them, only fields labelled UNKNOWN or INFERRED, and the gate lets exactly these through; every other field of the
   * row is held to EG as before.
   */
  unverifiedFields?: Readonly<Partial<Record<OfField, string>>>;
  fields: Readonly<Record<OfField, FieldEntry>>;
  domain?: Domain;
  timing?: { blocksMs: string; source: 'SIM-observed' };
  presentation?: readonly string[];
  blockedBy?: readonly string[];
  exclusionReason?: string;
  /** An excluded construct may carry the domain it would have if it were reopened (C-40). */
  preSpecifiedDomain?: Domain;
};

export type YolobitContract = {
  contractId: 'yolobit-micropython';
  version: string;
  status: string;
  /** The public snapshot the whole contract is pinned to (contract §1). */
  snapshot: {
    observedOn: string;
    editorBuildMarker: string;
    blocklyVersion: string;
    simulatorBuild: string;
    firmwareListing: readonly string[];
    firmwareExact: 'UNKNOWN';
    micropythonVersion: 'UNKNOWN';
    statement: string;
  };
  rv1: 'ACCEPT_WITH_RESTRICTIONS';
  evidence: Readonly<Record<EvidenceRef, EvidenceEntry>>;
  constants: {
    MAX_RANGE_VALUE: 1_000_000;
    MAX_REPEAT_ABS: 1_000_000;
    MAX_RANDOM_ABS: 1_000_000;
    MAX_RANDOM_SPAN: 1_000_000;
    DISPLAY_CHARSET: { from: 0x20; to: 0x7e };
  };
  /** Owner-approved display model (OQ-E, contract §4.3). */
  display: {
    width: 5;
    height: 5;
    indexBase: 0;
    origin: 'top-left';
    x: 'column';
    y: 'row';
    colourFormat: '#rrggbb';
    defaultColour: '#FF0000';
    /** The eight colours of the Advanced palette (contract §4.4). */
    palette: readonly string[];
    approval: string;
  };
  /** Owner decision C-Q6 = Option A (contract §10.2): native scale, no normalisation. */
  analog: { nativeMax: 4095; uiPercentMax: 100; normalisedTo1023: false; approval: string };
  modules: readonly ModuleContract[];
  constructs: readonly ConstructContract[];
};

// --- Zod schema (shape only; the cross-field invariants are in contract-validation.ts) ---

const claimSchema = z.object({
  kind: z.enum(claimKinds),
  statement: z.string().min(1),
  sources: z.array(z.string()).min(1),
  value: z.unknown().optional(),
});

const fieldEntrySchema = z.discriminatedUnion('label', [
  z.object({
    label: z.enum(['VERIFIED', 'DOCUMENTED']),
    claims: z.array(claimSchema).min(1),
    corroboratedBy: z.array(z.string()).optional(),
  }),
  z.object({ label: z.literal('n/a'), reason: z.enum(naReasons), note: z.string().min(1) }),
  z.object({ label: z.enum(['INFERRED', 'UNKNOWN']), note: z.string().min(1) }),
]);

const termSchema: z.ZodType<Term> = z.lazy(() =>
  z.union([
    z.object({ arg: z.string() }).strict(),
    z.object({ const: z.number() }).strict(),
    z.object({ add: z.tuple([termSchema, termSchema]) }).strict(),
    z.object({ sub: z.tuple([termSchema, termSchema]) }).strict(),
  ]),
);

const predSchema: z.ZodType<Pred> = z.lazy(() =>
  z.union([
    z.object({ le: z.tuple([termSchema, termSchema]) }).strict(),
    z.object({ lt: z.tuple([termSchema, termSchema]) }).strict(),
    z.object({ eq: z.tuple([termSchema, termSchema]) }).strict(),
    z.object({ all: z.array(predSchema) }).strict(),
    z.object({ oneOf: z.object({ arg: z.string(), values: z.array(z.union([z.number(), z.string()])) }) }).strict(),
    z.object({ ascii: z.object({ arg: z.string(), from: z.literal(0x20), to: z.literal(0x7e) }) }).strict(),
    z.object({ literal: z.object({ arg: z.string() }) }).strict(),
  ]),
);

const domainSchema = z.object({
  args: z.record(z.string(), z.enum(['int', 'str'])),
  evaluation: z
    .object({
      order: z.array(z.string()),
      once: z.literal(true),
      checkEach: z.literal('after-own-evaluation'),
      temporaries: z.literal('unless-all-literal').optional(),
    })
    .optional(),
  compileTime: z.array(z.object({ when: predSchema, diagnostic: z.enum(domainDiagnostics) })),
  runtime: predSchema,
});

const fieldsSchema = z.object(Object.fromEntries(ofFields.map((field) => [field, fieldEntrySchema])) as Record<OfField, typeof fieldEntrySchema>).strict();

const moduleSchema = z.object({
  id: z.enum(moduleIds),
  module: z.enum(['time', 'yolobit', 'music', 'random', 'builtins']),
  importForm: z.string().nullable(),
  preamble: z.array(z.string()).optional(),
  fields: z.object({ import: fieldEntrySchema, module: fieldEntrySchema }).strict(),
  eligibility: z.enum(eligibilities),
  exclusionReason: z.string().optional(),
  unverifiedFields: z.partialRecord(z.enum(['import', 'module']), z.string().min(1)).optional(),
});

const constructSchema = z.object({
  id: z.string(),
  alsoCovers: z.array(z.string()).optional(),
  capability: z.string(),
  tier: z.object({ 'ybc-basic': z.enum(['MUST', 'NICE']).optional(), 'ybc-advanced': z.enum(['MUST', 'NICE']).optional() }),
  profiles: z.array(z.enum(['ybc-basic', 'ybc-advanced'])),
  eligibility: z.enum(eligibilities),
  restrictions: z.array(z.string()),
  modules: z.array(z.enum(moduleIds)),
  python: z
    .object({ form: z.string().min(1), builtins: z.array(z.enum(generatorBuiltins)).optional() })
    .optional(),
  observedPython: z.string().optional(),
  unverifiedForms: z.array(z.object({ form: z.string().min(1), reason: z.string().min(1) })).optional(),
  unverifiedFields: z.partialRecord(z.enum(ofFields), z.string().min(1)).optional(),
  fields: fieldsSchema,
  domain: domainSchema.optional(),
  timing: z.object({ blocksMs: z.string(), source: z.literal('SIM-observed') }).optional(),
  presentation: z.array(z.string()).optional(),
  blockedBy: z.array(z.string()).optional(),
  exclusionReason: z.string().optional(),
  preSpecifiedDomain: domainSchema.optional(),
});

export const yolobitContractSchema = z.object({
  contractId: z.literal('yolobit-micropython'),
  version: z.string(),
  status: z.string(),
  snapshot: z.object({
    observedOn: z.string(),
    editorBuildMarker: z.string(),
    blocklyVersion: z.string(),
    simulatorBuild: z.string(),
    firmwareListing: z.array(z.string()).min(1),
    firmwareExact: z.literal('UNKNOWN'),
    micropythonVersion: z.literal('UNKNOWN'),
    statement: z.string(),
  }),
  rv1: z.literal('ACCEPT_WITH_RESTRICTIONS'),
  evidence: z.record(
    z.string(),
    z.object({
      kind: z.enum(evidenceKinds),
      date: z.string(),
      source: z.string(),
      action: z.string(),
      observed: z.string(),
      supports: z.array(z.string()),
      establishes: z.array(z.enum(ofFields)),
    }),
  ),
  constants: z.object({
    MAX_RANGE_VALUE: z.literal(1_000_000),
    MAX_REPEAT_ABS: z.literal(1_000_000),
    MAX_RANDOM_ABS: z.literal(1_000_000),
    MAX_RANDOM_SPAN: z.literal(1_000_000),
    DISPLAY_CHARSET: z.object({ from: z.literal(0x20), to: z.literal(0x7e) }),
  }),
  display: z.object({
    width: z.literal(5),
    height: z.literal(5),
    indexBase: z.literal(0),
    origin: z.literal('top-left'),
    x: z.literal('column'),
    y: z.literal('row'),
    colourFormat: z.literal('#rrggbb'),
    defaultColour: z.literal('#FF0000'),
    palette: z.array(z.string()).length(8),
    approval: z.string(),
  }),
  analog: z.object({
    nativeMax: z.literal(4095),
    uiPercentMax: z.literal(100),
    normalisedTo1023: z.literal(false),
    approval: z.string(),
  }),
  modules: z.array(moduleSchema),
  constructs: z.array(constructSchema),
});
