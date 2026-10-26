import { describe, expect, it } from 'vitest';
import {
  ROBOT_CHECK_LIMITS,
  ROBOT_ENGINE,
  robotCheckResultProblems,
  robotReadyProblems,
  type RobotCheckResult,
} from './check-result';
import { SCENARIO_MAX_SCORE, VARIANTS_MAX } from './scenario-schema';
import { ROBOT_ENGINE_VERSION } from '../world/snapshot';

// The result of a robot check as the lab reports it to the host (N18 R7.1, robot plan §4.6 and §4.7): the type R6.2 produces, and the
// bounds the host's parser holds it to (the shared fixture, docs/fixtures/stem-lab-v1-robot.json). A result outside them is a bug of
// the lab, found here and not as a message the host drops.

const result = (): RobotCheckResult => ({
  passed: false,
  goals: [
    { id: 'stop-in-zone', label: 'Dừng trong vùng đích', passed: true },
    { id: 'avoid-wall', label: 'Không chạm tường', passed: false },
  ],
  score: 41.25,
  maxScore: 100,
  simTimeMs: 9800.5,
  variants: [
    { seed: 7, passed: true, score: 80, simTimeMs: 12100 },
    { seed: 1031, passed: false, score: 22, simTimeMs: 7600.25 },
    { seed: 52817, passed: false, score: 21.75, simTimeMs: 9700 },
  ],
  engine: ROBOT_ENGINE,
  scenarioVersion: 1,
  programHash: '3A7BD3E2360A3D29EEA436FCFB7E44C735D117C42D1C1835420B6B9942DD4F1B',
});

/** A copy of the valid result with `change` applied; the result is typed loosely so a test can break any field. */
function broken(change: (copy: Record<string, unknown>) => void): RobotCheckResult {
  const copy = structuredClone(result()) as unknown as Record<string, unknown>;
  change(copy);
  return copy as unknown as RobotCheckResult;
}

describe('the robot check result (N18 R7.1)', () => {
  it('names the engine of the 3D robot lab, and the top score and variant count the scenario schema holds to', () => {
    expect(ROBOT_ENGINE).toBe('robot-engine@1');
    expect(ROBOT_CHECK_LIMITS.maxScore).toBe(SCENARIO_MAX_SCORE);
    expect(ROBOT_CHECK_LIMITS.maxVariants).toBe(VARIANTS_MAX);
  });

  it('names the engine version the world has: one source, though the leaf imports nothing (N18 final fix M6)', () => {
    // verify:attempt expects robot-engine@ROBOT_ENGINE_VERSION; a check that named another engine would be unverifiable.
    expect(ROBOT_ENGINE).toBe(`robot-engine@${ROBOT_ENGINE_VERSION}`);
  });

  it('has no problem when it is complete and within the bounds of the host', () => {
    expect(robotCheckResultProblems(result())).toEqual([]);
  });

  it('accepts the bounds themselves: the lowest, the highest, and no variants', () => {
    const lowest = broken((copy) => {
      copy.score = 0;
      copy.simTimeMs = 0;
      copy.variants = [{ seed: 0, passed: false, score: 0, simTimeMs: 0 }];
      copy.programHash = '0';
      copy.goals = [{ id: 'a', label: 'a', passed: false }];
    });
    expect(robotCheckResultProblems(lowest)).toEqual([]);
    const highest = broken((copy) => {
      copy.passed = true;
      copy.goals = Array.from({ length: ROBOT_CHECK_LIMITS.maxGoals }, (_, index) => ({ id: `g${index}`.padEnd(200, 'x'), label: 'x'.repeat(200), passed: true }));
      copy.score = 100;
      copy.simTimeMs = 3_600_000;
      copy.variants = Array.from({ length: ROBOT_CHECK_LIMITS.maxVariants }, (_, index) => ({ seed: index === 9 ? Number.MAX_SAFE_INTEGER : -index, passed: true, score: 100, simTimeMs: 3_600_000 }));
      copy.scenarioVersion = 2_147_483_647;
      copy.programHash = 'f'.repeat(64);
      copy.engine = 'e'.repeat(50);
    });
    expect(robotCheckResultProblems(highest)).toEqual([]);
    expect(robotCheckResultProblems(broken((copy) => { copy.passed = false; copy.goals = [{ id: 'a', label: 'a', passed: false }]; copy.variants = []; }))).toEqual([]);
  });

  it.each([
    ['score', 'score'],
    ['maxScore', 'maxScore'],
    ['simTimeMs', 'simTimeMs'],
    ['variants', 'variants'],
    ['engine', 'engine'],
    ['scenarioVersion', 'scenarioVersion'],
    ['programHash', 'programHash'],
    ['passed', 'passed'],
    ['goals', 'goals'],
  ])('finds a result without %s incomplete: a scored check-result carries it', (field, path) => {
    expect(robotCheckResultProblems(broken((copy) => void delete copy[field])).join('; ')).toContain(`${path}:`);
  });

  it.each<[string, (copy: Record<string, unknown>) => void, string]>([
    ['a null optional field is not an absent one', (copy) => void (copy.programHash = null), 'programHash: must be'],
    ['passed as text', (copy) => void (copy.passed = 'false'), 'passed: must be true or false'],
    ['a NaN score', (copy) => void (copy.score = NaN), 'score: must be a finite number from 0 to 100'],
    ['an infinite score', (copy) => void (copy.score = Infinity), 'score: must be a finite number from 0 to 100'],
    ['a negative score', (copy) => void (copy.score = -0.01), 'score: must be a finite number from 0 to 100'],
    ['a score above maxScore', (copy) => void (copy.score = 100.01), 'score: must be a finite number from 0 to 100'],
    ['a score as text', (copy) => void (copy.score = '41.25'), 'score: must be a finite number from 0 to 100'],
    ['a maxScore of 90', (copy) => void (copy.maxScore = 90), 'maxScore: must be 100'],
    ['a maxScore of 150', (copy) => void (copy.maxScore = 150), 'maxScore: must be 100'],
    ['an infinite maxScore', (copy) => void (copy.maxScore = Infinity), 'maxScore: must be 100'],
    ['a negative simTimeMs', (copy) => void (copy.simTimeMs = -1), 'simTimeMs: must be a finite number from 0 to 3600000'],
    ['a simTimeMs over an hour', (copy) => void (copy.simTimeMs = 3_600_001), 'simTimeMs: must be a finite number from 0 to 3600000'],
    ['an infinite simTimeMs', (copy) => void (copy.simTimeMs = Infinity), 'simTimeMs: must be a finite number from 0 to 3600000'],
    ['variants that are not a list', (copy) => void (copy.variants = { length: 1 }), 'variants: must be a list'],
    ['more than 10 variants', (copy) => void (copy.variants = Array.from({ length: 11 }, () => ({ seed: 1, passed: false, score: 0, simTimeMs: 0 }))), 'variants: at most 10'],
    ['a null variant', (copy) => void ((copy.variants as unknown[])[1] = null), 'variants[1]: must be an object'],
    ['a fractional seed', (copy) => void (((copy.variants as Record<string, unknown>[])[0] as Record<string, unknown>).seed = 1.5), 'variants[0].seed: must be a safe integer'],
    ['a seed beyond the safe integers', (copy) => void (((copy.variants as Record<string, unknown>[])[0] as Record<string, unknown>).seed = 2 ** 53), 'variants[0].seed: must be a safe integer'],
    ['an infinite seed', (copy) => void (((copy.variants as Record<string, unknown>[])[0] as Record<string, unknown>).seed = Infinity), 'variants[0].seed: must be a safe integer'],
    ['a variant verdict as text', (copy) => void (((copy.variants as Record<string, unknown>[])[2] as Record<string, unknown>).passed = 'no'), 'variants[2].passed: must be true or false'],
    ['a variant score above maxScore', (copy) => void (((copy.variants as Record<string, unknown>[])[1] as Record<string, unknown>).score = 101), 'variants[1].score: must be a finite number from 0 to 100'],
    ['a NaN variant score', (copy) => void (((copy.variants as Record<string, unknown>[])[1] as Record<string, unknown>).score = NaN), 'variants[1].score: must be a finite number from 0 to 100'],
    ['a negative variant simTimeMs', (copy) => void (((copy.variants as Record<string, unknown>[])[2] as Record<string, unknown>).simTimeMs = -Infinity), 'variants[2].simTimeMs: must be a finite number from 0 to 3600000'],
    ['an empty engine', (copy) => void (copy.engine = ''), 'engine: must be 1 to 50 characters'],
    ['an engine of 51 characters', (copy) => void (copy.engine = 'e'.repeat(51)), 'engine: must be 1 to 50 characters'],
    ['a space in the engine', (copy) => void (copy.engine = 'robot engine@1'), 'engine: must be 1 to 50 characters'],
    ['an engine that is a number', (copy) => void (copy.engine = 1), 'engine: must be 1 to 50 characters'],
    ['scenarioVersion 0', (copy) => void (copy.scenarioVersion = 0), 'scenarioVersion: must be a whole number from 1 to 2147483647'],
    ['a fractional scenarioVersion', (copy) => void (copy.scenarioVersion = 1.5), 'scenarioVersion: must be a whole number from 1 to 2147483647'],
    ['scenarioVersion beyond 32 bits', (copy) => void (copy.scenarioVersion = 2_147_483_648), 'scenarioVersion: must be a whole number from 1 to 2147483647'],
    ['scenarioVersion as text', (copy) => void (copy.scenarioVersion = '1'), 'scenarioVersion: must be a whole number from 1 to 2147483647'],
    ['an empty programHash', (copy) => void (copy.programHash = ''), 'programHash: must be 1 to 64 hexadecimal digits'],
    ['a programHash of 65 digits', (copy) => void (copy.programHash = 'a'.repeat(65)), 'programHash: must be 1 to 64 hexadecimal digits'],
    ['a programHash that is not hexadecimal', (copy) => void (copy.programHash = 'xyz'), 'programHash: must be 1 to 64 hexadecimal digits'],
    ['a prefixed programHash', (copy) => void (copy.programHash = '0x9f86'), 'programHash: must be 1 to 64 hexadecimal digits'],
    ['no goals: a result with a score lists the goals it scores', (copy) => void (copy.goals = []), 'goals: at least one'],
    ['goals that are not a list', (copy) => void (copy.goals = 'all'), 'goals: must be a list'],
    ['more than 50 goals', (copy) => void (copy.goals = Array.from({ length: 51 }, (_, index) => ({ id: `g${index}`, label: 'g', passed: false }))), 'goals: at most 50'],
    ['a goal without an id', (copy) => void (((copy.goals as Record<string, unknown>[])[0] as Record<string, unknown>).id = ''), 'goals[0].id: must be 1 to 200 characters'],
    ['a goal id of 201 characters', (copy) => void (((copy.goals as Record<string, unknown>[])[0] as Record<string, unknown>).id = 'a'.repeat(201)), 'goals[0].id: must be 1 to 200 characters'],
    ['a goal without a label', (copy) => void delete ((copy.goals as Record<string, unknown>[])[1] as Record<string, unknown>).label, 'goals[1].label: must be 1 to 200 characters'],
    ['a goal label of 201 characters', (copy) => void (((copy.goals as Record<string, unknown>[])[1] as Record<string, unknown>).label = 'ế'.repeat(201)), 'goals[1].label: must be 1 to 200 characters'],
    ['a goal result without passed', (copy) => void delete ((copy.goals as Record<string, unknown>[])[0] as Record<string, unknown>).passed, 'goals[0].passed: must be true or false'],
    ['a goal that is null', (copy) => void ((copy.goals as unknown[])[0] = null), 'goals[0]: must be an object'],
  ])('refuses %s', (_, change, problem) => {
    expect(robotCheckResultProblems(broken(change)).join('\n')).toContain(problem);
  });

  it('refuses a verdict that says passed while a goal did not pass, and one that says failed while every goal did', () => {
    expect(robotCheckResultProblems(broken((copy) => void (copy.passed = true))).join('\n')).toContain('passed: is true but goal "avoid-wall" did not pass');
    const allGoals = broken((copy) => {
      copy.goals = [{ id: 'a', label: 'a', passed: true }];
      copy.variants = [];
    });
    expect(robotCheckResultProblems(allGoals).join('\n')).toContain('passed: is false but every goal passed');
  });

  it('refuses a verdict that the variants contradict: passed means every variant passed', () => {
    const lie = broken((copy) => {
      copy.passed = true;
      copy.goals = [{ id: 'a', label: 'a', passed: true }];
    });
    expect(robotCheckResultProblems(lie).join('\n')).toContain('passed: is true but variant 1 (seed 1031) did not pass');
    const failedWithPassingVariants = broken((copy) => {
      copy.goals = [{ id: 'a', label: 'a', passed: true }];
      copy.variants = [{ seed: 1, passed: true, score: 100, simTimeMs: 1 }];
      copy.score = 100;
    });
    expect(robotCheckResultProblems(failedWithPassingVariants).join('\n')).toContain('passed: is false but every variant passed');
  });

  it('says every problem at once, in the order of the message', () => {
    const problems = robotCheckResultProblems(broken((copy) => {
      copy.programHash = '';
      copy.score = -1;
      copy.engine = '';
    }));
    expect(problems.map((problem) => problem.split(':')[0])).toEqual(['score', 'engine', 'programHash']);
  });
});

describe('the robot fields of ready (N18 R7.1)', () => {
  it('accepts a scenario version of 1 to 2147483647 and the top score of 100, each optional', () => {
    expect(robotReadyProblems({})).toEqual([]);
    expect(robotReadyProblems({ scenarioVersion: 1, maxScore: 100 })).toEqual([]);
    expect(robotReadyProblems({ scenarioVersion: 2_147_483_647 })).toEqual([]);
  });

  it.each([
    [{ scenarioVersion: 0 }, 'scenarioVersion: must be a whole number from 1 to 2147483647'],
    [{ scenarioVersion: 1.5 }, 'scenarioVersion: must be a whole number from 1 to 2147483647'],
    [{ scenarioVersion: '1' }, 'scenarioVersion: must be a whole number from 1 to 2147483647'],
    [{ scenarioVersion: Infinity }, 'scenarioVersion: must be a whole number from 1 to 2147483647'],
    [{ scenarioVersion: 1, maxScore: 90 }, 'maxScore: must be 100'],
    [{ scenarioVersion: 1, maxScore: '100' }, 'maxScore: must be 100'],
    [{ scenarioVersion: 1, maxScore: null }, 'maxScore: must be 100 (leave it out for a scenario without goals)'],
    [{ scenarioVersion: 1, maxScore: Infinity }, 'maxScore: must be 100'],
  ])('refuses %j', (fields, problem) => {
    expect(robotReadyProblems(fields as Parameters<typeof robotReadyProblems>[0]).join('\n')).toContain(problem);
  });
});
