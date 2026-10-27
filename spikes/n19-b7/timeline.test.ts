// N19 B7 spike: a lesson reference's run tick by tick (the lab's Chạy, variant VARIANT): the chassis' yaw rate (angvel.y), the gripper and
// what the program does, printed every PRINT_EVERY s with the yaw change over that span; from FROM s on, every tick.
//   KEY=rb-grip-stack UNTIL=20 pnpm exec vitest run --config spikes/n19-b7/vitest.config.ts timeline
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { unoR3Board } from '../../src/core/hardware/catalog';
import { registry } from '../../src/core/program/__fixtures__/uno-blocks';
import { createRobotRunSession } from '../../src/core/run/robot-run-session';
import type { Scenario } from '../../src/core/scenario/scenario';
import type { RigidBody } from '../../src/core/world/rapier';
import { scenarioCatalog } from '../../src/samples/robot-scenarios';
import { robotSolutions } from '../../src/samples/robot-solutions';
import { gripperKit, lastPhysics, projectOf, roverKit, setup } from './lib';

const yawOf = (q: { x: number; y: number; z: number; w: number }) => Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.z * q.z));

it('traces', async () => {
  await setup();
  const key = process.env.KEY ?? 'rb-grip-stack';
  const scenario = scenarioCatalog.get(key) as Scenario;
  const kit = scenario.kit === 'ref-uno-gripper' ? gripperKit : roverKit;
  const session = createRobotRunSession({ scenario, kit, board: unoR3Board, registry });
  await session.start(projectOf(key, robotSolutions[key as keyof typeof robotSolutions].reference), Number(process.env.VARIANT ?? 0));
  const physics = lastPhysics();
  const dynamic: RigidBody[] = [];
  physics.forEachRigidBody((body) => {
    if (body.isDynamic()) dynamic.push(body);
  });
  const chassis = dynamic.find((body) => body.numColliders() === 6)!;
  const until = Number(process.env.UNTIL ?? 20);
  const every = Number(process.env.PRINT_EVERY ?? 0.25);
  const rows: unknown[] = [];
  let lastYaw = yawOf(chassis.rotation());
  let lastT = 0;
  for (let k = 1; k <= until * 120; k++) {
    await session.runUntil(k / 120);
    const w = session.getSnapshot().world!;
    const t = w.t;
    if (Math.abs(t / every - Math.round(t / every)) < 1e-9 || t >= Number(process.env.FROM ?? 1e9)) {
      const yaw = yawOf(chassis.rotation());
      const row = {
        t: Math.round(t * 1000) / 1000,
        status: session.getSnapshot().status,
        wy: (chassis.angvel().y * 180) / Math.PI,
        yawRate: ((yaw - lastYaw) * 180) / Math.PI / (t - lastT),
        v: Math.hypot(chassis.linvel().x, chassis.linvel().z) * 100,
        lift: w.robot.gripper?.liftDeg,
        claw: w.robot.gripper?.clawDeg,
        held: w.robot.gripper?.heldId,
        block: w.activeBlockId,
      };
      lastYaw = yaw;
      lastT = t;
      rows.push(row);
      console.log(JSON.stringify(row));
    }
  }
  writeFileSync(join(import.meta.dirname, 'results', `${process.env.OUT ?? 'timeline'}.json`), JSON.stringify(rows, null, 1));
  session.stop();
  expect(rows.length).toBeGreaterThan(0);
});
