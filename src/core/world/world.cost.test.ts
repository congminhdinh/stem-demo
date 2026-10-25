import { beforeAll, describe, expect, it } from 'vitest';
import { productionKits, referenceKitRef } from '../hardware/catalog';
import type { Kit } from '../hardware/kit';
import allGoalsScenario from '../scenario/__fixtures__/all-goals.scenario.json';
import { createGoal } from '../scenario/goals';
import { loadScenario } from '../scenario/scenario';
import { threadCpuMs } from './__fixtures__/cpu-time';
import { parseArena } from './arena/arena-schema';
import boxesArena from './arena/fixtures/boxes.json';
import { toGoalFrame } from './goal-frame';
import { initPhysics, PHYSICS_DT_S, PHYSICS_HZ } from './rapier';
import type { ActuatorTargets } from './robot/assembly';
import { createScenarioWorld, createWorld, type World } from './world';

// N18 R3.5, the budget of plan §5: physics ≤ 0.5 ms per tick on a mid-range machine, and a headless check of 3 variants × 60 s
// ≤ 10 s. Measured in CPU time of this thread (other test workers and processes on the machine do not count), for the whole world:
// the step, the sensors, the snapshot, the goal frame and the goals. The program (interpreter, virtual UNO) is R3.6's and not in it.

beforeAll(() => initPhysics(), 30_000);

const kit = productionKits.get(referenceKitRef) as Kit;
const run = (duty: number, dir: -1 | 0 | 1) => ({ duty, dir, brake: false });

/** An obstacle avoider on the ultrasonic, the servo sweeping: the sensors are read every tick, as a program would. */
function avoider(): (world: World, tick: number) => ActuatorTargets {
  let turning = 0;
  return (world, tick) => {
    const servos = { servo1: Math.floor(tick / 120) % 2 === 0 ? 30 : 150 };
    world.sense.line('lineCenter');
    if (turning === 0 && world.sense.distanceCm('ultrasonic') < 25) turning = 45;
    if (turning > 0) {
      turning -= 1;
      return { motors: { motorLeft: run(160, 1), motorRight: run(160, -1) }, servos };
    }
    return { motors: { motorLeft: run(190, 1), motorRight: run(190, 1) }, servos };
  };
}

describe('the cost of the world', () => {
  it('a tick of the whole world (step, sensors, snapshot, goal frame) costs well under 0.5 ms', async () => {
    const world = await createWorld({ arena: parseArena(boxesArena), start: { xCm: 30, yCm: 100, yawDeg: 0 }, kit, seed: 1 });
    try {
      const controller = avoider();
      const tick = (n: number) => {
        world.applyActuators(controller(world, n));
        world.step(PHYSICS_DT_S);
        toGoalFrame(world.snapshot(), world.frameExtras());
      };
      for (let n = 0; n < 300; n++) tick(n);
      // Batches of 10 ticks: one tick is close to the CPU clock's microsecond.
      const batches: number[] = [];
      const started = threadCpuMs();
      for (let n = 300; n < 3300; n += 10) {
        const begin = threadCpuMs();
        for (let k = 0; k < 10; k++) tick(n + k);
        batches.push((threadCpuMs() - begin) / 10);
      }
      const mean = (threadCpuMs() - started) / 3000;
      batches.sort((a, b) => a - b);
      const median = batches[150]!;
      const p95 = batches[285]!;
      console.info(`world tick (boxes arena, avoider, snapshot + goal frame): ${mean.toFixed(4)} ms mean, ${median.toFixed(4)} ms median, ${p95.toFixed(4)} ms p95 of 10-tick batches, CPU`);
      expect(mean).toBeLessThan(0.5);
    } finally {
      world.dispose();
    }
  });

  it('a headless check of 3 variants × 60 s (21 600 ticks, every goal of the scenario fed each tick) takes well under 10 s', async () => {
    const scenario = loadScenario(allGoalsScenario);
    const ticks = 60 * PHYSICS_HZ;
    const started = threadCpuMs();
    for (let variant = 0; variant < 3; variant++) {
      const world = await createScenarioWorld(scenario, kit, variant);
      try {
        const goals = scenario.goals.map((spec) => createGoal(spec, { arena: world.arena, scenario, program: scenario.starter, othersPassedAtS: () => null }));
        const controller = avoider();
        for (let n = 0; n < ticks; n++) {
          world.applyActuators(controller(world, n));
          world.step(PHYSICS_DT_S);
          const frame = toGoalFrame(world.snapshot(), world.frameExtras());
          for (const goal of goals) goal.update(frame, PHYSICS_DT_S);
        }
        expect(goals.map((goal) => goal.result().id)).toEqual(scenario.goals.map((spec) => spec.id));
      } finally {
        world.dispose();
      }
    }
    const ms = threadCpuMs() - started;
    console.info(`headless 3 variants × 60 s: ${ms.toFixed(0)} ms CPU (${(ms / (3 * ticks)).toFixed(4)} ms per tick)`);
    expect(ms).toBeLessThan(10_000);
  }, 120_000);
});
