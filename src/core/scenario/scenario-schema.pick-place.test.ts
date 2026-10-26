import { describe, expect, expectTypeOf, it } from 'vitest';
import fixture from './__fixtures__/pick-place.scenario.json';
import { loadScenario } from './scenario';
import { allGoalKinds, goalKinds, pickPlaceGoalKinds, ScenarioError, type GoalKind } from './scenario-schema';

// N19 D2 (plan §4.5): the four pick-and-place goal kinds in the schema: their fields and defaults, and the rules the shape cannot say (the
// objects and zones they name are the arena's, one zone or a zone per colour, every colour the object takes has a zone, a stack is of two
// objects, a hold or a rest fits in the run).

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const authored = (): any => structuredClone(fixture);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const editGoal = (index: number, edit: (goal: any) => void, more?: (scenario: any) => void): unknown => {
  const scenario = authored();
  edit(scenario.goals[index]);
  more?.(scenario);
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

const objects = 'objects: cube, base, parcel-1, parcel-2, parcel-3, can';
const zones = 'zones: start, pickup, drop, red-zone, green-zone, blue-zone, bare';

describe('the pick-and-place goal kinds (N19 D2)', () => {
  it('are four, after the nine of N18', () => {
    expect(pickPlaceGoalKinds).toEqual(['object-held', 'object-placed', 'object-on-object', 'object-unmoved']);
    expect(allGoalKinds).toEqual([...goalKinds, ...pickPlaceGoalKinds]);
  });

  it('make allGoalKinds every kind of the schema’s union, and nothing else (checked when the tests compile; review M9)', () => {
    expectTypeOf<(typeof allGoalKinds)[number]>().toEqualTypeOf<GoalKind>();
    expect(new Set(allGoalKinds).size).toBe(13);
  });

  it('load from the fixture, which has one of each, with the defaults of plan §4.5 filled in', () => {
    const scenario = loadScenario(fixture);
    expect(new Set(scenario.goals.map((goal) => goal.kind))).toEqual(new Set(pickPlaceGoalKinds));
    const [held, placed, stacked, unmoved, sorted] = scenario.goals;
    expect(held).toEqual({ id: 'grab-cube', kind: 'object-held', label: { vi: 'Gắp khối lên', en: 'Pick the cube up' }, points: 20, object: 'cube', holdS: 0.5, minLiftCm: 2 });
    expect(placed).toMatchObject({ object: 'cube', zone: 'drop', fully: true, maxTiltDeg: 15, restS: 0.5, carried: true, maxSlideCm: 3 });
    expect(placed).not.toHaveProperty('zoneByColor');
    expect(stacked).toMatchObject({ top: 'cube', bottom: 'base', maxOffsetCm: 1.5, maxTiltDeg: 10, restS: 0.5, carried: true });
    expect(unmoved).toMatchObject({ object: 'base', maxMoveCm: 1, maxTiltDeg: 20 });
    expect(sorted).toMatchObject({ zoneByColor: { '#d32f2f': 'red-zone', '#388e3c': 'green-zone', '#1976d2': 'blue-zone' } });
    expect(sorted).not.toHaveProperty('zone');
    expect(loadScenario(editGoal(0, (g) => delete g.minLiftCm)).goals[0]).toMatchObject({ holdS: 0.5, minLiftCm: 0 });
    // N19 fix round 1 (review I1): a grip carries only when it lifted the object 1 cm, unless the goal says another height.
    expect([placed, stacked, sorted].map((goal) => (goal as { minCarryLiftCm?: number }).minCarryLiftCm)).toEqual([1, 1, 1]);
    expect(loadScenario(editGoal(1, (g) => (g.minCarryLiftCm = 2.5))).goals[1]).toMatchObject({ minCarryLiftCm: 2.5 });
  });

  it('want the objects and zones they name to be the arena’s', () => {
    expect(issuesOf(editGoal(0, (g) => (g.object = 'ball')))).toEqual([`goals[0].object: no object "ball" in the arena (${objects})`]);
    expect(issuesOf(editGoal(1, (g) => (g.zone = 'moon')))).toEqual([`goals[1].zone: no zone "moon" in the arena (${zones})`]);
    expect(issuesOf(editGoal(1, (g) => (g.object = 'ball')))).toEqual([`goals[1].object: no object "ball" in the arena (${objects})`]);
    expect(issuesOf(editGoal(2, (g) => (g.top = 'ball')))).toEqual([`goals[2].top: no object "ball" in the arena (${objects})`]);
    expect(issuesOf(editGoal(2, (g) => (g.bottom = 'ball')))).toEqual([`goals[2].bottom: no object "ball" in the arena (${objects})`]);
    expect(issuesOf(editGoal(3, (g) => (g.object = 'ball')))).toEqual([`goals[3].object: no object "ball" in the arena (${objects})`]);
    expect(issuesOf(editGoal(4, (g) => (g.zoneByColor['#388e3c'] = 'moon')))).toEqual([`goals[4].zoneByColor.#388e3c: no zone "moon" in the arena (${zones})`]);
  });

  it('want object-placed to name one zone or a zone per colour, never both nor neither', () => {
    expect(issuesOf(editGoal(1, (g) => (g.zoneByColor = { '#d32f2f': 'red-zone' })))).toEqual(['goals[1]: needs a zone or a zoneByColor, one of the two']);
    expect(issuesOf(editGoal(1, (g) => delete g.zone))).toEqual(['goals[1]: needs a zone or a zoneByColor, one of the two']);
  });

  it('want a zone for every colour the object has in a variant, each colour once whatever its case', () => {
    expect(issuesOf(editGoal(4, (g) => delete g.zoneByColor['#388e3c']))).toEqual([
      'goals[4].zoneByColor: no zone for #388e3c, the colour of "cube" in variant 1 (colours: #d32f2f, #1976d2)',
    ]);
    expect(issuesOf(editGoal(4, (g) => (g.zoneByColor['#D32F2F'] = 'blue-zone')))).toEqual(['goals[4].zoneByColor.#D32F2F: the colour #D32F2F is listed already (#d32f2f)']);
    // Without a list of colours, the object has its arena colour in every variant.
    expect(issuesOf(editGoal(4, (g) => (g.zoneByColor = { '#388e3c': 'green-zone' }), (s) => delete s.variants.objectColors))).toEqual([
      'goals[4].zoneByColor: no zone for #d32f2f, the colour of "cube" in variant 0 (colours: #388e3c)',
    ]);
    expect(issuesOf(editGoal(4, (g) => (g.object = 'parcel-1')))).toEqual(['goals[4].zoneByColor: needs an object with a colour ("parcel-1" has none)']);
    expect(issuesOf(editGoal(4, (g) => (g.zoneByColor = { red: 'red-zone', '#388e3c': 'green-zone', '#1976d2': 'blue-zone' })))).toContain('goals[4].zoneByColor.red: a colour is "#rrggbb"');
    // A colour in another case than the object's is the same colour.
    expect(() => loadScenario(editGoal(4, (g) => (g.zoneByColor = { '#D32F2F': 'red-zone', '#388E3C': 'green-zone', '#1976D2': 'blue-zone' })))).not.toThrow();
  });

  it('want a stack of two objects, and a hold or a rest no longer than the run', () => {
    expect(issuesOf(editGoal(2, (g) => (g.bottom = 'cube')))).toEqual(['goals[2].bottom: must be another object than top ("cube")']);
    expect(issuesOf(editGoal(0, (g) => (g.holdS = 61)))).toEqual(['goals[0].holdS: must not be more than the time limit (60 s)']);
    expect(issuesOf(editGoal(1, (g) => (g.restS = 61)))).toEqual(['goals[1].restS: must not be more than the time limit (60 s)']);
    expect(issuesOf(editGoal(2, (g) => (g.restS = 61)))).toEqual(['goals[2].restS: must not be more than the time limit (60 s)']);
  });

  it('refuse numbers out of range and the fields of another kind', () => {
    expect(issuesOf(editGoal(0, (g) => (g.minLiftCm = -1)))).toEqual(['goals[0].minLiftCm: must be 0 or more']);
    expect(issuesOf(editGoal(0, (g) => (g.holdS = 0)))).toEqual(['goals[0].holdS: must be more than 0']);
    expect(issuesOf(editGoal(1, (g) => (g.maxTiltDeg = 91)))).toEqual(['goals[1].maxTiltDeg: must be from 0 to 90']);
    expect(issuesOf(editGoal(1, (g) => (g.maxSlideCm = -0.5)))).toEqual(['goals[1].maxSlideCm: must be 0 or more']);
    expect(issuesOf(editGoal(1, (g) => (g.minCarryLiftCm = -1)))).toEqual(['goals[1].minCarryLiftCm: must be 0 or more']);
    expect(issuesOf(editGoal(2, (g) => (g.minCarryLiftCm = -1)))).toEqual(['goals[2].minCarryLiftCm: must be 0 or more']);
    expect(issuesOf(editGoal(2, (g) => delete g.maxOffsetCm))).toEqual(['goals[2].maxOffsetCm: Invalid input: expected number, received undefined']);
    expect(issuesOf(editGoal(3, (g) => (g.maxMoveCm = -1)))).toEqual(['goals[3].maxMoveCm: must be 0 or more']);
    expect(issuesOf(editGoal(3, (g) => (g.zone = 'drop')))).toEqual(['goals[3]: Unrecognized key: "zone"']);
  });

  it('says the four among the kinds a scenario can have when a kind is unknown', () => {
    expect(issuesOf(editGoal(0, (g) => (g.kind = 'object-hold')))).toEqual([
      'goals[0].kind: unknown goal kind "object-hold"; the kinds are reach-zone, checkpoints-in-order, stay-on-line, avoid-contact, object-in-zone, stop-in-zone, servo-angle, finish-within, uses-block, object-held, object-placed, object-on-object, object-unmoved',
    ]);
  });
});
