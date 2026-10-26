import { describe, expect, it, vi } from 'vitest';
import fixture from './__fixtures__/all-goals.scenario.json';
import { loadScenario } from './scenario';
import { ScenarioError } from './scenario-schema';

// N19 A1 (plan D-G1): the kit a scenario file names is the kit its key stands for, read per key from the template table of robot-keys.ts
// (it was one constant for every key). This file gives the schema a table of its own, not a production key's, in which `rb-mini-mission` (the
// key of the fixture) runs on a second kit: the production table has one kit until A2 registers the gripper, so this is the only way to
// see a key whose kit is not the rover's refused, and one whose kit is its own accepted.

vi.mock('../../samples/robot-keys', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../samples/robot-keys')>();
  return {
    ...original,
    robotTemplates: { ...original.robotTemplates, 'rb-mini-mission': { ...original.robotTemplates['rb-mini-mission'], kit: 'test-only-second-kit' } },
  };
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const authored = (edit: (scenario: any) => void = () => {}): unknown => {
  const scenario = structuredClone(fixture);
  edit(scenario);
  return scenario;
};

const issuesOf = (input: unknown): string[] => {
  try {
    loadScenario(input);
  } catch (error) {
    if (error instanceof ScenarioError) return error.issues.map((issue) => `${issue.path}: ${issue.message}`);
    throw error;
  }
  throw new Error('the scenario loaded');
};

describe('the kit of a scenario is the kit of its key (N19 A1)', () => {
  it('refuses a scenario that names the rover when its key stands for another kit', () => {
    expect(fixture.kit).toBe('ref-uno-rover');
    expect(issuesOf(authored())).toEqual(['kit: rb-mini-mission uses the kit "test-only-second-kit", not "ref-uno-rover"']);
  });

  it('accepts the scenario that names its key’s own kit', () => {
    const scenario = loadScenario(authored((s) => (s.kit = 'test-only-second-kit')));
    expect(scenario.kit).toBe('test-only-second-kit');
    expect(scenario.key).toBe('rb-mini-mission');
  });

  it('still checks the kit of a key that stands for the rover against the rover', () => {
    expect(issuesOf(authored((s) => ((s.key = 'rb-square-route'), (s.kit = 'test-only-second-kit'))))).toContain(
      'kit: rb-square-route uses the kit "ref-uno-rover", not "test-only-second-kit"',
    );
  });
});
