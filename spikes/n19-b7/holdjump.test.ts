// N19 B7 spike: what the lift's hold changes in the picture when it takes hold: the chassis' and the held cube's pose (cm, quaternion), the
// wheels, the gripper's angles, tick by tick around the engagement, against the 3D view's thresholds (scene-math.ts: 0.01 cm, 1e-5, 1e-3 rad,
// 0.05°). The car holds a 15 g cube with its arm at LIFT (default 90°, the gripper-ui spec's teleop pose).
//   LIFT=90 MASS=15 pnpm exec vitest run --config spikes/n19-b7/vitest.config.ts holdjump
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { COAST, cube, gripperScene, pick, run, seconds } from '../../src/core/world/__fixtures__/gripper-scene';
import { setup } from './lib';

it('holdjump', async () => {
  await setup();
  const START = { xCm: 150, yCm: 150, yawDeg: 0 };
  const massG = Number(process.env.MASS ?? 15);
  const liftDeg = Number(process.env.LIFT ?? 90);
  const objects = massG === 0 ? [] : [cube('cube', [START.xCm + 20, START.yCm], massG)];
  const scene = gripperScene({ ground: { sizeCm: [300, 300], color: '#ffffff' }, objects }, START);
  if (massG > 0) run(scene, pick(scene, 'cube', { liftDeg: 0, u: 3 }), seconds(5));
  scene.drive(COAST);
  scene.set({ liftDeg });
  const sample = () => {
    const c = scene.robot.chassis;
    const o = massG > 0 ? scene.object('cube').body : c;
    return { cp: c.translation(), cq: c.rotation(), op: o.translation(), oq: o.rotation(), wheels: scene.robot.wheelAngles(), lift: scene.gripper.liftDeg(), claw: scene.gripper.clawDeg(), held: scene.gripper.liftHeld };
  };
  const rows: ReturnType<typeof sample>[] = [];
  for (let i = 0; i < seconds(4); i++) {
    scene.step();
    rows.push(sample());
  }
  const k = rows.findIndex((row) => row.held);
  const diff = (a: ReturnType<typeof sample>, b: ReturnType<typeof sample>) => ({
    chassisCm: Math.max(Math.abs(a.cp.x - b.cp.x), Math.abs(a.cp.y - b.cp.y), Math.abs(a.cp.z - b.cp.z)) * 100,
    chassisQ: Math.max(Math.abs(a.cq.x - b.cq.x), Math.abs(a.cq.y - b.cq.y), Math.abs(a.cq.z - b.cq.z), Math.abs(a.cq.w - b.cq.w)),
    objectCm: Math.max(Math.abs(a.op.x - b.op.x), Math.abs(a.op.y - b.op.y), Math.abs(a.op.z - b.op.z)) * 100,
    objectQ: Math.max(Math.abs(a.oq.x - b.oq.x), Math.abs(a.oq.y - b.oq.y), Math.abs(a.oq.z - b.oq.z), Math.abs(a.oq.w - b.oq.w)),
    wheelRad: Math.max(Math.abs(a.wheels[0] - b.wheels[0]), Math.abs(a.wheels[1] - b.wheels[1])),
    liftDeg: Math.abs(a.lift - b.lift),
    clawDeg: Math.abs(a.claw - b.claw),
  });
  const lines = [`engaged at tick ${k} (${(k / 120).toFixed(3)} s after the lift command)`];
  for (const span of [1, 12, 60, 120, 240]) if (k - 1 >= 0 && k - 1 + span < rows.length) lines.push(`from the tick before to ${span} ticks after: ${JSON.stringify(diff(rows[k - 1]!, rows[k - 1 + span]!))}`);
  lines.push(`the 0.5 s before it (motor-held): ${JSON.stringify(diff(rows[k - 61]!, rows[k - 1]!))}`);
  writeFileSync(join(import.meta.dirname, 'results', `holdjump-lift${liftDeg}-${massG}g.txt`), `${lines.join('\n')}\n`);
  expect(k).toBeGreaterThan(0);
});
