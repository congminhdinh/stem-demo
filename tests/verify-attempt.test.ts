import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ProjectDocument } from '../src/core/circuit/document';
import { localDeviceDefinitions } from '../src/core/devices/local-catalog';
import { createDeviceRegistry } from '../src/core/devices/registry';
import { productionKits } from '../src/core/hardware';
import { checkRobot } from '../src/core/scenario/check-robot';
import { ROBOT_ENGINE, type RobotCheckResult } from '../src/core/scenario/check-result';
import type { Scenario } from '../src/core/scenario/scenario';
import {
  ATTEMPT_LIMITS,
  attemptDiffs,
  createVerifyEnvironment,
  describeReports,
  expectedEngine,
  labAttemptSchema,
  printable,
  verifyAttemptInput,
  verifyAttemptText,
  verifyExitCode,
  type VerifyEnvironment,
} from '../src/core/scenario/verify-attempt';
import { initPhysics } from '../src/core/world/rapier';
import { ROBOT_ENGINE_VERSION } from '../src/core/world/snapshot';
import { scenarioCatalog } from '../src/samples/robot-scenarios';
import { robotSolutions } from '../src/samples/robot-solutions';
import { robotStarterDocument } from '../src/samples/robot-templates';

// N18 R8a: the verifier of a stored robot lab attempt (src/core/scenario/verify-attempt.ts, scripts/verify-attempt.mjs). The honest attempt
// is what STEMLearning stores of a real check: the reference solution of rb-mini-mission checked headless (three variants, five goals, a
// score below 100, so a raised one is still a score), written as the API's camelCase LabAttemptDto plus the project document of the
// entity's ProjectJson. Every other case changes one field of it.

const key = 'rb-mini-mission';
const registry = createDeviceRegistry(localDeviceDefinitions);
const env: VerifyEnvironment = createVerifyEnvironment({ scenarios: scenarioCatalog, kits: productionKits, registry });
const project = (): ProjectDocument => ({ ...robotStarterDocument(key), program: { blocks: structuredClone(robotSolutions[key].reference) } });

let checked: RobotCheckResult;
beforeAll(async () => {
  await initPhysics();
  const scenario = scenarioCatalog.get(key)!;
  const { kit, board } = env.kitOf(scenario);
  checked = (await checkRobot(project(), scenario, { mode: 'headless', kit, board, registry }).result)!;
}, 120_000);

type Attempt = Record<string, unknown>;

/** The attempt STEMLearning returns for the honest check (LabAttemptDto, camelCase), with its stored project. */
function honest(changes: Attempt = {}): Attempt {
  return {
    id: 41,
    lessonId: 7,
    activityId: 12,
    labKind: 2,
    templateKey: key,
    templateVersion: checked.scenarioVersion,
    engine: checked.engine,
    passed: checked.passed,
    passing: checked.passed,
    score: checked.score,
    maxScore: checked.maxScore,
    simTimeMs: checked.simTimeMs,
    goals: checked.goals.map((goal) => ({ ...goal })),
    variants: checked.variants.map((variant) => ({ ...variant })),
    programHash: checked.programHash,
    hasProject: true,
    createdAt: '2026-10-25T08:00:00Z',
    projectJson: JSON.stringify(project()),
    ...changes,
  };
}

const verifyOne = async (attempt: unknown, environment = env) => {
  const outcome = await verifyAttemptInput(attempt, environment);
  expect(outcome.many).toBe(false);
  return outcome.reports[0]!;
};

describe('the honest attempt (the check of the reference solution of rb-mini-mission)', () => {
  it('is what the check gives: it passes its three variants, robot-engine@1, scenario version 1', () => {
    expect(expectedEngine).toBe(`robot-engine@${ROBOT_ENGINE_VERSION}`);
    expect(expectedEngine).toBe(ROBOT_ENGINE);
    expect(checked).toMatchObject({ passed: true, maxScore: 100, engine: 'robot-engine@1', scenarioVersion: 1 });
    expect(checked.variants.map((variant) => variant.seed)).toEqual([3225, 3226, 3227]);
    expect(checked.goals).toHaveLength(5);
    expect(checked.score).toBeLessThan(100);
    expect(checked.programHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('matches: the re-run gives the same passed, score, simTimeMs, goals, variants and programHash', async () => {
    const report = await verifyOne(honest());
    expect(report).toEqual({ index: 0, id: 41, templateKey: key, status: 'match' });
    expect(verifyExitCode([report])).toBe(0);
  }, 120_000);
});

describe('a mismatch names each field that differs, with the attempt value and the re-run value', () => {
  it('a raised score', async () => {
    const report = await verifyOne(honest({ score: checked.score + 1 }));
    expect(report).toEqual({ index: 0, id: 41, templateKey: key, status: 'mismatch', diffs: [{ field: 'score', attempt: checked.score + 1, rerun: checked.score }] });
    expect(verifyExitCode([report])).toBe(1);
  }, 120_000);

  it('a flipped variant passed', async () => {
    const variants = checked.variants.map((variant, index) => (index === 1 ? { ...variant, passed: !variant.passed } : variant));
    const report = await verifyOne(honest({ variants }));
    expect(report.status).toBe('mismatch');
    expect(report.diffs).toEqual([{ field: 'variants[1].passed', attempt: false, rerun: true }]);
  }, 120_000);

  it('a programHash that is not the hash of the project’s IR', async () => {
    const report = await verifyOne(honest({ programHash: 'ab'.repeat(32) }));
    expect(report.status).toBe('mismatch');
    expect(report.diffs).toEqual([{ field: 'programHash', attempt: 'ab'.repeat(32), rerun: checked.programHash }]);
  }, 120_000);

  it('a goal reported passed that did not pass, and a time that is not the re-run’s', async () => {
    const goals = checked.goals.map((goal, index) => (index === 0 ? { ...goal, passed: !goal.passed } : goal));
    const report = await verifyOne(honest({ goals, simTimeMs: checked.simTimeMs + 8 }));
    expect(report.diffs).toEqual([
      { field: 'simTimeMs', attempt: checked.simTimeMs + 8, rerun: checked.simTimeMs },
      { field: `goals[${checked.goals[0]!.id}].passed`, attempt: !checked.goals[0]!.passed, rerun: checked.goals[0]!.passed },
    ]);
  }, 120_000);

  it('reads the hash as the LMS stores it (lowercase): an uppercase hash of the same program matches', async () => {
    expect((await verifyOne(honest({ programHash: checked.programHash.toUpperCase() }))).status).toBe('match');
  }, 120_000);

  it('the goals in another order: a mismatch of goals, with both lists of ids', async () => {
    const reversed = [...checked.goals].reverse();
    const report = await verifyOne(honest({ goals: reversed }));
    expect(report.status).toBe('mismatch');
    expect(report.diffs).toEqual([{ field: 'goals', attempt: reversed.map((goal) => goal.id), rerun: checked.goals.map((goal) => goal.id) }]);
  }, 120_000);

  it('a goal left out, added or put in another’s place: a mismatch of goals (attemptDiffs, on the honest re-run)', () => {
    const ids = checked.goals.map((goal) => goal.id);
    const diffsOf = (goals: unknown[]) => attemptDiffs(labAttemptSchema.parse(honest({ goals })), checked);
    expect(diffsOf(checked.goals.slice(0, 4))).toEqual([{ field: 'goals', attempt: ids.slice(0, 4), rerun: ids }]);
    expect(diffsOf([...checked.goals, { id: 'extra', label: 'Extra', passed: true }])).toEqual([{ field: 'goals', attempt: [...ids, 'extra'], rerun: ids }]);
    expect(diffsOf([{ ...checked.goals[0]!, id: 'other' }, ...checked.goals.slice(1)])).toEqual([{ field: 'goals', attempt: ['other', ...ids.slice(1)], rerun: ids }]);
    expect(diffsOf(checked.goals.map((goal) => ({ ...goal })))).toEqual([]);
  });
});

describe('an attempt this build cannot verify (exit 2), each with its reason', () => {
  const unverifiable = async (attempt: unknown, environment = env) => {
    const report = await verifyOne(attempt, environment);
    expect(report.status).toBe('unverifiable');
    expect(verifyExitCode([report])).toBe(2);
    return report;
  };

  it('a changed seed: seed-mismatch (the seeds are the scenario’s, variantOffsets; another one is a tamper signal)', async () => {
    const report = await unverifiable(honest({ variants: checked.variants.map((variant, index) => (index === 2 ? { ...variant, seed: 3228 } : variant)) }));
    expect(report).toMatchObject({ reason: 'seed-mismatch', detail: 'the attempt’s variant seeds [3225, 3226, 3228] are not the scenario’s [3225, 3226, 3227]' });
  });

  it('a variant left out or added: seed-mismatch', async () => {
    expect(await unverifiable(honest({ variants: [] }))).toMatchObject({ reason: 'seed-mismatch' });
    expect(await unverifiable(honest({ variants: null }))).toMatchObject({ reason: 'seed-mismatch' });
    expect(await unverifiable(honest({ variants: checked.variants.slice(0, 2) }))).toMatchObject({ reason: 'seed-mismatch' });
    expect(await unverifiable(honest({ variants: [...checked.variants, { ...checked.variants[0]!, seed: 3228 }] }))).toMatchObject({ reason: 'seed-mismatch' });
  });

  it('an old version of the scenario: scenario-version (this build has version 2 of it)', async () => {
    const newer: VerifyEnvironment = { ...env, scenario: (name) => (name === key ? ({ ...scenarioCatalog.get(key)!, version: 2 } as Scenario) : env.scenario(name)) };
    const report = await unverifiable(honest(), newer);
    expect(report).toMatchObject({ reason: 'scenario-version', detail: 'the attempt is of version 1 of rb-mini-mission, this build has version 2' });
  });

  it('another engine: engine', async () => {
    expect(await unverifiable(honest({ engine: 'robot-engine@0' }))).toMatchObject({ reason: 'engine', detail: 'the attempt ran on robot-engine@0, this build is robot-engine@1' });
  });

  it('a key this build does not have, or the sandbox (no score): unknown-key', async () => {
    expect(await unverifiable(honest({ templateKey: 'rb-unknown' }))).toMatchObject({ reason: 'unknown-key' });
    expect(await unverifiable(honest({ templateKey: 'rb-sandbox' }))).toMatchObject({ reason: 'unknown-key' });
  });

  it('no project, in the attempt or in an earlier one with its hash: no-project', async () => {
    expect(await unverifiable(honest({ projectJson: null, hasProject: false }))).toMatchObject({ reason: 'no-project' });
    expect(await unverifiable(honest({ projectJson: '   ' }))).toMatchObject({ reason: 'no-project' });
  });

  it('a project that fails its schema or does not compile: project-invalid', async () => {
    expect(await unverifiable(honest({ projectJson: '{"schemaVersion":2}' }))).toMatchObject({ reason: 'project-invalid' });
    expect(await unverifiable(honest({ projectJson: '[1, 2]' }))).toMatchObject({ reason: 'project-invalid' });
    expect(await unverifiable(honest({ projectJson: '{ not json' }))).toMatchObject({ reason: 'project-invalid' });
    const unknownBlock = { ...project(), program: { blocks: { languageVersion: 0, blocks: [{ type: 'no_such_block', id: 'x', x: 0, y: 0 }] } } };
    const report = await unverifiable(honest({ projectJson: JSON.stringify(unknownBlock) }));
    expect(report).toMatchObject({ reason: 'project-invalid' });
    expect(report.detail).toMatch(/^the project does not compile \(layer|^the project does not compile \(compile/);
  }, 120_000);
});

describe('the input is untrusted: Zod first, the LMS limits, never eval (invalid-attempt, exit 2)', () => {
  const invalid = async (attempt: unknown) => {
    const report = await verifyOne(attempt);
    expect(report).toMatchObject({ status: 'unverifiable', reason: 'invalid-attempt' });
    expect(verifyExitCode([report])).toBe(2);
    return report;
  };

  it('an oversized project: more than 262 144 UTF-8 bytes', async () => {
    expect(ATTEMPT_LIMITS.projectMaxBytes).toBe(262_144);
    const report = await invalid(honest({ projectJson: `{"pad":"${'x'.repeat(262_144)}"}` }));
    expect(report.problems).toEqual(['projectJson: must be at most 262144 UTF-8 bytes']);
    // Bytes, not characters: 87 382 "ạ" are 262 146 bytes.
    await invalid(honest({ projectJson: 'ạ'.repeat(87_382) }));
  });

  it('more than 10 variants, more than 20 goals, no goal', async () => {
    const variant = checked.variants[0]!;
    expect((await invalid(honest({ variants: Array.from({ length: 11 }, () => variant) }))).problems).toEqual(['variants: at most 10']);
    const goal = { id: 'g', label: 'g', passed: true };
    expect((await invalid(honest({ goals: Array.from({ length: 21 }, (_, index) => ({ ...goal, id: `g${index}` })) }))).problems).toEqual(['goals: at most 20']);
    expect((await invalid(honest({ goals: [] }))).problems).toEqual(['goals: at least 1']);
  });

  it('a number that is not finite (JSON 1e999 is Infinity), a score above 100, a fraction of a millisecond', async () => {
    expect((await invalid(JSON.parse(JSON.stringify(honest()).replace(/"score":[^,]+,/, '"score":1e999,')))).problems).toEqual(['score: must be a finite number from 0 to 100']);
    await invalid(honest({ score: 100.5 }));
    await invalid(honest({ simTimeMs: 0.5 }));
    await invalid(honest({ variants: [{ ...checked.variants[0]!, seed: Number.NaN }, ...checked.variants.slice(1)] }));
  });

  it('not an attempt: a missing field, another lab kind, no object, an empty or too long list', async () => {
    const noHash = honest();
    delete noHash.programHash;
    expect((await invalid(noHash)).problems).toEqual(['programHash: must be 1 to 64 hexadecimal digits']);
    await invalid(honest({ labKind: 0 }));
    await invalid(honest({ maxScore: 50 }));
    await invalid('a string');
    await invalid(null);
    const empty = await verifyAttemptInput([], env);
    expect(empty.reports).toEqual([{ index: 0, status: 'unverifiable', reason: 'invalid-attempt', detail: 'the input is not an attempt: an empty list', problems: ['(input): an empty list'] }]);
    const many = await verifyAttemptInput(Array.from({ length: ATTEMPT_LIMITS.maxAttempts + 1 }, () => ({})), env);
    expect(many.reports).toHaveLength(1);
    expect(many.reports[0]).toMatchObject({ reason: 'invalid-attempt', problems: ['(input): at most 500 attempts'] });
  });

  it('keeps none of the input’s other fields, and reads a key like __proto__ as data', async () => {
    const report = await verifyOne(JSON.parse(JSON.stringify(honest({ score: 200 })).replace('{', '{"__proto__":{"polluted":true},')));
    expect(report.reason).toBe('invalid-attempt');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('goals as LabAttemptRules has them: distinct ids, no control character in an id or a label, trimmed', async () => {
    // The honest goals and a forged copy of each, which the LMS refuses (and a find by id would never compare).
    const forged = checked.goals.map((goal) => ({ ...goal, passed: !goal.passed, label: 'forged' }));
    const duplicated = await invalid(honest({ goals: [...checked.goals, ...forged] }));
    expect(duplicated.problems).toEqual(checked.goals.map((goal, index) => `goals[${index + 5}].id: must be distinct: "${goal.id}" is listed before`));
    expect((await invalid(honest({ goals: [{ ...checked.goals[0]!, label: 'two\nlines' }, ...checked.goals.slice(1)] }))).problems).toEqual([
      'goals[0].label: must be 1 to 200 characters without control characters',
    ]);
    await invalid(honest({ goals: [{ ...checked.goals[0]!, id: `${checked.goals[0]!.id}\u0085` }, ...checked.goals.slice(1)] }));
    await invalid(honest({ goals: [{ ...checked.goals[0]!, id: '   ' }, ...checked.goals.slice(1)] }));
    expect(labAttemptSchema.parse(honest({ goals: [{ ...checked.goals[0]!, id: ` ${checked.goals[0]!.id} ` }, ...checked.goals.slice(1)] })).goals[0]!.id).toBe(checked.goals[0]!.id);
  });

  it('a list far over its limit is refused at once, by its length, with one problem (100 000 goals, 100 000 variants)', async () => {
    const goal = { id: 'g', label: 'g', passed: true };
    const started = performance.now();
    const goals = await invalid(honest({ goals: Array.from({ length: 100_000 }, () => ({})) }));
    const variants = await invalid(honest({ variants: Array.from({ length: 100_000 }, () => goal) }));
    const elapsedMs = performance.now() - started;
    expect(goals.problems).toEqual(['goals: at most 20']);
    expect(variants.problems).toEqual(['variants: at most 10']);
    expect(elapsedMs).toBeLessThan(1000);
  });

  it('reports at most 20 problems of an attempt, then how many more', async () => {
    const report = await invalid(honest({ goals: Array.from({ length: 20 }, () => ({ id: 1, label: 2, passed: 3 })) }));
    expect(ATTEMPT_LIMITS.maxProblems).toBe(20);
    expect(report.problems).toHaveLength(21);
    expect(report.problems!.slice(0, 3)).toEqual([
      'goals[0].id: must be 1 to 50 characters without control characters',
      'goals[0].label: must be 1 to 200 characters without control characters',
      'goals[0].passed: must be true or false',
    ]);
    expect(report.problems![20]).toBe('… and 40 more');
  });

  it('reads a text of at most 32 MiB of UTF-8, as JSON, before anything else (verifyAttemptText, what a server takes)', async () => {
    expect(ATTEMPT_LIMITS.inputMaxBytes).toBe(33_554_432);
    const started = performance.now();
    const long = await verifyAttemptText(' '.repeat(ATTEMPT_LIMITS.inputMaxBytes + 1), env);
    expect(performance.now() - started).toBeLessThan(1000);
    expect(long.reports).toEqual([
      { index: 0, status: 'unverifiable', reason: 'invalid-attempt', detail: 'the input is not an attempt: longer than 33554432 UTF-8 bytes', problems: ['(input): longer than 33554432 UTF-8 bytes'] },
    ]);
    // A JSON string of 11 184 810 "ạ" is 11 184 812 UTF-16 units and exactly 33 554 432 bytes: read. One "ạ" more is 3 bytes too many.
    expect((await verifyAttemptText(`"${'ạ'.repeat(11_184_810)}"`, env)).reports[0]!.detail).toBe('the attempt fails the schema or the LMS limits');
    expect((await verifyAttemptText(`"${'ạ'.repeat(11_184_811)}"`, env)).reports[0]!.detail).toBe('the input is not an attempt: longer than 33554432 UTF-8 bytes');
    expect((await verifyAttemptText('{ not json', env)).reports[0]).toMatchObject({ reason: 'invalid-attempt', detail: expect.stringMatching(/^the input is not an attempt: not JSON \(/) });
    expect((await verifyAttemptText(JSON.stringify(honest({ engine: 'robot-engine@0' })), env)).reports[0]).toMatchObject({ status: 'unverifiable', reason: 'engine' });
  });
});

describe('an export of a learner’s attempts, oldest first', () => {
  it('an attempt without its project takes the project of the latest earlier attempt with its programHash (and key)', async () => {
    // A project with the honest hash that is not the honest program (its first number is one more): taking it would not match.
    const other = JSON.stringify(project()).replace(/"NUM":(-?\d+)/, (_, value: string) => `"NUM":${Number(value) + 1}`);
    expect(other).not.toBe(JSON.stringify(project()));
    const outcome = await verifyAttemptInput(
      [
        honest({ id: 1, projectJson: other }),
        honest({ id: 2 }),
        honest({ id: 3, programHash: 'cd'.repeat(32) }),
        honest({ id: 4, projectJson: null, hasProject: false }),
      ],
      env,
    );
    expect(outcome.many).toBe(true);
    expect(outcome.reports.map((report) => [report.id, report.status, report.projectFrom])).toEqual([
      [1, 'mismatch', undefined],
      [2, 'match', undefined],
      [3, 'mismatch', undefined],
      [4, 'match', 1],
    ]);
    expect(outcome.reports[0]!.diffs?.[0]).toMatchObject({ field: 'programHash', attempt: checked.programHash });
    expect(verifyExitCode(outcome.reports)).toBe(1);
  }, 240_000);

  it('never takes a project from a later attempt, nor from an attempt that is not valid', async () => {
    const outcome = await verifyAttemptInput([honest({ id: 1, projectJson: null }), honest({ id: 2, score: -1 }), honest({ id: 3, projectJson: null }), honest({ id: 4 })], env);
    expect(outcome.reports.map((report) => [report.index, report.id ?? null, report.status, report.reason])).toEqual([
      [0, 1, 'unverifiable', 'no-project'],
      [1, null, 'unverifiable', 'invalid-attempt'],
      [2, 3, 'unverifiable', 'no-project'],
      [3, 4, 'match', undefined],
    ]);
    // A mismatch outranks an attempt that cannot be verified; only every attempt matching is exit 0.
    expect(verifyExitCode(outcome.reports)).toBe(2);
    expect(verifyExitCode([...outcome.reports, { index: 4, status: 'mismatch', diffs: [] }])).toBe(1);
    expect(verifyExitCode([outcome.reports[3]!])).toBe(0);
  }, 120_000);

  it('says each report in a line, and each differing field under it', async () => {
    const outcome = await verifyAttemptInput([honest({ id: 5, score: checked.score + 1 }), honest({ id: 6, engine: 'robot-engine@0' })], env);
    expect(describeReports(outcome.reports)).toEqual([
      `attempt 1 (id 5, ${key}): MISMATCH`,
      `  score: attempt ${checked.score + 1}, re-run ${checked.score}`,
      `attempt 2 (id 6, ${key}): UNVERIFIABLE engine: the attempt ran on robot-engine@0, this build is robot-engine@1`,
    ]);
  }, 120_000);

  it('a forged attempt that borrows an honest project (its own left out, its score raised) is a mismatch, and names the project it re-ran', async () => {
    const outcome = await verifyAttemptInput([honest({ id: 1 }), honest({ id: 2, projectJson: null, hasProject: false, score: checked.score + 1 })], env);
    expect(outcome.reports).toEqual([
      { index: 0, id: 1, templateKey: key, status: 'match' },
      { index: 1, id: 2, templateKey: key, status: 'mismatch', diffs: [{ field: 'score', attempt: checked.score + 1, rerun: checked.score }], projectFrom: 0 },
    ]);
  }, 120_000);

  it('a fault of this build while one attempt is verified is its rerun-failed: the others are still verified', async () => {
    const faulty: VerifyEnvironment = {
      ...env,
      scenario: (name) => {
        if (name === 'rb-boom') throw new Error('the catalog broke');
        return env.scenario(name);
      },
    };
    const outcome = await verifyAttemptInput([honest({ id: 1, templateKey: 'rb-boom' }), honest({ id: 2, engine: 'robot-engine@0' })], faulty);
    expect(outcome.reports.map((report) => [report.id, report.status, report.reason, report.detail])).toEqual([
      [1, 'unverifiable', 'rerun-failed', 'this build failed to verify it: the catalog broke'],
      [2, 'unverifiable', 'engine', 'the attempt ran on robot-engine@0, this build is robot-engine@1'],
    ]);
  });

  it('writes text of the input with its control characters escaped: a key cannot start a line or drive a terminal', async () => {
    const injected = 'x\nattempt 9 (id 41, rb-mini-mission): match\u001b[2J';
    const lines = describeReports((await verifyAttemptInput(honest({ templateKey: injected }), env)).reports);
    expect(lines).toEqual([
      'attempt 1 (id 41, x\\nattempt 9 (id 41, rb-mini-mission): match\\u001b[2J): UNVERIFIABLE unknown-key: this build has no scenario "x\\nattempt 9 (id 41, rb-mini-mission): match\\u001b[2J"',
    ]);
    expect(lines.join('').split('').some((char) => char.charCodeAt(0) < 0x20)).toBe(false);
    expect(printable('a\tb\rc\u007fd\u0085e\u202ef\u2028g’…')).toBe('a\\tb\\rc\\u007fd\\u0085e\\u202ef\\u2028g’…');
  });
});

describe('scripts/verify-attempt.mjs (pnpm verify:attempt), as its own Node process', () => {
  const root = join(import.meta.dirname, '..');
  const script = join(root, 'scripts', 'verify-attempt.mjs');
  let work: string;
  beforeAll(() => {
    work = mkdtempSync(join(tmpdir(), 'verify-attempt-'));
  });
  afterAll(() => {
    rmSync(work, { recursive: true, force: true });
  });
  const run = (...args: string[]) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', cwd: root });

  it('re-runs the honest attempt of a temp file on Node (the -compat Rapier) and exits 0; a raised score exits 1; bad input exits 2', () => {
    const file = join(work, 'attempts.json');
    writeFileSync(file, JSON.stringify([honest(), honest({ id: 42, score: checked.score + 1 })]));
    const both = run(file, '--json');
    expect(both.status, both.stderr).toBe(1);
    expect(JSON.parse(both.stdout)).toEqual([
      { index: 0, id: 41, templateKey: key, status: 'match' },
      { index: 1, id: 42, templateKey: key, status: 'mismatch', diffs: [{ field: 'score', attempt: checked.score + 1, rerun: checked.score }] },
    ]);

    writeFileSync(file, JSON.stringify(honest()));
    const one = run(file);
    expect(one.status, one.stderr).toBe(0);
    expect(one.stdout).toBe(`attempt 1 (id 41, ${key}): match\n`);

    writeFileSync(file, '{ not json');
    const bad = run(file, '--json');
    expect(bad.status).toBe(2);
    expect(JSON.parse(bad.stdout)).toMatchObject({ status: 'unverifiable', reason: 'invalid-attempt' });

    expect(run().status).toBe(2);
    expect(run(join(work, 'missing.json')).status).toBe(2);
  }, 180_000);
});
