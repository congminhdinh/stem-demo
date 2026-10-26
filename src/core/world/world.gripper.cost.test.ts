import { beforeAll, describe, expect, it } from 'vitest';
import { threadCpuMs } from './__fixtures__/cpu-time';
import { gripperKit } from './__fixtures__/gripper-scene';
import { parseArena } from './arena/arena-schema';
import { toGoalFrame } from './goal-frame';
import { initPhysics, PHYSICS_DT_S } from './rapier';
import type { MotorCommand } from './robot/dc-motor';
import type { GripperTargets } from './robot/gripper';
import { createWorld, type World } from './world';

// N19 B1/B2: the cost of a gripper world (plan §7 B2: ≤ 0.5 ms per tick, median, on this machine; ADR 0004 §4.5 estimated 0.22 ms). The whole
// world as world.cost.test.ts times it (step with the gripper's +8 PGS and +4 solver iterations on the car's island, the grasp machine,
// contacts, sensors, snapshot, goal frame), on the G0.1 spike's scenario 1: pick a 15 g cube at lift 0°, lift to 90°, drive 50 cm, lower,
// release, back off; 3000 ticks, in CPU time of this thread, in batches of 10 ticks (one tick is close to the CPU clock's microsecond).
//
// Measured (N19 B2, Apple M4 Pro, Node 24.22.1, Vitest 4.1.11, this test alone, load average 4.8–5.5): 0.291–0.294 ms median, 0.29–0.30 ms
// mean, 0.32–0.33 ms p95; the rover's world (world.cost.test.ts) 0.134 ms median in the same run. So plan §7 B2's 0.5 ms holds on this machine.
// Run while `pnpm verify`'s workers fill the machine (load average 16–24), the same ticks take 0.53–0.59 ms of CPU time: this test therefore
// holds world.cost.test.ts's generous 2 ms (N18 P1), which catches a cost gone wrong by an order of magnitude; the strict number is the
// quiet machine's, and the school-PC budget is E9's (`pnpm bench:robot3d`).

beforeAll(() => initPhysics(), 30_000);

const DEG = Math.PI / 180;
const START = { xCm: 40, yCm: 50, yawDeg: 0 } as const;
const TIP0 = 4.5 + 5 * Math.cos(-40 * DEG);
const seconds = (s: number) => Math.round(s / PHYSICS_DT_S);
const COAST: MotorCommand = { duty: 0, dir: 0, brake: false };
const BRAKE: MotorCommand = { duty: 0, dir: 0, brake: true };
const run = (duty: number, dir: 1 | -1): MotorCommand => ({ duty, dir, brake: false });

/** Scenario 1 of the spike as a controller: one call per tick, the targets of that tick. */
function carry(world: World) {
  let motor = COAST;
  let gripper: GripperTargets = { liftDeg: 0, clawDeg: 0 };
  let phase = 0;
  let mark = 0;
  let x0 = 0;
  const cube = () => world.snapshot().objects[0]!.pose.xCm - world.snapshot().robot.xCm - TIP0;
  /** Each phase: when it ends (given the ticks since it began and the robot's x), and what the targets become then. */
  const phases: { readonly done: (since: number, robotX: number) => boolean; readonly then: (robotX: number) => void }[] = [
    { done: (since) => since >= seconds(0.35), then: () => (motor = run(140, 1)) },
    { done: () => cube() <= 3.25, then: () => (motor = BRAKE) },
    { done: (since) => since >= seconds(0.3), then: () => (gripper = { ...gripper, clawDeg: 80 }) },
    { done: (since) => since >= seconds(0.8), then: () => (gripper = { ...gripper, liftDeg: 90 }) },
    {
      done: (since) => since >= seconds(0.5),
      then: (robotX) => {
        motor = run(200, 1);
        x0 = robotX;
      },
    },
    { done: (_since, robotX) => robotX - x0 >= 50, then: () => (motor = BRAKE) },
    { done: (since) => since >= seconds(0.6), then: () => (gripper = { ...gripper, liftDeg: 0 }) },
    { done: (since) => since >= seconds(0.5), then: () => (gripper = { ...gripper, clawDeg: 0 }) },
    {
      done: (since) => since >= seconds(0.4),
      then: (robotX) => {
        motor = run(120, -1);
        x0 = robotX;
      },
    },
    { done: (_since, robotX) => robotX - x0 <= -10, then: () => (motor = BRAKE) },
  ];
  return (tick: number): void => {
    const robotX = world.snapshot().robot.xCm;
    const current = phases[phase];
    if (current !== undefined && current.done(tick - mark, robotX)) {
      current.then(robotX);
      phase += 1;
      mark = tick;
    }
    world.applyActuators({ motors: { motorLeft: motor, motorRight: motor }, gripper });
  };
}

describe('the cost of a gripper world (N19 B2)', () => {
  it('a tick of the whole gripper world costs under 2 ms (median of 10-tick batches, CPU; 0.29 ms on a quiet machine), the spike’s carry scenario', async () => {
    const arena = parseArena({ ground: { sizeCm: [200, 100], color: '#ffffff' }, objects: [{ shape: 'box', id: 'cube', centerCm: [START.xCm + TIP0 + 3 + 8, START.yCm], sizeCm: [4, 4, 4], massG: 15 }] });
    const once = async () => {
      const world = await createWorld({ arena, start: START, kit: gripperKit, seed: 1 });
      try {
        const controller = carry(world);
        const batches: number[] = [];
        let held = 0;
        const started = threadCpuMs();
        for (let n = 0; n < 3000; n += 10) {
          const begin = threadCpuMs();
          for (let k = 0; k < 10; k++) {
            controller(n + k);
            world.step(PHYSICS_DT_S);
            toGoalFrame(world.snapshot(), world.frameExtras());
            if (world.snapshot().robot.gripper!.heldId !== null) held += 1;
          }
          batches.push((threadCpuMs() - begin) / 10);
        }
        const mean = (threadCpuMs() - started) / 3000;
        return { batches, mean, held, end: world.snapshot() };
      } finally {
        world.dispose();
      }
    };
    // A warm-up run first (the JIT), then the timed one.
    await once();
    const { batches, mean, held, end } = await once();
    batches.sort((a, b) => a - b);
    const median = batches[150]!;
    const p95 = batches[285]!;
    console.info(`gripper world tick (spike scenario 1, snapshot + goal frame): ${mean.toFixed(4)} ms mean, ${median.toFixed(4)} ms median, ${p95.toFixed(4)} ms p95 of 10-tick batches, CPU`);
    // The run did what the scenario says: the cube was held for a while and is let go at the end.
    expect(held).toBeGreaterThan(seconds(2));
    expect(end.robot.gripper!.heldId).toBeNull();
    expect(median).toBeLessThan(2);
    expect(mean).toBeLessThan(2);
  }, 120_000);
});
