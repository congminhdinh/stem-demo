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
import { SCENARIO_MAX_SCORE, scenarioMaxScore, type RobotGoalSpec, type Scenario } from '../src/core/scenario/scenario';
import { applyVariant, ROBOT_FOOTPRINT_RADIUS_CM, variantOffsets } from '../src/core/scenario/variants';
import type { Arena } from '../src/core/world/arena/arena-schema';
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
const GUARD_KINDS = ['avoid-contact', 'stay-on-line'];
const ACHIEVEMENT_KINDS = ['reach-zone', 'checkpoints-in-order', 'stop-in-zone', 'servo-angle', 'object-in-zone'];

// --- The scenarios -------------------------------------------------------------------------------------------------------------------

describe('the robot scenarios of this build (N18 R5.2)', () => {
  it('are one per key, in the order of the lessons, each with the profile and kit of its key', () => {
    expect(scenarioCatalog.scenarios.map((scenario) => scenario.key)).toEqual([...robotTemplateKeys]);
    for (const scenario of scenarioCatalog.scenarios) {
      expect(scenario.profile).toBe(robotTemplates[scenario.key as keyof typeof robotTemplates].profile);
      expect(scenario.kit).toBe('ref-uno-rover');
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
    });
    expect(scenarioOf('rb-mini-mission').scoring.timeBonusMax).toBe(10);
    expect(scenarioOf('rb-line-follow').goals[0]).toMatchObject({ minRatio: 0.85 });
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
      expect(scenario.arena.objects, `${key}: no object to push, so none starts in its zone`).toEqual([]);
      const zones = [...new Set(scenario.goals.flatMap(goalZones))];
      for (let index = 0; index < scenario.variants.count; index++) {
        const { start } = applyVariant(scenario, variantOffsets(scenario, index));
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
      expect(scenario.arena.paint.lines.length > 0, scenario.key).toBe(hasLineGoal || scenario.key === robotSandboxKey);
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
        const offsets = variantOffsets(scenario, index);
        const { start, arena } = applyVariant(scenario, offsets);
        if (index === 0) {
          expect(start).toEqual(scenario.start);
          expect(arena).toBe(scenario.arena);
        } else {
          // A jittered start that did not fit would have fallen back to the authored place: none did.
          expect(offsets.start.dxCm !== 0 || offsets.start.dyCm !== 0, `variant ${index} moved`).toBe(true);
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
        const world = await createScenarioWorld(scenario, kit, index);
        try {
          const { start } = applyVariant(scenario, variantOffsets(scenario, index));
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
        const { start } = applyVariant(scenario, variantOffsets(scenario, index));
        return start.xCm + travel * Math.cos((start.yawDeg * Math.PI) / 180);
      });
      expect(Math.max(...ends) - zoneTo, `${key}: past the zone`).toBeGreaterThanOrEqual(4);
      expect(zoneFrom - Math.min(...ends), `${key}: short of the zone`).toBeGreaterThanOrEqual(4);
    }
  });

  it('lessons 4 and 6 turn a jittered start by 4° or more: an open-loop robot is 2.75 cm off the line within 40 cm', () => {
    for (const key of ['rb-line-follow', 'rb-mini-mission'] as const) {
      const scenario = scenarioOf(key);
      const turns = [1, 2].map((index) => Math.abs(variantOffsets(scenario, index).start.dYawDeg));
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

  it('is the blocks the lesson teaches and the language basics', () => {
    expect(Object.fromEntries(scoredKeys.map((key) => [key, scenarioOf(key).toolbox]))).toEqual({
      'rb-drive-to-zone': [...basics, ...drive],
      'rb-square-route': [...basics, ...drive, 'controls_repeat_ext'],
      'rb-stop-at-wall': [...basics, ...drive, ...loops, ...logic, 'uno_ultrasonic_cm', ...print],
      'rb-line-follow': [...basics, ...drive, ...loops, ...logic, 'uno_line_dark', ...print],
      'rb-servo-gate': [...basics, ...drive, ...loops, ...logic, 'uno_ultrasonic_cm', 'uno_servo_set', ...print],
      'rb-mini-mission': [...basics, ...drive, ...loops, ...logic, 'uno_ultrasonic_cm', 'uno_line_dark', 'uno_servo_set', ...print],
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
    const hatType = ['rb-drive-to-zone', 'rb-square-route'].includes(key) ? 'stem_on_start' : 'stem_forever';
    expect(topBlocks(starter).map((block) => [block.type, block.disabledReasons, block.inputs])).toEqual([
      [hatType, undefined, undefined],
      ['uno_drive_move', ['ORPHANED_BLOCK'], { SPEED: { shadow: { type: 'math_number', id: 'prepared-drive-speed', fields: { NUM: 50 } } } }],
    ]);
    expect([...runningBlockTypes(starter)]).toEqual([hatType]);
  });

  it('lessons 3-6 have a blind program, lessons 1-2 do not', () => {
    expect(scoredKeys.filter((key) => robotSolutions[key].blind !== undefined)).toEqual(lessonsWithBlind);
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

  it('lessons 4-6 have exploits from the review, each named, each held under half of the score', () => {
    expect(exploits.map(([key, exploit]) => `${key} ${exploit.name} ${exploit.maxScore}`)).toEqual([
      'rb-line-follow crawl-and-dash 0',
      'rb-line-follow short-drive 40',
      'rb-servo-gate flag-and-crash 40',
      'rb-mini-mission follower-without-distance 45',
    ]);
    for (const [key, exploit] of exploits) {
      expect(exploit.name, key).toMatch(/^[a-z0-9-]+$/);
      expect(exploit.maxScore, `${key} ${exploit.name}`).toBeLessThan(SCENARIO_MAX_SCORE / 2);
      expect(exploit.description.length).toBeGreaterThan(40);
    }
  });

  it('the tape of lesson 6 runs on to the dock wall, so only a stop on the distance parks in the dock', () => {
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

// The sketches are not in a `__golden__` folder: scripts/check-arduino.mjs finds those by default, and check-arduino.test.ts pins that
// default to C1's own cases. `pnpm check:arduino` names src and tests, so it compiles every .ino in them, these too.
describe('the sketches of the reference solutions (N18 R5.2, goldens like C1’s)', () => {
  const goldenDir = join(import.meta.dirname, 'robot-solutions');

  it.each(scoredKeys)('%s: the reference’s Arduino sketch is its golden', async (key) => {
    const compiled = compileUnoProject(projectOf(key, robotSolutions[key].reference), rules);
    if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
    const sketch = generateUnoSketch(compiled.ir, { kit: compiled.kit, board: compiled.board, scenario: { key, version: scenarioOf(key).version } });
    if (!sketch.ok) throw new Error(JSON.stringify(sketch.diagnostics));
    expect(sketch.source.split('\n')[0]).toBe(`// Scenario: ${key}@1, kit: ref-uno-rover@0, board: uno-r3@0`);
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
