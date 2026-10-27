// N19 B7 spike: a stopped gripper car on a flat floor (no object), its arm set to lift L and claw C, motors coasting (or braking): the
// chassis' yaw rate and drift over a window after a settle. World level (gripper-scene.ts, the world's order of a tick), no program.
//   OUT=<name> LIFTS='[0,55,90]' CLAWS='[0,80]' MOTOR=coast|brake SETTLE=3 WINDOW=10 pnpm exec vitest run --config spikes/n19-b7/vitest.config.ts sweep
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, expect, it } from 'vitest';
import { BRAKE, COAST, cube, gripperScene, pick, run, seconds } from '../../src/core/world/__fixtures__/gripper-scene';
import { initPhysics } from '../../src/core/world/rapier';
import { holdLiftByLimits, jointErrors } from './lib';

beforeAll(() => initPhysics(), 30_000);

const yawOf = (q: { x: number; y: number; z: number; w: number }) => Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.z * q.z));

it('sweeps lift × claw', () => {
  const lifts = JSON.parse(process.env.LIFTS ?? '[0,30,55,90]') as number[];
  const claws = JSON.parse(process.env.CLAWS ?? '[0,80]') as number[];
  const motor = process.env.MOTOR === 'brake' ? BRAKE : COAST;
  const settle = Number(process.env.SETTLE ?? 3);
  const window = Number(process.env.WINDOW ?? 10);
  const yaw0 = Number(process.env.YAW ?? 0);
  const rows = [];
  for (const liftDeg of lifts) {
    for (const clawDeg of claws) {
      const x = Number(process.env.X ?? 150);
      const y = Number(process.env.Y ?? 150);
      // PICK=1: a 15 g cube 20 cm ahead; the car picks it at lift 0 (gripper-scene.ts `pick`), lifts it to `liftDeg`, opens (a release: the
      // grasp's fixed joint removed), then the PRE legs and the stop. PICK=hold: the same without the release.
      const picking = process.env.PICK;
      const objects = picking === undefined ? [] : [cube('cube', [x + 20, y], Number(process.env.MASS ?? 15))];
      const scene = gripperScene({ ground: { sizeCm: JSON.parse(process.env.GROUND ?? '[300,300]') as [number, number], color: '#ffffff' }, objects }, { xCm: x, yCm: y, yawDeg: yaw0 });
      if (picking !== undefined) {
        run(scene, pick(scene, 'cube', { liftDeg: 0, u: 3 }), seconds(5));
        if (scene.grasp.heldId === null) throw new Error('no grip');
        scene.drive(BRAKE);
        scene.set({ liftDeg });
        for (let i = 0; i < seconds(1); i++) scene.step();
        if (picking !== 'hold') scene.set({ clawDeg });
        for (let i = 0; i < seconds(0.5); i++) scene.step();
      }
      scene.set({ liftDeg, ...(picking === 'hold' ? {} : { clawDeg }) });
      // PRE: a list of [duty, dir, seconds] legs driven before the stop (the arm already at its pose), e.g. the stack's last [[128,-1,1]].
      const pre = JSON.parse(process.env.PRE ?? '[]') as [number, -1 | 1, number][];
      for (let i = 0; i < seconds(1); i++) scene.step();
      for (const [duty, dir, s] of pre) {
        scene.drive({ duty, dir, brake: false });
        for (let i = 0; i < seconds(s); i++) scene.step();
      }
      scene.drive(motor);
      for (let i = 0; i < seconds(settle); i++) scene.step();
      // HOLD=1: from the window's start the boom is held by its joint's limits at its angle, the lift motor off (lib.ts `holdLiftByLimits`).
      if (process.env.HOLD === '1') holdLiftByLimits(scene.world, scene.robot.chassis, scene.gripper.boom);
      // FINGERS_OFF=1: from the window's start the fingers' motors push with nothing (a held cube is not the fingers' to push: solver groups).
      if (process.env.FINGERS_OFF === '1') for (const finger of scene.gripper.fingers) finger.joint.setMotorMaxForce(0);
      const q0 = scene.robot.chassis.rotation();
      const p0 = scene.robot.chassis.translation();
      let maxW = 0;
      for (let i = 0; i < seconds(window); i++) {
        scene.step();
        maxW = Math.max(maxW, Math.abs(scene.robot.chassis.angvel().y));
      }
      const q1 = scene.robot.chassis.rotation();
      const p1 = scene.robot.chassis.translation();
      const row = {
        liftDeg,
        clawDeg,
        motor: process.env.MOTOR ?? 'coast',
        yawRateDegS: ((yawOf(q1) - yawOf(q0)) * 180) / Math.PI / window,
        driftCmS: (Math.hypot(p1.x - p0.x, p1.z - p0.z) * 100) / window,
        maxYawRateDegS: (maxW * 180) / Math.PI,
        lift: scene.gripper.liftDeg(),
        claw: scene.gripper.clawDeg(),
        held: scene.grasp.heldId,
        joints: jointErrors(scene.world),
      };
      rows.push(row);
      console.log(JSON.stringify(row));
      scene.dispose();
    }
  }
  writeFileSync(join(import.meta.dirname, 'results', `${process.env.OUT ?? 'sweep'}.json`), JSON.stringify(rows, null, 1));
  expect(rows.length).toBe(lifts.length * claws.length);
});
