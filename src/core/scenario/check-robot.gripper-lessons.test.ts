import { beforeAll, describe, expect, it } from 'vitest';
import { initPhysics } from '../world/rapier';
import { gripperReferences, type CheckCase } from './__fixtures__/check-cases';
import { expectAsCase, sameEveryWay } from './__fixtures__/check-drives';

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
