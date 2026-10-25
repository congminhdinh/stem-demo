import { z } from 'zod';
import { robotKitVersion } from '../../samples/robot-keys';
import { projectDocumentSchema, type ProjectDocument } from '../circuit/document';
import type { DeviceRegistry } from '../devices/registry';
import type { BoardProfile } from '../hardware/board';
import type { KitCatalog } from '../hardware/catalog';
import type { Kit } from '../hardware/kit';
import type { ProfileCatalog } from '../profiles/profile';
import type { BlockPackCatalog } from '../program/block-packs';
import { ROBOT_ENGINE_VERSION } from '../world/snapshot';
import { checkRobot, RobotCheckError } from './check-robot';
import { ROBOT_CHECK_LIMITS, type RobotCheckResult } from './check-result';
import { GOAL_ID_MAX_CHARS, GOAL_LABEL_MAX_CHARS, GOALS_MAX, scenarioMaxScore, VARIANTS_MAX, type Scenario } from './scenario';
import { variantOffsets } from './variants';

// The verifier of a stored robot lab attempt (N18 R8a, robot plan §R8): a `LabAttempt` as STEMLearning stores and returns it is re-run
// headless with the real check (`checkRobot`, the one the lab runs) on the project it stored, and what the attempt says is compared with
// what the re-run gives. A check is deterministic (plan §3: the same ticks headless, at 1× and at 4×, on every engine), so the re-run of an
// honest attempt gives exactly its result. scripts/verify-attempt.mjs runs this on Node; it is the base of a later server-side verifier.
//
//   match         every field the re-run gives is the attempt's: passed, score (exactly), simTimeMs, the goals (their ids in the order of the
//                 result, then each one's passed), each variant's seed, passed, score and simTimeMs, and programHash (the hash of the project's
//                 IR, `hashProgramIr`; the LMS stores it in lowercase, so it is compared so). Goal labels are not compared (the lab's language).
//   mismatch      a field differs: each one is told with the attempt's value and the re-run's.
//   unverifiable  this build cannot say, for one `reason`: invalid-attempt (the input fails the schema or the LMS limits), unknown-key (no
//                 scored scenario of the key), scenario-version (another version of the scenario than this build's), engine (another
//                 engine than robot-engine@ROBOT_ENGINE_VERSION), seed-mismatch (the variants' seeds are not the scenario's, `variantOffsets`:
//                 a check never reports other seeds, so another one is a tamper signal), no-project (neither the attempt nor an earlier one
//                 with its hash has a project), project-invalid (the project is not JSON, fails the document schema or does not compile),
//                 rerun-failed (the re-run could not build its world or scorer, or anything else of this build failed while this attempt was
//                 verified: a fault of this build, not of the attempt, and the other attempts are still verified).
//
// A match proves that the program in the stored project earns that result in this scenario. It does not prove who wrote the program.
//
// The input is untrusted (an export a teacher or admin hands in): it is read with Zod before anything else, with the LMS's own rules
// (LabAttemptRules: a project of at most 262 144 UTF-8 bytes, at most 10 variants, 1 to 20 goals with distinct ids, goal ids and labels
// without control characters, finite numbers), and only the fields named here are kept. A list's length is checked before its elements, the
// text of an input is at most ATTEMPT_LIMITS.inputMaxBytes (`verifyAttemptText`), and an attempt reports at most ATTEMPT_LIMITS.maxProblems
// problems, so a hostile input costs little. Nothing of it is ever evaluated: the project is JSON.parse'd and validated like any document.
// What the LMS checks across fields (passed is every goal and every variant) is left to the comparison: a re-run says more than a refusal.
// An input is one attempt, or a list of a learner's attempts oldest first (the LMS keeps a project only when the program changed: an
// attempt without one takes the project of the latest earlier attempt with the same programHash and key). The text `describeReports`
// writes shows a control character of the input escaped (`\n`, `\u001b`), never as itself.
//
// Framework-free: the caller builds the environment (createVerifyEnvironment) and loads the physics first (`initPhysics`, with the -compat
// build on Node: scripts/verify-attempt.mjs).

/** The LMS's limits on what an attempt carries (STEMLearning LabAttemptRules). */
export const ATTEMPT_LIMITS = {
  /** LabAttemptRules.ProjectMaxBytes: the project document as text, in UTF-8 bytes. */
  projectMaxBytes: 262_144,
  /** LabAttemptRules.MaxVariants, the scenario schema's VARIANTS_MAX. */
  maxVariants: VARIANTS_MAX,
  /** LabAttemptRules.MaxGoals, the scenario schema's GOALS_MAX. */
  maxGoals: GOALS_MAX,
  /** LabAttemptRules.MaxAttemptsPerActivity: the most attempts of one activity, so of one export. */
  maxAttempts: 500,
  /** LabAttemptRules.TemplateKeyMaxLength. */
  templateKeyMaxLength: 50,
  /** The most UTF-8 bytes of an input's text (`verifyAttemptText`): 500 attempts, of which at most 20 keep a project (MaxStoredProjects). */
  inputMaxBytes: 32 * 1024 * 1024,
  /** The most problems an invalid attempt reports; then one more line says how many were left out. */
  maxProblems: 20,
} as const;

/** The engine an attempt must name: this build's. */
export const expectedEngine = `robot-engine@${ROBOT_ENGINE_VERSION}`;

export type UnverifiableReason =
  | 'invalid-attempt'
  | 'unknown-key'
  | 'scenario-version'
  | 'engine'
  | 'seed-mismatch'
  | 'no-project'
  | 'project-invalid'
  | 'rerun-failed';

/** A field of the attempt that is not what the re-run gives: `score`, `variants[1].passed`, `goals[reach].passed`. */
export type AttemptDiff = { readonly field: string; readonly attempt: unknown; readonly rerun: unknown };

/** What the verifier says of one attempt of the input (`index`: its place in the input, from 0). */
export type AttemptReport = {
  readonly index: number;
  /** The LMS's id of the attempt, and its key, when the attempt is valid and has them. */
  readonly id?: number;
  readonly templateKey?: string;
  readonly status: 'match' | 'mismatch' | 'unverifiable';
  readonly reason?: UnverifiableReason;
  /** Why it is unverifiable, in words. */
  readonly detail?: string;
  /** invalid-attempt: each problem of the input, `path: what is wrong`. */
  readonly problems?: readonly string[];
  /** mismatch: each field that differs, in the order of the result. */
  readonly diffs?: readonly AttemptDiff[];
  /** The index of the earlier attempt whose project was re-run, when the attempt has none of its own. */
  readonly projectFrom?: number;
};

/** What the verifier needs of this build: the scenarios, the kit each runs on, and the catalogs a project is compiled with. */
export type VerifyEnvironment = {
  /** The scenario of a key, or undefined when this build has none. */
  scenario(key: string): Scenario | undefined;
  /** The kit and board a scenario runs on, as the lab runs it. */
  kitOf(scenario: Scenario): { kit: Kit; board: BoardProfile };
  registry: DeviceRegistry;
  profiles?: ProfileCatalog;
  packs?: BlockPackCatalog;
};

/**
 * The environment of this build: the scenarios of `scenarios` (the shipped catalog), each on its kit `scenario.kit@kitVersion` of `kits`
 * (the version a robot lab launches with, robot-keys.ts). Throws when a scenario's kit is not in the catalog: a build that cannot run its own
 * scenario is broken, not the attempt.
 */
export function createVerifyEnvironment(options: {
  scenarios: { get(key: string): Scenario | undefined };
  kits: KitCatalog;
  registry: DeviceRegistry;
  kitVersion?: string;
  profiles?: ProfileCatalog;
  packs?: BlockPackCatalog;
}): VerifyEnvironment {
  const { scenarios, kits, registry, kitVersion = robotKitVersion } = options;
  return {
    scenario: (key) => scenarios.get(key),
    kitOf(scenario) {
      const ref = { id: scenario.kit, version: kitVersion };
      const kit = kits.get(ref);
      const board = kits.boardOf(ref);
      if (kit === undefined || board === undefined) {
        throw new Error(`Scenario "${scenario.key}" runs on the kit ${ref.id}@${ref.version}, which this build does not have.`);
      }
      return { kit, board };
    },
    registry,
    ...(options.profiles === undefined ? {} : { profiles: options.profiles }),
    ...(options.packs === undefined ? {} : { packs: options.packs }),
  };
}

// --- the input ----------------------------------------------------------------------------------------------------------------------

const SCORE_MAX = ROBOT_CHECK_LIMITS.maxScore;
const SIM_TIME_MAX = ROBOT_CHECK_LIMITS.simTimeMsMax;

/** The UTF-8 length of a text, in bytes, without encoding it. */
function utf8Bytes(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    if (unit < 0x80) bytes += 1;
    else if (unit < 0x800) bytes += 2;
    else if (unit >= 0xd800 && unit <= 0xdbff && i + 1 < text.length && (text.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
      bytes += 4;
      i++;
    } else bytes += 3;
  }
  return bytes;
}

const message = (text: string) => ({ error: text });

/** A control character as .NET's char.IsControl has it (Unicode Cc: U+0000…U+001F, U+007F…U+009F): LabAttemptRules.IsGoalText refuses it. */
const isControl = (unit: number) => unit <= 0x1f || (unit >= 0x7f && unit <= 0x9f);
const hasControl = (text: string) => {
  for (let i = 0; i < text.length; i++) if (isControl(text.charCodeAt(i))) return true;
  return false;
};

/** A goal's id or label as LabAttemptRules reads it: trimmed, then 1 to `max` characters (UTF-16 units, as .NET counts), no control character. */
const goalText = (max: number) => {
  const length = `must be 1 to ${max} characters without control characters`;
  return z.string(message(length)).trim().min(1, length).max(max, length).refine((text) => !hasControl(text), length);
};

/**
 * A list of at most `max` elements, at least `min`: its length is checked before any element is (a list of a million elements is refused at
 * once, with one problem), then each element with `element`.
 */
const boundedList = <T extends z.ZodType>(element: T, bounds: { min?: number; max: number; error: string }) => {
  const list = z.array(z.unknown(), message(bounds.error)).max(bounds.max, `at most ${bounds.max}`);
  return (bounds.min === undefined ? list : list.min(bounds.min, `at least ${bounds.min}`)).pipe(z.array(element));
};
const scoreSchema = z.number(message(`must be a finite number from 0 to ${SCORE_MAX}`)).min(0, `must be a finite number from 0 to ${SCORE_MAX}`).max(SCORE_MAX, `must be a finite number from 0 to ${SCORE_MAX}`);
const simTimeSchema = z.int(message(`must be a whole number of ms from 0 to ${SIM_TIME_MAX}`)).min(0, `must be a whole number of ms from 0 to ${SIM_TIME_MAX}`).max(SIM_TIME_MAX, `must be a whole number of ms from 0 to ${SIM_TIME_MAX}`);
const flag = z.boolean(message('must be true or false'));

const goalSchema = z.object({ id: goalText(GOAL_ID_MAX_CHARS), label: goalText(GOAL_LABEL_MAX_CHARS), passed: flag }, message('must be an object'));

/** The goals: 1 to 20, with distinct ids (LabAttemptRules.Canonical, ordinal comparison). */
const goalsSchema = boundedList(goalSchema, { min: 1, max: GOALS_MAX, error: 'must be a list' }).superRefine((goals, ctx) => {
  const seen = new Set<string>();
  goals.forEach((goal, index) => {
    if (seen.has(goal.id)) ctx.addIssue({ code: 'custom', path: [index, 'id'], message: `must be distinct: "${goal.id}" is listed before` });
    seen.add(goal.id);
  });
});

const variantSchema = z.object({ seed: z.int(message('must be a safe integer')), passed: flag, score: scoreSchema, simTimeMs: simTimeSchema }, message('must be an object'));

/** One attempt: the API's camelCase LabAttemptDto of a robot lab, with `projectJson` (the entity's ProjectJson, which the DTO leaves out). */
export const labAttemptSchema = z.object(
  {
    id: z.int(message('must be a safe integer')).optional(),
    /** LabKind.Robot, serialized by its value. */
    labKind: z.literal(2, message('must be 2 (a robot lab)')).optional(),
    templateKey: z
      .string(message(`must be 1 to ${ATTEMPT_LIMITS.templateKeyMaxLength} characters`))
      .min(1, `must be 1 to ${ATTEMPT_LIMITS.templateKeyMaxLength} characters`)
      .max(ATTEMPT_LIMITS.templateKeyMaxLength, `must be 1 to ${ATTEMPT_LIMITS.templateKeyMaxLength} characters`),
    templateVersion: z
      .int(message(`must be a whole number from ${ROBOT_CHECK_LIMITS.scenarioVersionMin} to ${ROBOT_CHECK_LIMITS.scenarioVersionMax}`))
      .min(ROBOT_CHECK_LIMITS.scenarioVersionMin, `must be a whole number from ${ROBOT_CHECK_LIMITS.scenarioVersionMin} to ${ROBOT_CHECK_LIMITS.scenarioVersionMax}`)
      .max(ROBOT_CHECK_LIMITS.scenarioVersionMax, `must be a whole number from ${ROBOT_CHECK_LIMITS.scenarioVersionMin} to ${ROBOT_CHECK_LIMITS.scenarioVersionMax}`),
    engine: z.string(message('must be 1 to 50 characters of A-Z a-z 0-9 . _ @ -')).regex(ROBOT_CHECK_LIMITS.engine, 'must be 1 to 50 characters of A-Z a-z 0-9 . _ @ -'),
    passed: flag,
    score: scoreSchema,
    maxScore: z.literal(SCORE_MAX, message(`must be ${SCORE_MAX}`)),
    simTimeMs: simTimeSchema,
    goals: goalsSchema,
    /** Null when the attempt has none (VariantsJson null); a robot check always has some. */
    variants: boundedList(variantSchema, { max: ATTEMPT_LIMITS.maxVariants, error: 'must be a list or null' }).nullish(),
    programHash: z.string(message('must be 1 to 64 hexadecimal digits')).regex(ROBOT_CHECK_LIMITS.programHash, 'must be 1 to 64 hexadecimal digits'),
    /** The project document as the LMS stored it (text); null or absent when it kept none for this attempt. */
    projectJson: z
      .string(message('must be a text or null'))
      .refine((text) => utf8Bytes(text) <= ATTEMPT_LIMITS.projectMaxBytes, `must be at most ${ATTEMPT_LIMITS.projectMaxBytes} UTF-8 bytes`)
      .nullish(),
  },
  message('must be an object'),
);

export type LabAttemptInput = z.output<typeof labAttemptSchema>;

/** The problems of a failed parse, `path: what is wrong`: at most ATTEMPT_LIMITS.maxProblems, then a line that says how many more. */
function problemsOf(error: z.ZodError): string[] {
  const shownIssues = error.issues.slice(0, ATTEMPT_LIMITS.maxProblems);
  const problems = shownIssues.map(
    (issue) => `${issue.path.length === 0 ? '(attempt)' : issue.path.map((part) => (typeof part === 'number' ? `[${part}]` : `.${String(part)}`)).join('').replace(/^\./, '')}: ${issue.message}`,
  );
  const left = error.issues.length - shownIssues.length;
  return left > 0 ? [...problems, `… and ${left} more`] : problems;
}

type Entry = { ok: true; attempt: LabAttemptInput } | { ok: false; problems: string[] };

/** The entries of the input, each validated on its own; or why the input as a whole is not one. */
function entriesOf(input: unknown): { many: boolean; entries: Entry[] } | { problem: string } {
  const read = (value: unknown): Entry => {
    const parsed = labAttemptSchema.safeParse(value);
    return parsed.success ? { ok: true, attempt: parsed.data } : { ok: false, problems: problemsOf(parsed.error) };
  };
  if (Array.isArray(input)) {
    if (input.length === 0) return { problem: 'an empty list' };
    if (input.length > ATTEMPT_LIMITS.maxAttempts) return { problem: `at most ${ATTEMPT_LIMITS.maxAttempts} attempts` };
    return { many: true, entries: input.map(read) };
  }
  return { many: false, entries: [read(input)] };
}

// --- the verdicts -------------------------------------------------------------------------------------------------------------------

const lower = (hash: string) => hash.toLowerCase();
const hasText = (text: string | null | undefined): text is string => typeof text === 'string' && text.trim() !== '';

/** Each field of `attempt` that is not what `rerun` gives (see the top of this file), in the order of the result. */
export function attemptDiffs(attempt: LabAttemptInput, rerun: RobotCheckResult): AttemptDiff[] {
  const diffs: AttemptDiff[] = [];
  const compare = (field: string, claimed: unknown, actual: unknown) => {
    if (claimed !== actual) diffs.push({ field, attempt: claimed, rerun: actual });
  };
  // The LMS stores the hash in lowercase (LabAttemptRules.Canonical); the check writes it so.
  if (lower(attempt.programHash) !== lower(rerun.programHash)) {
    diffs.push({ field: 'programHash', attempt: attempt.programHash, rerun: rerun.programHash });
  }
  compare('passed', attempt.passed, rerun.passed);
  compare('score', attempt.score, rerun.score);
  compare('simTimeMs', attempt.simTimeMs, rerun.simTimeMs);
  // The goals are the result's, in its order (the scenario's): a missing, extra or reordered goal is a mismatch of `goals` itself.
  const claimedIds = attempt.goals.map((goal) => goal.id);
  const ids = rerun.goals.map((goal) => goal.id);
  if (claimedIds.length !== ids.length || claimedIds.some((id, index) => id !== ids[index])) {
    diffs.push({ field: 'goals', attempt: claimedIds, rerun: ids });
  } else {
    rerun.goals.forEach((goal, index) => compare(`goals[${goal.id}].passed`, attempt.goals[index]!.passed, goal.passed));
  }
  const variants = attempt.variants ?? [];
  rerun.variants.forEach((variant, index) => {
    const claimed = variants[index];
    for (const field of ['seed', 'passed', 'score', 'simTimeMs'] as const) {
      compare(`variants[${index}].${field}`, claimed === undefined ? null : claimed[field], variant[field]);
    }
  });
  return diffs;
}

type Verdict = Pick<AttemptReport, 'status' | 'reason' | 'detail' | 'diffs'>;

const unverifiable = (reason: UnverifiableReason, detail: string): Verdict => ({ status: 'unverifiable', reason, detail });
const listed = (seeds: readonly number[]) => `[${seeds.join(', ')}]`;

/** What can be said of an attempt before anything runs: the scenario, its version, the engine, the seeds. Null when it may be re-run. */
function precheck(attempt: LabAttemptInput, env: VerifyEnvironment): { scenario: Scenario } | Verdict {
  const scenario = env.scenario(attempt.templateKey);
  if (scenario === undefined) {
    return unverifiable('unknown-key', `this build has no scenario "${attempt.templateKey}"`);
  }
  if (scenarioMaxScore(scenario) === undefined) {
    return unverifiable('unknown-key', `"${attempt.templateKey}" has no score: its labs report no check to verify`);
  }
  if (attempt.templateVersion !== scenario.version) {
    return unverifiable('scenario-version', `the attempt is of version ${attempt.templateVersion} of ${scenario.key}, this build has version ${scenario.version}`);
  }
  if (attempt.engine !== expectedEngine) {
    return unverifiable('engine', `the attempt ran on ${attempt.engine}, this build is ${expectedEngine}`);
  }
  const seeds = Array.from({ length: scenario.variants.count }, (_, index) => variantOffsets(scenario, index).seed);
  const claimed = (attempt.variants ?? []).map((variant) => variant.seed);
  if (claimed.length !== seeds.length || claimed.some((seed, index) => seed !== seeds[index])) {
    return unverifiable('seed-mismatch', `the attempt’s variant seeds ${listed(claimed)} are not the scenario’s ${listed(seeds)}`);
  }
  return { scenario };
}

/** The project document of a stored text: parsed as JSON (never evaluated) and validated; or why it is not one. */
function projectOf(text: string): { project: ProjectDocument } | { problem: string } {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { problem: 'the project is not JSON' };
  }
  const parsed = projectDocumentSchema.safeParse(json);
  if (!parsed.success) {
    return { problem: `the project is not a project document (${problemsOf(parsed.error).slice(0, 3).join('; ')})` };
  }
  return { project: parsed.data };
}

/** Re-runs `project` in `scenario` headless with the real check, and compares. */
async function rerun(attempt: LabAttemptInput, scenario: Scenario, projectText: string, env: VerifyEnvironment): Promise<Verdict> {
  const read = projectOf(projectText);
  if ('problem' in read) {
    return unverifiable('project-invalid', read.problem);
  }
  const { kit, board } = env.kitOf(scenario);
  let result: RobotCheckResult | null;
  try {
    result = await checkRobot(read.project, scenario, {
      mode: 'headless',
      kit,
      board,
      registry: env.registry,
      ...(env.profiles === undefined ? {} : { profiles: env.profiles }),
      ...(env.packs === undefined ? {} : { packs: env.packs }),
    }).result;
  } catch (error) {
    if (!(error instanceof RobotCheckError)) throw error;
    const said = error.diagnostics.map((diagnostic) => diagnostic.message).slice(0, 3).join('; ') || 'no diagnostic';
    return error.reason === 'layer' || error.reason === 'compile'
      ? unverifiable('project-invalid', `the project does not compile (${error.reason}): ${said}`)
      : unverifiable('rerun-failed', `the re-run could not be made (${error.reason}): ${said}`);
  }
  if (result === null) {
    // Only a cancel gives null, and nothing cancels this check.
    throw new Error('The re-run of the check was cancelled.');
  }
  const diffs = attemptDiffs(attempt, result);
  return diffs.length === 0 ? { status: 'match' } : { status: 'mismatch', diffs };
}

export type VerifyOutcome = { many: boolean; reports: AttemptReport[] };

/** The one report of an input that is no attempt at all: not JSON, too long, not an object nor a list, an empty or too long list. */
export function invalidInputOutcome(problem: string): VerifyOutcome {
  return {
    many: false,
    reports: [{ index: 0, status: 'unverifiable', reason: 'invalid-attempt', detail: `the input is not an attempt: ${problem}`, problems: [`(input): ${problem}`] }],
  };
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** The verdict of one valid attempt of the input; `entries` are the input's, for an earlier attempt's project. */
async function verdictOf(index: number, attempt: LabAttemptInput, entries: readonly Entry[], env: VerifyEnvironment): Promise<Verdict & Pick<AttemptReport, 'projectFrom'>> {
  const checked = precheck(attempt, env);
  if ('status' in checked) {
    return checked;
  }
  // Its own project, or the latest earlier valid attempt's with the same key and hash.
  let projectFrom: number | undefined;
  let projectText = hasText(attempt.projectJson) ? attempt.projectJson : undefined;
  for (let earlier = index - 1; projectText === undefined && earlier >= 0; earlier--) {
    const candidate = entries[earlier]!;
    if (
      candidate.ok &&
      candidate.attempt.templateKey === attempt.templateKey &&
      lower(candidate.attempt.programHash) === lower(attempt.programHash) &&
      hasText(candidate.attempt.projectJson)
    ) {
      projectText = candidate.attempt.projectJson;
      projectFrom = earlier;
    }
  }
  if (projectText === undefined) {
    return unverifiable('no-project', 'neither the attempt nor an earlier one with its programHash has a project');
  }
  const verdict = await rerun(attempt, checked.scenario, projectText, env);
  return { ...verdict, ...(projectFrom === undefined ? {} : { projectFrom }) };
}

/**
 * Verifies an input: one attempt, or a list of a learner's attempts oldest first (see the top of this file). `many` says which it was, so
 * that a caller can answer in the same shape. One report per attempt, in input order; an input that is no attempt at all (not an object
 * nor a list, an empty list, more than ATTEMPT_LIMITS.maxAttempts) is one invalid-attempt report. A fault of this build while one attempt is
 * verified is that attempt's rerun-failed: the others are still verified, and this never rejects.
 */
export async function verifyAttemptInput(input: unknown, env: VerifyEnvironment): Promise<VerifyOutcome> {
  const read = entriesOf(input);
  if ('problem' in read) {
    return invalidInputOutcome(read.problem);
  }
  const reports: AttemptReport[] = [];
  for (const [index, entry] of read.entries.entries()) {
    if (!entry.ok) {
      reports.push({ index, status: 'unverifiable', reason: 'invalid-attempt', detail: 'the attempt fails the schema or the LMS limits', problems: entry.problems });
      continue;
    }
    const { attempt } = entry;
    const named = { index, ...(attempt.id === undefined ? {} : { id: attempt.id }), templateKey: attempt.templateKey };
    let verdict: Verdict & Pick<AttemptReport, 'projectFrom'>;
    try {
      verdict = await verdictOf(index, attempt, read.entries, env);
    } catch (error) {
      verdict = unverifiable('rerun-failed', `this build failed to verify it: ${messageOf(error)}`);
    }
    reports.push({ ...named, ...verdict });
  }
  return { many: read.many, reports };
}

/**
 * Verifies the text of an input (a file, a request body): at most ATTEMPT_LIMITS.inputMaxBytes of UTF-8, JSON (parsed, never evaluated), then
 * as `verifyAttemptInput`. A server takes this one, so that a body too long is refused before it is parsed.
 */
export async function verifyAttemptText(text: string, env: VerifyEnvironment): Promise<VerifyOutcome> {
  // Every UTF-16 unit is at least one byte: a text longer in units is longer in bytes, and is not counted.
  if (text.length > ATTEMPT_LIMITS.inputMaxBytes || utf8Bytes(text) > ATTEMPT_LIMITS.inputMaxBytes) {
    return invalidInputOutcome(`longer than ${ATTEMPT_LIMITS.inputMaxBytes} UTF-8 bytes`);
  }
  let input: unknown;
  try {
    input = JSON.parse(text);
  } catch (error) {
    return invalidInputOutcome(`not JSON (${messageOf(error)})`);
  }
  return verifyAttemptInput(input, env);
}

/** The exit code of a verification: 1 when any attempt mismatches, else 2 when any cannot be verified, else 0 (every attempt matches). */
export function verifyExitCode(reports: readonly Pick<AttemptReport, 'status'>[]): 0 | 1 | 2 {
  if (reports.some((report) => report.status === 'mismatch')) return 1;
  if (reports.length === 0 || reports.some((report) => report.status === 'unverifiable')) return 2;
  return 0;
}

const shown = (value: unknown) => (typeof value === 'string' ? value : JSON.stringify(value));

/** Bidirectional and line separator controls (U+200E, U+200F, U+2028…U+202E, U+2066…U+2069), which reorder or break a terminal's line. */
const isLayoutControl = (unit: number) => unit === 0x200e || unit === 0x200f || (unit >= 0x2028 && unit <= 0x202e) || (unit >= 0x2066 && unit <= 0x2069);
const escapes: Readonly<Record<number, string>> = { 0x09: '\\t', 0x0a: '\\n', 0x0d: '\\r' };

/** A line of text with each control character escaped (`\n`, `\u001b`): text of the input can neither start a line nor drive a terminal. */
export function printable(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    out += isControl(unit) || isLayoutControl(unit) ? (escapes[unit] ?? `\\u${unit.toString(16).padStart(4, '0')}`) : text[i];
  }
  return out;
}

/**
 * The reports as text lines: one per attempt (numbered from 1), and each differing field or problem under it. Every line goes through
 * `printable`: the key, the detail and the problems hold text of the input.
 */
export function describeReports(reports: readonly AttemptReport[]): string[] {
  return reports.flatMap((report) => describeReport(report)).map(printable);
}

function describeReport(report: AttemptReport): string[] {
  const what = [report.id === undefined ? undefined : `id ${report.id}`, report.templateKey].filter((part) => part !== undefined).join(', ');
  const head = `attempt ${report.index + 1}${what === '' ? '' : ` (${what})`}`;
  const from = report.projectFrom === undefined ? '' : ` (the project of attempt ${report.projectFrom + 1})`;
  switch (report.status) {
    case 'match':
      return [`${head}: match${from}`];
    case 'mismatch':
      return [`${head}: MISMATCH${from}`, ...(report.diffs ?? []).map((diff) => `  ${diff.field}: attempt ${shown(diff.attempt)}, re-run ${shown(diff.rerun)}`)];
    case 'unverifiable':
      return [`${head}: UNVERIFIABLE ${report.reason ?? ''}: ${report.detail ?? ''}`, ...(report.problems ?? []).map((problem) => `  ${problem}`)];
  }
}
