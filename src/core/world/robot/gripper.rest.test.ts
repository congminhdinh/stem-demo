import { beforeAll, describe, expect, it } from 'vitest';
import { backward, BRAKE, COAST, cube, forward, gripperScene, pick, run, seconds, type GripperScene } from '../__fixtures__/gripper-scene';
import { initPhysics } from '../rapier';
import { rotateVector } from '../units';
import { LIFT_HOLD_TICKS } from './gripper';

// N19 B7 (plan §4.17): a stopped gripper car stays where it stopped. Before B7 the car turned at rest whenever the lift servo's motor held
// the boom between its stops (spikes/n19-b7/results.md): 1.5e-4 to 2.5e-4 °/s on a clean floor at lift 10–70°, 0.0102 °/s at the end of
// rb-grip-stack's reference, which made the 3D scene redraw 10 times a second (E9); holding a cube, the fingers' motors leaked the same way.
// B7's hold (gripper.ts): a car still on its supports with its drive stopped and its servo commands unchanged for 1 s holds its lift, and the
// fingers of a held object, by their joints' limits. The bounds of the brief, over 10 s once settled: the chassis turns under 1e-4 °/s and
// its origin moves under 1e-4 cm/s. Measures (tests only, Math trigonometry): the yaw of the chassis' forward axis on the floor, the travel
// of its origin on the floor.

beforeAll(() => initPhysics(), 30_000);

const MAX_YAW_RATE_DEG_S = 1e-4;
const MAX_DRIFT_CM_S = 1e-4;
const WINDOW_S = 10;
const START = { xCm: 150, yCm: 150, yawDeg: 0 } as const;
const floor = { sizeCm: [300, 300] as [number, number], color: '#ffffff' };

const yawDeg = (scene: GripperScene) => {
  const q = scene.robot.chassis.rotation();
  return (Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.z * q.z)) * 180) / Math.PI;
};

/** The chassis' yaw rate and drift over WINDOW_S, from the scene as it is. */
function creep(scene: GripperScene): { yawRateDegS: number; driftCmS: number } {
  const yaw0 = yawDeg(scene);
  const p0 = scene.robot.chassis.translation();
  for (let i = 0; i < seconds(WINDOW_S); i++) scene.step();
  const p1 = scene.robot.chassis.translation();
  return { yawRateDegS: Math.abs(yawDeg(scene) - yaw0) / WINDOW_S, driftCmS: (Math.hypot(p1.x - p0.x, p1.z - p0.z) * 100) / WINDOW_S };
}

/** The arm put at lift/claw, the car backed off at duty 128 for 1 s (the stack reference's last move), stopped (coast) and settled 3 s. */
function stoppedAt(liftDeg: number, clawDeg: number): GripperScene {
  const scene = gripperScene({ ground: floor }, START);
  scene.set({ liftDeg, clawDeg });
  for (let i = 0; i < seconds(1); i++) scene.step();
  scene.drive(backward(128));
  for (let i = 0; i < seconds(1); i++) scene.step();
  scene.drive(COAST);
  for (let i = 0; i < seconds(3); i++) scene.step();
  return scene;
}

describe('a stopped gripper car does not creep (N19 B7)', () => {
  it.each([
    [55, 0, 'the end of rb-grip-stack: carried at 55°, the claw open'],
    [55, 80, 'carried at 55°, the claw closed on nothing'],
    [10, 0, 'just off the floor, open'],
    [45, 40, 'level boom, the claw half closed'],
    [90, 80, 'arm up, the claw closed (the lift on its top stop)'],
    [0, 0, 'arm down on its bottom stop, open'],
  ] as const)('not holding: lift %d°, claw %d° (%s)', (liftDeg, clawDeg, what) => {
    const scene = stoppedAt(liftDeg, clawDeg);
    try {
      expect(scene.gripper.liftDeg(), what).toBeCloseTo(liftDeg, 0);
      // The lift holds; an empty claw keeps its motors.
      expect([scene.gripper.liftHeld, scene.gripper.clawHeld], what).toEqual([true, false]);
      const { yawRateDegS, driftCmS } = creep(scene);
      expect(scene.gripper.liftHeld, what).toBe(true);
      expect(yawRateDegS, what).toBeLessThan(MAX_YAW_RATE_DEG_S);
      expect(driftCmS, what).toBeLessThan(MAX_DRIFT_CM_S);
    } finally {
      scene.dispose();
    }
  }, 60_000);

  it.each([
    [15, 55],
    [50, 30],
    [50, 90],
  ] as const)('holding %d g, carried at lift %d°, stopped and settled', (massG, liftDeg) => {
    const scene = gripperScene({ ground: floor, objects: [cube('cube', [START.xCm + 20, START.yCm], massG)] }, START);
    try {
      // Picked at lift 0 with the car's pick (gripper-scene.ts), carried up, driven on 1 s at duty 128, stopped and settled 3 s.
      run(scene, pick(scene, 'cube', { liftDeg: 0, u: 3 }), seconds(5));
      expect(scene.grasp.heldId).toBe('cube');
      scene.set({ liftDeg });
      for (let i = 0; i < seconds(1); i++) scene.step();
      scene.drive(forward(128));
      for (let i = 0; i < seconds(1); i++) scene.step();
      scene.drive(COAST);
      for (let i = 0; i < seconds(3); i++) scene.step();
      expect(scene.grasp.heldId).toBe('cube');
      expect([scene.gripper.liftHeld, scene.gripper.clawHeld]).toEqual([true, true]);
      const { yawRateDegS, driftCmS } = creep(scene);
      expect(scene.grasp.heldId).toBe('cube');
      expect(yawRateDegS).toBeLessThan(MAX_YAW_RATE_DEG_S);
      expect(driftCmS).toBeLessThan(MAX_DRIFT_CM_S);
    } finally {
      scene.dispose();
    }
  }, 60_000);

  it('touching the base: the open jaws driven onto lesson 11’s base (6 × 6 × 4 cm, 40 g) until a finger meets it, then stopped', () => {
    const base = { shape: 'box' as const, id: 'base', centerCm: [START.xCm + 22, START.yCm] as [number, number], sizeCm: [6, 6, 4] as [number, number, number], massG: 40 };
    const scene = gripperScene({ ground: floor, objects: [base] }, START);
    try {
      scene.set({ liftDeg: 0, clawDeg: 0 });
      for (let i = 0; i < seconds(0.5); i++) scene.step();
      scene.drive(forward(102));
      const finger = (side: 0 | 1) => scene.gripper.fingers[side].collider.contactCollider(scene.object('base').collider, 0.0005) !== null;
      let met = false;
      for (let i = 0; i < seconds(4) && !met; i++) {
        scene.step();
        met = finger(0) || finger(1);
      }
      expect(met).toBe(true);
      scene.drive(COAST);
      for (let i = 0; i < seconds(3); i++) scene.step();
      expect(finger(0) || finger(1)).toBe(true);
      expect(scene.grasp.heldId).toBeNull();
      expect(scene.gripper.liftHeld).toBe(true);
      const { yawRateDegS, driftCmS } = creep(scene);
      expect(finger(0) || finger(1)).toBe(true);
      expect(yawRateDegS).toBeLessThan(MAX_YAW_RATE_DEG_S);
      expect(driftCmS).toBeLessThan(MAX_DRIFT_CM_S);
    } finally {
      scene.dispose();
    }
  }, 60_000);
});

describe('the lift’s hold at rest (N19 B7, gripper.ts)', () => {
  /** Ticks the scene until the lift holds (at most `max`), and how many it took. */
  const ticksToHold = (scene: GripperScene, max = seconds(3)) => {
    for (let i = 1; i <= max; i++) {
      scene.step();
      if (scene.gripper.liftHeld) return i;
    }
    return null;
  };

  it('takes hold 1 s after the lift came to its command with the car still, and holds the boom where it stood', () => {
    const scene = gripperScene({ ground: floor }, START);
    try {
      // The world's settle (0.5 s) is shorter than the hold's second: a car just built does not hold yet.
      expect(scene.gripper.liftHeld).toBe(false);
      scene.set({ liftDeg: 55 });
      // 90° → 55° takes 0.1 s or so; then LIFT_HOLD_TICKS in a row at rest.
      const ticks = ticksToHold(scene)!;
      expect(ticks).toBeGreaterThan(LIFT_HOLD_TICKS);
      expect(ticks).toBeLessThan(LIFT_HOLD_TICKS + seconds(0.3));
      const held = scene.gripper.liftDeg();
      expect(held).toBeCloseTo(55, 1);
      for (let i = 0; i < seconds(5); i++) scene.step();
      expect(scene.gripper.liftHeld).toBe(true);
      expect(Math.abs(scene.gripper.liftDeg() - held)).toBeLessThan(1e-3);
    } finally {
      scene.dispose();
    }
  }, 60_000);

  it('lets go at a new lift or claw command, the same command again changes nothing, and the motor drives on from where it held', () => {
    const scene = gripperScene({ ground: floor }, START);
    try {
      scene.set({ liftDeg: 55, clawDeg: 0 });
      expect(ticksToHold(scene)).not.toBeNull();
      scene.set({ liftDeg: 55, clawDeg: 0 });
      scene.step();
      expect(scene.gripper.liftHeld).toBe(true);
      scene.set({ clawDeg: 80 });
      scene.step();
      expect(scene.gripper.liftHeld).toBe(false);
      expect(ticksToHold(scene)).not.toBeNull();
      scene.set({ liftDeg: 0 });
      scene.step();
      expect(scene.gripper.liftHeld).toBe(false);
      for (let i = 0; i < seconds(0.5); i++) scene.step();
      expect(scene.gripper.liftDeg()).toBeCloseTo(0, 1);
    } finally {
      scene.dispose();
    }
  }, 60_000);

  it('lets go when the drive moves the car, and does not hold while it drives or rolls to a stop', () => {
    const scene = gripperScene({ ground: floor }, START);
    try {
      scene.set({ liftDeg: 55 });
      expect(ticksToHold(scene)).not.toBeNull();
      scene.drive(forward(128));
      scene.step();
      expect(scene.gripper.liftHeld).toBe(false);
      let heldWhileMoving = false;
      for (let i = 0; i < seconds(1); i++) {
        scene.step();
        heldWhileMoving ||= scene.gripper.liftHeld;
      }
      scene.drive(BRAKE);
      for (let i = 0; i < seconds(0.9); i++) {
        scene.step();
        heldWhileMoving ||= scene.gripper.liftHeld;
      }
      expect(heldWhileMoving).toBe(false);
      expect(ticksToHold(scene)).not.toBeNull();
    } finally {
      scene.dispose();
    }
  }, 60_000);

  it('never holds an arm pressing on something: lowered onto a block, the car noses up off its supports and the motor keeps pressing', () => {
    // A heavy 8 × 10 × 4 cm block from 10 to 18 cm ahead, under the jaws' path. The press is held by the car's weight (plan §4.6: the nose
    // lifts), so the lift reaches its command on the chassis, but the car stands on its wheels alone, its caster up: no hold.
    const block = { shape: 'box' as const, id: 'block', centerCm: [START.xCm + 14, START.yCm] as [number, number], sizeCm: [8, 10, 4] as [number, number, number], massG: 400 };
    const scene = gripperScene({ ground: floor, objects: [block] }, START);
    try {
      scene.set({ liftDeg: 0, clawDeg: 0 });
      expect(ticksToHold(scene, seconds(3))).toBeNull();
      const forward = rotateVector(scene.robot.chassis.rotation(), { x: 1, y: 0, z: 0 });
      // Nosed up on its wheels, the caster off the floor.
      expect((Math.asin(forward.y) * 180) / Math.PI).toBeGreaterThan(2);
      expect(scene.robot.isGrounded()).toBe(true);
    } finally {
      scene.dispose();
    }
  }, 60_000);

  it('holding a cube, the fingers hold too and the claw angle stays; opening the claw lets both go and the cube is put down', () => {
    const scene = gripperScene({ ground: floor, objects: [cube('cube', [START.xCm + 20, START.yCm], 15)] }, START);
    try {
      run(scene, pick(scene, 'cube', { liftDeg: 0, u: 3 }), seconds(5));
      scene.set({ liftDeg: 30 });
      expect(ticksToHold(scene)).not.toBeNull();
      expect([scene.grasp.heldId, scene.gripper.clawHeld]).toEqual(['cube', true]);
      const claw = scene.gripper.clawDeg();
      for (let i = 0; i < seconds(3); i++) scene.step();
      expect(Math.abs(scene.gripper.clawDeg() - claw)).toBeLessThan(1e-3);
      scene.set({ clawDeg: 0 });
      scene.step();
      expect([scene.gripper.liftHeld, scene.gripper.clawHeld]).toEqual([false, false]);
      for (let i = 0; i < seconds(0.5); i++) scene.step();
      expect(scene.grasp.heldId).toBeNull();
      expect(scene.gripper.clawDeg()).toBeCloseTo(0, 0);
    } finally {
      scene.dispose();
    }
  }, 60_000);

  it('a hand placement (placeAt) lets go, and it takes hold again at the new place', () => {
    const scene = gripperScene({ ground: floor }, START);
    try {
      scene.set({ liftDeg: 55 });
      expect(ticksToHold(scene)).not.toBeNull();
      scene.robot.placeAt({ xCm: 100, yCm: 100, yawDeg: 30 });
      expect(scene.gripper.liftHeld).toBe(false);
      expect(ticksToHold(scene)).toBeGreaterThan(LIFT_HOLD_TICKS);
      expect(scene.gripper.liftDeg()).toBeCloseTo(55, 1);
    } finally {
      scene.dispose();
    }
  }, 60_000);
});
