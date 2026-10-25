import { beforeAll, describe, expect, it } from 'vitest';
import { initPhysics } from '../world/rapier';
import { checkCases, type CheckCase } from './__fixtures__/check-cases';
import { expectAsCase, sameEveryWay } from './__fixtures__/check-drives';

// N18 R6.2 (R5.2b folded in): the six pilot scenarios of R5.2a (src/samples/robot-scenarios/rb-*.json) and their programs
// (src/samples/robot-solutions.ts) through the real check. Each reference solution passes, the same headless, at 1× and at 4× (the pilot
// cases of the determinism list `checkCases`). check-robot.pilot-challenges.test.ts runs their blind programs and exploits.

beforeAll(() => initPhysics(), 30_000);

const references = checkCases.filter((check) => check.drives === 'speeds');

describe('same score/passed/hash for 1×, 4× and headless', () => {
  it('runs a reference solution of each of the six pilot scenarios', () => {
    expect(references.map((check) => check.name.split(':')[0])).toEqual(['rb-drive-to-zone', 'rb-square-route', 'rb-stop-at-wall', 'rb-line-follow', 'rb-servo-gate', 'rb-mini-mission']);
  });

  it.each(references.map((check) => [check.name, check] as const))('%s, which passes', async (_name, check: CheckCase) => {
    const { result } = await sameEveryWay(check);
    expectAsCase(check, result);
    expect(result.goals.every((goal) => goal.passed) && result.variants.every((variant) => variant.passed)).toBe(true);
  }, 600_000);
});
