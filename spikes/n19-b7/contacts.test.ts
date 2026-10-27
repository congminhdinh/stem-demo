// N19 B7 spike: the support balls' contacts with the floor tick by tick at rest: the stack reference's end (session) and the flat floor (scene).
//   pnpm exec vitest run --config spikes/n19-b7/vitest.config.ts contacts
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { unoR3Board } from '../../src/core/hardware/catalog';
import { registry } from '../../src/core/program/__fixtures__/uno-blocks';
import { createRobotRunSession } from '../../src/core/run/robot-run-session';
import type { Scenario } from '../../src/core/scenario/scenario';
import { COAST, gripperScene, seconds, backward } from '../../src/core/world/__fixtures__/gripper-scene';
import type { RigidBody } from '../../src/core/world/rapier';
import { scenarioCatalog } from '../../src/samples/robot-scenarios';
import { robotSolutions } from '../../src/samples/robot-solutions';
import { ballContacts, gripperKit, lastPhysics, projectOf, setup } from './lib';

it('dumps', async () => {
  await setup();
  const ticks = Number(process.env.TICKS ?? 4);
  const dump: Record<string, unknown[]> = { stack: [], flat: [] };
  {
    const scenario = scenarioCatalog.get('rb-grip-stack') as Scenario;
    const session = createRobotRunSession({ scenario, kit: gripperKit, board: unoR3Board, registry });
    await session.start(projectOf('rb-grip-stack', robotSolutions['rb-grip-stack'].reference), 0);
    const physics = lastPhysics();
    const dynamic: RigidBody[] = [];
    physics.forEachRigidBody((body) => {
      if (body.isDynamic()) dynamic.push(body);
    });
    const chassis = dynamic.find((body) => body.numColliders() === 6)!;
    await session.runUntil(15);
    for (let k = 1; k <= ticks; k++) {
      await session.runUntil(15 + k / 120);
      dump.stack!.push({ wy: chassis.angvel().y, v: chassis.linvel(), balls: ballContacts(physics, chassis) });
    }
    session.stop();
  }
  {
    const scene = gripperScene({ ground: { sizeCm: [200, 80], color: '#ffffff' } }, { xCm: 131.9, yCm: 39.9, yawDeg: -0.08 });
    scene.set({ liftDeg: 55, clawDeg: 0 });
    for (let i = 0; i < seconds(1); i++) scene.step();
    scene.drive(backward(128));
    for (let i = 0; i < seconds(1); i++) scene.step();
    scene.drive(COAST);
    for (let i = 0; i < seconds(3); i++) scene.step();
    for (let k = 1; k <= ticks; k++) {
      scene.step();
      dump.flat!.push({ wy: scene.robot.chassis.angvel().y, v: scene.robot.chassis.linvel(), balls: ballContacts(scene.world, scene.robot.chassis) });
    }
    scene.dispose();
  }
  writeFileSync(join(import.meta.dirname, 'results', `${process.env.OUT ?? 'contacts'}.json`), JSON.stringify(dump, null, 1));
  expect(dump.stack!.length).toBe(ticks);
});
