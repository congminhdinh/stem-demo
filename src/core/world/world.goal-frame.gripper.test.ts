import { beforeAll, describe, expect, it } from 'vitest';
import { gripperKit } from './__fixtures__/gripper-scene';
import { bodyPalette } from './arena/body-colors';
import { parseArena } from './arena/arena-schema';
import { toGoalFrame } from './goal-frame';
import { initPhysics, PHYSICS_DT_S } from './rapier';
import type { MotorCommand } from './robot/dc-motor';
import type { GripperTargets } from './robot/gripper';
import type { RobotSnapshot } from './snapshot';
import { createWorld, type World } from './world';

// N19 B4 in the world (world.ts, goal-frame.ts; plan §4.4, §4.5): a gripper car's goal frame carries the gripper and, for each arena object,
// its height, tilt, hold and support, straight from the bodies each tick, as toGoalFrame makes it of the snapshot and the extras.

beforeAll(() => initPhysics(), 30_000);

const DEG = Math.PI / 180;
const START = { xCm: 40, yCm: 50, yawDeg: 0 } as const;
const tipX = (liftDeg: number) => 4.5 + 5 * Math.cos((liftDeg - 40) * DEG);
const seconds = (s: number) => Math.round(s / PHYSICS_DT_S);
const BRAKE: MotorCommand = { duty: 0, dir: 0, brake: true };
const COAST: MotorCommand = { duty: 0, dir: 0, brake: false };
const forward = (duty: number): MotorCommand => ({ duty, dir: 1, brake: false });
const box = (id: string, xCm: number, sizeCm: [number, number, number], massG: number, color?: string) => ({
  shape: 'box' as const,
  id,
  centerCm: [xCm, START.yCm] as [number, number],
  sizeCm,
  massG,
  ...(color === undefined ? {} : { color }),
});
const CUBE_X = START.xCm + tipX(0) + 3 + 8;

function driver(world: World, onTick?: () => void) {
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
        onTick?.();
      }
    },
  };
}

const xOf = (snapshot: RobotSnapshot, id: string) => snapshot.objects.find((object) => object.id === id)!.pose.xCm;

/** Lower and open, drive in until the cube's centre is at carriage u ≤ 3.25, brake, close: held. */
function pick(world: World, control: ReturnType<typeof driver>) {
  control.set({ liftDeg: 0, clawDeg: 0 });
  control.step(seconds(0.35));
  control.drive(forward(140));
  for (let i = 0; i < seconds(4) && xOf(world.snapshot(), 'cube') - world.snapshot().robot.xCm - tipX(0) > 3.25; i++) control.step();
  control.drive(BRAKE);
  control.step(seconds(0.3));
  control.set({ clawDeg: 80 });
  control.step(seconds(0.6));
}

describe('the gripper car’s goal frame (N19 B4)', () => {
  it('is the frame toGoalFrame makes of the snapshot and the extras, tick after tick, through a pick, a lift and a release', async () => {
    const world = await createWorld({ arena: parseArena({ ground: { sizeCm: [200, 100], color: '#ffffff' }, objects: [box('cube', CUBE_X, [4, 4, 4], 15, bodyPalette.red)] }), start: START, kit: gripperKit, seed: 1 });
    try {
      let compared = 0;
      let heldTicks = 0;
      const compare = () => {
        const raw = world.goalFrame({ leds: {}, buzzerHz: null });
        expect(raw).toEqual(toGoalFrame({ ...world.snapshot(), leds: {} }, { ...world.frameExtras(), buzzerHz: null }));
        if (raw.objects.cube?.held === true) heldTicks += 1;
        compared += 1;
      };
      const control = driver(world, compare);
      compare();
      pick(world, control);
      control.set({ liftDeg: 60 });
      control.step(seconds(0.4));
      control.set({ clawDeg: 0 });
      control.step(seconds(0.5));
      expect(compared).toBeGreaterThan(seconds(2));
      expect(heldTicks).toBeGreaterThan(seconds(0.5));
      expect(world.goalFrame({ leds: {}, buzzerHz: null }).objects.cube!.held).toBe(false);
    } finally {
      world.dispose();
    }
  }, 60_000);

  it('goal frame of a held cube: held true, zCm above rest, tiltDeg 0', async () => {
    const world = await createWorld({ arena: parseArena({ ground: { sizeCm: [200, 100], color: '#ffffff' }, objects: [box('cube', CUBE_X, [4, 4, 4], 15)] }), start: START, kit: gripperKit, seed: 1 });
    try {
      const atRest = world.goalFrame({ leds: {}, buzzerHz: null });
      // Built at setup()'s angles; the lift sags 0.009° under its own weight at 90° (ADR 0004 §4.1, §10b).
      expect(atRest.gripper).toEqual({ clawDeg: 0, liftDeg: 89.991, heldId: null });
      const cubeAtRest = atRest.objects.cube!;
      expect([cubeAtRest.held, cubeAtRest.restingOn]).toEqual([false, ['#ground']]);
      expect(cubeAtRest.zCm).toBeCloseTo(2, 1);
      expect(cubeAtRest.tiltDeg).toBeLessThan(0.05);
      const control = driver(world);
      pick(world, control);
      control.set({ liftDeg: 90 });
      control.step(seconds(0.5));
      const frame = world.goalFrame({ leds: {}, buzzerHz: null });
      expect(frame.gripper?.heldId).toBe('cube');
      expect(Math.abs(frame.gripper!.liftDeg - 90)).toBeLessThan(0.2);
      // Attached at θc 19.94°, the fingers then follow the cube's faces (grasp.ts rule 3): parallel on a 4 cm cube at 26.97°. Measured 26.473.
      expect(frame.gripper!.clawDeg).toBeGreaterThan(25);
      expect(frame.gripper!.clawDeg).toBeLessThan(27);
      expect(frame.gripper!.clawDeg).toBe(Math.round(frame.gripper!.clawDeg * 1000) / 1000);
      const cube = frame.objects.cube!;
      expect([cube.held, cube.restingOn]).toEqual([true, []]);
      // Lifted to 90°: its bottom 7 cm above the floor (ADR 0004 §4.2), its middle as much above where it lay.
      expect(cube.zCm! - cubeAtRest.zCm!).toBeGreaterThan(6.5);
      expect(cube.tiltDeg).toBeLessThan(0.5);
    } finally {
      world.dispose();
    }
  }, 60_000);

  it('a cube resting on the base lists the base in restingOn: carried at lift 55° over the 6 × 6 × 4 cm base and let go there', async () => {
    // ADR 0004 §4.2 scenario 8′: held at lift 55° the cube's bottom is at 4.49 cm, over the base's top at 4; let go, it drops 0.49 cm onto it.
    const baseX = CUBE_X + 20;
    const arena = parseArena({ ground: { sizeCm: [200, 100], color: '#ffffff' }, objects: [box('cube', CUBE_X, [4, 4, 4], 15, bodyPalette.red), box('base', baseX, [6, 6, 4], 40, bodyPalette.yellow)] });
    const world = await createWorld({ arena, start: START, kit: gripperKit, seed: 1 });
    try {
      const control = driver(world);
      pick(world, control);
      control.set({ liftDeg: 55 });
      control.step(seconds(0.5));
      control.drive(forward(140));
      for (let i = 0; i < seconds(4) && xOf(world.snapshot(), 'cube') < baseX - 0.3; i++) control.step();
      control.drive(BRAKE);
      control.step(seconds(0.4));
      expect(world.snapshot().robot.gripper!.heldId).toBe('cube');
      control.set({ clawDeg: 0 });
      control.step(seconds(1));
      const frame = world.goalFrame({ leds: {}, buzzerHz: null });
      const { cube, base } = frame.objects;
      expect([cube!.held, cube!.restingOn, base!.restingOn]).toEqual([false, ['base'], ['#ground']]);
      // On top of it: its middle at the base's top (4 cm) plus half its own height, standing.
      expect(Math.abs(cube!.zCm! - 6)).toBeLessThan(0.1);
      expect(cube!.tiltDeg).toBeLessThan(2);
      expect(Math.abs(cube!.xCm - base!.xCm)).toBeLessThan(1.5);
    } finally {
      world.dispose();
    }
  }, 60_000);
});
