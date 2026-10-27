// N19 B7 spike: are the support balls' friction impulses reported (contactTangentImpulseX/Y) when the friction must act: a stopped car pushed
// sideways by 0.3 N, the gripper kit and the rover.
//   pnpm exec vitest run --config spikes/n19-b7/vitest.config.ts push
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { parseArena } from '../../src/core/world/arena/arena-schema';
import { buildArena } from '../../src/core/world/arena/build-arena';
import { createPhysicsWorld } from '../../src/core/world/rapier';
import { assembleRobot, stepWorld } from '../../src/core/world/robot/assembly';
import { ballContacts, gripperKit, roverKit, setup } from './lib';

it('push', async () => {
  await setup();
  const lines: string[] = [];
  const log = (...args: unknown[]) => lines.push(args.map(String).join(' '));
  for (const kit of [gripperKit, roverKit]) {
    const world = createPhysicsWorld();
    buildArena(world, parseArena({ ground: { sizeCm: [300, 300], color: '#ffffff' } }));
    const robot = assembleRobot(world, kit, { xCm: 150, yCm: 150, yawDeg: 0 });
    for (let i = 0; i < 240; i++) stepWorld(world, robot);
    const quiet = ballContacts(world, robot.chassis);
    const p0 = robot.chassis.translation();
    robot.chassis.addForce({ x: 0, y: 0, z: 0.3 }, true);
    for (let i = 0; i < 60; i++) stepWorld(world, robot);
    const pushed = ballContacts(world, robot.chassis);
    const p1 = robot.chassis.translation();
    log(kit.id, 'quiet', JSON.stringify(quiet.map((b) => (b as { pts: { n: number; tx: number; ty: number }[] }).pts.map((p) => [p.n, p.tx, p.ty]))));
    log(kit.id, 'pushed', JSON.stringify(pushed.map((b) => (b as { pts: { n: number; tx: number; ty: number }[] }).pts.map((p) => [p.n, p.tx, p.ty]))), 'moved m', p1.z - p0.z);
    world.free();
  }
  writeFileSync(join(import.meta.dirname, 'results', 'push.txt'), `${lines.join('\n')}\n`);
  expect(lines.length).toBe(4);
});
