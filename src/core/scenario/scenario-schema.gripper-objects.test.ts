import { describe, expect, it } from 'vitest';
import pick from '../../samples/robot-scenarios/rb-grip-pick.json';
import deliver from '../../samples/robot-scenarios/rb-grip-deliver.json';
import sort from '../../samples/robot-scenarios/rb-grip-sort.json';
import stack from '../../samples/robot-scenarios/rb-grip-stack.json';
import pickPlace from './__fixtures__/pick-place.scenario.json';
import { loadScenario } from './scenario';
import { ScenarioError } from './scenario-schema';

// N19 final fix (G2 M4, review B1/B2 M6): a gripper car's objects are square seen from above, a box's two sides on the floor equal and
// turned by whole quarter turns (or a cylinder). The grasp takes a box's own width as its shorter side (world/robot/grasp.ts `ownWidthCm`,
// rule 6), so a long box met side on could be gripped with the fingers in it; docs/robot-scenario-authoring.md §11.3 said so, and now the
// schema does. The rover's scenarios are not checked (no gripper: nothing is gripped).

function issuesOf(input: unknown): string[] {
  try {
    loadScenario(input);
  } catch (error) {
    if (error instanceof ScenarioError) return error.issues.map((issue) => `${issue.path}: ${issue.message}`);
    throw error;
  }
  return [];
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const edited = (source: unknown, edit: (scenario: any) => void): unknown => {
  const scenario = structuredClone(source);
  edit(scenario);
  return scenario;
};

describe('a gripper car’s objects are square from above (N19 final fix, G2 M4)', () => {
  it('as the four lessons have them: they load unchanged', () => {
    expect([pick, deliver, sort, stack].map((lesson) => issuesOf(lesson))).toEqual([[], [], [], []]);
  });

  it('refuses a rectangular box on the gripper car: 4 × 5 cm', () => {
    expect(issuesOf(edited(pick, (s) => (s.arena.objects[0].sizeCm = [4, 5, 4])))).toEqual([
      'arena.objects[0].sizeCm: a gripper car’s object must be square from above (the grasp reads a box’s shorter side): 4 × 5 cm',
    ]);
  });

  it('refuses a box turned off a quarter turn; a whole number of quarter turns is square still', () => {
    expect(issuesOf(edited(pick, (s) => (s.arena.objects[0].yawDeg = 30)))).toEqual(['arena.objects[0].yawDeg: a gripper car’s object must face the arena square (a multiple of 90°): 30°']);
    expect([90, -180, 270, 0].map((yawDeg) => issuesOf(edited(pick, (s) => (s.arena.objects[0].yawDeg = yawDeg))))).toEqual([[], [], [], []]);
  });

  it('says both for a box that is both, and leaves a cylinder alone', () => {
    expect(issuesOf(edited(stack, (s) => Object.assign(s.arena.objects[1], { sizeCm: [6, 8, 4], yawDeg: 45 })))).toEqual([
      'arena.objects[1].sizeCm: a gripper car’s object must be square from above (the grasp reads a box’s shorter side): 6 × 8 cm',
      'arena.objects[1].yawDeg: a gripper car’s object must face the arena square (a multiple of 90°): 45°',
    ]);
    const [x, y] = stack.arena.objects[1]!.centerCm;
    expect(issuesOf(edited(stack, (s) => (s.arena.objects[1] = { shape: 'cylinder', id: 'base', centerCm: [x, y], radiusCm: 3, heightCm: 4, massG: 40, noun: 'base' })))).toEqual([]);
  });

  it('does not check a rover’s scenario: a rectangular, turned object loads there', () => {
    const rover = edited(pickPlace, (s) => Object.assign(s.arena.objects[0], { sizeCm: [4, 5, 4], yawDeg: 30 }));
    expect((rover as { kit: string }).kit).toBe('ref-uno-rover');
    expect(issuesOf(rover)).toEqual([]);
  });
});
