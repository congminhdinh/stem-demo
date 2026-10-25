import type { ProjectDocument } from '../../circuit/document';
import { productionKits, referenceKitRef, unoR3Board, type Kit } from '../../hardware';
import { registry } from '../../program/__fixtures__/uno-blocks';
import { program, type Json } from '../../program/__fixtures__/ybc-blocks';
import { unoDocument } from '../../profiles/__fixtures__/uno-document';
import { createGoal } from '../../scenario/goals';
import { loadScenario, type Scenario, type ScenarioJson } from '../../scenario/scenario';
import type { RobotSnapshot } from '../../world/snapshot';
import { createRobotRunSession, type RobotRunSession, type RobotRunSessionOptions, type RobotRunSnapshot, type RobotScorerFactory } from '../robot-run-session';

// TEST-ONLY (N18 R3.6): robot run sessions on the reference rover (ref-uno-rover@0) in small scenarios, and robot projects of
// Blockly JSON (program/__fixtures__/uno-blocks.ts builds the robot's blocks).

export const rover = productionKits.get(referenceKitRef) as Kit;

const title = { vi: 'Bài thử', en: 'Fixture' };

/**
 * A 200 × 100 cm floor without walls; the robot starts at (40, 50) facing +x. The zone "target" (x 55..75) lies where "forward at 50 %
 * for 2 s" ends (about 26 cm on); "far" (x 150..190) is never reached by it.
 */
export const driveScenarioJson: ScenarioJson = {
  key: 'rb-drive-to-zone',
  version: 1,
  title,
  profile: 'uno-basic',
  kit: 'ref-uno-rover',
  arena: {
    ground: { sizeCm: [200, 100], color: '#ffffff' },
    paint: {
      zones: [
        { id: 'target', kind: 'target', polygonCm: [[55, 30], [75, 30], [75, 70], [55, 70]], color: '#d9ead3' },
        { id: 'far', kind: 'area', polygonCm: [[150, 30], [190, 30], [190, 70], [150, 70]], color: '#f4cccc' },
      ],
    },
  },
  start: { xCm: 40, yCm: 50, yawDeg: 0 },
  variants: { count: 2, seed: 11, startJitterCm: 3, yawJitterDeg: 5 },
  inputs: [],
  timeLimitS: 20,
  goals: [
    { id: 'reach', kind: 'reach-zone', label: { vi: 'Tới vùng', en: 'Reach the zone' }, points: 50, zone: 'target' },
    { id: 'reach-far', kind: 'reach-zone', label: { vi: 'Tới vùng xa', en: 'Reach the far zone' }, points: 50, zone: 'far' },
  ],
  starter: {},
};

/** The sandbox: a floor of `sizeCm` without walls and goals, the robot at `start`, optionally a wall across x = `wallAtCm`. */
export function sandboxScenario(options: { sizeCm?: [number, number]; start?: { xCm: number; yCm: number; yawDeg: number }; wallAtCm?: number; inputs?: ScenarioJson['inputs'] } = {}): Scenario {
  const [width, depth] = options.sizeCm ?? [300, 150];
  return loadScenario({
    key: 'rb-sandbox',
    version: 1,
    title,
    profile: 'uno-basic',
    kit: 'ref-uno-rover',
    arena: {
      ground: { sizeCm: [width, depth], color: '#ffffff' },
      ...(options.wallAtCm === undefined ? {} : { walls: [{ id: 'wall', fromCm: [options.wallAtCm, 0], toCm: [options.wallAtCm, depth] }] }),
    },
    start: options.start ?? { xCm: 40, yCm: depth / 2, yawDeg: 0 },
    variants: { count: 1, seed: 3, startJitterCm: 0, yawJitterDeg: 0 },
    inputs: options.inputs ?? [],
    timeLimitS: 60,
    goals: [],
    starter: {},
  });
}

export const driveScenario = (): Scenario => loadScenario(driveScenarioJson);

/**
 * N18 R6.2: `scenario` whose run ends at the first contact with one of `tags`. R5.2a adds `endOnContact` to the scenario schema; until it
 * merges a scenario that says it does not load, so the field is put on the loaded scenario, by the same name.
 */
export function withEndOnContact(scenario: Scenario, tags: string[]): Scenario {
  return { ...scenario, endOnContact: tags } as Scenario;
}

/** A robot project of the Basic profile (or the one given) with these hats; `kit` when it names one. */
export function robotProject(onStart: Json[], forever?: Json[], options: { profile?: 'uno-basic' | 'uno-advanced'; kit?: { id: string; version: string }; variables?: string[] } = {}): ProjectDocument {
  return unoDocument(options.profile ?? 'uno-basic', {
    program: { blocks: program(onStart, forever, options.variables ?? ['x', 'y']) },
    ...(options.kit ? { kit: options.kit } : {}),
  });
}

/** A session on the reference rover for `scenario`. */
export function roverSession(scenario: Scenario, options: Partial<RobotRunSessionOptions> = {}): RobotRunSession {
  return createRobotRunSession({ scenario, kit: rover, board: unoR3Board, registry, ...options });
}

/** A scorer of every goal of the scenario that sums the points of the goals that passed (no time bonus: that is R6.2's). */
export const everyGoalScorer: RobotScorerFactory = ({ scenario, arena, program: workspace }) => {
  const goals = scenario.goals.map((spec) => createGoal(spec, { arena, scenario, program: workspace, othersPassedAtS: () => null }));
  return {
    update(frame, dtS) {
      for (const goal of goals) goal.update(frame, dtS);
    },
    score() {
      const results = goals.map((goal) => goal.result());
      return { points: results.reduce((sum, result) => sum + result.points, 0), maxScore: 100, goals: results };
    },
  };
};

/** Every snapshot `session` publishes from now on. */
export function published(session: RobotRunSession): RobotRunSnapshot[] {
  const seen: RobotRunSnapshot[] = [];
  session.subscribe((snapshot) => void seen.push(snapshot));
  return seen;
}

/** The world snapshot of the session; throws when idle. */
export function worldOf(session: RobotRunSession): RobotSnapshot {
  const world = session.getSnapshot().world;
  if (world === null) {
    throw new Error(`No world: the session is ${session.getSnapshot().status}`);
  }
  return world;
}

/** Every number of a JSON value, with its path. */
export function numbers(value: unknown, path = ''): [string, number][] {
  if (typeof value === 'number') return [[path, value]];
  if (Array.isArray(value)) return value.flatMap((item, i) => numbers(item, `${path}[${i}]`));
  if (value !== null && typeof value === 'object') return Object.entries(value).flatMap(([key, item]) => numbers(item, `${path}.${key}`));
  return [];
}

export { unoR3Board };
