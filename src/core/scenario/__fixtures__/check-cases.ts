import type { ProjectDocument } from '../../circuit/document';
import { robotProject } from '../../run/__fixtures__/robot-session';
import { driveMove, driveStop, unoDivide } from '../../program/__fixtures__/uno-blocks';
import { num, wait } from '../../program/__fixtures__/ybc-blocks';
import { scenarioCatalog } from '../../../samples/robot-scenarios';
import { robotSolutions, type BlocklyJson, type RobotScoredKey } from '../../../samples/robot-solutions';
import { robotStarterDocument, robotTemplates } from '../../../samples/robot-templates';
import { loadScenario, type Scenario, type ScenarioJson } from '../scenario';

// TEST-ONLY (N18 R6.2): robot checks, a scenario and a program each, for the tests of checkRobot and its determinism (Review Focus 2:
// `same score/passed/hash for 1×, 4× and headless`). `checkCases` is the determinism list: the fixtures below, driven every way, and the
// reference solution of each pilot scenario (src/samples/robot-solutions.ts, R5.2a; R5.2b folded into R6.2), driven headless, at 1× and at
// 4×, which must pass. `pilotChallenges` are the pilots' blind programs and exploits, which must fail with at most their recorded score.

/** A check case: a scenario with goals, and the learner's program for it. Each call builds them anew. */
export type CheckCase = {
  readonly name: string;
  readonly scenario: () => Scenario;
  readonly project: () => ProjectDocument;
  /** How the determinism test drives it: every way (the fixtures), or headless, 1× and 4× (the pilots, whose runs are long). */
  readonly drives: 'every' | 'speeds';
  /** What the check must give, when the case says: it passes, or it fails with at most `maxScore`. */
  readonly expected?: { readonly passed: boolean; readonly maxScore?: number };
};

const title = { vi: 'Bài thử: đỗ trong vùng', en: 'Fixture: park in the zone' };
const label = (vi: string, en: string) => ({ vi, en });

/**
 * A 200 × 100 cm floor; the rover starts at (40, 50) facing +x, in three variants (±2 cm, ±3°). The zone "target" (x 55..75) is where
 * "forward at 50 % for 2 s, then stop" coasts to rest (about 26 cm on). 8 s to do it: reach the zone (30), park in it (30), all of it
 * within 6 s (20), and a time bonus of up to 20.
 */
export const parkScenarioJson: ScenarioJson = {
  key: 'rb-drive-to-zone',
  version: 2,
  title,
  profile: 'uno-basic',
  kit: 'ref-uno-rover',
  arena: {
    ground: { sizeCm: [200, 100], color: '#ffffff' },
    paint: { zones: [{ id: 'target', kind: 'target', polygonCm: [[55, 30], [75, 30], [75, 70], [55, 70]], color: '#d9ead3' }] },
  },
  start: { xCm: 40, yCm: 50, yawDeg: 0 },
  variants: { count: 3, seed: 11, startJitterCm: 2, yawJitterDeg: 3 },
  inputs: [],
  timeLimitS: 8,
  goals: [
    { id: 'reach', kind: 'reach-zone', label: label('Tới vùng đích', 'Reach the zone'), points: 30, zone: 'target' },
    { id: 'park', kind: 'stop-in-zone', label: label('Dừng hẳn trong vùng', 'Park in the zone'), points: 30, zone: 'target', maxSpeedCmS: 2, holdS: 1 },
    { id: 'in-time', kind: 'finish-within', label: label('Xong trong 6 giây', 'Done within 6 s'), points: 20, seconds: 6 },
  ],
  scoring: { timeBonusMax: 20 },
  starter: {},
};

export const parkScenario = (): Scenario => loadScenario(parkScenarioJson);

/** The park scenario with a wall across x = 100 (cm), whose first contact ends the run (`endOnContact: ["wall"]`). */
export const crashScenario = (): Scenario =>
  loadScenario({ ...parkScenarioJson, arena: { ...parkScenarioJson.arena, walls: [{ id: 'wall', fromCm: [100, 0], toCm: [100, 100] }] }, endOnContact: ['wall'] });

/**
 * The park scenario's floor and zone with a wall across x = 100 (cm) and other goals: reach the target (50) and never touch the wall (30,
 * a guard goal), with a time bonus of up to 20. Full speed for ever reaches the target and then hits the wall: 50.
 */
export const wallScenario = (): Scenario =>
  loadScenario({
    ...parkScenarioJson,
    arena: { ...parkScenarioJson.arena, walls: [{ id: 'wall', fromCm: [100, 0], toCm: [100, 100] }] },
    goals: [
      { id: 'reach', kind: 'reach-zone', label: label('Tới vùng đích', 'Reach the zone'), points: 50, zone: 'target' },
      { id: 'no-wall', kind: 'avoid-contact', label: label('Không chạm tường', 'Do not touch the wall'), points: 30, tag: 'wall' },
    ],
  });

/** Forward at 50 % for 2 s, then stop: it parks in the target. */
export const parker = (): ProjectDocument => robotProject([driveMove('forward', num(50)), wait(num(2000)), driveStop()]);
/** Forward at 50 % for 4 s: through the target and past it. */
export const overshooter = (): ProjectDocument => robotProject([driveMove('forward', num(50)), wait(num(4000)), driveStop()]);
/** Full speed ahead, for ever. */
export const rammer = (): ProjectDocument => robotProject([], [driveMove('forward', num(100))]);
/**
 * The review's probe (R6.2 fix round 1): full speed for 800 ms, then a wait longer than the contract allows, computed, so the program faults
 * (out-of-domain) with the robot in the target, short of the wall. A run frozen there would pass every goal of the wall scenario.
 */
export const faulter = (): ProjectDocument => robotProject([driveMove('forward', num(100)), wait(num(800)), wait(unoDivide(num(70000), num(1)))]);
/** The probe without its fault: full speed for 800 ms, then stop. */
export const dasher = (): ProjectDocument => robotProject([driveMove('forward', num(100)), wait(num(800)), driveStop()]);

/** A pilot scenario's project with `program`: the scenario's starter document, as the lab opens it, holding the program. */
const pilotProject = (key: RobotScoredKey, program: BlocklyJson) => (): ProjectDocument => ({ ...robotStarterDocument(key), program: { blocks: structuredClone(program) } });
const pilotScenario = (key: RobotScoredKey) => (): Scenario => scenarioCatalog.get(key)!;
/** The pilot course's six (on the rover): N19 D4's gripper lessons are cases of their own, below, so these lists are the ones N18 pinned. */
const pilotKeys = (Object.keys(robotSolutions) as RobotScoredKey[]).filter((key) => robotTemplates[key].kit === 'ref-uno-rover');

/** Each pilot scenario's reference solution: it passes every goal in every variant. */
export const pilotReferences: readonly CheckCase[] = pilotKeys.map((key) => ({
  name: `${key}: the reference solution`,
  scenario: pilotScenario(key),
  project: pilotProject(key, robotSolutions[key].reference),
  drives: 'speeds',
  expected: { passed: true },
}));

/** Each pilot scenario's blind program (motors and waits, timed for variant 0), which fails a variant, and its exploits, each with its most. */
export const pilotChallenges: readonly CheckCase[] = pilotKeys.flatMap((key) => {
  const { blind, exploits = [] } = robotSolutions[key];
  return [
    ...(blind === undefined ? [] : [{ name: `${key}: the blind program`, scenario: pilotScenario(key), project: pilotProject(key, blind), drives: 'speeds' as const, expected: { passed: false } }]),
    ...exploits.map((exploit) => ({
      name: `${key}: the exploit ${exploit.name}`,
      scenario: pilotScenario(key),
      project: pilotProject(key, exploit.program),
      drives: 'speeds' as const,
      expected: { passed: false, maxScore: exploit.maxScore },
    })),
  ];
});

/** N19 D4: the gripper car's lessons 8-11 (ref-uno-gripper@0), in the order of the lessons. */
export const gripperLessonKeys: readonly RobotScoredKey[] = (Object.keys(robotSolutions) as RobotScoredKey[]).filter((key) => robotTemplates[key].kit === 'ref-uno-gripper');

/** N19 D4: each gripper lesson's reference solution, which passes every goal in every variant, driven headless, at 1× and at 4×. */
export const gripperReferences: readonly CheckCase[] = gripperLessonKeys.map((key) => ({
  name: `${key}: the reference solution`,
  scenario: pilotScenario(key),
  project: pilotProject(key, robotSolutions[key].reference),
  drives: 'speeds',
  expected: { passed: true },
}));

/** N19 D4: each gripper lesson's blind program (lessons 8, 9, 11) and the exploits of plan §6, each with its ceiling. */
export const gripperChallenges: readonly CheckCase[] = gripperLessonKeys.flatMap((key) => {
  const { blind, exploits = [] } = robotSolutions[key];
  return [
    ...(blind === undefined ? [] : [{ name: `${key}: the blind program`, scenario: pilotScenario(key), project: pilotProject(key, blind), drives: 'speeds' as const, expected: { passed: false } }]),
    ...exploits.map((exploit) => ({
      name: `${key}: the exploit ${exploit.name}`,
      scenario: pilotScenario(key),
      project: pilotProject(key, exploit.program),
      drives: 'speeds' as const,
      expected: { passed: false, maxScore: exploit.maxScore },
    })),
  ];
});

/** N19 D4 fix round 1 (review I1): the cube's lateral offset from a start's line of travel, cm (left of the heading positive). */
export function lateralOffsetCm(start: { readonly xCm: number; readonly yCm: number; readonly yawDeg: number }, cube: readonly [number, number]): number {
  const rad = (start.yawDeg * Math.PI) / 180;
  return -(cube[0] - start.xCm) * Math.sin(rad) + (cube[1] - start.yCm) * Math.cos(rad);
}

/**
 * N19 D4 fix round 1 (review I1): lesson 8 at the corners of its variant range, each a one-round scenario: the start moved by ±startJitterCm
 * in x and y and turned by ±yawJitterDeg, the cube moved by ±dxCm of its objectJitter. The cube's offset from the line of travel is linear in
 * the moves and monotone in the turn, so these 16 are its extremes (tests/robot-scenarios.test.ts holds the range to them). The reference must
 * pass each.
 */
export function pickCorners(): { readonly name: string; readonly offsetCm: number; readonly scenario: () => Scenario }[] {
  const pick = scenarioCatalog.get('rb-grip-pick')!;
  const { startJitterCm: s, yawJitterDeg: a } = pick.variants;
  const c = pick.variants.objectJitter![0]!.dxCm;
  const cube = pick.arena.objects[0]!;
  const corners = [];
  for (const dx of [-s, s]) for (const dy of [-s, s]) for (const dYaw of [-a, a]) for (const dc of [-c, c]) {
    const start = { xCm: pick.start.xCm + dx, yCm: pick.start.yCm + dy, yawDeg: pick.start.yawDeg + dYaw };
    const at: [number, number] = [cube.centerCm[0] + dc, cube.centerCm[1]];
    corners.push({
      name: `start ${dx > 0 ? '+' : '−'}${s} x, ${dy > 0 ? '+' : '−'}${s} y, ${dYaw > 0 ? '+' : '−'}${a}°, cube ${dc > 0 ? '+' : '−'}${c}`,
      offsetCm: lateralOffsetCm(start, at),
      scenario: () =>
        loadScenario({
          ...pick,
          start,
          arena: { ...pick.arena, objects: [{ ...cube, centerCm: at }] },
          variants: { count: 1, seed: pick.variants.seed, startJitterCm: 0, yawJitterDeg: 0 },
        } as ScenarioJson),
    });
  }
  return corners;
}

export const checkCases: readonly CheckCase[] = [
  { name: 'park: a program that parks in the zone', scenario: parkScenario, project: parker, drives: 'every' },
  { name: 'park: a program that overshoots', scenario: parkScenario, project: overshooter, drives: 'every' },
  { name: 'crash: a program that hits the wall that ends the run', scenario: crashScenario, project: rammer, drives: 'every' },
  { name: 'wall: a program that faults once its goals have passed', scenario: wallScenario, project: faulter, drives: 'every' },
  ...pilotReferences,
];
