import { productionKits, referenceKitRef, unoR3Board } from '../src/core/hardware/catalog';
import type { Kit } from '../src/core/hardware/kit';
import { registry } from '../src/core/program/__fixtures__/uno-blocks';
import allGoalsScenario from '../src/core/scenario/__fixtures__/all-goals.scenario.json';
import { pilotReferences, type CheckCase } from '../src/core/scenario/__fixtures__/check-cases';
import { checkRobot } from '../src/core/scenario/check-robot';
import { loadScenario } from '../src/core/scenario/scenario';
import { parseArena } from '../src/core/world/arena/arena-schema';
import boxesArena from '../src/core/world/arena/fixtures/boxes.json';
import lineLoopArena from '../src/core/world/arena/fixtures/line-loop.json';
import { PHYSICS_DT_S } from '../src/core/world/rapier';
import type { ActuatorTargets } from '../src/core/world/robot/assembly';
import type { MotorCommand } from '../src/core/world/robot/dc-motor';
import { fnv1a32, hashSnapshot, snapshotText } from '../src/core/world/snapshot';
import { createScenarioWorld, createWorld, type World } from '../src/core/world/world';

// The determinism fixtures of the robot world (N18 R3.5, robot plan §5): the same runs, hashed the same way, on Node
// (tests/robot-determinism.test.ts, the split and the -compat Rapier builds) and in Chromium, Firefox and WebKit
// (e2e/robot-determinism.spec.ts, through e2e/robot-determinism.html). Their hashes are pinned in
// tests/__snapshots__/robot-determinism.json for ROBOT_ENGINE_VERSION.
//
// Each fixture builds a world, then for DETERMINISM_TICKS ticks asks its controller for the actuator targets, steps, and hashes the
// tick: the snapshot (hashSnapshot) and the goal frame's extras (contacts, speed, outline), which the snapshot does not hold. Two
// fixtures are closed loops: the controller reads the sensors, so a reading that differed by a bit would steer the run elsewhere.
//   - boxes-script: an open-loop script in the arena with walls, boxes, a cylinder and objects to push (R3.3's golden run).
//   - line-follow: a three-sensor line follower on the taped loop, 25 s.
//   - mini-mission-v1-noise: variant 1 of a scenario (jittered start and obstacles, the variant's seed), an obstacle avoider on the
//     ultrasonic with ±1 cm of seeded noise, the servo sweeping.
// N19 B6, the gripper car (ref-uno-gripper@0; the rover's fixtures and hashes are as they were). Each a scripted controller over the world's
// sensors, so the grasp machine, the gripper's bodies and its sensors (IR, colour, the ultrasonic that hears the gripper) are hashed too:
//   - gripper-pick-place: lower and open, drive in until the IR sees the 50 g parcel, close, lift, carry, let it go 1 cm above the floor
//     (lift 14°), back off, then drive the raised claw into a wall at full speed and on (it noses up), back off and spin.
//   - gripper-stack: lesson 11's move: grip the red cube, lift to 55°, drive on for a time to over the base (6 × 6 × 4 cm, 40 g), let it go
//     onto it, back off.
//   - gripper-sensors: a closed loop on all three sensors with ±1 cm of seeded ultrasonic noise in a walled arena of coloured cubes: drive in
//     until the IR sees the cube ahead, read its colour, grip it and lift it; then roam on the ultrasonic, turning away from what it hears
//     near the way the colour said (red more than blue: left), the arm dipping to 25° every 3 s, where the claw servo blocks the ultrasonic.
//
// N18 final fix M3: whole checks too (`determinismChecks`), the learner's program through the compiler, the interpreter on the virtual clock
// and the virtual UNO, the world and the scorer: checkRobot headless, as Kiểm tra and verify:attempt run it. Two closed loops, whose every
// decision reads a sensor: the mini-mission's reference (follow the line, stop near an obstacle; 3 variants of 45 s) and the line-follow
// lesson's (3 variants of 120 s). What a check gives the LMS (passed, score, each variant's score and time, the program's hash) and the hash
// of each variant's last world are pinned in the same golden file, under `checks`.

export const DETERMINISM_TICKS = 3000;

export type FixtureHashes = {
  /** hashSnapshot of the last tick's snapshot. */
  readonly final: string;
  /** FNV-1a chained over every tick's snapshot hash and extras hash, tick 0 included. */
  readonly trajectory: string;
};

type Controller = (world: World, tick: number) => ActuatorTargets;
export type DeterminismFixture = {
  readonly name: string;
  make(): Promise<World>;
  /** A new controller for one run (it may keep state). */
  controller(): Controller;
};

const kit = (): Kit => productionKits.get(referenceKitRef) as Kit;
const gripperKit = (): Kit => productionKits.get({ id: 'ref-uno-gripper', version: '0' }) as Kit;
const run = (duty: number, dir: -1 | 0 | 1): MotorCommand => ({ duty, dir, brake: false });
const brake: MotorCommand = { duty: 255, dir: 0, brake: true };
const both = (command: MotorCommand): ActuatorTargets => ({ motors: { motorLeft: command, motorRight: command } });
const pair = (left: MotorCommand, right: MotorCommand): ActuatorTargets => ({ motors: { motorLeft: left, motorRight: right } });

/** R3.3's 3000-tick script: drive, spin, sweep the arm, reverse, brake, push an object of the arena. */
function script(tick: number): ActuatorTargets {
  const s = tick / 120;
  if (s < 1.5) return both(run(128, 1));
  if (s < 2) return pair(run(128, -1), run(128, 1));
  if (s < 2.5) return { ...both(brake), servos: { servo1: 0 } };
  if (s < 4.5) return { ...both(run(255, 1)), servos: { servo1: 180 } };
  if (s < 5) return pair(run(200, 1), run(200, -1));
  if (s < 8) return { ...both(run(180, 1)), servos: { servo1: Math.floor(s * 2) % 2 === 0 ? 0 : 180 } };
  if (s < 9) return both(run(150, -1));
  if (s < 12) return pair(run(255, 1), run(90, 1));
  if (s < 13) return both(run(0, 0));
  if (s < 18) return { ...pair(run(100, 1), run(255, 1)), servos: { servo1: 45 } };
  if (s < 19) return both(brake);
  return { ...both(run(255, 1)), servos: { servo1: 135 } };
}

/** N19 B6: a run of phases, each holding its targets until its `until` says so (a sensor) or its ticks run out; the last holds to the end. */
type Phase = { readonly targets: (world: World) => ActuatorTargets; readonly ticks: number; readonly until?: (world: World) => boolean };
function phases(list: readonly Phase[]): Controller {
  let index = 0;
  let entered = 0;
  return (world, tick) => {
    while (index < list.length - 1) {
      const phase = list[index]!;
      if (tick - entered < phase.ticks && !(phase.until?.(world) ?? false)) break;
      index += 1;
      entered = tick;
    }
    return list[index]!.targets(world);
  };
}
const second = (s: number) => Math.round(s * 120);
const hold = (targets: ActuatorTargets): ((world: World) => ActuatorTargets) => () => targets;
const irSees = (world: World) => world.sense.ir('irClaw').detected;
const cube = (id: string, xCm: number, yCm: number, massG: number, color: string) =>
  ({ id, shape: 'box', centerCm: [xCm, yCm], sizeCm: [4, 4, 4], massG, noun: 'cube', color }) as const;
const ground = (sizeCm: readonly [number, number]) => ({ sizeCm: [sizeCm[0], sizeCm[1]] as [number, number], color: '#f5f5f5' });

/** N19 B6: the gripper car's fixtures, after the rover's in `determinismFixtures` (whose three come first, as they always have). */
const gripperFixtures: readonly DeterminismFixture[] = [
  {
    name: 'gripper-pick-place',
    make: () =>
      createWorld({
        arena: parseArena({
          ground: ground([250, 100]),
          walls: [{ id: 'wall', fromCm: [200, 5], toCm: [200, 95] }],
          objects: [{ ...cube('parcel', 66, 50, 50, '#1976d2'), noun: 'parcel' }],
        }),
        start: { xCm: 30, yCm: 50, yawDeg: 0 },
        kit: gripperKit(),
        seed: 11,
      }),
    controller: () =>
      phases([
        { targets: hold({ ...both(brake), gripper: { liftDeg: 0, clawDeg: 0 } }), ticks: second(0.4) },
        { targets: hold(both(run(150, 1))), ticks: second(4), until: irSees },
        { targets: hold({ ...both(brake), gripper: { clawDeg: 80 } }), ticks: second(0.8) },
        { targets: hold({ ...both(brake), gripper: { liftDeg: 90 } }), ticks: second(0.4) },
        { targets: hold(both(run(200, 1))), ticks: second(1.5) },
        { targets: hold(both(brake)), ticks: second(0.5) },
        { targets: hold({ ...both(brake), gripper: { liftDeg: 14 } }), ticks: second(0.5) },
        { targets: hold({ ...both(brake), gripper: { clawDeg: 0 } }), ticks: second(0.6) },
        { targets: hold(both(run(150, -1))), ticks: second(0.8) },
        { targets: hold({ ...both(brake), gripper: { liftDeg: 45 } }), ticks: second(0.5) },
        { targets: hold(both(run(255, 1))), ticks: second(6), until: (world) => world.sense.contacts().some((contact) => contact.otherId === 'wall') },
        { targets: hold(both(run(255, 1))), ticks: second(2) },
        { targets: hold(both(run(0, 0))), ticks: second(1) },
        { targets: hold(both(run(150, -1))), ticks: second(1.2) },
        { targets: hold({ ...pair(run(160, 1), run(160, -1)), gripper: { liftDeg: 90, clawDeg: 80 } }), ticks: 1 },
      ]),
  },
  {
    name: 'gripper-stack',
    make: () =>
      createWorld({
        arena: parseArena({
          ground: ground([220, 80]),
          walls: [{ id: 'end-wall', fromCm: [175, 5], toCm: [175, 75] }],
          objects: [cube('red', 95, 40, 15, '#d32f2f'), { id: 'base', shape: 'box', centerCm: [140, 40], sizeCm: [6, 6, 4], massG: 40, noun: 'base', color: '#fbc02d' }],
        }),
        start: { xCm: 40, yCm: 40, yawDeg: 0 },
        kit: gripperKit(),
        seed: 12,
      }),
    controller: () =>
      phases([
        { targets: hold({ ...both(brake), gripper: { liftDeg: 0, clawDeg: 0 } }), ticks: second(0.4) },
        { targets: hold(both(run(140, 1))), ticks: second(6), until: irSees },
        { targets: hold({ ...both(brake), gripper: { clawDeg: 80 } }), ticks: second(0.8) },
        { targets: hold({ ...both(brake), gripper: { liftDeg: 55 } }), ticks: second(0.5) },
        // Timed, as lesson 11's line follower would be: holding the cube at 55°, the ultrasonic hears the cube itself (3.7 cm).
        { targets: hold(both(run(140, 1))), ticks: second(2.9) },
        { targets: hold(both(brake)), ticks: second(0.6) },
        { targets: hold({ ...both(brake), gripper: { clawDeg: 0 } }), ticks: second(0.8) },
        { targets: hold(both(run(150, -1))), ticks: second(0.8) },
        { targets: hold({ ...both(brake), gripper: { liftDeg: 90 } }), ticks: 1 },
      ]),
  },
  {
    name: 'gripper-sensors',
    make: () =>
      createWorld({
        arena: parseArena({
          ground: ground([200, 200]),
          walls: [
            { fromCm: [0, 1], toCm: [200, 1] },
            { fromCm: [0, 199], toCm: [200, 199] },
            { fromCm: [1, 0], toCm: [1, 200] },
            { fromCm: [199, 0], toCm: [199, 200] },
          ],
          objects: [cube('red', 95, 100, 15, '#d32f2f'), cube('blue', 70, 160, 15, '#1976d2'), cube('black', 150, 50, 15, '#212121'), cube('yellow', 160, 150, 15, '#fbc02d')],
        }),
        start: { xCm: 40, yCm: 100, yawDeg: 0 },
        kit: gripperKit(),
        seed: 13,
        ultrasonicNoiseCm: 1,
      }),
    controller: () => {
      let phase: 'seek' | 'grip' | 'raise' | 'roam' = 'seek';
      let since = 0;
      let left = true;
      let turning = 0;
      return (world, tick) => {
        if (phase === 'seek') {
          if (!irSees(world)) return { ...both(run(150, 1)), gripper: { liftDeg: 0, clawDeg: 0 } };
          // What the colour sensor sees of the cube in the jaws: more red than blue turns left from now on.
          const { light } = world.sense.color('color1');
          left = light.r > light.b;
          [phase, since] = ['grip', tick];
        }
        if (phase === 'grip') {
          if (tick - since < second(0.8)) return { ...both(brake), gripper: { clawDeg: 80 } };
          [phase, since] = ['raise', tick];
        }
        if (phase === 'raise') {
          if (tick - since < second(0.4)) return { ...both(brake), gripper: { liftDeg: 90 } };
          [phase, since] = ['roam', tick];
        }
        // Every 3 s the arm dips to 25° for half a second: the claw servo's case before the ultrasonic, which reads 2 cm and turns the car.
        const gripper = { clawDeg: 80, liftDeg: (tick - since) % second(3) < second(0.5) ? 25 : 90 };
        if (turning === 0 && world.sense.distanceCm('ultrasonic') < 25) turning = 48;
        if (turning > 0) {
          turning -= 1;
          return { ...(left ? pair(run(160, -1), run(160, 1)) : pair(run(160, 1), run(160, -1))), gripper };
        }
        return { ...both(run(170, 1)), gripper };
      };
    },
  },
];

export const determinismFixtures: readonly DeterminismFixture[] = [
  {
    name: 'boxes-script',
    make: () => createWorld({ arena: parseArena(boxesArena), start: { xCm: 30, yCm: 100, yawDeg: 0 }, kit: kit(), seed: 1 }),
    controller: () => (_world, tick) => script(tick),
  },
  {
    name: 'line-follow',
    make: () => createWorld({ arena: parseArena(lineLoopArena), start: { xCm: 30, yCm: 25, yawDeg: 0 }, kit: kit(), seed: 2 }),
    controller: () => (world) => {
      const dark = (role: string) => world.sense.line(role).dark;
      if (dark('lineCenter')) return both(run(170, 1));
      if (dark('lineLeft')) return pair(run(90, 1), run(200, 1));
      if (dark('lineRight')) return pair(run(200, 1), run(90, 1));
      return pair(run(140, -1), run(140, 1));
    },
  },
  {
    name: 'mini-mission-v1-noise',
    make: () => createScenarioWorld(loadScenario(allGoalsScenario), kit(), 1, { ultrasonicNoiseCm: 1 }),
    controller: () => {
      let turning = 0;
      return (world, tick) => {
        const servos = { servo1: Math.floor(tick / 120) % 2 === 0 ? 30 : 150 };
        if (turning === 0 && world.sense.distanceCm('ultrasonic') < 25) turning = 45;
        if (turning > 0) {
          turning -= 1;
          return { ...pair(run(160, 1), run(160, -1)), servos };
        }
        return { ...both(run(190, 1)), servos };
      };
    },
  },
  ...gripperFixtures,
];

/** Runs a fixture for `ticks` ticks (DETERMINISM_TICKS for the golden ones) and hashes it. */
export async function runFixture(fixture: DeterminismFixture, ticks = DETERMINISM_TICKS): Promise<FixtureHashes> {
  const world = await fixture.make();
  try {
    const controller = fixture.controller();
    let trajectory = fnv1a32('');
    const mix = () => {
      trajectory = fnv1a32(`${trajectory}${hashSnapshot(world.snapshot())}${fnv1a32(snapshotText(world.frameExtras()))}`);
    };
    mix();
    for (let tick = 0; tick < ticks; tick++) {
      world.applyActuators(controller(world, tick));
      world.step(PHYSICS_DT_S);
      mix();
    }
    return { final: hashSnapshot(world.snapshot()), trajectory };
  } finally {
    world.dispose();
  }
}

/** Every fixture's hashes, by name. */
export async function runAllFixtures(): Promise<Record<string, FixtureHashes>> {
  const hashes: Record<string, FixtureHashes> = {};
  for (const fixture of determinismFixtures) hashes[fixture.name] = await runFixture(fixture);
  return hashes;
}

/** What a whole check gives that must be the same on every runtime: its result for the LMS and the hash of each variant's last world. */
export type CheckHashes = {
  readonly passed: boolean;
  readonly score: number;
  readonly variants: readonly { readonly seed: number; readonly passed: boolean; readonly score: number; readonly simTimeMs: number }[];
  readonly programHash: string;
  /** hashSnapshot of each variant's last world, in variant order. */
  readonly final: readonly string[];
};

/** The whole checks of the golden file, by name: pilot references (src/samples/robot-solutions.ts) of closed-loop programs. */
export const determinismChecks: readonly { readonly name: string; readonly check: CheckCase }[] = [
  { name: 'rb-mini-mission-reference', check: pilotReferences.find((candidate) => candidate.name.startsWith('rb-mini-mission:'))! },
  { name: 'rb-line-follow-reference', check: pilotReferences.find((candidate) => candidate.name.startsWith('rb-line-follow:'))! },
];

/** Runs a whole check headless, as Kiểm tra at Nhanh does, and gives what it must give on every runtime. */
export async function runCheckFixture(check: CheckCase): Promise<CheckHashes> {
  const final: string[] = [];
  const run = checkRobot(check.project(), check.scenario(), {
    mode: 'headless',
    kit: kit(),
    board: unoR3Board,
    registry,
    onProgress: (progress) => {
      if (progress.kind === 'variant-ended') final.push(progress.snapshot.world === null ? 'no world' : hashSnapshot(progress.snapshot.world));
    },
  });
  const result = await run.result;
  if (result === null) throw new Error(`The check ${check.name} gave no result.`);
  return {
    passed: result.passed,
    score: result.score,
    variants: result.variants.map(({ seed, passed, score, simTimeMs }) => ({ seed, passed, score, simTimeMs })),
    programHash: result.programHash,
    final,
  };
}

/** Every whole check's result and hashes, by name. */
export async function runAllChecks(): Promise<Record<string, CheckHashes>> {
  const checks: Record<string, CheckHashes> = {};
  for (const { name, check } of determinismChecks) checks[name] = await runCheckFixture(check);
  return checks;
}
