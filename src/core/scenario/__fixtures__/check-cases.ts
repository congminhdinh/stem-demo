import type { ProjectDocument } from '../../circuit/document';
import { robotProject } from '../../run/__fixtures__/robot-session';
import { driveMove, driveStop, unoDivide } from '../../program/__fixtures__/uno-blocks';
import { num, wait } from '../../program/__fixtures__/ybc-blocks';
import { scenarioCatalog } from '../../../samples/robot-scenarios';
import { robotSolutions, type BlocklyJson, type RobotScoredKey } from '../../../samples/robot-solutions';
import { robotStarterDocument } from '../../../samples/robot-templates';
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
const pilotKeys = Object.keys(robotSolutions) as RobotScoredKey[];

/** Each pilot scenario's reference solution: it passes every goal in every variant. */
export const pilotReferences: readonly CheckCase[] = pilotKeys.map((key) => ({
  name: `${key}: the reference solution`,
  scenario: pilotScenario(key),
  project: pilotProject(key, robotSolutions[key].reference),
  drives: 'speeds',
  expected: { passed: true },
}));

/**
 * The exploits whose check score moved past the most R5.2a recorded for them once C2 merged (contract 0.1.7 charges motorSet 43.6875 µs, so a
 * loop of motor calls counted to a time runs longer): by case name, the score measured on the merged master (28600ae). The programs and the
 * scenarios are unchanged; R6.2 reports the move and does not retune them (controller ruling). Each still fails, under rule 10's 60.
 * `timed-follower` counts 300 000 follower loops to stop in the dock after about 13.9 s; it now drives on into the obstacle and the run ends
 * there in every variant (14.392 / 15.475 / 13.342 s), as `follower-without-distance` does: 45, where R5.2a measured 96 / 35 / 96.
 */
export const exploitScoresSinceC2: Readonly<Record<string, number>> = { 'rb-mini-mission: the exploit timed-follower': 45 };

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
      expected: { passed: false, maxScore: exploitScoresSinceC2[`${key}: the exploit ${exploit.name}`] ?? exploit.maxScore },
    })),
  ];
});

export const checkCases: readonly CheckCase[] = [
  { name: 'park: a program that parks in the zone', scenario: parkScenario, project: parker, drives: 'every' },
  { name: 'park: a program that overshoots', scenario: parkScenario, project: overshooter, drives: 'every' },
  { name: 'crash: a program that hits the wall that ends the run', scenario: crashScenario, project: rammer, drives: 'every' },
  { name: 'wall: a program that faults once its goals have passed', scenario: wallScenario, project: faulter, drives: 'every' },
  ...pilotReferences,
];
