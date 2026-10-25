import { beforeAll, describe, it } from 'vitest';
import { initPhysics } from '../world/rapier';
import { checkCases, type CheckCase } from './__fixtures__/check-cases';
import { expectAsCase, sameEveryWay } from './__fixtures__/check-drives';

// N18 R6.2, Review Focus 2 (robot plan §6): a hidden tab or a slow machine during a check gives the very same result. A check is driven
// headless, or in realtime by the page's frames at 1× and 4×, by frames of any length (slow ones drop ticks, the run does not catch up),
// and by a tab hidden for a second and back; every way, the same score, verdicts, goal results, times, program hash, and the same hash of
// each variant's last world (__fixtures__/check-drives.ts). The cases are `checkCases` (__fixtures__/check-cases.ts): this file runs the
// fixtures, driven every way; check-robot.pilots.test.ts runs the pilot scenarios' references of the same list (a test file each, so they
// run side by side).

beforeAll(() => initPhysics(), 30_000);

const fixtures = checkCases.filter((check) => check.drives === 'every');

describe('same score/passed/hash for 1×, 4× and headless', () => {
  it.each(fixtures.map((check) => [check.name, check] as const))('%s', async (_name, check: CheckCase) => {
    const { result } = await sameEveryWay(check);
    expectAsCase(check, result);
  }, 120_000);
});
