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
//   match         every field the re-run gives is the attempt's: passed, score (exactly), simTimeMs, each goal's passed (by id), each variant's
//                 seed, passed, score and simTimeMs, and programHash (the hash of the project's IR, `hashProgramIr`; the LMS stores it in
//                 lowercase, so it is compared so).
//   mismatch      a field differs: each one is told with the attempt's value and the re-run's.
//   unverifiable  this build cannot say, for one `reason`: invalid-attempt (the input fails the schema or the LMS limits), unknown-key (no
//                 scored scenario of the key), scenario-version (another version of the scenario than this build's), engine (another
//                 engine than robot-engine@ROBOT_ENGINE_VERSION), seed-mismatch (the variants' seeds are not the scenario's, `variantOffsets`:
//                 a check never reports other seeds, so another one is a tamper signal), no-project (neither the attempt nor an earlier one
//                 with its hash has a project), project-invalid (the project is not JSON, fails the document schema or does not compile),
//                 rerun-failed (the re-run could not build its world or scorer: a fault of this build, not of the attempt).
//
// A match proves that the program in the stored project earns that result in this scenario. It does not prove who wrote the program.
//
// The input is untrusted (an export a teacher or admin hands in): it is read with Zod before anything else, with the LMS's own limits
// (LabAttemptRules: a project of at most 262 144 UTF-8 bytes, at most 10 variants and 20 goals, finite numbers), and only the fields named
// here are kept. Nothing of it is ever evaluated: the project is JSON.parse'd and validated like any document. An input is one attempt, or a
// list of a learner's attempts oldest first (the LMS keeps a project only when the program changed: an attempt without one takes the
// project of the latest earlier attempt with the same programHash and key).
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
const scoreSchema = z.number(message(`must be a finite number from 0 to ${SCORE_MAX}`)).min(0, `must be a finite number from 0 to ${SCORE_MAX}`).max(SCORE_MAX, `must be a finite number from 0 to ${SCORE_MAX}`);
const simTimeSchema = z.int(message(`must be a whole number of ms from 0 to ${SIM_TIME_MAX}`)).min(0, `must be a whole number of ms from 0 to ${SIM_TIME_MAX}`).max(SIM_TIME_MAX, `must be a whole number of ms from 0 to ${SIM_TIME_MAX}`);
const flag = z.boolean(message('must be true or false'));

const goalSchema = z.object(
  {
    id: z.string(message(`must be 1 to ${GOAL_ID_MAX_CHARS} characters`)).min(1, `must be 1 to ${GOAL_ID_MAX_CHARS} characters`).max(GOAL_ID_MAX_CHARS, `must be 1 to ${GOAL_ID_MAX_CHARS} characters`),
    label: z.string(message(`must be 1 to ${GOAL_LABEL_MAX_CHARS} characters`)).min(1, `must be 1 to ${GOAL_LABEL_MAX_CHARS} characters`).max(GOAL_LABEL_MAX_CHARS, `must be 1 to ${GOAL_LABEL_MAX_CHARS} characters`),
    passed: flag,
  },
  message('must be an object'),
);

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
    goals: z
      .array(goalSchema, message('must be a list'))
      .min(1, 'at least 1')
      .max(ATTEMPT_LIMITS.maxGoals, `at most ${ATTEMPT_LIMITS.maxGoals}`),
    /** Null when the attempt has none (VariantsJson null); a robot check always has some. */
    variants: z.array(variantSchema, message('must be a list or null')).max(ATTEMPT_LIMITS.maxVariants, `at most ${ATTEMPT_LIMITS.maxVariants}`).nullish(),
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

const problemsOf = (error: z.ZodError): string[] =>
  error.issues.map((issue) => `${issue.path.length === 0 ? '(attempt)' : issue.path.map((part) => (typeof part === 'number' ? `[${part}]` : `.${String(part)}`)).join('').replace(/^\./, '')}: ${issue.message}`);

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
  for (const goal of rerun.goals) {
    const claimed = attempt.goals.find((candidate) => candidate.id === goal.id);
    compare(`goals[${goal.id}].passed`, claimed === undefined ? null : claimed.passed, goal.passed);
  }
  for (const goal of attempt.goals) {
    if (!rerun.goals.some((candidate) => candidate.id === goal.id)) compare(`goals[${goal.id}].passed`, goal.passed, null);
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

/**
 * Verifies an input: one attempt, or a list of a learner's attempts oldest first (see the top of this file). `many` says which it was, so
 * that a caller can answer in the same shape. One report per attempt, in input order; an input that is no attempt at all (not an object
 * nor a list, an empty list, more than ATTEMPT_LIMITS.maxAttempts) is one invalid-attempt report. Rejects only on a fault of this build.
 */
export async function verifyAttemptInput(input: unknown, env: VerifyEnvironment): Promise<{ many: boolean; reports: AttemptReport[] }> {
  const read = entriesOf(input);
  if ('problem' in read) {
    return {
      many: false,
      reports: [{ index: 0, status: 'unverifiable', reason: 'invalid-attempt', detail: `the input is not an attempt: ${read.problem}`, problems: [`(input): ${read.problem}`] }],
    };
  }
  const reports: AttemptReport[] = [];
  for (const [index, entry] of read.entries.entries()) {
    if (!entry.ok) {
      reports.push({ index, status: 'unverifiable', reason: 'invalid-attempt', detail: 'the attempt fails the schema or the LMS limits', problems: entry.problems });
      continue;
    }
    const { attempt } = entry;
    const named = { index, ...(attempt.id === undefined ? {} : { id: attempt.id }), templateKey: attempt.templateKey };
    const checked = precheck(attempt, env);
    if ('status' in checked) {
      reports.push({ ...named, ...checked });
      continue;
    }
    // Its own project, or the latest earlier valid attempt's with the same key and hash.
    let projectFrom: number | undefined;
    let projectText = hasText(attempt.projectJson) ? attempt.projectJson : undefined;
    for (let earlier = index - 1; projectText === undefined && earlier >= 0; earlier--) {
      const candidate = read.entries[earlier]!;
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
      reports.push({ ...named, ...unverifiable('no-project', 'neither the attempt nor an earlier one with its programHash has a project') });
      continue;
    }
    const verdict = await rerun(attempt, checked.scenario, projectText, env);
    reports.push({ ...named, ...verdict, ...(projectFrom === undefined ? {} : { projectFrom }) });
  }
  return { many: read.many, reports };
}

/** The exit code of a verification: 1 when any attempt mismatches, else 2 when any cannot be verified, else 0 (every attempt matches). */
export function verifyExitCode(reports: readonly Pick<AttemptReport, 'status'>[]): 0 | 1 | 2 {
  if (reports.some((report) => report.status === 'mismatch')) return 1;
  if (reports.length === 0 || reports.some((report) => report.status === 'unverifiable')) return 2;
  return 0;
}

const shown = (value: unknown) => (typeof value === 'string' ? value : JSON.stringify(value));

/** The reports as text lines: one per attempt (numbered from 1), and each differing field or problem under it. */
export function describeReports(reports: readonly AttemptReport[]): string[] {
  return reports.flatMap((report) => {
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
  });
}
