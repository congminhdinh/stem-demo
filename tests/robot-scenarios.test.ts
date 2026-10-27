import * as Blockly from 'blockly/core';
import 'blockly/blocks';
import * as En from 'blockly/msg/en';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runningBlockTypes } from '../src/core/challenge/running-blocks';
import type { ProjectDocument } from '../src/core/circuit/document';
import { generateUnoSketch } from '../src/core/codegen/arduino/generate';
import { localDeviceDefinitions } from '../src/core/devices/local-catalog';
import { createDeviceRegistry } from '../src/core/devices/registry';
import { productionKits, referenceKitRef, type Kit } from '../src/core/hardware';
import { productionProfiles } from '../src/core/profiles';
import { createBlockPackCatalog } from '../src/core/program/block-packs';
import { compileUnoProject } from '../src/core/program/compile-uno-program';
import { insidePolygon } from '../src/core/scenario/goals/geometry';
import { circleShape, insideGround, rectShape, shapesOverlap, wallShape, type Shape } from '../src/core/scenario/overlap';
import { polygonsOverlap } from '../src/core/scenario/polygon-overlap';
import { SCENARIO_MAX_SCORE, scenarioKitRef, scenarioMaxScore, type RobotGoalSpec, type Scenario } from '../src/core/scenario/scenario';
import { applyVariant, kitFootprintRadiusCm, ROBOT_FOOTPRINT_RADIUS_CM, variantObjectColors, variantOffsets } from '../src/core/scenario/variants';
import { bodyColorName } from '../src/core/world/arena/body-colors';
import type { Arena } from '../src/core/world/arena/arena-schema';
import { lateralOffsetCm, pickCorners } from '../src/core/scenario/__fixtures__/check-cases';
import { robotFootprint, startFootprintIssues } from '../src/core/world/robot/footprint';
import { createScenarioWorld } from '../src/core/world/world';
import { scenarioCatalog } from '../src/samples/robot-scenarios';
import { robotScenarioManifest, serializeManifest } from '../src/samples/robot-scenarios/manifest';
import { robotSolutions, type BlocklyJson, type RobotScoredKey } from '../src/samples/robot-solutions';
import { robotSandboxKey, robotStarterDocument, robotTemplateKeys, robotTemplates } from '../src/samples/robot-templates';
import { canOpenProgram, registerBlocks } from '../src/ui/blockly/editor-blocks';
import { en, vi } from '../src/ui/i18n/messages';

// N18 R5.2a: the six scenarios of the pilot course and the sandbox (src/samples/robot-scenarios/rb-*.json), and the programs that go with
// them (src/samples/robot-solutions.ts): the starter a lesson opens with, the reference solution and, for lessons 3-6, the blind program
// (motors and waits only, timed for variant 0). What can be checked without the run session and the check (R3.6, R6.2) is checked here:
// the data loads and adds up, every variant leaves the robot room to start, every goal asks for something the robot must do, the programs
// are the JSON real Blockly saves, they compile against the scenario's profile, kit and toolbox, and the reference's sketch is a golden
// (tests/robot-solutions/rb-<key>.ino, compiled with C1's goldens by `pnpm check:arduino --require`, which names src and tests). R5.2b runs
// the programs through the check of every variant.

const registry = createDeviceRegistry(localDeviceDefinitions);
const packs = createBlockPackCatalog(registry);
const rules = { registry, profiles: productionProfiles, packs, kits: productionKits };
const kit = productionKits.get(referenceKitRef) as Kit;
/** N19 D4: the kit a scenario runs on (the reference rover for every N18 scenario, the gripper car for lessons 8-11). */
const kitOf = (scenario: Scenario): Kit => productionKits.get(scenarioKitRef(scenario) ?? referenceKitRef) as Kit;
/** N19 A2: the variants of a scenario at the radius of its own kit (the radius is required). */
const offsetsOf = (scenario: Scenario, index: number) => variantOffsets(scenario, index, kitFootprintRadiusCm(productionKits.get(scenarioKitRef(scenario) ?? referenceKitRef) as Kit));

const scoredKeys = robotTemplateKeys.filter((key): key is RobotScoredKey => key !== robotSandboxKey);
const scenarioOf = (key: string): Scenario => {
  const scenario = scenarioCatalog.get(key);
  if (!scenario) throw new Error(`no scenario ${key}`);
  return scenario;
};
const lessonsWithBlind: readonly RobotScoredKey[] = ['rb-stop-at-wall', 'rb-line-follow', 'rb-servo-gate', 'rb-mini-mission'];

/** The air the arenas keep around a start, beyond the footprint the variants use (R3.5: 11 cm; the rover's wheel corners reach 10.27 cm). */
const START_CLEARANCE_CM = 2;
const START_ROOM_CM = ROBOT_FOOTPRINT_RADIUS_CM + START_CLEARANCE_CM;
/** The slowest speed a solution may use, %: well clear of the placeholder kit's dead band (no motion under a duty of about 80, 31 %). */
const MIN_SOLUTION_SPEED = 40;

const SENSOR_BLOCKS = ['uno_ultrasonic_cm', 'uno_line_dark', 'uno_line_raw', 'uno_button_pressed'];
const MOTOR_BLOCKS = ['uno_drive_move', 'uno_motor_set'];

// --- Blockly JSON, read without Blockly ------------------------------------------------------------------------------------------------

type Json = Record<string, unknown>;
const asRecord = (value: unknown): Json | undefined => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : undefined);

/** Every block of a workspace, top blocks, statements, values and shadows alike. */
function allBlocks(workspace: unknown): Json[] {
  const found: Json[] = [];
  const pending: unknown[] = [...((asRecord(asRecord(workspace)?.blocks)?.blocks as unknown[]) ?? [])];
  while (pending.length > 0) {
    const block = asRecord(pending.pop());
    if (!block) continue;
    found.push(block);
    for (const input of Object.values(asRecord(block.inputs) ?? {})) {
      pending.push(asRecord(input)?.block, asRecord(input)?.shadow);
    }
    pending.push(asRecord(block.next)?.block);
  }
  return found;
}
const topBlocks = (workspace: unknown): Json[] => (asRecord(asRecord(workspace)?.blocks)?.blocks as Json[]) ?? [];
const blockTypes = (workspace: unknown) => new Set(allBlocks(workspace).map((block) => String(block.type)));

/** The number typed into an input (the block over a shadow wins, as in Blockly), or undefined when it is not a typed number. */
function typedNumber(block: Json, input: string): number | undefined {
  const socket = asRecord(asRecord(block.inputs)?.[input]);
  const value = asRecord(socket?.block) ?? asRecord(socket?.shadow);
  return value?.type === 'math_number' ? Number(asRecord(value.fields)?.NUM) : undefined;
}

/** The programs of a scored scenario, by name. */
function programsOf(key: RobotScoredKey): [string, BlocklyJson][] {
  const solution = robotSolutions[key];
  return [
    ['starter', scenarioOf(key).starter],
    ['reference', solution.reference],
    ...(solution.blind ? [['blind', solution.blind] as [string, BlocklyJson]] : []),
  ];
}
const solutionPrograms = scoredKeys.flatMap((key) => programsOf(key).map(([name, program]) => [key, name, program] as const));
/** The exploits of the review (R5.2a fix round 1): regression cases for R5.2b, with the most each may score. */
const exploits = scoredKeys.flatMap((key) => (robotSolutions[key].exploits ?? []).map((exploit) => [key, exploit] as const));
/** Every program a test can open, compile and hold to the toolbox: the starters, the solutions and the exploits. */
const allPrograms = [...solutionPrograms, ...exploits.map(([key, exploit]) => [key, `exploit ${exploit.name}`, exploit.program] as const)];

const projectOf = (key: RobotScoredKey | typeof robotSandboxKey, program: BlocklyJson): ProjectDocument => ({
  ...robotStarterDocument(key),
  program: { blocks: program },
});

// --- Arena shapes --------------------------------------------------------------------------------------------------------------------

/** Everything that stands on the floor of an arena (a variant's: its boxes and cylinders where the variant put them). */
function solids(arena: Arena): { name: string; shape: Shape }[] {
  return [
    ...arena.walls.map((wall, i) => ({ name: wall.id ?? `wall ${i}`, shape: wallShape(wall.fromCm[0], wall.fromCm[1], wall.toCm[0], wall.toCm[1], wall.thicknessCm) })),
    ...arena.boxes.map((box, i) => ({ name: box.id ?? `box ${i}`, shape: rectShape(box.centerCm[0], box.centerCm[1], box.sizeCm[0] / 2, box.sizeCm[1] / 2, box.yawDeg) })),
    ...arena.cylinders.map((cylinder, i) => ({ name: cylinder.id ?? `cylinder ${i}`, shape: circleShape(cylinder.centerCm[0], cylinder.centerCm[1], cylinder.radiusCm) })),
    ...arena.objects.map((object) => ({
      name: object.id,
      shape: object.shape === 'box' ? rectShape(object.centerCm[0], object.centerCm[1], object.sizeCm[0] / 2, object.sizeCm[1] / 2, object.yawDeg) : circleShape(object.centerCm[0], object.centerCm[1], object.radiusCm),
    })),
  ];
}

/** A polygon around a circle (its edges outside the circle), to ask polygonsOverlap whether a zone and the circle share an area. */
const circlePolygon = (x: number, y: number, r: number, sides = 32): [number, number][] => {
  const outer = r / Math.cos(Math.PI / sides);
  return Array.from({ length: sides }, (_, i) => [x + outer * Math.cos((2 * Math.PI * i) / sides), y + outer * Math.sin((2 * Math.PI * i) / sides)] as [number, number]);
};

/** The zones a goal is reached in: where the robot must go. */
function goalZones(goal: RobotGoalSpec): string[] {
  switch (goal.kind) {
    case 'reach-zone':
    case 'stop-in-zone':
      return [goal.zone];
    case 'checkpoints-in-order':
      return goal.zones;
    case 'servo-angle':
      return goal.whenInZone === undefined ? [] : [goal.whenInZone];
    case 'object-in-zone':
      return [goal.zone];
    default:
      return [];
  }
}
const GUARD_KINDS = ['avoid-contact', 'stay-on-line', 'object-unmoved'];
const ACHIEVEMENT_KINDS = ['reach-zone', 'checkpoints-in-order', 'stop-in-zone', 'servo-angle', 'object-in-zone', 'object-held', 'object-placed', 'object-on-object'];

// --- The scenarios -------------------------------------------------------------------------------------------------------------------

describe('the robot scenarios of this build (N18 R5.2)', () => {
  it('are one per key, in the order of the lessons, each with the profile and kit of its key', () => {
    expect(scenarioCatalog.scenarios.map((scenario) => scenario.key)).toEqual([...robotTemplateKeys]);
    for (const scenario of scenarioCatalog.scenarios) {
      expect(scenario.profile).toBe(robotTemplates[scenario.key as keyof typeof robotTemplates].profile);
      expect(scenario.kit).toBe(robotTemplates[scenario.key as keyof typeof robotTemplates].kit);
      expect(scenario.version).toBe(1);
    }
  });

  it('have the titles the UI gives them, in both languages', () => {
    for (const scenario of scenarioCatalog.scenarios) {
      const titleKey = robotTemplates[scenario.key as keyof typeof robotTemplates].titleKey;
      expect(scenario.title).toEqual({ vi: vi[titleKey], en: en[titleKey] });
    }
  });

  it('score 100 each, the sandbox nothing: no goal, no time bonus, every block', () => {
    for (const key of scoredKeys) {
      expect(scenarioMaxScore(scenarioOf(key)), key).toBe(SCENARIO_MAX_SCORE);
    }
    const sandbox = scenarioOf(robotSandboxKey);
    expect(scenarioMaxScore(sandbox)).toBeUndefined();
    expect(sandbox.goals).toEqual([]);
    expect(sandbox.scoring).toEqual({});
    expect(sandbox.toolbox).toBeUndefined();
  });

  it('list exactly these goals, with their points', () => {
    const goals = Object.fromEntries(scoredKeys.map((key) => [key, scenarioOf(key).goals.map((goal) => `${goal.id} ${goal.kind} ${goal.points}`)]));
    expect(goals).toEqual({
      'rb-drive-to-zone': ['reach-target reach-zone 30', 'stop-in-target stop-in-zone 70'],
      'rb-square-route': ['half-square checkpoints-in-order 30', 'full-square checkpoints-in-order 50', 'use-repeat uses-block 20'],
      'rb-stop-at-wall': ['stop-near-wall stop-in-zone 70', 'no-crash avoid-contact 30'],
      'rb-line-follow': ['follow-line stay-on-line 40', 'reach-garage reach-zone 60'],
      'rb-servo-gate': ['flag-at-gate servo-angle 40', 'stop-at-gate stop-in-zone 40', 'no-crash avoid-contact 20'],
      'rb-mini-mission': ['route checkpoints-in-order 25', 'follow-line stay-on-line 20', 'no-bump avoid-contact 15', 'park stop-in-zone 20', 'in-time finish-within 10'],
      'rb-grip-pick': ['grab-cube object-held 40', 'place-cube object-placed 45', 'no-crash avoid-contact 15'],
      'rb-grip-deliver': ['deliver-1 object-placed 25', 'deliver-2 object-placed 25', 'deliver-3 object-placed 25', 'no-crash avoid-contact 15'],
      'rb-grip-sort': ['grab-cube object-held 25', 'sort-cube object-placed 60', 'no-crash avoid-contact 15'],
      'rb-grip-stack': ['grab-cube object-held 20', 'stack-cube object-on-object 55', 'base-still object-unmoved 15'],
    });
    expect(scenarioOf('rb-mini-mission').scoring.timeBonusMax).toBe(10);
    expect(scenarioOf('rb-line-follow').goals[0]).toMatchObject({ minRatio: 0.85 });
    // A correct follower at 35 %, just over the placeholder kit's dead band, enters the garage at about 94 s (spike).
    expect(scenarioOf('rb-line-follow').timeLimitS).toBe(120);
    // The reference at 40 %, the slowest a solution may drive, parks by 31.1 s in every variant (spike).
    expect(scenarioOf('rb-mini-mission').goals.find((goal) => goal.kind === 'finish-within')).toMatchObject({ seconds: 35 });
  });

  it('take a robot as stopped at 0.5 cm/s at most, below the slowest crawl of the placeholder kit (R5.2a fix round 3)', () => {
    const stops = scenarioCatalog.scenarios.flatMap((scenario) => scenario.goals.flatMap((goal) => (goal.kind === 'stop-in-zone' ? [[scenario.key, goal.maxSpeedCmS, goal.holdS]] : [])));
    expect(stops).toEqual([
      ['rb-drive-to-zone', 0.5, 1],
      ['rb-stop-at-wall', 0.5, 1],
      ['rb-servo-gate', 0.5, 1],
      ['rb-mini-mission', 0.5, 1],
    ]);
  });

  it('give a guard goal no more points than the goals that ask the robot to get somewhere (R5.2a fix round 1)', () => {
    for (const key of scoredKeys) {
      const goals = scenarioOf(key).goals;
      const sum = (kinds: readonly string[]) => goals.filter((goal) => kinds.includes(goal.kind)).reduce((total, goal) => total + goal.points, 0);
      expect(sum(GUARD_KINDS), key).toBeLessThanOrEqual(sum(ACHIEVEMENT_KINDS));
    }
  });

  it('run one exact variant for the open-loop lessons 1-2, and three jittered ones for lessons 3-6', () => {
    for (const key of ['rb-drive-to-zone', 'rb-square-route', robotSandboxKey]) {
      expect(scenarioOf(key).variants, key).toMatchObject({ count: 1, startJitterCm: 0, yawJitterDeg: 0 });
      expect(scenarioOf(key).variants.obstacleJitterCm ?? 0, key).toBe(0);
    }
    for (const key of lessonsWithBlind) {
      const { variants } = scenarioOf(key);
      expect(variants.count, key).toBe(3);
      expect(variants.startJitterCm, key).toBeGreaterThan(0);
      expect(variants.yawJitterDeg, key).toBeGreaterThan(0);
    }
  });

  it('every goal asks for an action: a guard goal comes with a goal to reach, and no start lies in a zone a goal sends the robot to', () => {
    for (const key of scoredKeys) {
      const scenario = scenarioOf(key);
      const kinds = scenario.goals.map((goal) => goal.kind);
      if (kinds.some((kind) => GUARD_KINDS.includes(kind))) {
        expect(kinds.some((kind) => ACHIEVEMENT_KINDS.includes(kind)), key).toBe(true);
      }
      expect(kinds.some((kind) => ACHIEVEMENT_KINDS.includes(kind)), `${key} has a goal to reach`).toBe(true);
      // N19 D4: the gripper lessons' objects are what they pick up (none starts in its zone: the gripper lessons' own test, below).
      if (scenario.kit === 'ref-uno-rover') expect(scenario.arena.objects, `${key}: no object to push, so none starts in its zone`).toEqual([]);
      const zones = [...new Set(scenario.goals.flatMap(goalZones))];
      for (let index = 0; index < scenario.variants.count; index++) {
        const { start } = applyVariant(scenario, offsetsOf(scenario, index));
        for (const id of zones) {
          const polygon = scenario.arena.paint.zones.find((zone) => zone.id === id)!.polygonCm;
          expect(insidePolygon(polygon, start.xCm, start.yCm), `${key} variant ${index} starts in ${id}`).toBe(false);
          expect(polygonsOverlap(polygon, circlePolygon(start.xCm, start.yCm, START_ROOM_CM)), `${key} variant ${index} starts against ${id}`).toBe(false);
        }
      }
    }
  });

  it('paint no zone dark enough for a line sensor, and lines only where a goal or the sandbox needs them', () => {
    for (const scenario of scenarioCatalog.scenarios) {
      for (const zone of scenario.arena.paint.zones) {
        const rgb = Number.parseInt(zone.color.slice(1), 16);
        const luma = (0.2126 * ((rgb >> 16) & 0xff) + 0.7152 * ((rgb >> 8) & 0xff) + 0.0722 * (rgb & 0xff)) / 255;
        expect(luma, `${scenario.key} ${zone.id}`).toBeGreaterThan(0.75);
      }
      const hasLineGoal = scenario.goals.some((goal) => goal.kind === 'stay-on-line');
      // N19 D4: a gripper lesson that follows the tape to its objects (deliver, stack) has its line sensor in the toolbox and no line goal.
      const followsTape = scenario.kit === 'ref-uno-gripper' && (scenario.toolbox ?? []).includes('uno_line_dark');
      expect(scenario.arena.paint.lines.length > 0, scenario.key).toBe(hasLineGoal || followsTape || scenario.key === robotSandboxKey);
    }
  });
});

describe('the variants of every scenario (N18 R5.2)', () => {
  it('ref-uno-rover@0 fits the footprint the variants use: every part, the servo arm at every angle, lies within 11 cm of its middle', () => {
    expect(ROBOT_FOOTPRINT_RADIUS_CM).toBe(11);
    expect(robotFootprint(kit).radiusCm).toBeCloseTo(10.27, 2);
    expect(robotFootprint(kit).radiusCm).toBeLessThan(ROBOT_FOOTPRINT_RADIUS_CM);
  });

  for (const scenario of scenarioCatalog.scenarios) {
    it(`${scenario.key}: every variant starts on the ground with ${START_ROOM_CM} cm of room, clear of every wall and obstacle, the kit footprint too`, () => {
      const [width, depth] = scenario.arena.ground.sizeCm;
      for (let index = 0; index < scenario.variants.count; index++) {
        const offsets = offsetsOf(scenario, index);
        const { start, arena } = applyVariant(scenario, offsets);
        if (index === 0) {
          expect(start).toEqual(scenario.start);
          expect(arena).toBe(scenario.arena);
        } else {
          // A jittered start that did not fit would have fallen back to the authored place: none did. N19 D4: lesson 10 only turns its start
          // (plan §6: the same place in every round), so its starts stay where they are.
          const movesStart = scenario.variants.startJitterCm > 0 || (scenario.variants.startJitterAlongCm ?? 0) > 0;
          expect(offsets.start.dxCm !== 0 || offsets.start.dyCm !== 0, `variant ${index} moved`).toBe(movesStart);
        }
        const things = solids(arena);
        const room = circleShape(start.xCm, start.yCm, START_ROOM_CM);
        expect(insideGround(room, width, depth), `variant ${index} on the ground`).toBe(true);
        for (const { name, shape } of things) {
          expect(shapesOverlap(room, shape), `variant ${index} against ${name}`).toBe(false);
        }
        // What createWorld checks: no part of the kit's robot (body, wheels, caster, the servo arm at every angle) stands in anything.
        expect(startFootprintIssues(arena, kit, start, index)).toEqual([]);
        // The obstacles stay on the ground and apart, wherever the variant put them.
        const obstacles = things.filter(({ name }) => !arena.walls.some((wall, i) => (wall.id ?? `wall ${i}`) === name));
        for (const [i, { name, shape }] of obstacles.entries()) {
          expect(insideGround(shape, width, depth), name).toBe(true);
          for (const other of obstacles.slice(i + 1)) expect(shapesOverlap(shape, other.shape), `${name} against ${other.name}`).toBe(false);
        }
      }
    });
  }

  it.each(scenarioCatalog.scenarios.map((scenario) => [scenario.key, scenario] as const))(
    '%s: the world of every variant builds (createScenarioWorld): the start is clear, and the robot rests where the variant puts it',
    async (_key, scenario) => {
      for (let index = 0; index < scenario.variants.count; index++) {
        const world = await createScenarioWorld(scenario, kitOf(scenario), index);
        try {
          const { start } = applyVariant(scenario, offsetsOf(scenario, index));
          const robot = world.snapshot().robot;
          expect(Math.hypot(robot.xCm - start.xCm, robot.yCm - start.yCm), `variant ${index} settles in place`).toBeLessThan(0.5);
          expect(world.outOfArena).toBe(false);
          expect(world.sense.contacts().filter((contact) => contact.kind !== 'ground')).toEqual([]);
        } finally {
          world.dispose();
        }
      }
    },
    30_000,
  );

  it('lessons 3 and 5 move one jittered start forward and one back, each so far that a fixed drive stops at least 4 cm out of the zone', () => {
    for (const key of ['rb-stop-at-wall', 'rb-servo-gate'] as const) {
      const scenario = scenarioOf(key);
      const stopGoal = scenario.goals.find((goal) => goal.kind === 'stop-in-zone')!;
      const xs = scenario.arena.paint.zones.find((zone) => zone.id === (stopGoal as { zone: string }).zone)!.polygonCm.map(([x]) => x);
      const [zoneFrom, zoneTo] = [Math.min(...xs), Math.max(...xs)];
      // A blind program drives the distance from the authored start to the middle of the zone, along its own heading.
      const travel = (zoneFrom + zoneTo) / 2 - scenario.start.xCm;
      const ends = [1, 2].map((index) => {
        const { start } = applyVariant(scenario, offsetsOf(scenario, index));
        return start.xCm + travel * Math.cos((start.yawDeg * Math.PI) / 180);
      });
      expect(Math.max(...ends) - zoneTo, `${key}: past the zone`).toBeGreaterThanOrEqual(4);
      expect(zoneFrom - Math.min(...ends), `${key}: short of the zone`).toBeGreaterThanOrEqual(4);
    }
  });

  it('lesson 6 moves one jittered start 12 cm or more on along the start straight and one back, farther apart than the dock is long', () => {
    // A follower stopped after a fixed time stops a fixed distance along the route from where it started: with starts this far apart, the
    // stops are farther apart than the dock (23 cm along the last straight), so one of them misses it whatever the time.
    const scenario = scenarioOf('rb-mini-mission');
    expect(scenario.variants).toMatchObject({ startJitterCm: 1.5, startJitterAlongCm: 15 });
    expect(scenario.start.yawDeg).toBe(0);
    const along = [0, 1, 2].map((index) => offsetsOf(scenario, index).start.dxCm);
    const across = [1, 2].map((index) => Math.abs(offsetsOf(scenario, index).start.dyCm));
    const dockYs = scenario.arena.paint.zones.find((zone) => zone.id === 'dock')!.polygonCm.map(([, y]) => y);
    expect(Math.max(...along)).toBeGreaterThanOrEqual(12);
    expect(Math.min(...along)).toBeLessThanOrEqual(-12);
    expect(Math.max(...along) - Math.min(...along)).toBeGreaterThan(Math.max(...dockYs) - Math.min(...dockYs) + 2);
    expect(Math.max(...across)).toBeLessThanOrEqual(1.5);
  });

  it('lessons 4 and 6 turn a jittered start by 4° or more: an open-loop robot is 2.75 cm off the line within 40 cm', () => {
    for (const key of ['rb-line-follow', 'rb-mini-mission'] as const) {
      const scenario = scenarioOf(key);
      const turns = [1, 2].map((index) => Math.abs(offsetsOf(scenario, index).start.dYawDeg));
      expect(Math.max(...turns), key).toBeGreaterThanOrEqual(4);
    }
  });
});

// --- The programs --------------------------------------------------------------------------------------------------------------------

describe('the toolbox of every scenario (N18 R5.2)', () => {
  const basics = ['stem_on_start', 'stem_forever', 'math_number', 'ybc_wait_ms'];
  const drive = ['uno_drive_move', 'uno_drive_stop', 'uno_motor_set'];
  const logic = ['controls_if', 'logic_compare', 'logic_operation', 'logic_negate', 'logic_boolean'];
  const loops = ['controls_repeat_ext', 'ybc_while'];
  const print = ['text_print', 'text'];
  const gripper = ['uno_gripper_claw', 'uno_gripper_claw_angle', 'uno_gripper_lift', 'uno_gripper_lift_angle'];

  it('is the blocks the lesson teaches and the language basics', () => {
    expect(Object.fromEntries(scoredKeys.map((key) => [key, scenarioOf(key).toolbox]))).toEqual({
      'rb-drive-to-zone': [...basics, ...drive],
      'rb-square-route': [...basics, ...drive, 'controls_repeat_ext'],
      'rb-stop-at-wall': [...basics, ...drive, ...loops, ...logic, 'uno_ultrasonic_cm', ...print],
      'rb-line-follow': [...basics, ...drive, ...loops, ...logic, 'uno_line_dark', ...print],
      'rb-servo-gate': [...basics, ...drive, ...loops, ...logic, 'uno_ultrasonic_cm', 'uno_servo_set', ...print],
      'rb-mini-mission': [...basics, ...drive, ...loops, ...logic, 'uno_ultrasonic_cm', 'uno_line_dark', 'uno_servo_set', ...print],
      'rb-grip-pick': [...basics, ...drive, ...loops, ...logic, 'uno_ultrasonic_cm', 'uno_ir_detect', ...gripper, ...print],
      'rb-grip-deliver': [...basics, ...drive, ...loops, ...logic, 'uno_line_dark', 'uno_ir_detect', ...gripper, ...print],
      'rb-grip-sort': [...basics, ...drive, ...loops, ...logic, 'uno_ir_detect', 'uno_color_is', ...gripper, ...print],
      'rb-grip-stack': [...basics, ...drive, ...loops, ...logic, 'uno_line_dark', 'uno_ir_detect', ...gripper, ...print],
    });
  });

  it('offers only blocks of the scenario’s profile', () => {
    for (const scenario of scenarioCatalog.scenarios) {
      const offered = packs.typesOf(productionProfiles.get(scenario.profile)!.blockPacks);
      for (const type of scenario.toolbox ?? []) expect(offered.has(type), `${scenario.key}: ${type}`).toBe(true);
    }
  });

  it.each(allPrograms)('%s %s uses only blocks of the toolbox', (key, _name, program) => {
    const toolbox = new Set(scenarioOf(key).toolbox);
    expect([...blockTypes(program)].filter((type) => !toolbox.has(type))).toEqual([]);
  });
});

describe('the programs of every scenario (N18 R5.2)', () => {
  it.each(allPrograms)('%s %s compiles for its profile and kit, with no diagnostic', (key, _name, program) => {
    const compiled = compileUnoProject(projectOf(key, program), rules);
    expect(compiled.ok ? compiled.diagnostics : compiled).toEqual([]);
  });

  it('the sandbox starter compiles too, on start and forever with nothing in them', () => {
    const starter = scenarioOf(robotSandboxKey).starter;
    expect(topBlocks(starter).map((block) => [block.type, block.inputs])).toEqual([
      ['stem_on_start', undefined],
      ['stem_forever', undefined],
    ]);
    const compiled = compileUnoProject(projectOf(robotSandboxKey, starter), rules);
    expect(compiled.ok ? compiled.diagnostics : compiled).toEqual([]);
  });

  it.each(scoredKeys)('%s starts from its lesson’s hat with one loose drive block, so nothing moves until the learner builds the program', (key) => {
    const starter = scenarioOf(key).starter;
    const hatType = ['rb-drive-to-zone', 'rb-square-route', 'rb-grip-pick', 'rb-grip-deliver', 'rb-grip-sort', 'rb-grip-stack'].includes(key) ? 'stem_on_start' : 'stem_forever';
    expect(topBlocks(starter).map((block) => [block.type, block.disabledReasons, block.inputs])).toEqual([
      [hatType, undefined, undefined],
      ['uno_drive_move', ['ORPHANED_BLOCK'], { SPEED: { shadow: { type: 'math_number', id: 'prepared-drive-speed', fields: { NUM: 50 } } } }],
    ]);
    expect([...runningBlockTypes(starter)]).toEqual([hatType]);
  });

  it('lessons 3-6 have a blind program, lessons 1-2 do not', () => {
    expect(scoredKeys.filter((key) => robotSolutions[key].blind !== undefined)).toEqual([...lessonsWithBlind, 'rb-grip-pick', 'rb-grip-deliver', 'rb-grip-stack']);
    expect(Object.keys(robotSolutions)).toEqual(scoredKeys);
    for (const key of scoredKeys) expect(robotSolutions[key].notes.length, key).toBeGreaterThan(100);
  });

  it('a blind program, and the references of the open-loop lessons, read no sensor: motors and waits in "on start"', () => {
    const openLoop = [
      ...lessonsWithBlind.map((key) => [`${key} blind`, robotSolutions[key].blind!] as const),
      ['rb-drive-to-zone reference', robotSolutions['rb-drive-to-zone'].reference] as const,
      ['rb-square-route reference', robotSolutions['rb-square-route'].reference] as const,
    ];
    for (const [name, program] of openLoop) {
      const types = blockTypes(program);
      expect(SENSOR_BLOCKS.filter((type) => types.has(type)), name).toEqual([]);
      expect(topBlocks(program).map((block) => block.type), name).toEqual(['stem_on_start']);
      expect(types.has('uno_drive_move'), name).toBe(true);
      expect(types.has('ybc_wait_ms'), name).toBe(true);
    }
  });

  it('the reference of a sensor lesson reads the sensors the lesson is about, in "forever"', () => {
    const sensors: Record<string, string[]> = {
      'rb-stop-at-wall': ['uno_ultrasonic_cm'],
      'rb-line-follow': ['uno_line_dark'],
      'rb-servo-gate': ['uno_ultrasonic_cm', 'uno_servo_set'],
      'rb-mini-mission': ['uno_ultrasonic_cm', 'uno_line_dark'],
    };
    for (const [key, needed] of Object.entries(sensors)) {
      const reference = robotSolutions[key as RobotScoredKey].reference;
      expect(needed.filter((type) => !runningBlockTypes(reference).has(type)), key).toEqual([]);
      expect(topBlocks(reference).map((block) => block.type), key).toEqual(['stem_forever']);
    }
  });

  it.each(solutionPrograms)(`%s %s drives at ${MIN_SOLUTION_SPEED} % or more (or 0), a number typed in`, (_key, _name, program) => {
    for (const block of allBlocks(program).filter((candidate) => MOTOR_BLOCKS.includes(String(candidate.type)))) {
      const speed = typedNumber(block, 'SPEED');
      expect(speed, String(block.id)).toBeDefined();
      expect(speed === 0 || Math.abs(speed!) >= MIN_SOLUTION_SPEED, `${String(block.id)}: ${speed}`).toBe(true);
    }
  });

  it('the uses-block goal of lesson 2 is met by its reference and not by its starter', () => {
    expect(runningBlockTypes(robotSolutions['rb-square-route'].reference).has('controls_repeat_ext')).toBe(true);
    expect(runningBlockTypes(scenarioOf('rb-square-route').starter).has('controls_repeat_ext')).toBe(false);
  });

  it('lessons 3-6 have the exploits of the reviews, each named, each held to at most 60 (rule 10)', () => {
    expect(exploits.map(([key, exploit]) => `${key} ${exploit.name} ${exploit.maxScore}`)).toEqual([
      'rb-stop-at-wall crash-and-back-off 0',
      'rb-stop-at-wall dash-then-creep 0',
      'rb-line-follow crawl-and-dash 0',
      'rb-line-follow short-drive 40',
      'rb-line-follow three-leg-route 60',
      'rb-servo-gate flag-and-crash 40',
      'rb-servo-gate flag-crash-and-back-off 40',
      'rb-servo-gate flag-dash-then-creep 40',
      'rb-mini-mission follower-without-distance 45',
      'rb-mini-mission timed-follower 45',
      'rb-mini-mission timed-follower-creep 45',
      'rb-mini-mission timed-follower-creep-forever 45',
      'rb-mini-mission follower-bump-and-back 45',
      'rb-grip-pick never-lower-arm 15',
      'rb-grip-pick push-in 15',
      'rb-grip-pick hold-in-zone 55',
      'rb-grip-pick push-closed-then-lift 55',
      'rb-grip-deliver push-north 15',
      'rb-grip-deliver open-jaw-sweep-lift 15',
      'rb-grip-sort always-turn-left 40',
      'rb-grip-sort only-check-red 40',
      'rb-grip-stack place-beside-base 35',
      'rb-grip-stack hold-over-base 35',
      'rb-grip-stack arm-too-low 20',
      'rb-grip-stack lower-arm-fully 35',
    ]);
    for (const [key, exploit] of exploits) {
      expect(exploit.name, key).toMatch(/^[a-z0-9-]+$/);
      expect(exploit.maxScore, `${key} ${exploit.name}`).toBeLessThanOrEqual(60);
      expect(exploit.description.length).toBeGreaterThan(40);
    }
    expect(new Set(exploits.map(([key, exploit]) => `${key} ${exploit.name}`)).size).toBe(exploits.length);
  });

  it('end the run at the first touch of what the avoid-contact goal names, in lessons 3, 5 and 6 (endOnContact)', () => {
    const ending = Object.fromEntries(scenarioCatalog.scenarios.map((scenario) => [scenario.key, scenario.endOnContact]));
    expect(ending).toEqual({
      'rb-drive-to-zone': undefined,
      'rb-square-route': undefined,
      'rb-stop-at-wall': ['wall'],
      'rb-line-follow': undefined,
      'rb-servo-gate': ['gate'],
      'rb-mini-mission': ['obstacle'],
      'rb-grip-pick': ['wall'],
      'rb-grip-deliver': ['wall'],
      'rb-grip-sort': ['wall'],
      'rb-grip-stack': ['wall'],
      'rb-sandbox': undefined,
    });
    // N19 D4: on the gripper car every wall ends a run (G0 ruling), with an avoid-contact goal or not (lesson 11 has none): the gripper
    // lessons' own test, below, holds them to it.
    for (const scenario of scenarioCatalog.scenarios.filter((candidate) => candidate.endOnContact !== undefined && candidate.kit === 'ref-uno-rover')) {
      const avoided = scenario.goals.flatMap((goal) => (goal.kind === 'avoid-contact' ? [goal.tag] : []));
      expect(scenario.endOnContact, scenario.key).toEqual(avoided);
    }
  });

  it('the tape of lesson 6 runs on to the dock wall, so a follower that stops when it loses the tape meets the wall first', () => {
    const scenario = scenarioOf('rb-mini-mission');
    const end = scenario.arena.paint.lines[0]!.pointsCm.at(-1)!;
    const wall = scenario.arena.walls.find((candidate) => candidate.id === 'dock-wall')!;
    const wallFaceY = wall.fromCm[1] - wall.thicknessCm / 2;
    expect(wallFaceY - end[1]).toBeGreaterThan(0);
    expect(wallFaceY - end[1]).toBeLessThanOrEqual(2);
    // A follower that stops when it loses the tape stops once its sensors (7 cm ahead of the middle) are past the tape's round end, half
    // its width beyond the last point: its front (7.5 cm ahead) would be past the wall's face, so it meets the wall first. The reference
    // stops on the echo under 15 cm, its middle 22.5 cm before the face, in the dock.
    const lostAtFrontY = end[1] + scenario.arena.paint.lines[0]!.widthCm / 2 - 7 + 7.5;
    const dock = scenario.arena.paint.zones.find((zone) => zone.id === 'dock')!.polygonCm.map(([, y]) => y);
    expect(lostAtFrontY).toBeGreaterThan(wallFaceY);
    expect(wallFaceY - 22.5).toBeGreaterThan(Math.min(...dock));
    expect(wallFaceY - 22.5).toBeLessThan(Math.max(...dock));
  });

  it('the servo of lesson 5 starts outside the range of its goal (the Servo library writes 90° when attached) and the reference turns it in', () => {
    const goal = scenarioOf('rb-servo-gate').goals.find((candidate) => candidate.kind === 'servo-angle') as { minDeg: number; maxDeg: number };
    const servo = allBlocks(robotSolutions['rb-servo-gate'].reference).find((block) => block.type === 'uno_servo_set')!;
    const angle = typedNumber(servo, 'ANGLE')!;
    expect(90 < goal.minDeg || 90 > goal.maxDeg).toBe(true);
    expect(angle).toBeGreaterThanOrEqual(goal.minDeg + 10);
    expect(angle).toBeLessThanOrEqual(goal.maxDeg - 10);
  });
});

describe('the programs as real Blockly saves them (N18 R5.2)', () => {
  Blockly.setLocale(En as unknown as Record<string, string>);
  registerBlocks(packs);
  const everyProgram = [...allPrograms.map(([key, name, program]) => [`${key} ${name}`, program] as const), [`${robotSandboxKey} starter`, scenarioOf(robotSandboxKey).starter] as const];

  it.each(everyProgram)('%s opens in the editor and saves back the same JSON', (_name, program) => {
    expect(canOpenProgram(program, packs)).toBe(true);
    const workspace = new Blockly.Workspace();
    try {
      Blockly.serialization.workspaces.load(structuredClone(program), workspace);
      expect(Blockly.serialization.workspaces.save(workspace)).toEqual(program);
    } finally {
      workspace.dispose();
    }
  });
});

// --- N19 D4: the gripper car's lessons 8-11 (plan §6) ------------------------------------------------------------------------------
//
// What the N18 tests above check of every scenario holds for these four too (the toolbox, the programs compile and open in Blockly, the time
// limits, the scores); what is particular to them is checked here: the arenas and goals of plan §6, the objects the gripper takes, the
// properties each lesson's variants rely on (the static pins of the seeds spikes/n19-d4 chose), the start clear of the gripper's whole sweep
// (B5/B6 ruling), the walls on the claw's path that end a run (G0 ruling), and the programs: what the references read, what the blind
// programs do not, the speeds the gripper car starts from (G0 ruling), the exploits' ceilings.

const gripperKeys = ['rb-grip-pick', 'rb-grip-deliver', 'rb-grip-sort', 'rb-grip-stack'] as const satisfies readonly RobotScoredKey[];
const gripperKit = productionKits.get({ id: 'ref-uno-gripper', version: '0' }) as Kit;
const xsOf = (polygon: readonly (readonly [number, number])[]) => [Math.min(...polygon.map(([x]) => x)), Math.max(...polygon.map(([x]) => x))];
const ysOf = (polygon: readonly (readonly [number, number])[]) => [Math.min(...polygon.map(([, y]) => y)), Math.max(...polygon.map(([, y]) => y))];
const zoneOf = (scenario: Scenario, id: string) => scenario.arena.paint.zones.find((zone) => zone.id === id)!;
const objectOf = (scenario: Scenario, id: string) => scenario.arena.objects.find((object) => object.id === id)!;
/** The sensor blocks of the gripper car: none of them in a blind program. */
const GRIPPER_SENSOR_BLOCKS = [...SENSOR_BLOCKS, 'uno_ir_detect', 'uno_color_is', 'uno_color_raw'];
/** G0 ruling (start duty): the gripper car starts from rest with 50 g held from duty 128, so its programs drive at 50 % or more. */
const MIN_GRIPPER_SPEED = 50;

describe('the gripper car’s lessons 8-11 (N19 D4, plan §6)', () => {
  it('are four, on ref-uno-gripper@0 and uno-basic, version 1, after the six pilots and before the sandbox, titled as plan §6 says', () => {
    expect(robotTemplateKeys.slice(6)).toEqual([...gripperKeys, robotSandboxKey]);
    expect(gripperKeys.map((key) => [scenarioOf(key).kit, scenarioOf(key).profile, scenarioOf(key).version, robotTemplates[key].kit])).toEqual(
      gripperKeys.map(() => ['ref-uno-gripper', 'uno-basic', 1, 'ref-uno-gripper']),
    );
    expect(gripperKeys.map((key) => scenarioOf(key).title)).toEqual([
      { vi: 'Tìm và gắp', en: 'Find and pick up' },
      { vi: 'Giao hàng theo vạch', en: 'Deliver along the line' },
      { vi: 'Phân loại theo màu', en: 'Sort by colour' },
      { vi: 'Xếp chồng', en: 'Stack the cube' },
    ]);
    expect(gripperKeys.map((key) => [scenarioOf(key).arena.ground.sizeCm, scenarioOf(key).timeLimitS, scenarioOf(key).scoring.timeBonusMax])).toEqual([
      [[170, 90], 30, undefined],
      [[180, 150], 90, 10],
      [[170, 150], 30, undefined],
      [[200, 80], 45, 10],
    ]);
  });

  it('take only square things, seen from above: 4 cm foam cubes of 15 g, and the stack’s 6 × 6 × 4 cm base of 40 g (B1/B2 review M6)', () => {
    const objects = gripperKeys.flatMap((key) => scenarioOf(key).arena.objects.map((object) => [key, object.id, object.shape, object.shape === 'box' ? object.sizeCm : null, object.massG, object.noun, object.color]));
    expect(objects).toEqual([
      ['rb-grip-pick', 'cube', 'box', [4, 4, 4], 15, 'cube', '#fbc02d'],
      ['rb-grip-deliver', 'parcel-1', 'box', [4, 4, 4], 15, 'parcel', undefined],
      ['rb-grip-deliver', 'parcel-2', 'box', [4, 4, 4], 15, 'parcel', undefined],
      ['rb-grip-deliver', 'parcel-3', 'box', [4, 4, 4], 15, 'parcel', undefined],
      ['rb-grip-sort', 'cube', 'box', [4, 4, 4], 15, 'cube', '#388e3c'],
      ['rb-grip-stack', 'cube', 'box', [4, 4, 4], 15, 'cube', '#d32f2f'],
      ['rb-grip-stack', 'base', 'box', [6, 6, 4], 40, 'base', '#fbc02d'],
    ]);
    for (const key of gripperKeys) {
      for (const object of scenarioOf(key).arena.objects) {
        if (object.shape === 'box') expect(object.sizeCm[0], `${key} ${object.id}`).toBe(object.sizeCm[1]);
        if (object.shape === 'box') expect(object.yawDeg, `${key} ${object.id}`).toBe(0);
      }
    }
  });

  it('lay out the arenas of plan §6: the zones the goals name, where the objects lie, the tape', () => {
    const pick = scenarioOf('rb-grip-pick');
    expect([xsOf(zoneOf(pick, 'pickup').polygonCm), zoneOf(pick, 'pickup').name, xsOf(zoneOf(pick, 'drop').polygonCm), zoneOf(pick, 'drop').name, objectOf(pick, 'cube').centerCm]).toEqual([[70, 100], 'pickup', [108, 148], 'drop', [85, 45]]);
    const deliver = scenarioOf('rb-grip-deliver');
    expect(deliver.arena.paint.lines.map((line) => line.pointsCm)).toEqual([[[120, 10], [120, 135]]]);
    expect([xsOf(zoneOf(deliver, 'kho').polygonCm), ysOf(zoneOf(deliver, 'kho').polygonCm), zoneOf(deliver, 'kho').name]).toEqual([[62, 100], [40, 125], 'warehouse']);
    expect(deliver.arena.objects.map((object) => object.centerCm)).toEqual([[120, 70], [120, 95], [120, 120]]);
    const shelf = deliver.arena.walls.filter((wall) => wall.tags.includes('kho-wall'));
    // E6/E7: the shelf is modelled for a wall of 40 × 4 × 12 cm; west of the warehouse, facing it.
    expect(shelf.map((wall) => [wall.id, wall.fromCm, wall.toCm, wall.thicknessCm, wall.heightCm])).toEqual([['kho-shelf', [58, 62.5], [58, 102.5], 4, 12]]);
    const sort = scenarioOf('rb-grip-sort');
    const [red, green, blue] = ['red-zone', 'green-zone', 'blue-zone'].map((id) => zoneOf(sort, id));
    expect([red!.name, green!.name, blue!.name, zoneOf(sort, 'start').color]).toEqual(['red', 'green', 'blue', '#e0e0e0']);
    // Red north, green straight ahead (east), blue south of the start, which faces +x.
    expect(sort.start.yawDeg).toBe(0);
    expect(ysOf(red!.polygonCm)[0]).toBeGreaterThan(sort.start.yCm);
    expect(ysOf(blue!.polygonCm)[1]).toBeLessThan(sort.start.yCm);
    expect(xsOf(green!.polygonCm)[0]).toBeGreaterThan(sort.start.xCm);
    const stack = scenarioOf('rb-grip-stack');
    expect(stack.arena.paint.lines.map((line) => line.pointsCm)).toEqual([[[14, 40], [150, 40]]]);
    expect([objectOf(stack, 'cube').centerCm, objectOf(stack, 'base').centerCm]).toEqual([[95, 40], [158, 40]]);
    // The tape ends where the reference stops with the cube over the base (spikes/n19-d4: the middle at x 144.5, the cube at 157.8).
    expect(insidePolygon(zoneOf(stack, 'stack').polygonCm, 158, 40)).toBe(true);
  });

  it('ask for the goals of plan §6, with their parameters', () => {
    /** Each goal's parameters: what it has besides its id, label, points and kind. */
    const params = (key: (typeof gripperKeys)[number]) =>
      scenarioOf(key).goals.map((goal) => [goal.id, Object.fromEntries(Object.entries(goal).filter(([field]) => !['id', 'label', 'points', 'kind'].includes(field)))]);
    expect(params('rb-grip-pick')).toEqual([
      ['grab-cube', { object: 'cube', holdS: 0.5, minLiftCm: 2 }],
      ['place-cube', { object: 'cube', zone: 'drop', fully: true, maxTiltDeg: 15, restS: 0.5, carried: true, maxSlideCm: 3, minCarryLiftCm: 1, minCarryCm: 5 }],
      ['no-crash', { tag: 'wall' }],
    ]);
    expect(params('rb-grip-deliver')).toEqual([
      ...[1, 2, 3].map((n) => [`deliver-${n}`, { object: `parcel-${n}`, zone: 'kho', fully: true, maxTiltDeg: 15, restS: 0.5, carried: true, maxSlideCm: 3, minCarryLiftCm: 1, minCarryCm: 5 }]),
      ['no-crash', { tag: 'wall' }],
    ]);
    expect(params('rb-grip-sort')).toEqual([
      ['grab-cube', { object: 'cube', holdS: 0.5, minLiftCm: 2 }],
      ['sort-cube', { object: 'cube', zoneByColor: { '#d32f2f': 'red-zone', '#388e3c': 'green-zone', '#1976d2': 'blue-zone' }, fully: true, maxTiltDeg: 15, restS: 0.5, carried: true, maxSlideCm: 3, minCarryLiftCm: 1, minCarryCm: 5 }],
      ['no-crash', { tag: 'wall' }],
    ]);
    expect(params('rb-grip-stack')).toEqual([
      ['grab-cube', { object: 'cube', holdS: 0.5, minLiftCm: 3 }],
      ['stack-cube', { top: 'cube', bottom: 'base', maxOffsetCm: 1.5, maxTiltDeg: 10, restS: 0.5, carried: true, minCarryLiftCm: 1, minCarryCm: 5 }],
      ['base-still', { object: 'base', maxMoveCm: 2, maxTiltDeg: 20 }],
    ]);
  });

  it('end the run at the first touch of any wall (endOnContact ["wall"]): every wall is on a path the claw may take (G0 ruling), and the guard names the same', () => {
    for (const key of gripperKeys) {
      const scenario = scenarioOf(key);
      expect(scenario.endOnContact, key).toEqual(['wall']);
      // Every wall carries its kind, `wall` (build-arena.ts): the shelf of the warehouse too.
      expect(scenario.arena.walls.length, key).toBeGreaterThanOrEqual(4);
      const guards = scenario.goals.flatMap((goal) => (goal.kind === 'avoid-contact' ? [goal.tag] : []));
      expect(guards, key).toEqual(key === 'rb-grip-stack' ? [] : ['wall']);
    }
  });

  it('put no object in the zone a goal puts it in, and no start in a zone a goal sends something to', () => {
    for (const key of gripperKeys) {
      const scenario = scenarioOf(key);
      const targets = scenario.goals.flatMap((goal) =>
        goal.kind === 'object-placed' ? [[goal.object, goal.zone !== undefined ? [goal.zone] : Object.values(goal.zoneByColor!)] as const] : [],
      );
      for (let index = 0; index < scenario.variants.count; index++) {
        const { start, arena } = applyVariant(scenario, offsetsOf(scenario, index));
        for (const [objectId, zoneIds] of targets) {
          const object = arena.objects.find((candidate) => candidate.id === objectId)!;
          for (const id of zoneIds) {
            expect(insidePolygon(zoneOf(scenario, id).polygonCm, object.centerCm[0], object.centerCm[1]), `${key} variant ${index}: ${objectId} in ${id}`).toBe(false);
            expect(polygonsOverlap(zoneOf(scenario, id).polygonCm, circlePolygon(start.xCm, start.yCm, kitFootprintRadiusCm(gripperKit))), `${key} variant ${index} starts against ${id}`).toBe(false);
          }
        }
      }
    }
  });

  it('start every variant with every object out of the gripper’s whole sweep, at every lift and claw angle (B5/B6 ruling, the footprint’s own sweep)', () => {
    for (const key of gripperKeys) {
      const scenario = scenarioOf(key);
      for (let index = 0; index < scenario.variants.count; index++) {
        const { start, arena } = applyVariant(scenario, offsetsOf(scenario, index));
        // The world's own check: the walls against the whole sweep, the objects against the gripper as setup() leaves it.
        expect(startFootprintIssues(arena, gripperKit, start, index), `${key} variant ${index}`).toEqual([]);
        // The ruling's: each object as a box or cylinder, which footprint.ts checks against every lift and claw angle.
        const asObstacles = {
          walls: [],
          boxes: arena.objects.flatMap((object) => (object.shape === 'box' ? [{ id: object.id, centerCm: object.centerCm, sizeCm: object.sizeCm, yawDeg: object.yawDeg, body: 'fixed' as const, tags: [], ultrasonic: true }] : [])),
          cylinders: arena.objects.flatMap((object) => (object.shape === 'cylinder' ? [{ id: object.id, centerCm: object.centerCm, radiusCm: object.radiusCm, heightCm: object.heightCm, body: 'fixed' as const, tags: [], ultrasonic: true }] : [])),
          objects: [],
        };
        expect(startFootprintIssues(asObstacles, gripperKit, start, index), `${key} variant ${index}`).toEqual([]);
      }
    }
    // Not vacuous: a cube 12 cm ahead of the pick lesson's start, between the open jaws as setup() leaves them, is clear of that pose but under
    // the lowered arm's path, and the sweep says so.
    const pick = scenarioOf('rb-grip-pick');
    const ahead = [{ id: 'cube', centerCm: [pick.start.xCm + 12, pick.start.yCm] as [number, number], sizeCm: [4, 4, 4] as [number, number, number], yawDeg: 0, body: 'fixed' as const, tags: [], ultrasonic: true }];
    expect(startFootprintIssues({ walls: [], boxes: ahead, cylinders: [], objects: [] }, gripperKit, pick.start)).toEqual([
      { path: 'start', message: expect.stringContaining('gripper') },
    ]);
  });

  it('lesson 8 moves the cube 7 cm or more on in one variant and 7 cm or more back in another, and the start by 1 cm and 2° at most', () => {
    const scenario = scenarioOf('rb-grip-pick');
    expect(scenario.variants).toMatchObject({ count: 3, seed: 23, startJitterCm: 1, yawJitterDeg: 2, objectJitter: [{ objects: ['cube'], dxCm: 10, dyCm: 0 }] });
    const moves = [1, 2].map((index) => offsetsOf(scenario, index).objects![0]!);
    expect(Math.max(...moves.map((move) => move.dxCm))).toBeGreaterThanOrEqual(7);
    expect(Math.min(...moves.map((move) => move.dxCm))).toBeLessThanOrEqual(-7);
    expect(moves.map((move) => move.dyCm)).toEqual([0, 0]);
  });

  it('lesson 8 puts the cube at most 3.3 cm off the start’s line of travel over its whole variant range: the corners the check proves (review 1 I1)', () => {
    const scenario = scenarioOf('rb-grip-pick');
    const { startJitterCm: s, yawJitterDeg: a } = scenario.variants;
    const c = scenario.variants.objectJitter![0]!.dxCm;
    const cube = scenario.arena.objects[0]!.centerCm;
    const offsetAt = (dx: number, dy: number, dYaw: number, dc: number) =>
      Math.abs(lateralOffsetCm({ xCm: scenario.start.xCm + dx, yCm: scenario.start.yCm + dy, yawDeg: scenario.start.yawDeg + dYaw }, [cube[0] + dc, cube[1]]));
    // A 9 × 9 × 9 × 9 grid over the range: the largest offset is at its corners (linear in the moves, monotone in the turn).
    const steps = (j: number) => Array.from({ length: 9 }, (_, k) => -j + (k * j) / 4);
    let worst = 0;
    for (const dx of steps(s)) for (const dy of steps(s)) for (const dYaw of steps(a)) for (const dc of steps(c)) worst = Math.max(worst, offsetAt(dx, dy, dYaw, dc));
    expect(worst).toBeCloseTo(3.30, 2);
    expect(worst).toBeCloseTo(Math.max(...pickCorners().map((corner) => Math.abs(corner.offsetCm))), 9);
    // The shipped rounds lie inside it (seed 23).
    const shipped = [0, 1, 2].map((index) => {
      const { start, arena } = applyVariant(scenario, offsetsOf(scenario, index));
      return Math.round(Math.abs(lateralOffsetCm(start, arena.objects[0]!.centerCm)) * 100) / 100;
    });
    expect(shipped).toEqual([0, 0.73, 1.91]);
  });

  it('lesson 9 turns one jittered start by 4° or more and moves the starts 4 cm or more on and back along the tape, the parcels along it only', () => {
    const scenario = scenarioOf('rb-grip-deliver');
    expect(scenario.variants).toMatchObject({ count: 3, seed: 430, startJitterCm: 0, startJitterAlongCm: 6, yawJitterDeg: 5 });
    const starts = [1, 2].map((index) => offsetsOf(scenario, index).start);
    expect(Math.max(...starts.map((start) => Math.abs(start.dYawDeg)))).toBeGreaterThanOrEqual(4);
    // The start faces +y (along the tape): along is dy, and nothing across it.
    expect(starts.map((start) => start.dxCm)).toEqual([0, 0]);
    expect(Math.max(...starts.map((start) => start.dyCm))).toBeGreaterThanOrEqual(4);
    expect(Math.min(...starts.map((start) => start.dyCm))).toBeLessThanOrEqual(-4);
    for (const index of [1, 2]) {
      const parcels = offsetsOf(scenario, index).objects!;
      expect(parcels.map((move) => move.dxCm)).toEqual([0, 0, 0]);
      expect(Math.max(...parcels.map((move) => Math.abs(move.dyCm))), `variant ${index}`).toBeGreaterThanOrEqual(2);
    }
  });

  it('lesson 10 keeps the start and the cube where they are in every round, only the colour changes: green, red, blue', () => {
    const scenario = scenarioOf('rb-grip-sort');
    expect(scenario.variants).toMatchObject({ count: 3, seed: 8, startJitterCm: 0, yawJitterDeg: 3 });
    expect(scenario.variants.objectJitter).toBeUndefined();
    for (let index = 0; index < 3; index++) {
      const offsets = offsetsOf(scenario, index);
      expect([offsets.start.dxCm, offsets.start.dyCm, Math.abs(offsets.start.dYawDeg) <= 3]).toEqual([0, 0, true]);
      expect(applyVariant(scenario, offsets).arena.objects.map((object) => object.centerCm)).toEqual([[49, 75]]);
    }
    const colours = [0, 1, 2].map((index) => variantObjectColors(scenario, index).cube);
    expect(colours.map((colour) => bodyColorName(colour))).toEqual(['green', 'red', 'blue']);
    // Each colour has the zone of its name.
    const goal = scenario.goals.find((candidate) => candidate.kind === 'object-placed') as { zoneByColor: Record<string, string> };
    expect(colours.map((colour) => zoneOf(scenario, goal.zoneByColor[colour!]!).name)).toEqual(['green', 'red', 'blue']);
  });

  it('lesson 11 moves one jittered start 9 cm or more on along the tape and one 9 cm or more back, and the red cube by up to 5 cm', () => {
    const scenario = scenarioOf('rb-grip-stack');
    expect(scenario.variants).toMatchObject({ count: 3, seed: 217, startJitterCm: 0, startJitterAlongCm: 12, yawJitterDeg: 0, objectJitter: [{ objects: ['cube'], dxCm: 5, dyCm: 0 }] });
    const along = [1, 2].map((index) => offsetsOf(scenario, index).start.dxCm);
    expect(Math.max(...along)).toBeGreaterThanOrEqual(9);
    expect(Math.min(...along)).toBeLessThanOrEqual(-9);
    expect([1, 2].map((index) => offsetsOf(scenario, index).start.dyCm)).toEqual([0, 0]);
    expect([1, 2].map((index) => offsetsOf(scenario, index).objects![1])).toEqual([{ dxCm: 0, dyCm: 0 }, { dxCm: 0, dyCm: 0 }]);
  });

  it('give each lesson 8, 9 and 11 a blind program that reads no sensor: in "on start", motors, the gripper and waits', () => {
    for (const key of ['rb-grip-pick', 'rb-grip-deliver', 'rb-grip-stack'] as const) {
      const types = blockTypes(robotSolutions[key].blind!);
      expect(GRIPPER_SENSOR_BLOCKS.filter((type) => types.has(type)), key).toEqual([]);
      expect(topBlocks(robotSolutions[key].blind!).map((block) => block.type), key).toEqual(['stem_on_start']);
      expect(['uno_drive_move', 'ybc_wait_ms', 'uno_gripper_claw'].filter((type) => !types.has(type)), key).toEqual([]);
    }
    expect(robotSolutions['rb-grip-sort'].blind).toBeUndefined();
  });

  it('have references that read the sensors the lesson is about, in "on start", lesson 11 carrying at 55°', () => {
    const sensors: Record<(typeof gripperKeys)[number], string[]> = {
      'rb-grip-pick': ['uno_ultrasonic_cm', 'uno_ir_detect'],
      'rb-grip-deliver': ['uno_line_dark', 'uno_ir_detect'],
      'rb-grip-sort': ['uno_ir_detect', 'uno_color_is'],
      'rb-grip-stack': ['uno_line_dark', 'uno_ir_detect'],
    };
    for (const key of gripperKeys) {
      const reference = robotSolutions[key].reference;
      expect(sensors[key].filter((type) => !runningBlockTypes(reference).has(type)), key).toEqual([]);
      expect(topBlocks(reference).map((block) => block.type), key).toEqual(['stem_on_start']);
    }
    const arm = allBlocks(robotSolutions['rb-grip-stack'].reference).filter((block) => block.type === 'uno_gripper_lift_angle');
    expect(arm.map((block) => typedNumber(block, 'ANGLE'))).toEqual([55]);
  });

  it.each(gripperKeys.flatMap((key) => allPrograms.filter(([candidate]) => candidate === key)))(
    `%s %s drives the gripper car at ${MIN_GRIPPER_SPEED} % or more (or 0)`,
    (_key, _name, program) => {
      for (const block of allBlocks(program).filter((candidate) => MOTOR_BLOCKS.includes(String(candidate.type)))) {
        const speed = typedNumber(block, 'SPEED')!;
        expect(speed === 0 || Math.abs(speed) >= MIN_GRIPPER_SPEED, `${String(block.id)}: ${speed}`).toBe(true);
      }
    },
  );

  it('hold each exploit to its ceiling in plan §6', () => {
    const ceilings = Object.fromEntries(gripperKeys.flatMap((key) => (robotSolutions[key].exploits ?? []).map((exploit) => [`${key} ${exploit.name}`, exploit.maxScore])));
    expect(ceilings).toEqual({
      'rb-grip-pick never-lower-arm': 15,
      'rb-grip-pick push-in': 15,
      'rb-grip-pick hold-in-zone': 55,
      // Review 1 M1: pushed in with the claw closed, then gripped and lifted in place: no carry, as hold-in-zone holds.
      'rb-grip-pick push-closed-then-lift': 55,
      'rb-grip-deliver push-north': 15,
      'rb-grip-deliver open-jaw-sweep-lift': 15,
      'rb-grip-sort always-turn-left': 40,
      'rb-grip-sort only-check-red': 40,
      'rb-grip-stack place-beside-base': 35,
      'rb-grip-stack hold-over-base': 35,
      'rb-grip-stack arm-too-low': 20,
      // Controller ruling D4 item B: plan §6's "hạ hết tay (≤ 20)" is two exploits, the carry too low (20) and the arm lowered on the base (35).
      'rb-grip-stack lower-arm-fully': 35,
    });
  });

  it.each(gripperKeys)('%s: the reference’s Arduino sketch is its golden, on the gripper car', async (key) => {
    const compiled = compileUnoProject(projectOf(key, robotSolutions[key].reference), rules);
    if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
    const sketch = generateUnoSketch(compiled.ir, { kit: compiled.kit, board: compiled.board, scenario: { key, version: scenarioOf(key).version } });
    if (!sketch.ok) throw new Error(JSON.stringify(sketch.diagnostics));
    expect(sketch.source.split('\n')[0]).toBe(`// Scenario: ${key}@1, kit: ref-uno-gripper@0, board: uno-r3@0`);
    await expect(sketch.source).toMatchFileSnapshot(`./robot-solutions/${key}.ino`);
  });
});

// The sketches are not in a `__golden__` folder: scripts/check-arduino.mjs finds those by default, and check-arduino.test.ts pins that
// default to C1's own cases. `pnpm check:arduino` names src and tests, so it compiles every .ino in them, these too.
describe('the sketches of the reference solutions (N18 R5.2, goldens like C1’s)', () => {
  const goldenDir = join(import.meta.dirname, 'robot-solutions');

  it.each(scoredKeys)('%s: the reference’s Arduino sketch is its golden', async (key) => {
    const compiled = compileUnoProject(projectOf(key, robotSolutions[key].reference), rules);
    if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
    const sketch = generateUnoSketch(compiled.ir, { kit: compiled.kit, board: compiled.board, scenario: { key, version: scenarioOf(key).version } });
    if (!sketch.ok) throw new Error(JSON.stringify(sketch.diagnostics));
    expect(sketch.source.split('\n')[0]).toBe(`// Scenario: ${key}@1, kit: ${robotTemplates[key].kit}@0, board: uno-r3@0`);
    await expect(sketch.source).toMatchFileSnapshot(`./robot-solutions/${key}.ino`);
  });

  it('has a golden for every reference solution, and nothing else', () => {
    expect(readdirSync(goldenDir).sort()).toEqual(scoredKeys.map((key) => `${key}.ino`).sort());
  });
});

describe('the manifest of the scenarios (N18 R7.1)', () => {
  it('is the committed docs/fixtures/robot-scenarios.v1.json', () => {
    const committed = readFileSync(join(import.meta.dirname, '..', 'docs', 'fixtures', 'robot-scenarios.v1.json'), 'utf8');
    expect(serializeManifest(robotScenarioManifest(scenarioCatalog))).toBe(committed);
  });
});
