import { describe, expect, it } from 'vitest';
import fixture from './__fixtures__/pick-place.scenario.json';
import { loadScenario } from './scenario';
import { ScenarioError } from './scenario-schema';

// N19 D1 (plan §4.5): the variants of a pick-and-place lesson move its objects (`objectJitter`) and change their colours (`objectColors`).
// Both are optional, with no default, and checked against the arena: what they name is an object of it, an object moves in one entry at
// most, and a list of colours has one colour per variant, the first of them the colour the arena gives the object (variant 0 is the
// lesson as authored).

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const authored = (): any => structuredClone(fixture);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const edited = (edit: (scenario: any) => void): unknown => {
  const scenario = authored();
  edit(scenario);
  return scenario;
};

function issuesOf(input: unknown): string[] {
  try {
    loadScenario(input);
  } catch (error) {
    if (error instanceof ScenarioError) return error.issues.map((issue) => `${issue.path}: ${issue.message}`);
    throw error;
  }
  throw new Error('the scenario loaded');
}

describe('variants.objectJitter and variants.objectColors', () => {
  it('loads them as authored', () => {
    const scenario = loadScenario(fixture);
    expect(scenario.variants).toEqual({
      count: 3,
      seed: 7,
      startJitterCm: 1,
      yawJitterDeg: 2,
      objectJitter: [
        { objects: ['cube'], dxCm: 5, dyCm: 0 },
        { objects: ['parcel-1', 'parcel-2', 'parcel-3'], dxCm: 0, dyCm: 3 },
      ],
      objectColors: { cube: ['#d32f2f', '#388e3c', '#1976d2'] },
    });
  });

  it('wants each entry of objectJitter to move objects of the arena, each in one entry, by lengths of 0 or more', () => {
    expect(issuesOf(edited((s) => (s.variants.objectJitter[0].objects = ['ball'])))).toEqual([
      'variants.objectJitter[0].objects[0]: no object "ball" in the arena (objects: cube, base, parcel-1, parcel-2, parcel-3, can)',
    ]);
    expect(issuesOf(edited((s) => s.variants.objectJitter[1].objects.push('cube')))).toEqual([
      'variants.objectJitter[1].objects[3]: "cube" already moves in variants.objectJitter[0]',
    ]);
    expect(issuesOf(edited((s) => (s.variants.objectJitter[0].objects = ['cube', 'cube'])))).toEqual([
      'variants.objectJitter[0].objects[1]: "cube" already moves in variants.objectJitter[0]',
    ]);
    expect(issuesOf(edited((s) => (s.variants.objectJitter[0].dxCm = -1)))).toEqual(['variants.objectJitter[0].dxCm: must be 0 or more']);
    expect(issuesOf(edited((s) => (s.variants.objectJitter[0].objects = [])))).toEqual(['variants.objectJitter[0].objects: needs at least one object']);
    expect(issuesOf(edited((s) => (s.variants.objectJitter = [])))).toEqual(['variants.objectJitter: needs at least one entry']);
    expect(issuesOf(edited((s) => (s.variants.objectJitter[0].dzCm = 1)))).toEqual(['variants.objectJitter[0]: Unrecognized key: "dzCm"']);
  });

  it('wants objectColors to give an object of the arena one colour per variant, the first the arena’s own', () => {
    expect(issuesOf(edited((s) => (s.variants.objectColors = { ball: ['#d32f2f', '#388e3c', '#1976d2'] })))).toEqual([
      'variants.objectColors.ball: no object "ball" in the arena (objects: cube, base, parcel-1, parcel-2, parcel-3, can)',
    ]);
    expect(issuesOf(edited((s) => s.variants.objectColors.cube.pop()))).toEqual(['variants.objectColors.cube: needs one colour per variant (3), not 2']);
    expect(issuesOf(edited((s) => (s.variants.objectColors.cube[0] = '#388e3c')))).toEqual([
      'variants.objectColors.cube[0]: variant 0 is the arena as authored, so this must be the colour the arena gives "cube" (#d32f2f)',
    ]);
    expect(issuesOf(edited((s) => (s.variants.objectColors = { 'parcel-1': ['#d32f2f', '#388e3c', '#1976d2'] })))).toEqual([
      'variants.objectColors.parcel-1[0]: variant 0 is the arena as authored, so this must be the colour the arena gives "parcel-1" (it gives none)',
    ]);
    expect(issuesOf(edited((s) => (s.variants.objectColors.cube[2] = 'blue')))).toEqual(['variants.objectColors.cube[2]: a colour is "#rrggbb"']);
    expect(issuesOf(edited((s) => (s.variants.objectColors.cube[0] = 'red')))).toEqual(['variants.objectColors.cube[0]: a colour is "#rrggbb"']);
  });

  it('takes the arena’s colour in another case for the first entry: a colour is the same whatever the case of its hex digits', () => {
    expect(() => loadScenario(edited((s) => (s.variants.objectColors.cube[0] = '#D32F2F')))).not.toThrow();
  });

  it('is optional, each of the two on its own', () => {
    expect(loadScenario(edited((s) => delete s.variants.objectJitter)).variants).not.toHaveProperty('objectJitter');
    expect(loadScenario(edited((s) => delete s.variants.objectColors)).variants).not.toHaveProperty('objectColors');
  });
});
