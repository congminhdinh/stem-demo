import { beforeAll, describe, expect, it } from 'vitest';
import { productionKits, referenceKitRef } from '../hardware/catalog';
import type { Kit } from '../hardware/kit';
import { gripperKit } from './__fixtures__/gripper-scene';
import { bodyPalette } from './arena/body-colors';
import { parseArena, type ArenaInput } from './arena/arena-schema';
import { initPhysics, PHYSICS_DT_S } from './rapier';
import type { MotorCommand } from './robot/dc-motor';
import type { GripperTargets } from './robot/gripper';
import { GRIPPER_PART_ID } from './sensors/sensed-bodies';
import type { RobotSnapshot } from './snapshot';
import { createWorld, type World } from './world';

// N19 B3 in the world (world.ts, plan §4.4): the gripper car's IR between the jaws and colour sensor on the carriage, measured once per
// tick after the grasp machine, and its ultrasonic, which leaves out the chassis but hears the gripper's own parts as a real HC-SR04 does.
// Arenas keep their bodies at least 17 cm ahead of the robot at the start (out of the jaws' reach at any lift); the scripts drive up.

beforeAll(() => initPhysics(), 30_000);

const rover = productionKits.get(referenceKitRef) as Kit;
const DEG = Math.PI / 180;
const START = { xCm: 40, yCm: 50, yawDeg: 0 } as const;
/** The carriage origin ahead of the robot frame's origin at a lift angle, cm (mount x 4.5, boom 5 cm, elevation lift − 40°). */
const tipX = (liftDeg: number) => 4.5 + 5 * Math.cos((liftDeg - 40) * DEG);
const seconds = (s: number) => Math.round(s / PHYSICS_DT_S);
const BRAKE: MotorCommand = { duty: 0, dir: 0, brake: true };
const COAST: MotorCommand = { duty: 0, dir: 0, brake: false };
const forward = (duty: number): MotorCommand => ({ duty, dir: 1, brake: false });
const cube = (id: string, xCm: number, color?: string, massG = 15) => ({
  shape: 'box' as const,
  id,
  centerCm: [xCm, START.yCm] as [number, number],
  sizeCm: [4, 4, 4] as [number, number, number],
  massG,
  ...(color === undefined ? {} : { color }),
});
const floor = (extra: Partial<ArenaInput> = {}) => parseArena({ ground: { sizeCm: [250, 100], color: '#ffffff' }, ...extra });

function driver(world: World) {
  let motor = COAST;
  let gripper: GripperTargets = {};
  return {
    drive(command: MotorCommand) {
      motor = command;
    },
    set(targets: GripperTargets) {
      gripper = { ...gripper, ...targets };
    },
    step(ticks = 1) {
      for (let i = 0; i < ticks; i++) {
        world.applyActuators({ motors: { motorLeft: motor, motorRight: motor }, gripper });
        world.step(PHYSICS_DT_S);
      }
    },
  };
}

/** The cube's centre ahead of the carriage origin at a lift angle, cm (the robot heads along +x). */
const uOf = (snapshot: RobotSnapshot, id: string, liftDeg = 0) => snapshot.objects.find((object) => object.id === id)!.pose.xCm - snapshot.robot.xCm - tipX(liftDeg);

/** Lower and open, then drive in at duty 140 until the cube's centre is at carriage u ≤ `u` + 0.25; brake and settle. */
function approach(world: World, control: ReturnType<typeof driver>, id: string, u: number, onTick?: () => void) {
  control.set({ liftDeg: 0, clawDeg: 0 });
  control.step(seconds(0.35));
  control.drive(forward(140));
  for (let i = 0; i < seconds(4) && uOf(world.snapshot(), id) > u + 0.25; i++) {
    control.step();
    onTick?.();
  }
  control.drive(BRAKE);
  control.step(seconds(0.3));
}

describe('the gripper car’s sensors in the world (N19 B3)', () => {
  it('snapshots the IR and the colour sensor in kit order after the ultrasonic and the line sensors; the rover’s sensors are as they were', async () => {
    const world = await createWorld({ arena: floor(), start: START, kit: gripperKit, seed: 1 });
    try {
      const sensors = world.snapshot().sensors;
      expect(sensors.map((sensor) => [sensor.role, sensor.kind])).toEqual([
        ['ultrasonic', 'ultrasonic'],
        ['lineLeft', 'line-sensor'],
        ['lineCenter', 'line-sensor'],
        ['lineRight', 'line-sensor'],
        ['irClaw', 'ir-obstacle'],
        ['color1', 'color-sensor'],
      ]);
      expect(sensors[4]).toEqual({ role: 'irClaw', kind: 'ir-obstacle', detected: false, hitId: null });
      expect(sensors[5]).toEqual({ role: 'color1', kind: 'color-sensor', hitId: null, distanceCm: null });
      expect(world.sense.ir('irClaw')).toEqual({ detected: false, level: 1, hitId: null });
      expect(world.sense.color('color1')).toEqual({ hitId: null, distanceCm: null, light: { c: 600, r: 200, g: 200, b: 200 } });
      expect(() => world.sense.ir('color1')).toThrow(new RangeError('The kit has no IR sensor "color1".'));
      expect(() => world.sense.color('irClaw')).toThrow(new RangeError('The kit has no colour sensor "irClaw".'));
    } finally {
      world.dispose();
    }
    const roverWorld = await createWorld({ arena: floor(), start: START, kit: rover, seed: 1 });
    try {
      expect(roverWorld.snapshot().sensors.map((sensor) => sensor.kind)).toEqual(['ultrasonic', 'line-sensor', 'line-sensor', 'line-sensor']);
      expect(() => roverWorld.sense.ir('irClaw')).toThrow(RangeError);
      expect(() => roverWorld.sense.color('color1')).toThrow(RangeError);
    } finally {
      roverWorld.dispose();
    }
  });

  it('ultrasonic clear of jaws at lift 0° and 90°: at every claw angle it hears the wall 60 cm ahead, and at lift 45° its own carriage', async () => {
    // The wall's face 60 cm past the ultrasonic (mount x 7.5): no part of the gripper is in its five-ray cone at lift 0° nor 90°.
    const faceX = START.xCm + 7.5 + 60;
    const world = await createWorld({ arena: floor({ walls: [{ id: 'wall', fromCm: [faceX + 1, 5], toCm: [faceX + 1, 95] }] }), start: START, kit: gripperKit, seed: 1 });
    try {
      const control = driver(world);
      const heard: string[] = [];
      for (const liftDeg of [0, 90]) {
        for (const clawDeg of [0, 20, 40, 60, 80]) {
          control.set({ liftDeg, clawDeg });
          control.step(seconds(0.4));
          const { gripper } = world.snapshot().robot;
          expect([Math.abs(gripper!.liftDeg - liftDeg) < 1, Math.abs(gripper!.clawDeg - clawDeg) < 1]).toEqual([true, true]);
          const echo = world.sense.ultrasonic('ultrasonic');
          heard.push(`${liftDeg}/${clawDeg}: ${echo.hitId} ${echo.cm.toFixed(1)}`);
        }
      }
      expect(heard).toEqual([0, 90].flatMap((lift) => [0, 20, 40, 60, 80].map((claw) => `${lift}/${claw}: wall 60.0`)));
      // Raised to 45° the carriage stands right in front of it (its box 1.5 cm ahead, 4.74–5.94 cm high): it hears that, at its near end.
      control.set({ liftDeg: 45, clawDeg: 0 });
      control.step(seconds(0.4));
      expect(world.sense.ultrasonic('ultrasonic')).toEqual({ cm: 2, echoUs: 116, hitId: GRIPPER_PART_ID });
    } finally {
      world.dispose();
    }
  });

  it('a 4 cm cube between the jaws reads 3.8 ± 0.2 cm: the last the cone hears of it, its near face between the jaws, before it passes under', async () => {
    const world = await createWorld({ arena: floor({ objects: [cube('cube', START.xCm + tipX(0) + 3 + 8)] }), start: START, kit: gripperKit, seed: 1 });
    try {
      const control = driver(world);
      let last: { cm: number; nearFaceU: number } | null = null;
      approach(world, control, 'cube', 3, () => {
        const echo = world.sense.ultrasonic('ultrasonic');
        if (echo.hitId === 'cube') last = { cm: echo.cm, nearFaceU: uOf(world.snapshot(), 'cube') - 2 };
      });
      expect(last).not.toBeNull();
      const { cm, nearFaceU } = last!;
      expect(Math.abs(cm - 3.8)).toBeLessThanOrEqual(0.2);
      // Between the jaws: the fingers run from u 0.5 (their hinges) to 5.5.
      expect(nearFaceU).toBeGreaterThan(0.5);
      expect(nearFaceU).toBeLessThan(5.5);
      // Centred between the jaws (u ≈ 3) the cube is under the cone: the lowest ray meets its top at 75°, which sends no echo back.
      expect(Math.abs(uOf(world.snapshot(), 'cube') - 3)).toBeLessThan(0.5);
      expect(world.sense.ultrasonic('ultrasonic').hitId).not.toBe('cube');
    } finally {
      world.dispose();
    }
  }, 60_000);

  it('IR sees nothing without an object, at every claw and lift angle in 5° steps: never the robot’s own fingers', async () => {
    const world = await createWorld({ arena: floor(), start: START, kit: gripperKit, seed: 1 });
    try {
      const control = driver(world);
      const seen: string[] = [];
      let combos = 0;
      for (let liftDeg = 0; liftDeg <= 90; liftDeg += 5) {
        control.set({ liftDeg, clawDeg: 0 });
        control.step(seconds(0.3));
        for (let clawDeg = 0; clawDeg <= 90; clawDeg += 5) {
          control.set({ clawDeg });
          control.step(seconds(0.12));
          const { gripper } = world.snapshot().robot;
          // The claw stops where the fingers meet (80°): told more, it reads 80.
          expect([liftDeg, clawDeg, Math.abs(gripper!.liftDeg - liftDeg) < 1, Math.abs(gripper!.clawDeg - Math.min(clawDeg, 80)) < 1]).toEqual([liftDeg, clawDeg, true, true]);
          const ir = world.sense.ir('irClaw');
          if (ir.detected || ir.hitId !== null || ir.level !== 1) seen.push(`${liftDeg}/${clawDeg}: ${ir.hitId}`);
          combos += 1;
        }
      }
      expect(combos).toBe(19 * 19);
      expect(seen).toEqual([]);
    } finally {
      world.dispose();
    }
  }, 60_000);

  it('IR sees a cube coming between the jaws within 2 cm, and a held cube; the colour sensor reads it too', async () => {
    const world = await createWorld({ arena: floor({ objects: [cube('cube', START.xCm + tipX(0) + 3 + 8, bodyPalette.red)] }), start: START, kit: gripperKit, seed: 1 });
    try {
      const control = driver(world);
      let firstSeenNearFaceU: number | null = null;
      approach(world, control, 'cube', 3, () => {
        if (firstSeenNearFaceU === null && world.sense.ir('irClaw').detected) firstSeenNearFaceU = uOf(world.snapshot(), 'cube') - 2;
      });
      // The IR sits at carriage u 0.3: it first sees the cube's near face 2 cm on (one tick of travel, 1.3 mm at duty 140, sooner).
      expect(firstSeenNearFaceU).not.toBeNull();
      expect(firstSeenNearFaceU!).toBeLessThanOrEqual(2.3);
      expect(firstSeenNearFaceU!).toBeGreaterThan(2.1);
      control.set({ clawDeg: 80 });
      control.step(seconds(0.6));
      control.set({ liftDeg: 90 });
      control.step(seconds(0.5));
      const snapshot = world.snapshot();
      expect(snapshot.robot.gripper!.heldId).toBe('cube');
      expect(world.sense.ir('irClaw')).toEqual({ detected: true, level: 0, hitId: 'cube' });
      const color = world.sense.color('color1');
      expect(color.hitId).toBe('cube');
      // Held at u ≈ 3, its near face 0.7 cm from the sensors (u 0.3).
      expect(Math.abs(color.distanceCm! - 0.7)).toBeLessThan(0.3);
      expect(snapshot.sensors.find((sensor) => sensor.kind === 'ir-obstacle')).toEqual({ role: 'irClaw', kind: 'ir-obstacle', detected: true, hitId: 'cube' });
      expect(snapshot.sensors.find((sensor) => sensor.kind === 'color-sensor')).toEqual({ role: 'color1', kind: 'color-sensor', hitId: 'cube', distanceCm: color.distanceCm });
    } finally {
      world.dispose();
    }
  }, 60_000);

  it('black cube not seen by IR: between the jaws, held or not; the colour sensor still meets it', async () => {
    const world = await createWorld({ arena: floor({ objects: [cube('black', START.xCm + tipX(0) + 3 + 8, '#212121')] }), start: START, kit: gripperKit, seed: 1 });
    try {
      const control = driver(world);
      let detected = 0;
      approach(world, control, 'black', 3, () => {
        if (world.sense.ir('irClaw').detected) detected += 1;
      });
      expect(detected).toBe(0);
      const ir = world.sense.ir('irClaw');
      expect(ir).toEqual({ detected: false, level: 1, hitId: 'black' });
      control.set({ clawDeg: 80 });
      control.step(seconds(0.6));
      expect(world.snapshot().robot.gripper!.heldId).toBe('black');
      expect(world.sense.ir('irClaw').detected).toBe(false);
      expect(world.sense.color('color1').hitId).toBe('black');
    } finally {
      world.dispose();
    }
  }, 60_000);

  it('the colour sensor looks ahead of the carriage: lowered, nothing in front, it meets neither the mat nor its own carriage; closed, its finger', async () => {
    const world = await createWorld({ arena: floor(), start: START, kit: gripperKit, seed: 1 });
    try {
      const control = driver(world);
      control.set({ liftDeg: 0, clawDeg: 0 });
      control.step(seconds(0.4));
      expect(world.sense.color('color1')).toEqual({ hitId: null, distanceCm: null, light: { c: 600, r: 200, g: 200, b: 200 } });
      // Closed on nothing, the fingers' tips meet across its ray: it meets its own right finger's pad (measured 3.3627 cm), a dark grey.
      control.set({ clawDeg: 80 });
      control.step(seconds(0.4));
      const closed = world.sense.color('color1');
      expect([closed.hitId, closed.distanceCm]).toEqual([GRIPPER_PART_ID, 3.3627]);
      expect(closed.light).toEqual({ c: 4454, r: 1543, g: 1517, b: 1394 });
    } finally {
      world.dispose();
    }
  });
});
