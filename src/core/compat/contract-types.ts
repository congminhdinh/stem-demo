import { z } from 'zod';

// The machine-readable compatibility contracts: shapes (docs/yolobit-compatibility-contract.md §21 and, since N18 R0.3,
// docs/uno-compatibility-contract.md §15). The values are in `yolobit-contract.ts` and `uno-contract.ts`; the rules that
// decide what a learner may see are in `contract-validation.ts`, one set per target (`rulesOf`).
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
  // UNO (N18 R0.3): the compiler and the emulator.
  'compile-ok',
  'compile-size',
  'disassembly',
  'emu-trace',
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

/**
 * Ledger entries may also support things that are not field claims. `sim-semantic`: a test of this repository that runs a row on the
 * simulator, the evidence of the UNO contract's L1 level (N18 final fix M4).
 */
export type LedgerSupport = ClaimKind | 'snapshot' | 'method' | 'context' | 'sim-semantic';

export type EvidenceRef = string;

export type EvidenceEntry = {
  kind: AnyEvidenceKind;
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
/** UNO (N18 R0.3, contract §2): the Arduino AVR core and the Servo library. */
export const unoModuleIds = ['U-M1', 'U-M2'] as const;
export type UnoModuleId = (typeof unoModuleIds)[number];

/** A pinned library or core: what `arduino-cli lib install <name>@<version>` (or `core install`) installs. */
export type CppLibrary = { name: string; version: string; license: string };

/** Availability of a module is separate from the syntax that imports it (contract §2.2, N2). */
export type ModuleContract = {
  id: ModuleId | UnoModuleId;
  module: 'time' | 'yolobit' | 'music' | 'random' | 'builtins' | 'arduino-core' | 'servo';
  /** The text a program writes to import it; builtins (and the Arduino core, which the .ino build includes) have none. */
  importForm: string | null;
  /** UNO: the pinned core or library the module is. */
  library?: CppLibrary;
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

export const profileIds = ['ybc-basic', 'ybc-advanced', 'uno-basic', 'uno-advanced'] as const;
export type ProfileId = (typeof profileIds)[number];
export type Profiles = readonly ProfileId[];
export type Tier = Partial<Record<ProfileId, 'MUST' | 'NICE'>>;

export type ConstructContract = {
  /** The contract id, e.g. 'C-39'. */
  id: string;
  /** Further contract ids a grouped row stands for (the contract lists them together). */
  alsoCovers?: readonly string[];
  capability: string;
  /** Curriculum intent (contract §15.1 "Tier"); whether it is shown is the eligibility's decision. */
  tier: Tier;
  /** The profiles that may show the construct once it passes the gate. Empty for EXCLUDED and DEFERRED. */
  profiles: Profiles;
  eligibility: Eligibility;
  /** Human-readable restrictions for RESTRICTED rows (the machine-checkable part is `domain`). */
  restrictions: readonly string[];
  /** Ids of the modules the construct needs; it is only eligible if every one is. */
  modules: readonly (ModuleId | UnoModuleId)[];
  /** What the generator emits. Absent for EXCLUDED and DEFERRED: they have no mapping. */
  python?: { form: string; builtins?: readonly (typeof generatorBuiltins)[number][] };
  /** UNO (N18 R0.3): what the Arduino C++ generator emits. Absent for EXCLUDED and DEFERRED. */
  cpp?: CppMapping;
  /** UNO: how far each claim level has got for this row (contract §12). */
  levels?: ClaimLevels;
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

// --- UNO (N18 R0.3, docs/uno-compatibility-contract.md) -------------------------------------

/**
 * Where UNO evidence comes from (contract §0.2): EMU an avr8js trace of a HEX we compiled from our own sketch;
 * CC arduino-cli output for our own sketch (compile, sizes, disassembly); ARD the Arduino reference and library
 * docs; DS the ATmega328P datasheet; CXX the C++ draft and the GCC manual; PKG release listings (snapshot only);
 * TST a test of this repository that runs the row on the simulator, its file and the titles of its tests (L1 only, N18 final fix M4).
 */
export const unoEvidenceKinds = ['EMU', 'CC', 'ARD', 'DS', 'CXX', 'PKG', 'TST'] as const;
export type UnoEvidenceKind = (typeof unoEvidenceKinds)[number];
export type AnyEvidenceKind = EvidenceKind | UnoEvidenceKind;

/** What each UNO evidence kind may establish (contract §0.4, the emulator boundary). */
export const UNO_EVIDENCE_SCOPE: Readonly<Record<UnoEvidenceKind, readonly ClaimKind[]>> = {
  EMU: ['emu-trace'],
  CC: ['compile-ok', 'compile-size', 'disassembly'],
  ARD: ['documented'],
  DS: ['documented'],
  CXX: ['documented', 'language'],
  PKG: [],
  // A test says the simulator does what the contract says; what the board does stays the emulator's, the compiler's and the documents'.
  TST: [],
};

/** Claims the emulator can never establish: it is not the board (contract §0.4, L3). */
export const emuForbiddenClaims = ['physical-range', 'electrical', 'physical-timing', 'firmware-identity'] as const satisfies readonly ClaimKind[];

/** Which kinds of claim can establish each observable field of an UNO row (contract §0.4). */
export const UNO_FIELD_CLAIM_KINDS: Readonly<Record<OfField, readonly ClaimKind[]>> = {
  call: ['compile-ok', 'documented', 'language'],
  import: ['compile-ok'],
  module: ['compile-ok', 'documented'],
  unit: ['documented', 'emu-trace'],
  range: ['documented', 'emu-trace', 'language'],
  default: ['documented', 'emu-trace'],
  clamp: ['documented', 'emu-trace'],
  round: ['documented', 'emu-trace', 'language'],
  block: ['documented', 'emu-trace', 'disassembly'],
  yield: ['emu-trace'],
  return: ['documented', 'emu-trace', 'language'],
  error: ['documented', 'emu-trace', 'language'],
  coord: ['documented'],
  event: ['documented'],
  content: ['documented', 'emu-trace', 'language'],
};

/**
 * What the Arduino C++ generator emits for a row (contract §2.3). `form` has <placeholders> as the Python forms do;
 * `includes`, `globals` and `setup` are written once per sketch (setup lines at the top of `setup()`); `helpers` are
 * ids of `UnoContract.helpers`, whose text is written once before `setup()`.
 */
export type CppMapping = {
  form: string;
  /**
   * N18 C1: further exact forms of the row, which the allowlist admits next to `form` (U-04's INT32_MIN literal, U-17's text part).
   * The row's `call` evidence covers each of them (CC-03 compiled them in contract-forms.ino).
   */
  variants?: readonly string[];
  includes: readonly string[];
  libraries: readonly CppLibrary[];
  helpers?: readonly string[];
  globals?: readonly string[];
  setup?: readonly string[];
};

/**
 * The claim levels of plan D-R11 (contract §12). L1 is PASS on tests of the simulator (TST, N18 final fix M4); L3 is never PASS here: no
 * physical evidence exists yet.
 */
export const claimLevels = ['L1', 'L2', 'L2e', 'L3'] as const;
export type ClaimLevel = (typeof claimLevels)[number];
export type LevelStatus = { status: 'PASS'; evidence: readonly EvidenceRef[] } | { status: 'PENDING'; by: string } | { status: 'n/a'; note: string };
export type ClaimLevels = Readonly<Record<ClaimLevel, LevelStatus>>;

/** The Arduino calls the virtual UNO charges (`BoardProfile.costsUs`, contract §4.4), in µs. */
export const arduinoCalls = [
  'pinMode',
  'pinModeInputPullup',
  'digitalWrite',
  'digitalWriteTimerPin',
  'digitalRead',
  'digitalReadTimerPin',
  'analogRead',
  'analogReadFirst',
  'analogWrite',
  'analogWriteDigital',
  'millis',
  'delayOverhead',
  'servoWrite',
  'tone',
  'noTone',
  'pulseInAfterPulse',
  'pulseInNoPulse30000',
  'ultrasonicCmOverhead',
  'ultrasonicCmNoEcho',
  'motorSetOverhead',
  'serialWriteByte',
  'serialQueueByte',
  'serialLineByte',
  'serialPrintLongBase',
  'serialPrintLongDigit',
  'serialPrintLongSign',
  'serialPrintln',
] as const;
export type ArduinoCall = (typeof arduinoCalls)[number];

export type UnoContract = {
  contractId: 'uno-arduino-avr';
  version: string;
  status: string;
  /** The toolchain, library and emulator versions the whole contract is pinned to (contract §1). */
  snapshot: {
    pinnedOn: string;
    fqbn: 'arduino:avr:uno';
    arduinoCli: string;
    core: CppLibrary & { published: string };
    toolchain: string;
    compilerFlags: string;
    libraries: readonly (CppLibrary & { published: string })[];
    emulator: CppLibrary & { published: string };
    mcuAssumed: 'atmega328p';
    boardIdentity: 'UNKNOWN';
    statement: string;
  };
  /** The emulator boundary (contract §0.4): avr8js evidence is accepted for what EMU may establish, never for L3. */
  rv1: 'ACCEPT_WITH_RESTRICTIONS';
  evidence: Readonly<Record<EvidenceRef, EvidenceEntry>>;
  board: {
    mcu: 'atmega328p';
    clockHz: 16_000_000;
    adcMax: 1023;
    pwmMax: 255;
    flashBytes: 32_256;
    ramBytes: 2048;
    pwmPins: readonly { pin: string; timer: 'T0' | 'T1' | 'T2'; mode: 'fast' | 'phase-correct'; frequencyHz: number }[];
    reserved: readonly { pin: string; when: 'serial' }[];
    timerClaims: Readonly<Record<'servo' | 'tone', 'T1' | 'T2'>>;
    nonPwmThreshold: 128;
  };
  /** The cxx-int32 numeric model (contract §3). */
  numeric: {
    model: 'cxx-int32';
    min: -2_147_483_648;
    max: 2_147_483_647;
    overflow: 'wrap';
    division: 'truncate-toward-zero';
    remainder: 'sign-of-dividend';
    int32MinDividedByMinusOne: -2_147_483_648;
    remainderByMinusOne: 0;
    divisionByZero: { quotient: 0; remainder: 0; warning: 'division-by-zero' };
    boolPrints: { true: '1'; false: '0' };
    literalSuffix: 'L';
    int32MinLiteral: '(-2147483647L - 1L)';
    float: 'excluded';
  };
  constants: {
    LOOP_MIN_US: 50;
    NODE_US: 1;
    SERIAL_BAUD: 9600;
    SERIAL_FRAME_US: 1040;
    SERIAL_TX_QUEUE_BYTES: 64;
    PULSEIN_TIMEOUT_US: 30_000;
    ULTRASONIC_US_PER_CM: 58;
    ULTRASONIC_MIN_CM: 2;
    ULTRASONIC_MAX_CM: 400;
    ULTRASONIC_NO_ECHO_CM: 400;
    MAX_WAIT_MS: 60_000;
    COUNT_UP_MAX_END: 2_147_483_646;
    MOTOR_SPEED_MAX: 100;
    SERVO_ANGLE_MAX: 180;
    SERVO_START_ANGLE: 90;
    TONE_MIN_HZ: 31;
    TONE_MAX_HZ: 4000;
    TONE_MIN_MS: 1;
    TONE_MAX_MS: 60_000;
    PWM_MAX: 255;
    RAM_SOLUTION_MAX_PERCENT: 75;
    RAM_WARN_ABOVE_BYTES: 1536;
  };
  /** µs per Arduino call, measured (contract §4.4, ADR 0003 §4). Exact binary fractions where the cycle count is exact. */
  costsUs: Readonly<Record<ArduinoCall, number>>;
  costsEvidence: readonly EvidenceRef[];
  /**
   * 0.1.5, 0.1.6: what tone() costs (contract §4.4, EMU-18), by the band of Timer2 prescaler its frequency needs (`fromHz` up, the lowest
   * band first): on a pin that plays no tone (it registers the pin and sets Timer2 up first) and on the pin that plays one.
   */
  toneUs: { bands: readonly { prescaler: number; fromHz: number; silentUs: number; playingUs: number }[]; evidence: readonly EvidenceRef[] };
  /** Interrupt load measured on the emulated board; the simulator v0 does not charge it (contract §4.5). */
  isrLoad: { timer0: number; perServo: number; tonePerHz: number; charged: false };
  /** `millis()` as the board computes it (contract §4.3): n = floor(t / 1024 µs) since setup(); n + floor(3n / 125). */
  millis: { overflowUs: 1024; fractPerOverflow: 3; fractMax: 125; evidence: readonly EvidenceRef[] };
  /** Helper texts the generator writes verbatim (contract §3.2, §6), by id. */
  helpers: Readonly<Record<string, { text: string; usedBy: readonly string[] }>>;
  /** Diagnostics the UNO compiler and simulator give (contract §13). */
  diagnostics: readonly { id: string; severity: 'error' | 'warning'; when: string }[];
  modules: readonly ModuleContract[];
  constructs: readonly ConstructContract[];
};

/** Either contract: the validation in contract-validation.ts applies to both, with the rules of its target. */
export type CompatContract = YolobitContract | UnoContract;

/** The evidence rules of one target, as data. */
export type ContractRules = {
  family: 'Yolo:Bit' | 'UNO';
  evidenceScope: Readonly<Partial<Record<AnyEvidenceKind, readonly ClaimKind[]>>>;
  fieldClaimKinds: Readonly<Record<OfField, readonly ClaimKind[]>>;
  /** A VERIFIED field rests on at least one source of these kinds; a DOCUMENTED field on one of the other list. */
  verifiedBy: readonly AnyEvidenceKind[];
  documentedBy: readonly AnyEvidenceKind[];
  /** The simulator or emulator whose acceptance could be withdrawn (RV-1): its claims then stop counting. */
  emulator: AnyEvidenceKind;
  mapping: 'python' | 'cpp';
  profiles: readonly ProfileId[];
};

export const YOLOBIT_RULES: ContractRules = {
  family: 'Yolo:Bit',
  evidenceScope: EVIDENCE_SCOPE,
  fieldClaimKinds: FIELD_CLAIM_KINDS,
  verifiedBy: ['GEN', 'SIM'],
  documentedBy: ['UI', 'WEB', 'MPY'],
  emulator: 'SIM',
  mapping: 'python',
  profiles: ['ybc-basic', 'ybc-advanced'],
};

export const UNO_RULES: ContractRules = {
  family: 'UNO',
  evidenceScope: UNO_EVIDENCE_SCOPE,
  fieldClaimKinds: UNO_FIELD_CLAIM_KINDS,
  verifiedBy: ['EMU', 'CC'],
  documentedBy: ['ARD', 'DS', 'CXX'],
  emulator: 'EMU',
  mapping: 'cpp',
  profiles: ['uno-basic', 'uno-advanced'],
};

export function rulesOf(contract: Pick<CompatContract, 'contractId'>): ContractRules {
  return contract.contractId === 'uno-arduino-avr' ? UNO_RULES : YOLOBIT_RULES;
}

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

// --- UNO Zod schema (N18 R0.3; shape only, like the Yolo:Bit one) -----------------------------

const libraryShape = { name: z.string().min(1), version: z.string().min(1), license: z.string().min(1) };
const librarySchema = z.object(libraryShape).strict();
const publishedLibrarySchema = z.object({ ...libraryShape, published: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).strict();

const levelStatusSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('PASS'), evidence: z.array(z.string()).min(1) }).strict(),
  z.object({ status: z.literal('PENDING'), by: z.string().min(1) }).strict(),
  z.object({ status: z.literal('n/a'), note: z.string().min(1) }).strict(),
]);

const unoModuleSchema = z.object({
  id: z.enum(unoModuleIds),
  module: z.enum(['arduino-core', 'servo']),
  importForm: z.string().nullable(),
  library: librarySchema,
  fields: z.object({ import: fieldEntrySchema, module: fieldEntrySchema }).strict(),
  eligibility: z.enum(eligibilities),
  exclusionReason: z.string().optional(),
});

const unoConstructSchema = z.object({
  id: z.string().regex(/^U-\d{2}$/),
  capability: z.string().min(1),
  tier: z.object({ 'uno-basic': z.enum(['MUST', 'NICE']).optional(), 'uno-advanced': z.enum(['MUST', 'NICE']).optional() }).strict(),
  profiles: z.array(z.enum(['uno-basic', 'uno-advanced'])),
  eligibility: z.enum(eligibilities),
  restrictions: z.array(z.string()),
  modules: z.array(z.enum(unoModuleIds)),
  cpp: z
    .object({
      form: z.string().min(1),
      variants: z.array(z.string().min(1)).optional(),
      includes: z.array(z.string()),
      libraries: z.array(librarySchema),
      helpers: z.array(z.string()).optional(),
      globals: z.array(z.string()).optional(),
      setup: z.array(z.string()).optional(),
    })
    .strict()
    .optional(),
  levels: z.object({ L1: levelStatusSchema, L2: levelStatusSchema, L2e: levelStatusSchema, L3: levelStatusSchema }).strict(),
  fields: fieldsSchema,
  domain: domainSchema.optional(),
  presentation: z.array(z.string()).optional(),
  blockedBy: z.array(z.string()).optional(),
  exclusionReason: z.string().optional(),
}).strict();

export const unoContractSchema = z.object({
  contractId: z.literal('uno-arduino-avr'),
  version: z.string(),
  status: z.string(),
  snapshot: z
    .object({
      pinnedOn: z.string(),
      fqbn: z.literal('arduino:avr:uno'),
      arduinoCli: z.string(),
      core: publishedLibrarySchema,
      toolchain: z.string(),
      compilerFlags: z.string(),
      libraries: z.array(publishedLibrarySchema).min(1),
      emulator: publishedLibrarySchema,
      mcuAssumed: z.literal('atmega328p'),
      boardIdentity: z.literal('UNKNOWN'),
      statement: z.string(),
    })
    .strict(),
  rv1: z.literal('ACCEPT_WITH_RESTRICTIONS'),
  evidence: z.record(
    z.string(),
    z.object({
      kind: z.enum(unoEvidenceKinds),
      date: z.string(),
      source: z.string(),
      action: z.string(),
      observed: z.string(),
      supports: z.array(z.string()),
      establishes: z.array(z.enum(ofFields)),
    }),
  ),
  board: z
    .object({
      mcu: z.literal('atmega328p'),
      clockHz: z.literal(16_000_000),
      adcMax: z.literal(1023),
      pwmMax: z.literal(255),
      flashBytes: z.literal(32_256),
      ramBytes: z.literal(2048),
      pwmPins: z.array(z.object({ pin: z.string(), timer: z.enum(['T0', 'T1', 'T2']), mode: z.enum(['fast', 'phase-correct']), frequencyHz: z.number().positive() }).strict()).length(6),
      reserved: z.array(z.object({ pin: z.string(), when: z.literal('serial') }).strict()),
      timerClaims: z.object({ servo: z.enum(['T1', 'T2']), tone: z.enum(['T1', 'T2']) }).strict(),
      nonPwmThreshold: z.literal(128),
    })
    .strict(),
  numeric: z
    .object({
      model: z.literal('cxx-int32'),
      min: z.literal(-2_147_483_648),
      max: z.literal(2_147_483_647),
      overflow: z.literal('wrap'),
      division: z.literal('truncate-toward-zero'),
      remainder: z.literal('sign-of-dividend'),
      int32MinDividedByMinusOne: z.literal(-2_147_483_648),
      remainderByMinusOne: z.literal(0),
      divisionByZero: z.object({ quotient: z.literal(0), remainder: z.literal(0), warning: z.literal('division-by-zero') }).strict(),
      boolPrints: z.object({ true: z.literal('1'), false: z.literal('0') }).strict(),
      literalSuffix: z.literal('L'),
      int32MinLiteral: z.literal('(-2147483647L - 1L)'),
      float: z.literal('excluded'),
    })
    .strict(),
  constants: z.object(Object.fromEntries(
    Object.entries({
      LOOP_MIN_US: 50, NODE_US: 1, SERIAL_BAUD: 9600, SERIAL_FRAME_US: 1040, SERIAL_TX_QUEUE_BYTES: 64, PULSEIN_TIMEOUT_US: 30_000,
      ULTRASONIC_US_PER_CM: 58, ULTRASONIC_MIN_CM: 2, ULTRASONIC_MAX_CM: 400, ULTRASONIC_NO_ECHO_CM: 400, MAX_WAIT_MS: 60_000,
      COUNT_UP_MAX_END: 2_147_483_646, MOTOR_SPEED_MAX: 100, SERVO_ANGLE_MAX: 180, SERVO_START_ANGLE: 90, TONE_MIN_HZ: 31, TONE_MAX_HZ: 4000,
      TONE_MIN_MS: 1, TONE_MAX_MS: 60_000, PWM_MAX: 255, RAM_SOLUTION_MAX_PERCENT: 75, RAM_WARN_ABOVE_BYTES: 1536,
    }).map(([key, value]) => [key, z.literal(value)]),
  )).strict(),
  costsUs: z.object(Object.fromEntries(arduinoCalls.map((call) => [call, z.number().positive()]))).strict(),
  costsEvidence: z.array(z.string()).min(1),
  toneUs: z
    .object({
      bands: z.array(z.object({ prescaler: z.number().int().positive(), fromHz: z.number().positive(), silentUs: z.number().positive(), playingUs: z.number().positive() }).strict()).min(1),
      evidence: z.array(z.string()).min(1),
    })
    .strict(),
  isrLoad: z.object({ timer0: z.number().positive(), perServo: z.number().positive(), tonePerHz: z.number().positive(), charged: z.literal(false) }).strict(),
  millis: z.object({ overflowUs: z.literal(1024), fractPerOverflow: z.literal(3), fractMax: z.literal(125), evidence: z.array(z.string()).min(1) }).strict(),
  helpers: z.record(z.string(), z.object({ text: z.string().min(1), usedBy: z.array(z.string()).min(1) }).strict()),
  diagnostics: z.array(z.object({ id: z.string(), severity: z.enum(['error', 'warning']), when: z.string().min(1) }).strict()),
  modules: z.array(unoModuleSchema),
  constructs: z.array(unoConstructSchema),
});
