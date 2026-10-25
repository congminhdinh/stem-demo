import type { ProjectDocument } from '../../circuit/document';
import { robotProject } from '../../run/__fixtures__/robot-session';
import { driveMove, driveStop, unoDivide } from '../../program/__fixtures__/uno-blocks';
import { num, wait } from '../../program/__fixtures__/ybc-blocks';
import { loadScenario, type Scenario, type ScenarioJson } from '../scenario';

// TEST-ONLY (N18 R6.2): robot checks, a scenario and a program each, for the tests of checkRobot and its determinism (Review Focus 2:
// `same score/passed/hash for 1×, 4× and headless`). The determinism test runs every case of `checkCases`: R5.2b adds the pilot
// scenarios with their reference solutions (src/samples/robot-solutions.ts) to the list, and the same test runs them.

/** A check case: a scenario with goals, and the learner's program for it. Each call builds them anew (new block ids). */
export type CheckCase = { readonly name: string; readonly scenario: () => Scenario; readonly project: () => ProjectDocument };

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

export const checkCases: readonly CheckCase[] = [
  { name: 'park: a program that parks in the zone', scenario: parkScenario, project: parker },
  { name: 'park: a program that overshoots', scenario: parkScenario, project: overshooter },
  { name: 'crash: a program that hits the wall that ends the run', scenario: crashScenario, project: rammer },
  { name: 'wall: a program that faults once its goals have passed', scenario: wallScenario, project: faulter },
];
