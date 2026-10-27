import { beforeAll, describe, expect, it } from 'vitest';
import { initPhysics } from '../world/rapier';
import { gripperReferences, pickCorners, type CheckCase } from './__fixtures__/check-cases';
import { expectAsCase, outcomeOf, sameEveryWay } from './__fixtures__/check-drives';

// N19 D4 (plan §6, Review Focus 2): the gripper car's four lessons (src/samples/robot-scenarios/rb-grip-*.json) through the real check with
// their reference solutions (src/samples/robot-solutions.ts): each passes every goal in every variant, with the same score, verdicts, goal
// results, ends, program hash and last world of each variant headless, at 1× and at 4× (a stop, a reset or a speed never changes a grip).
// The scores are the ones spikes/n19-d4 measured (results.md); tests/robot-determinism.test.ts pins the hashes on 4 engines.

beforeAll(() => initPhysics(), 30_000);

/** Each reference's score, and each variant's: the time bonus is the only point below 100 (deliver and stack finish by 26 s and 13 s). */
const scores: Readonly<Record<string, { score: number; variants: readonly number[] }>> = {
  'rb-grip-pick': { score: 100, variants: [100, 100, 100] },
  'rb-grip-deliver': { score: 97, variants: [97, 97, 97] },
  'rb-grip-sort': { score: 100, variants: [100, 100, 100] },
  'rb-grip-stack': { score: 97, variants: [97, 97, 97] },
};

describe('grip scenario same score/passed/hash for 1×, 4× and headless', () => {
  it('runs the reference solution of each of the four gripper lessons', () => {
    expect(gripperReferences.map((check) => check.name.split(':')[0])).toEqual(['rb-grip-pick', 'rb-grip-deliver', 'rb-grip-sort', 'rb-grip-stack']);
  });

  it.each(gripperReferences.map((check) => [check.name, check] as const))('%s, which passes', async (_name, check: CheckCase) => {
    const { result, variants } = await sameEveryWay(check);
    expectAsCase(check, result);
    expect(result.goals.every((goal) => goal.passed) && result.variants.every((variant) => variant.passed)).toBe(true);
    const key = check.name.split(':')[0]!;
    expect({ score: result.score, variants: result.variants.map((variant) => variant.score) }).toEqual(scores[key]);
    expect(variants.map((variant) => variant?.end)).toEqual(variants.map(() => ({ reason: 'time-limit', atS: check.scenario().timeLimitS })));
  }, 900_000);
});

// N19 D4 fix round 1 (review I1): seed 23's three rounds are not the lesson's whole range. At each corner of lesson 8's variant range (the start
// ±1 cm and ±2°, the cube ±10 cm: the cube up to 3.3 cm off the robot's line of travel, where a finger shoves it into the drop zone before the
// IR sees it) the reference passes every goal. tests/robot-scenarios.test.ts holds the range to these corners.
describe('lesson 8’s reference at the corners of its variant range (review 1 I1)', () => {
  const reference = gripperReferences.find((check) => check.name.startsWith('rb-grip-pick:'))!;

  it('runs the 16 corners, up to 3.3 cm off the line of travel on either side', () => {
    const offsets = pickCorners().map((corner) => corner.offsetCm);
    expect(pickCorners()).toHaveLength(16);
    expect(Math.max(...offsets)).toBeCloseTo(3.3, 1);
    expect(Math.min(...offsets)).toBeCloseTo(-3.3, 1);
  });

  it.each(pickCorners().map((corner) => [corner.name, corner] as const))('%s: passes with 100', async (_name, corner) => {
    const { result } = await outcomeOf(reference.project(), corner.scenario(), { name: 'headless', mode: 'headless' });
    expect({ passed: result.passed, score: result.score, goals: result.goals.map((goal) => [goal.id, goal.passed]) }).toEqual({
      passed: true,
      score: 100,
      goals: [
        ['grab-cube', true],
        ['place-cube', true],
        ['no-crash', true],
      ],
    });
  }, 300_000);
});
