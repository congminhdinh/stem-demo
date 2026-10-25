import { beforeAll, describe, expect, it } from 'vitest';
import { initPhysics } from '../world/rapier';
import { pilotChallenges, type CheckCase } from './__fixtures__/check-cases';
import { expectAsCase, outcomeOf } from './__fixtures__/check-drives';

// N18 R6.2 (R5.2b folded in): the six pilot scenarios' blind programs (lessons 3-6: motors and waits, timed for variant 0) and the exploits
// of the R5.2a reviews (src/samples/robot-solutions.ts) through the real check, headless: each fails, an exploit with at most the score R5.2a
// recorded for it (the most the check may give it, rule 10 of docs/robot-scenario-authoring.md), a blind program in a variant at least.

beforeAll(() => initPhysics(), 30_000);

describe('the pilots’ blind programs and exploits fail the check', () => {
  it('has the blind programs of lessons 3-6 and every exploit', () => {
    expect(pilotChallenges.filter((check) => check.name.includes('blind'))).toHaveLength(4);
    expect(pilotChallenges.filter((check) => check.name.includes('exploit')).length).toBeGreaterThanOrEqual(12);
  });

  it.each(pilotChallenges.map((check) => [check.name, check] as const))('%s', async (_name, check: CheckCase) => {
    const { result } = await outcomeOf(check.project(), check.scenario(), { name: 'headless', mode: 'headless' });
    expectAsCase(check, result);
    expect(result.variants.some((variant) => !variant.passed)).toBe(true);
  }, 300_000);
});
