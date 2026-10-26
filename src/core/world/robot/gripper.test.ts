import { beforeAll, describe, expect, it } from 'vitest';
import { productionKits, referenceKitRef } from '../../hardware/catalog';
import type { Kit } from '../../hardware/kit';
import { robotMechanics } from '../../hardware/kit-mechanics';
import { BRAKE, cube, DT, forward, gripperKit, gripperScene, pick, run, seconds, wait, type Script } from '../__fixtures__/gripper-scene';
import { parseArena, type ArenaInput } from '../arena/arena-schema';
import { buildArena } from '../arena/build-arena';
import { createPhysicsWorld, initPhysics, type Collider } from '../rapier';
import { assembleRobot, stepWorld } from './assembly';
import {
  betaOfClawDeg,
  fingerTorqueNm,
  GRIPPER_COLLISION_GROUPS,
  GRIPPER_EXTRA_PGS_ITERATIONS,
  GRIPPER_EXTRA_SOLVER_ITERATIONS,
  GRIPPER_GROUP,
  GRIPPER_SOLVER_GROUPS,
  GRIPPER_START,
  LIFT_BRAKE_DECEL_RAD_S2,
  type GripperTargets,
} from './gripper';

// N19 B1 (plan §4.4 with §4.6, §4.7; ADR 0004 §5.2): the 2-DOF gripper of ref-uno-gripper@0 as Rapier bodies on the chassis: a boom on the
// lift servo, a carriage the parallel link keeps level (an AngZ lock chassis↔carriage), two mirrored fingers on the claw servo. Scripts
// set the targets each tick as the G0.1 spike did; measures use Math trigonometry (tests only, never written back into the world).

beforeAll(() => initPhysics(), 30_000);

const rover = productionKits.get(referenceKitRef) as Kit;
const open = (sizeCm: [number, number] = [200, 100]): ArenaInput => ({ ground: { sizeCm, color: '#ffffff' } });
const START = { xCm: 40, yCm: 50, yawDeg: 0 } as const;
const DEG = Math.PI / 180;
const spec = robotMechanics(gripperKit).gripper!.spec;

describe('the gripper of ref-uno-gripper@0 (N19 B1)', () => {
  it('builds the boom, the carriage and two fingers after the chassis; the chassis body is the car less the gripper’s moving parts', () => {
    const scene = gripperScene(open(), START);
    try {
      const { robot, gripper, world } = scene;
      expect(robot.bodies).toEqual([robot.chassis, gripper.boom, gripper.carriage, gripper.fingers[0].body, gripper.fingers[1].body]);
      // massG 460 is the whole car (§4.6): the chassis body is 460 − (6 + 22 + 2 × 3) = 426 g (Rapier keeps masses as float32).
      expect(robot.chassis.mass()).toBeCloseTo(0.426, 8);
      expect(gripper.boom.mass()).toBeCloseTo(0.006, 8);
      expect(gripper.carriage.mass()).toBeCloseTo(0.022, 8);
      expect(gripper.fingers.map((finger) => finger.body.mass())).toEqual([expect.closeTo(0.003, 8), expect.closeTo(0.003, 8)]);
      expect(robot.bodies.reduce((sum, body) => sum + body.mass(), 0)).toBeCloseTo(0.46, 6);
      // The arena's fixed body and the five; the ground and the chassis' six colliders (body, two wheel sides, two support balls,
      // caster) and the gripper's six (two boom plates, the boom's cross bar, the carriage, two fingers); five joints (boom on the
      // chassis, carriage on the boom, the AngZ lock chassis↔carriage, a finger on the carriage each).
      expect([world.bodies.len(), world.colliders.len(), world.impulseJoints.len(), world.multibodyJoints.len()]).toEqual([6, 13, 5, 0]);
      expect(gripper.colliders).toHaveLength(6);
      let own = 0;
      world.forEachCollider((collider) => {
        if (robot.ownsCollider(collider)) own += 1;
        expect(robot.ownsCollider(collider)).toBe(scene.arena.infoOf(collider) === undefined);
      });
      expect(own).toBe(12);
      for (const collider of gripper.colliders) expect(gripper.ownsCollider(collider)).toBe(true);
      expect(gripper.ownsCollider(robot.chassis.collider(0))).toBe(false);
    } finally {
      scene.dispose();
    }
  });

  it('every gripper body never sleeps and asks +8 PGS and +4 solver iterations; every gripper collider is in GRIPPER_GROUP only, for collisions and the solver', () => {
    expect([GRIPPER_GROUP, GRIPPER_COLLISION_GROUPS, GRIPPER_SOLVER_GROUPS]).toEqual([0x0004, 0x0004fffb, 0x0004ffff]);
    expect([GRIPPER_EXTRA_PGS_ITERATIONS, GRIPPER_EXTRA_SOLVER_ITERATIONS]).toEqual([8, 4]);
    const scene = gripperScene(open(), START);
    try {
      for (const body of scene.gripper.bodies) {
        expect([body.isSleeping(), body.additionalPgsIterations(), body.additionalSolverIterations()]).toEqual([false, 8, 4]);
      }
      expect(scene.robot.chassis.additionalSolverIterations()).toBe(0);
      for (const collider of scene.gripper.colliders) {
        expect([collider.collisionGroups(), collider.solverGroups()]).toEqual([0x0004fffb, 0x0004ffff]);
      }
      // The fingers are solid and frictionless (§4.6): jawFriction is the slip threshold's only.
      for (const finger of scene.gripper.fingers) expect([finger.collider.isSensor(), finger.collider.friction()]).toEqual([false, 0]);
    } finally {
      scene.dispose();
    }
  });

  it('maps the claw to the fingers: β = 12 − 0.445·θ, held within [−23.6°, 12°], each finger’s joint limited there', () => {
    expect([0, 26.97, 45, 80, 90, -5].map((deg) => Math.round(betaOfClawDeg(spec, deg) * 1e9) / 1e9)).toEqual([12, -0.00165, -8.025, -23.6, -23.6, 12]);
    // One servo drives both fingers through gears: each gets T_s / (2 · 0.445).
    expect(fingerTorqueNm(spec)).toBeCloseTo(0.18 / 0.89, 12);
    const scene = gripperScene(open(), START);
    try {
      const [left, right] = scene.gripper.fingers;
      expect([left.side, right.side]).toEqual([1, -1]);
      // (The joint keeps its limits as float32 radians.)
      expect([left.joint.limitsMin() / DEG, left.joint.limitsMax() / DEG].map((deg) => Math.round(deg * 1e4) / 1e4)).toEqual([-23.6, 12]);
      expect([right.joint.limitsMin() / DEG, right.joint.limitsMax() / DEG].map((deg) => Math.round(deg * 1e4) / 1e4)).toEqual([-12, 23.6]);
      // Built as setup() leaves it (D-G3): claw open, lift up.
      expect(GRIPPER_START).toEqual({ clawDeg: 0, liftDeg: 90 });
      expect([scene.gripper.clawCommandDeg, scene.gripper.liftCommandDeg]).toEqual([0, 90]);
      expect(left.betaDeg()).toBeCloseTo(12, 2);
      expect(right.betaDeg()).toBeCloseTo(12, 2);
      expect(scene.gripper.clawDeg()).toBeCloseTo(0, 1);
      expect(scene.gripper.liftDeg()).toBeCloseTo(90, 1);
    } finally {
      scene.dispose();
    }
  });

  it('clamps targets to 0..90 (D-G3) and refuses one that is not a number; a field left out holds', () => {
    const scene = gripperScene(open(), START);
    try {
      scene.set({ clawDeg: 120, liftDeg: -5 });
      expect([scene.gripper.clawCommandDeg, scene.gripper.liftCommandDeg]).toEqual([90, 0]);
      scene.set({ clawDeg: 30 });
      expect([scene.gripper.clawCommandDeg, scene.gripper.liftCommandDeg]).toEqual([30, 0]);
      expect(() => scene.set({ liftDeg: Number.NaN })).toThrow(RangeError);
      expect(() => scene.set({ clawDeg: undefined })).toThrow(RangeError);
      expect(() => scene.robot.applyActuators({ gripper: { clawDeg: 10, wristDeg: 5 } as GripperTargets })).toThrow(new RangeError('The gripper has no target wristDeg: clawDeg or liftDeg.'));
      expect([scene.gripper.clawCommandDeg, scene.gripper.liftCommandDeg]).toEqual([30, 0]);
    } finally {
      scene.dispose();
    }
  });

  it('a kit without a gripper refuses gripper targets, and nothing of a refused target is applied', () => {
    const world = createPhysicsWorld();
    try {
      buildArena(world, parseArena(open()));
      const robot = assembleRobot(world, rover, START);
      expect([robot.gripper, robot.grasp]).toEqual([null, null]);
      expect(() => robot.applyActuators({ motors: { motorLeft: { duty: 200, dir: 1, brake: false } }, gripper: { clawDeg: 10 } })).toThrow(new RangeError('The kit has no gripper.'));
      for (let tick = 0; tick < 60; tick++) stepWorld(world, robot);
      expect(Math.abs(robot.linvel().x)).toBeLessThan(1e-4);
    } finally {
      world.free();
    }
  });

  it('lift 0→90° in 22 ±2 ticks', () => {
    // The braking servo law (§4.6): speed = min(60°/liftSPer60Deg, |e|/dt, √(2·a·|e|)), a = 125.2 rad/s² (the spike's; see gripper.ts).
    expect(LIFT_BRAKE_DECEL_RAD_S2).toBe(125.2);
    const scene = gripperScene(open(), START);
    try {
      scene.set({ liftDeg: 0 });
      for (let tick = 0; tick < seconds(0.5); tick++) scene.step();
      expect(scene.gripper.liftDeg()).toBeCloseTo(0, 1);
      scene.set({ liftDeg: 90 });
      let reached = -1;
      let most = 0;
      for (let tick = 1; tick <= seconds(0.5); tick++) {
        scene.step();
        most = Math.max(most, scene.gripper.liftDeg());
        if (reached < 0 && Math.abs(scene.gripper.liftDeg() - 90) < 0.5) reached = tick;
      }
      // 22 ticks, within the plan's 22 ± 2 (ADR 0004 §4.1: 22 up, 21 down; with a = 139.4 it is 21), and 0.011° past 90 at most.
      expect(reached).toBe(22);
      expect(most).toBeLessThan(90.05);
      expect(scene.gripper.liftDeg()).toBeCloseTo(90, 1);
      // And down again (ADR 0004 §4.1: 21 ticks).
      scene.set({ liftDeg: 0 });
      let down = -1;
      for (let tick = 1; tick <= seconds(0.5) && down < 0; tick++) {
        scene.step();
        if (Math.abs(scene.gripper.liftDeg()) < 0.5) down = tick;
      }
      expect(down).toBe(21);
    } finally {
      scene.dispose();
    }
  });

  it('jaws stop at 80°', () => {
    const scene = gripperScene(open(), START);
    try {
      let most = 0;
      scene.set({ clawDeg: 80 });
      for (let tick = 0; tick < seconds(0.5); tick++) {
        scene.step();
        most = Math.max(most, scene.gripper.clawDeg());
      }
      expect(scene.gripper.clawDeg()).toBeCloseTo(80, 1);
      // Told 90 (the driver's most), the fingers still meet at jawsMeetDeg: their joints stop at β = −23.6°.
      scene.set({ clawDeg: 90 });
      for (let tick = 0; tick < seconds(0.5); tick++) {
        scene.step();
        most = Math.max(most, scene.gripper.clawDeg());
      }
      expect(scene.gripper.clawDeg()).toBeCloseTo(80, 1);
      expect(most).toBeLessThan(80.5);
      for (const finger of scene.gripper.fingers) expect(finger.betaDeg()).toBeCloseTo(-23.6, 1);
      // The tips meet at the middle line: the inner faces 2·(2.2 + 5·sin(−23.6°)) − 0.4 = 0 cm apart at the tips.
      scene.set({ clawDeg: 0 });
      for (let tick = 0; tick < seconds(0.5); tick++) scene.step();
      expect(scene.gripper.clawDeg()).toBeCloseTo(0, 1);
    } finally {
      scene.dispose();
    }
  });

  it('carriage level within 0.5° at every lift angle, 50 g held', () => {
    const scene = gripperScene({ ...open(), objects: [cube('cube', [START.xCm + 8.33 + 3 + 8, START.yCm], 50)] }, START);
    try {
      const rows: { lift: number; levelDeg: number; liftDeg: number; held: string | null }[] = [];
      let movingMost = 0;
      const script = (function* (): Script {
        yield* pick(scene, 'cube', { liftDeg: 0, u: 3 });
        for (const lift of [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 45, 0]) {
          scene.set({ liftDeg: lift });
          for (let i = 0; i < seconds(0.5); i++) {
            yield;
            movingMost = Math.max(movingMost, Math.abs(scene.gripper.carriageLevelErrorDeg()));
          }
          rows.push({ lift, levelDeg: scene.gripper.carriageLevelErrorDeg(), liftDeg: scene.gripper.liftDeg(), held: scene.grasp.heldId });
        }
      })();
      run(scene, script, seconds(0.35 + 4 + 1.1) + 12 * seconds(0.5) + 5);
      expect(rows.map((row) => row.lift)).toEqual([0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 45, 0]);
      for (const row of rows) {
        expect(row.held, `lift ${row.lift}`).toBe('cube');
        expect(Math.abs(row.levelDeg), `lift ${row.lift}`).toBeLessThanOrEqual(0.5);
        // The lift reaches its angle with the cube held (the last 0° presses the cube on the floor, which lifts the nose a little).
        if (row.lift > 0) expect(Math.abs(row.liftDeg - row.lift), `lift ${row.lift}`).toBeLessThan(0.5);
      }
      // Moving, the carriage swings a little more (measured 1.61°, at 45° → 0° where the cube lands on the floor): bounded, not level.
      expect(movingMost).toBeLessThan(2);
      expect(DT).toBe(1 / 120);
    } finally {
      scene.dispose();
    }
  });

  it('the arm keeps its angles when the robot is put down elsewhere (placeAt), and the gripper rides on the chassis', () => {
    const scene = gripperScene(open([300, 300]), START);
    try {
      scene.set({ liftDeg: 30, clawDeg: 40 });
      run(scene, wait(seconds(0.5)), seconds(0.5));
      const before = [scene.gripper.liftDeg(), scene.gripper.clawDeg()];
      scene.robot.placeAt({ xCm: 150, yCm: 200, yawDeg: 90 });
      const after = [scene.gripper.liftDeg(), scene.gripper.clawDeg()];
      after.forEach((value, i) => expect(value).toBeCloseTo(before[i]!, 4));
      // Put down level on the chassis.
      expect(Math.abs(scene.gripper.carriageLevelErrorDeg())).toBeLessThan(1e-4);
      // The boom's pivot is on the chassis at the mount: [4.5, 0, 4.9] cm in the robot frame, now 90° to the left.
      const pivot = scene.gripper.boom.translation();
      const chassis = scene.robot.chassis.translation();
      // (Positions are float32: 1e-5 cm at 2 m.)
      expect((pivot.x - chassis.x) * 100).toBeCloseTo(0, 4);
      expect((chassis.z - pivot.z) * 100).toBeCloseTo(4.5, 4);
      expect((pivot.y - chassis.y) * 100).toBeCloseTo(4.9, 4);
      for (const body of scene.gripper.bodies) expect([body.linvel(), body.angvel()]).toEqual([{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }]);
      run(scene, wait(seconds(0.5)), seconds(0.5));
      expect(scene.gripper.liftDeg()).toBeCloseTo(30, 1);
      expect(scene.gripper.clawDeg()).toBeCloseTo(40, 1);
    } finally {
      scene.dispose();
    }
  });

  it('gripper car starts from rest at duty 120, 140 and 160 with 50 g held at lift 0°', () => {
    // A 300 × 300 arena: there the car stood still at duty ≤ 160 before its support balls' contacts were refreshed every tick (Rapier kept the
    // friction it combined once per manifold, up to 0.97 from a tick the arm's move unloaded a wheel: 3.5 N of static friction).
    const moved: Record<number, number> = {};
    for (const duty of [120, 140, 160]) {
      const scene = gripperScene({ ground: { sizeCm: [300, 300], color: '#ffffff' }, objects: [cube('cube', [START.xCm + 8.33 + 3 + 8, START.yCm], 50)] }, START);
      try {
        let held: string | null = null;
        const script = (function* (): Script {
          yield* pick(scene, 'cube', { liftDeg: 0, u: 3 });
          scene.drive(BRAKE);
          yield* wait(seconds(0.5));
          const x0 = scene.robot.pose().position.x;
          scene.drive(forward(duty));
          yield* wait(seconds(0.5));
          moved[duty] = (scene.robot.pose().position.x - x0) * 100;
          held = scene.grasp.heldId;
          scene.drive(BRAKE);
          for (;;) yield;
        })();
        run(scene, script, seconds(0.35 + 4 + 1.1 + 1));
        expect(held, `duty ${duty}`).toBe('cube');
      } finally {
        scene.dispose();
      }
    }
    // From rest, in 0.5 s, holding 50 g at lift 0° (measured 3.49, 5.85 and 8.20 cm; before the refresh the car never reached the cube).
    expect(moved[120]).toBeGreaterThan(3.2);
    expect(moved[140]).toBeGreaterThan(5.5);
    expect(moved[160]).toBeGreaterThan(7.8);
    expect(moved[140]! - moved[120]!).toBeGreaterThan(2);
    expect(moved[160]! - moved[140]!).toBeGreaterThan(2);
  }, 60_000);

  it('the empty car starts from rest at duty 140 whatever arena it stands in and wherever its arm last moved', () => {
    // The cases that stood still (0.001–0.005 cm in 1 s) with the stale friction, and two that did not.
    const rows: string[] = [];
    for (const [size, at, lift] of [
      [[300, 300], [40, 50], 0],
      [[300, 300], [40, 50], 45],
      [[400, 400], [40, 50], 45],
      [[200, 100], [40, 50], 45],
      [[200, 100], [40, 50], 0],
      [[300, 300], [40, 50], 90],
    ] as const) {
      const scene = gripperScene({ ground: { sizeCm: [size[0], size[1]], color: '#ffffff' } }, { xCm: at[0], yCm: at[1], yawDeg: 0 });
      try {
        scene.set({ liftDeg: lift });
        run(scene, wait(seconds(0.5)), seconds(0.5));
        const x0 = scene.robot.pose().position.x;
        scene.drive(forward(140));
        run(scene, wait(seconds(1)), seconds(1));
        const cm = (scene.robot.pose().position.x - x0) * 100;
        rows.push(`${size.join('×')} lift ${lift}: ${cm.toFixed(2)} cm`);
        expect(cm, rows.at(-1)).toBeGreaterThan(14.5);
        expect(cm, rows.at(-1)).toBeLessThan(16.5);
      } finally {
        scene.dispose();
      }
    }
    expect(rows).toHaveLength(6);
  }, 60_000);

  it('never touches its own chassis (a contact is a positive impulse or a gap ≤ 0.5 mm: the manifold’s distance alone misses predicted ones)', () => {
    const scene = gripperScene(open(), START);
    const touching = (collider: Collider) => {
      let touch = false;
      scene.world.contactPairsWith(collider, (other) => {
        if (other.parent()?.handle !== scene.robot.chassis.handle) return;
        scene.world.contactPair(collider, other, (manifold) => {
          for (let i = 0; i < manifold.numContacts(); i++) if (manifold.contactImpulse(i) > 0 || manifold.contactDist(i) <= 0.0005) touch = true;
        });
      });
      return touch;
    };
    try {
      let ticks = 0;
      const script = (function* (): Script {
        for (const [lift, claw] of [[0, 0], [90, 80], [40, 0], [0, 80], [90, 0]] as const) {
          scene.set({ liftDeg: lift, clawDeg: claw });
          yield* wait(seconds(0.4));
        }
      })();
      run(scene, script, 5 * seconds(0.4), () => {
        if (scene.gripper.colliders.some(touching)) ticks += 1;
      });
      expect(ticks).toBe(0);
    } finally {
      scene.dispose();
    }
  });
});
