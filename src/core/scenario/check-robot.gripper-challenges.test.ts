import { beforeAll, describe, expect, it } from 'vitest';
import { initPhysics } from '../world/rapier';
import { gripperChallenges, type CheckCase } from './__fixtures__/check-cases';
import { expectAsCase, outcomeOf } from './__fixtures__/check-drives';

// N19 D4 (plan §6, Review Focus 4): the gripper lessons' blind programs (lessons 8, 9 and 11: motors, the gripper and waits, timed for
// variant 0) and the exploits of plan §6 (src/samples/robot-solutions.ts) through the real check, headless: each fails, a blind program in a
// variant at least, an exploit at or under its ceiling. Each score is the one spikes/n19-d4 measured (results.md), variant by variant.

beforeAll(() => initPhysics(), 30_000);

/** What the check gives each program: its score (the lowest variant's) and each variant's. */
const measured: Readonly<Record<string, readonly number[]>> = {
  'rb-grip-pick: the blind program': [100, 15, 15],
  'rb-grip-pick: the exploit never-lower-arm': [0, 0, 0],
  'rb-grip-pick: the exploit push-in': [15, 15, 15],
  'rb-grip-pick: the exploit hold-in-zone': [55, 55, 55],
  'rb-grip-pick: the exploit push-closed-then-lift': [55, 55, 0],
  'rb-grip-deliver: the blind program': [97, 40, 40],
  'rb-grip-deliver: the exploit push-north': [15, 15, 15],
  'rb-grip-deliver: the exploit open-jaw-sweep-lift': [15, 0, 15],
  'rb-grip-sort: the exploit always-turn-left': [40, 100, 40],
  'rb-grip-sort: the exploit only-check-red': [100, 100, 40],
  'rb-grip-stack: the blind program': [97, 15, 75],
  'rb-grip-stack: the exploit place-beside-base': [35, 35, 35],
  'rb-grip-stack: the exploit hold-over-base': [35, 35, 35],
  'rb-grip-stack: the exploit arm-too-low': [20, 20, 20],
  'rb-grip-stack: the exploit lower-arm-fully': [35, 35, 35],
};

describe('the gripper lessons’ blind programs and exploits fail the check', () => {
  it('has the blind programs of lessons 8, 9 and 11, the eleven exploits of plan §6 (its "hạ hết tay" two, ruling D4 item B) and review 1 M1’s', () => {
    expect(gripperChallenges.map((check) => check.name)).toEqual(Object.keys(measured));
  });

  it.each(gripperChallenges.map((check) => [check.name, check] as const))('%s', async (name, check: CheckCase) => {
    const { result } = await outcomeOf(check.project(), check.scenario(), { name: 'headless', mode: 'headless' });
    expectAsCase(check, result);
    expect(result.variants.some((variant) => !variant.passed)).toBe(true);
    expect(result.variants.map((variant) => variant.score)).toEqual(measured[name]);
    expect(result.score).toBe(Math.min(...measured[name]!));
  }, 600_000);
});
