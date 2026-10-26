import { beforeAll, describe, expect, it } from 'vitest';
import { productionKits, referenceKitRef } from '../hardware/catalog';
import type { Kit } from '../hardware/kit';
import allGoalsScenario from '../scenario/__fixtures__/all-goals.scenario.json';
import { loadScenario } from '../scenario/scenario';
import { initPhysics, PHYSICS_DT_S } from './rapier';
import type { ActuatorTargets } from './robot/assembly';
import { fnv1a32, snapshotText } from './snapshot';
import { createScenarioWorld } from './world';

// N19 B3/B4 (plan D-G10, brief "Rover unchanged"): the rover's snapshots and goal frames are byte-identical to master's (6884822, before the
// gripper's sensors and frame fields): the canonical text of every tick's snapshot, goal frame and frame extras of a scripted run, hashed in
// a chain. The N19 fields are absent from them, not present as undefined. The goldens of tests/robot-determinism.json pin the snapshots of
// three more fixtures; this pins the goal frames as well, which no golden reads directly.

beforeAll(() => initPhysics(), 30_000);

const rover = productionKits.get(referenceKitRef) as Kit;
const run = (duty: number, dir: -1 | 0 | 1) => ({ duty, dir, brake: false });

/** Measured on master 6884822 with this very script (N19 B3/B4 wrote the test before any change). */
const MASTER = { snapshots: '0011193f', frames: '76c7ef77', extras: '2464a796' } as const;

describe('the rover is unchanged by the gripper’s sensors and frame fields (N19 B3/B4)', () => {
  it('snapshot text, goal frames and frame extras of a scripted rover run hash as on master, with no N19 field', async () => {
    const world = await createScenarioWorld(loadScenario(allGoalsScenario), rover, 1);
    try {
      let snapshots = '';
      let frames = '';
      let extras = '';
      const n19Keys: string[] = [];
      const read = (tick: number) => {
        const leds = { led1: tick % 50 < 25 };
        const frame = world.goalFrame({ leds, buzzerHz: tick % 90 < 30 ? null : 440 + tick });
        snapshots = fnv1a32(snapshots + snapshotText(world.snapshot()));
        frames = fnv1a32(frames + snapshotText(frame));
        extras = fnv1a32(extras + snapshotText(world.frameExtras()));
        if ('gripper' in frame) n19Keys.push(`frame.gripper@${tick}`);
        if ('gripper' in world.snapshot().robot) n19Keys.push(`robot.gripper@${tick}`);
        for (const [id, object] of Object.entries(frame.objects)) {
          for (const key of ['zCm', 'tiltDeg', 'held', 'restingOn']) if (key in object) n19Keys.push(`${id}.${key}@${tick}`);
        }
        for (const sensor of world.snapshot().sensors) if (sensor.kind !== 'ultrasonic' && sensor.kind !== 'line-sensor') n19Keys.push(`${sensor.kind}@${tick}`);
      };
      read(0);
      for (let tick = 0; tick < 600; tick++) {
        const targets: ActuatorTargets =
          tick < 240
            ? { motors: { motorLeft: run(220, 1), motorRight: run(220, 1) }, servos: { servo1: tick < 120 ? 30 : 150 } }
            : { motors: { motorLeft: run(180, 1), motorRight: run(180, -1) }, servos: { servo1: 90 } };
        world.applyActuators(targets);
        world.step(PHYSICS_DT_S);
        read(tick + 1);
      }
      expect(n19Keys).toEqual([]);
      expect({ snapshots, frames, extras }).toEqual(MASTER);
    } finally {
      world.dispose();
    }
  }, 60_000);
});
