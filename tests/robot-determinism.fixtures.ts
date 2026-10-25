import { productionKits, referenceKitRef } from '../src/core/hardware/catalog';
import type { Kit } from '../src/core/hardware/kit';
import allGoalsScenario from '../src/core/scenario/__fixtures__/all-goals.scenario.json';
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
