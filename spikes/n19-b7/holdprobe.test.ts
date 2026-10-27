// N19 B7 spike: why a car holding a cube at lift 55° does not take hold: the hold's conditions tick by tick.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { COAST, cube, forward, gripperScene, pick, run, seconds } from '../../src/core/world/__fixtures__/gripper-scene';
import { setup } from './lib';

it('probe', async () => {
  await setup();
  const START = { xCm: 150, yCm: 150, yawDeg: 0 };
  const massG = Number(process.env.MASS ?? 15);
  const liftDeg = Number(process.env.LIFT ?? 55);
  const scene = gripperScene({ ground: { sizeCm: [300, 300], color: '#ffffff' }, objects: [cube('cube', [START.xCm + 20, START.yCm], massG)] }, START);
  run(scene, pick(scene, 'cube', { liftDeg: 0, u: 3 }), seconds(5));
  scene.set({ liftDeg });
  for (let i = 0; i < seconds(1); i++) scene.step();
  scene.drive(forward(128));
  for (let i = 0; i < seconds(1); i++) scene.step();
  scene.drive(COAST);
  const lines: string[] = [];
  let lastE = 0;
  let lastB: number[] = [0, 0];
  for (let i = 0; i < seconds(3); i++) {
    scene.step();
    const v = scene.robot.chassis.linvel();
    const w = scene.robot.chassis.angvel();
    const e = scene.gripper.liftDeg();
    const b = [scene.gripper.fingers[0].betaDeg(), scene.gripper.fingers[1].betaDeg()];
    if (i % 12 === 0 || i > seconds(3) - 3)
      lines.push(`${i} v ${Math.hypot(v.x, v.y, v.z).toExponential(2)} w ${Math.hypot(w.x, w.y, w.z).toExponential(2)} lift ${e.toFixed(5)} dLift ${(e - lastE).toExponential(2)} dB ${(b[0]! - lastB[0]!).toExponential(2)}/${(b[1]! - lastB[1]!).toExponential(2)} grounded ${scene.robot.isGrounded()} held ${scene.gripper.liftHeld}`);
    lastE = e;
    lastB = b;
  }
  writeFileSync(join(import.meta.dirname, 'results', 'holdprobe.txt'), `${lines.join('\n')}\n`);
  expect(lines.length).toBeGreaterThan(0);
});
