import { beforeAll, describe, expect, it, vi } from 'vitest';
import type * as RapierNamespace from '@dimforge/rapier3d-deterministic';
import { productionKits, referenceKitRef } from '../../hardware/catalog';
import type { Kit } from '../../hardware/kit';
import { parseArena, type ArenaInput } from '../arena/arena-schema';
import { buildArena, type BuiltArena } from '../arena/build-arena';
import boxesArena from '../arena/fixtures/boxes.json';
import { getRapier, initPhysics, createPhysicsWorld, refreshQueries, type PhysicsWorld, type RigidBody } from '../rapier';
import { arenaToWorld, degToRad, radToDeg, rotateVector, worldToArena, yawOfQuaternion, type Vec3 } from '../units';
import { assembleRobot, SETTLE_STEPS, stepWorld, type ActuatorTargets, type RobotBody, type RobotStart } from './assembly';
import type { MotorCommand } from './dc-motor';
import { localToWorld } from './robot-frame';

// N18 R3.3: the kit's robot as Rapier bodies, driven by model (c) of ADR 0001 §5.3, with the reference kit ref-uno-rover@0
// (PLACEHOLDER mechanics: 200 rpm motors on 6.6 cm wheels, a 15 cm track, an SG90-like servo arm).

// Compiling the real wasm can take seconds on a loaded machine.
beforeAll(() => initPhysics(), 30_000);

const kit = productionKits.get(referenceKitRef) as Kit;
const DT = 1 / 120;
const omega0 = (200 * 2 * Math.PI) / 60;
const WHEEL_R = 0.033;
/** ref-uno-rover@0's stall torque and gearbox friction (PLACEHOLDER), N·m. */
const T_S = 0.08;
const T_F = 0.025;
/**
 * The unloaded ground speed at a duty: where the torque line meets the gearbox friction, T_s·(u − ω/ω₀) = T_f, so
 * ω₀·(u − T_f/T_s)·r. At duty 128 that is 0.131 m/s, at 255 0.475 m/s (69 % of the no-load ω₀·r = 0.691 m/s).
 */
const cruise = (duty: number) => (duty / 255 - T_F / T_S) * omega0 * WHEEL_R;
const HALF_SPEED = cruise(128);
const FULL_SPEED = cruise(255);

const open: ArenaInput = { ground: { sizeCm: [300, 300], color: '#ffffff' } };
/** The R3.2 fixture with walls, boxes, a cylinder and pushable objects (parseArena validates it). */
const boxes = boxesArena as unknown as ArenaInput;
const run = (duty: number, dir: -1 | 0 | 1): MotorCommand => ({ duty, dir, brake: false });
const brake: MotorCommand = { duty: 255, dir: 0, brake: true };
const both = (command: MotorCommand): ActuatorTargets => ({ motors: { motorLeft: command, motorRight: command } });
const spinLeft = (duty: number): ActuatorTargets => ({ motors: { motorLeft: run(duty, -1), motorRight: run(duty, 1) } });

type Scene = { world: PhysicsWorld; robot: RobotBody; arena: BuiltArena };
/** The world modules a scene is built with: these, or fresh copies bound to another Rapier build. */
type Engine = {
  createPhysicsWorld: typeof createPhysicsWorld;
  buildArena: typeof buildArena;
  assembleRobot: typeof assembleRobot;
  stepWorld: typeof stepWorld;
};
const engine: Engine = { createPhysicsWorld, buildArena, assembleRobot, stepWorld };

function withRobot<T>(arena: ArenaInput, start: RobotStart, use: (scene: Scene) => T, robotKit: Kit = kit, using: Engine = engine): T {
  const world = using.createPhysicsWorld();
  try {
    const built = using.buildArena(world, parseArena(arena));
    return use({ world, robot: using.assembleRobot(world, robotKit, start), arena: built });
  } finally {
    world.free();
  }
}

function steps(world: PhysicsWorld, robot: RobotBody, ticks: number, targets?: ActuatorTargets): void {
  if (targets) robot.applyActuators(targets);
  for (let tick = 0; tick < ticks; tick++) stepWorld(world, robot);
}

const headingDeg = (robot: RobotBody) => radToDeg(yawOfQuaternion(robot.pose().rotation));
const speed = (v: Vec3) => Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
/** The smallest signed difference of two headings, degrees. */
const turn = (from: number, to: number) => ((((to - from) % 360) + 540) % 360) - 180;
/** The robot frame's origin on the arena (cm). */
const at = (robot: RobotBody) => worldToArena(robot.pose().position);
/** The speed the robot moves at over `ticks` more ticks, m/s, from how far it went. */
function travelSpeed(world: PhysicsWorld, robot: RobotBody, ticks: number): number {
  const from = at(robot);
  steps(world, robot, ticks);
  return Math.hypot(at(robot).xCm - from.xCm, at(robot).yCm - from.yCm) / 100 / (ticks * DT);
}

describe('assembleRobot', () => {
  it('builds the chassis and the servo arm, with the kit mass, and owns only its own colliders', () => {
    withRobot(open, { xCm: 100, yCm: 100, yawDeg: 0 }, ({ world, robot, arena }) => {
      expect(robot.bodies).toHaveLength(2);
      expect(robot.bodies[0]).toBe(robot.chassis);
      const total = robot.bodies.reduce((sum, body) => sum + body.mass(), 0);
      expect(total).toBeCloseTo(0.4, 6);
      expect(robot.bodies[1]!.mass()).toBeCloseTo(0.005, 6);
      let own = 0;
      world.forEachCollider((collider) => {
        if (robot.ownsCollider(collider)) own += 1;
        expect(robot.ownsCollider(collider)).toBe(arena.infoOf(collider) === undefined);
      });
      // Body box, two wheels (side cylinder + support ball each), the caster, the arm.
      expect(own).toBe(7);
    });
  });

  it('settle gives the rest height: on its supports, level and still at t = 0', () => {
    withRobot(open, { xCm: 100, yCm: 100, yawDeg: 30 }, ({ world, robot }) => {
      const rest = robot.pose().position;
      // The supports sink a tenth of a millimetre into the floor (Rapier's allowed penetration), no more.
      expect(rest.y).toBeLessThan(0);
      expect(rest.y).toBeGreaterThan(-0.0003);
      // Sinking unevenly into its three supports, the chassis tips by a hair and its origin moves 0.05 mm: not more than 0.1.
      expect(Math.hypot(at(robot).xCm - 100, at(robot).yCm - 100)).toBeLessThan(0.01);
      expect(headingDeg(robot)).toBeCloseTo(30, 2);
      const up = rotateVector(robot.pose().rotation, { x: 0, y: 1, z: 0 });
      expect(radToDeg(Math.acos(up.y))).toBeLessThan(0.1);
      expect(robot.isGrounded()).toBe(true);
      expect(speed(robot.linvel())).toBeLessThan(1e-5);
      expect(robot.wheelAngles()).toEqual([0, 0]);
      expect(robot.servoAngles().servo1).toBeCloseTo(90, 2);
      // It stays put: 2 s later it has not moved a micrometre.
      let fastest = 0;
      for (let tick = 0; tick < 240; tick++) {
        stepWorld(world, robot);
        fastest = Math.max(fastest, speed(robot.linvel()));
      }
      const later = robot.pose().position;
      expect(fastest).toBeLessThan(1e-5);
      expect(Math.abs(later.x - rest.x) + Math.abs(later.y - rest.y) + Math.abs(later.z - rest.z)).toBeLessThan(1e-6);
    });
  });

  it(`steps the world ${SETTLE_STEPS} times before t = 0, or as many as asked`, () => {
    const world = createPhysicsWorld();
    try {
      buildArena(world, parseArena(open));
      const crate = world.createRigidBody(getRapier().RigidBodyDesc.dynamic().setTranslation(0.5, 0.5, -0.5));
      world.createCollider(getRapier().ColliderDesc.ball(0.01), crate);
      assembleRobot(world, kit, { xCm: 100, yCm: 100, yawDeg: 0 }, { settleSteps: 3 });
      // A ball dropped from rest falls v = g·t: three steps.
      expect(crate.linvel().y).toBeCloseTo(-9.81 * 3 * DT, 4);
    } finally {
      world.free();
    }
  });

  it('refuses a kit without a chassis', () => {
    const { chassis: _chassis, ...bare } = kit;
    void _chassis;
    const world = createPhysicsWorld();
    try {
      expect(() => assembleRobot(world, bare as Kit, { xCm: 0, yCm: 0, yawDeg: 0 })).toThrow(/chassis: the world needs the chassis to build the robot/);
    } finally {
      world.free();
    }
  });
});

describe('the drive (model (c))', () => {
  it('50% both motors → straight 1 m within 2% heading drift', () => {
    withRobot(open, { xCm: 50, yCm: 50, yawDeg: 30 }, ({ world, robot }) => {
      const start = at(robot);
      const heading = degToRad(30);
      const forward = { x: Math.cos(heading), y: Math.sin(heading) };
      robot.applyActuators(both(run(128, 1)));
      let ticks = 0;
      const along = () => (at(robot).xCm - start.xCm) * forward.x + (at(robot).yCm - start.yCm) * forward.y;
      while (along() < 100 && ticks < 1500) {
        stepWorld(world, robot);
        ticks += 1;
      }
      const side = -(at(robot).xCm - start.xCm) * forward.y + (at(robot).yCm - start.yCm) * forward.x;
      expect(along()).toBeGreaterThanOrEqual(100);
      // 2 % of 1 m sideways, and a heading within atan(0.02) of where it started.
      expect(Math.abs(side)).toBeLessThan(2);
      expect(Math.abs(turn(30, headingDeg(robot)))).toBeLessThan(radToDeg(Math.atan(0.02)));
      // Unloaded, it cruises where the torque line at duty 128 meets the gearbox friction, 0.131 m/s (measured 2.8 % more:
      // the solver's friction falls a little short of T_f), so 1 m takes about 7.4 s.
      const cruising = travelSpeed(world, robot, 120) / HALF_SPEED;
      expect(cruising).toBeGreaterThan(1);
      expect(cruising).toBeLessThan(1.05);
      expect(speed(robot.linvel()) / HALF_SPEED).toBeCloseTo(cruising, 2);
      expect(ticks / 120).toBeGreaterThan(1 / (1.05 * HALF_SPEED));
      expect(ticks / 120).toBeLessThan(1 / HALF_SPEED + 0.5);
    });
  });

  it('spinLeft 90° repeatable within 1° over 10 runs', () => {
    withRobot(open, { xCm: 150, yCm: 150, yawDeg: 0 }, ({ world, robot }) => {
      // At duty 128 a wheel runs at 0.13 m/s against its gearbox (yaw rate 2·s/track ≈ 1.8 rad/s): 101 ticks turn about 90°.
      const turns: number[] = [];
      const centres: { xCm: number; yCm: number }[] = [];
      /** The axle's midpoint, 2 cm behind the body's centre: what a diff-drive turns about. */
      const axle = () => worldToArena(localToWorld(robot.pose().position, robot.pose().rotation, { x: -0.02, y: 0, z: 0 }));
      const pivot = axle();
      for (let run = 0; run < 10; run++) {
        const before = headingDeg(robot);
        steps(world, robot, 101, spinLeft(128));
        steps(world, robot, 30, both(brake));
        turns.push(turn(before, headingDeg(robot)));
        centres.push(axle());
      }
      const mean = turns.reduce((sum, value) => sum + value, 0) / turns.length;
      const spread = Math.max(...turns.map((value) => Math.abs(value - mean)));
      expect(spread).toBeLessThan(1);
      expect(mean).toBeGreaterThan(85);
      expect(mean).toBeLessThan(95);
      // It turns about a point within 3 mm of the axle's midpoint, so after a full turn (4 spins) that is back where it was.
      for (const centre of centres) {
        expect(Math.hypot(centre.xCm - pivot.xCm, centre.yCm - pivot.yCm)).toBeLessThan(0.6);
      }
      // (Four spins are not exactly 360°: the pivot's few millimetres of offset leave a fraction of a millimetre.)
      for (const fullTurn of [centres[3]!, centres[7]!]) {
        expect(Math.hypot(fullTurn.xCm - pivot.xCm, fullTurn.yCm - pivot.yCm)).toBeLessThan(0.05);
      }
    });
  });

  it('pushes 100 g box', () => {
    const arena: ArenaInput = {
      ...open,
      objects: [{ id: 'crate', shape: 'box', centerCm: [100, 150], sizeCm: [10, 10, 10], massG: 100 }],
    };
    withRobot(arena, { xCm: 50, yCm: 150, yawDeg: 0 }, ({ world, robot, arena: built }) => {
      const crate = built.dynamicBodies[0]!.body;
      const from = worldToArena(crate.translation());
      // Fold the arm along the body (0°: pointing right, inside the footprint) so the body's front does the pushing.
      steps(world, robot, 30, { servos: { servo1: 0 } });
      steps(world, robot, 360, both(run(255, 1)));
      const to = worldToArena(crate.translation());
      // 3 s at up to 0.475 m/s, 37 cm of it to reach the box.
      expect(to.xCm - from.xCm).toBeGreaterThan(70);
      expect(Math.abs(to.yCm - from.yCm)).toBeLessThan(1);
      // The box stays in front of the body (front face at +7.5 cm), touching it.
      expect(to.xCm - 5 - (at(robot).xCm + 7.5)).toBeLessThan(0.5);
      // Its friction (0.4 · 0.98 N) slows the motors further down their torque line: ω drops by F·r/(2·T_s)·ω₀, 12 % here.
      const crateFrom = worldToArena(crate.translation()).xCm;
      const pushing = travelSpeed(world, robot, 30) / FULL_SPEED;
      expect(pushing).toBeGreaterThan(0.85);
      expect(pushing).toBeLessThan(0.97);
      expect((worldToArena(crate.translation()).xCm - crateFrom) / 100 / (30 * DT) / FULL_SPEED).toBeCloseTo(pushing, 2);
    });
  });

  it('a lifted robot does not drive: on a stand, the wheels spin free and the chassis stays put', () => {
    const arena: ArenaInput = { ...open, boxes: [{ id: 'stand', centerCm: [150, 150], sizeCm: [6, 6, 2.5] }] };
    withRobot(arena, { xCm: 50, yCm: 50, yawDeg: 0 }, ({ world, robot }) => {
      // Lift it by hand onto the stand: the body's underside (1.5 cm up) on the stand's top (2.5 cm), wheels 1 cm in the air.
      liftTo(world, robot, arenaToWorld(150, 150, 1.05));
      steps(world, robot, 30);
      expect(robot.isGrounded()).toBe(false);
      const parked = at(robot);
      steps(world, robot, 240, both(run(255, 1)));
      expect(robot.isGrounded()).toBe(false);
      expect(Math.hypot(at(robot).xCm - parked.xCm, at(robot).yCm - parked.yCm)).toBeLessThan(0.01);
      // Off the floor each wheel spins at its motor's reference: almost ω₀ after 2 s.
      const [leftAngle, rightAngle] = robot.wheelAngles();
      expect(leftAngle).toBeGreaterThan(0.95 * omega0 * 2);
      expect(rightAngle).toBe(leftAngle);
      // Back on the floor, it drives.
      liftTo(world, robot, arenaToWorld(50, 50, 0));
      steps(world, robot, 60);
      expect(robot.isGrounded()).toBe(true);
      expect(at(robot).xCm - 50).toBeGreaterThan(10);
    });
  });

  it('brakes harder than it coasts, and a stopped robot stays stopped', () => {
    const stopDistance = (stop: MotorCommand) =>
      withRobot(open, { xCm: 50, yCm: 150, yawDeg: 0 }, ({ world, robot }) => {
        steps(world, robot, 120, both(run(255, 1)));
        const from = at(robot).xCm;
        steps(world, robot, 120, both(stop));
        expect(speed(robot.linvel())).toBeLessThan(1e-4);
        return at(robot).xCm - from;
      });
    const coast = stopDistance(run(0, 0));
    const braked = stopDistance(brake);
    expect(braked).toBeLessThan(coast);
    expect(braked).toBeGreaterThan(0);
    expect(coast).toBeLessThan(10);
  });

  it('follows the torque line: no-load speed ω₀·r without gearbox friction, stall torque T_s from rest, friction subtracted', () => {
    // Motors with no lag on a robot without its servo arm, so a tick's change of speed is the drive's push alone.
    const variant = (motor: { stallTorqueNm: number; gearFrictionNm: number }): Kit => ({
      ...kit,
      modules: kit.modules
        .filter((module) => module.kind !== 'servo')
        .map((module) => (module.kind === 'dc-motor' ? { ...module, spec: { ...module.spec, ...motor, tauS: 0 } } : module)),
    });
    const start = { xCm: 50, yCm: 150, yawDeg: 0 };
    // Without friction the wheels run up to the line's no-load speed ω₀·r.
    withRobot(open, start, ({ world, robot }) => {
      steps(world, robot, 180, both(run(255, 1)));
      expect(speed(robot.linvel()) / (omega0 * WHEEL_R)).toBeCloseTo(1, 3);
    }, variant({ stallTorqueNm: 0.08, gearFrictionNm: 0 }));
    // A weak motor (T_s = 0.03 N·m, under the tyres' grip): from rest the first tick's push is the stall torque,
    // 2 · T_s · u · dt / r, and half the duty gives half.
    withRobot(open, start, ({ world, robot }) => {
      steps(world, robot, 1, both(run(255, 1)));
      expect(robot.chassis.linvel().x).toBeCloseTo((2 * 0.03 * DT) / WHEEL_R / 0.4, 5);
      steps(world, robot, 120, both(brake));
      const before = robot.chassis.linvel().x;
      steps(world, robot, 1, both(run(127.5, 1)));
      expect(robot.chassis.linvel().x - before).toBeCloseTo((0.03 * DT) / WHEEL_R / 0.4, 5);
    }, variant({ stallTorqueNm: 0.03, gearFrictionNm: 0 }));
    // With gearbox friction T_f = 0.01 N·m the first tick keeps about T_s − T_f of it, and a duty well under T_f/T_s · 255
    // (85) does not start the robot at all. The solver's friction reaches 90–98 % of μ·N within a step, so a duty just
    // under the threshold (80) creeps: 0.6 cm in 1 s.
    withRobot(open, start, ({ world, robot }) => {
      steps(world, robot, 1, both(run(255, 1)));
      const kept = robot.chassis.linvel().x / ((2 * (0.03 - 0.01) * DT) / WHEEL_R / 0.4);
      expect(kept).toBeGreaterThan(1);
      expect(kept).toBeLessThan(1.08);
      steps(world, robot, 120, both(brake));
      const from = at(robot).xCm;
      steps(world, robot, 120, both(run(70, 1)));
      expect(Math.abs(at(robot).xCm - from)).toBeLessThan(0.01);
      steps(world, robot, 120, both(run(100, 1)));
      expect(at(robot).xCm - from).toBeGreaterThan(1);
    }, variant({ stallTorqueNm: 0.03, gearFrictionNm: 0.01 }));
  });

  it('a braked robot holds against a 1 N push', () => {
    withRobot(open, { xCm: 150, yCm: 150, yawDeg: 30 }, ({ world, robot }) => {
      steps(world, robot, 30, both(brake));
      const from = at(robot);
      // 1 N along its heading, at the centre of mass, inside every physics step (as a contact would push).
      robot.chassis.addForce({ x: Math.cos(degToRad(30)), y: 0, z: -Math.sin(degToRad(30)) }, true);
      steps(world, robot, 240);
      expect(Math.hypot(at(robot).xCm - from.xCm, at(robot).yCm - from.yCm)).toBeLessThan(0.1);
      // Coasting holds it the same way: at rest only the gearbox's friction acts.
      steps(world, robot, 240, both(run(0, 0)));
      expect(Math.hypot(at(robot).xCm - from.xCm, at(robot).yCm - from.yCm)).toBeLessThan(0.1);
    });
  });

  it('a coasting robot can be pushed above the friction limit', () => {
    withRobot(open, { xCm: 50, yCm: 150, yawDeg: 0 }, ({ world, robot }) => {
      steps(world, robot, 30, both(run(0, 0)));
      const from = at(robot).xCm;
      // Above the two wheels' 2·T_f/r = 1.52 N, a 3 N push moves it, the friction and the shorted line holding it back.
      robot.chassis.addForce({ x: 3, y: 0, z: 0 }, true);
      steps(world, robot, 120);
      expect(at(robot).xCm - from).toBeGreaterThan(5);
      expect(speed(robot.linvel())).toBeLessThan((3 / 0.4) * 1);
    });
  });

  it('runs under the no-load speed: the gearbox friction is a rolling resistance', () => {
    withRobot(open, { xCm: 50, yCm: 100, yawDeg: 0 }, ({ world, robot }) => {
      steps(world, robot, 120, both(run(255, 1)));
      // Where the torque line meets the friction, T_s·(1 − ω/ω₀) = T_f: ω = ω₀·(1 − T_f/T_s), 0.475 m/s on the floor.
      const top = travelSpeed(world, robot, 120);
      expect(top / FULL_SPEED).toBeGreaterThan(1);
      expect(top / FULL_SPEED).toBeLessThan(1.05);
      // With these PLACEHOLDER constants that is 70 % of the no-load speed ω₀·r = 0.691 m/s.
      expect(top / (omega0 * WHEEL_R)).toBeLessThan(0.72);
      // The drive pushes with a force over the step, so the velocity read after a step is the speed it moves at.
      expect(speed(robot.linvel()) / top).toBeCloseTo(1, 3);
    });
  });

  it('turns the wheels as far as the robot rolls: 1 m is 1/r rad, a spin turns them opposite ways', () => {
    withRobot(open, { xCm: 50, yCm: 100, yawDeg: 0 }, ({ world, robot }) => {
      const from = at(robot).xCm;
      steps(world, robot, 300, both(run(255, 1)));
      steps(world, robot, 60, both(brake));
      const rolledM = (at(robot).xCm - from) / 100;
      const [leftAngle, rightAngle] = robot.wheelAngles();
      expect(leftAngle / (rolledM / WHEEL_R)).toBeCloseTo(1, 3);
      expect(rightAngle / (rolledM / WHEEL_R)).toBeCloseTo(1, 3);
      // A quarter turn in place: the wheels turn opposite ways, their difference the turn times the track over the radius
      // (each wheel's contact rolls ± turn · track/2; the pivot, 2–3 mm off the axle's midpoint, adds the same to both).
      const heading = headingDeg(robot);
      const [l0, r0] = robot.wheelAngles();
      steps(world, robot, 101, spinLeft(128));
      steps(world, robot, 30, both(brake));
      const turnedRad = degToRad(turn(heading, headingDeg(robot)));
      const [l1, r1] = robot.wheelAngles();
      expect(r1 - r0).toBeGreaterThan(0);
      expect(l1 - l0).toBeLessThan(0);
      expect((r1 - r0 - (l1 - l0)) / ((turnedRad * 0.15) / WHEEL_R)).toBeCloseTo(1, 4);
      expect(Math.abs(r1 - r0 + (l1 - l0)) / (r1 - r0)).toBeLessThan(0.05);
    });
  });

  it('refuses targets for roles the kit does not drive', () => {
    withRobot(open, { xCm: 50, yCm: 50, yawDeg: 0 }, ({ robot }) => {
      expect(() => robot.applyActuators({ motors: { servo1: run(10, 1) } })).toThrow(/no drive motor servo1/);
      expect(() => robot.applyActuators({ servos: { motorLeft: 10 } })).toThrow(/no servo motorLeft/);
      expect(() => robot.applyActuators({ motors: { motorLeft: run(300, 1) } })).toThrow(/duty is 0\.\.255, not 300/);
      expect(() => robot.applyActuators({ servos: { servo1: Number.NaN } })).toThrow(/not NaN/);
      // A role named with undefined is a mistake, not a "leave out".
      expect(() => robot.applyActuators({ motors: { motorLeft: undefined } })).toThrow(/target of motor motorLeft is undefined/);
      expect(() => robot.applyActuators({ servos: { servo1: undefined } })).toThrow(/target of servo servo1 is undefined/);
    });
  });

  it('a motor left out of the targets stops (targets are not sticky), a servo left out holds its angle', () => {
    withRobot(open, { xCm: 150, yCm: 150, yawDeg: 0 }, ({ world, robot }) => {
      steps(world, robot, 60, { ...both(run(255, 1)), servos: { servo1: 30 } });
      expect(speed(robot.linvel())).toBeGreaterThan(0.3);
      // Only the left motor named: the right one stops, so the robot turns right.
      const heading = headingDeg(robot);
      steps(world, robot, 60, { motors: { motorLeft: run(255, 1) } });
      expect(turn(heading, headingDeg(robot))).toBeLessThan(-20);
      // No motor named: both stop. The servo, never named again, still holds 30°.
      steps(world, robot, 60, { servos: {} });
      expect(speed(robot.linvel())).toBeLessThan(1e-3);
      expect(robot.servoAngles().servo1).toBeCloseTo(30, 0);
      // A refused target changes nothing: the motors named before it are not applied either.
      expect(() => robot.applyActuators({ motors: { motorLeft: run(255, 1), motorRight: run(999, 1) } })).toThrow(/not 999/);
      steps(world, robot, 30);
      expect(speed(robot.linvel())).toBeLessThan(1e-3);
    });
  });
});

describe('the servo arm', () => {
  it('servo reaches 90° in ~0.15 s from 0°', () => {
    withRobot(open, { xCm: 100, yCm: 100, yawDeg: 0 }, ({ world, robot }) => {
      steps(world, robot, 60, { servos: { servo1: 0 } });
      expect(robot.servoAngles().servo1).toBeCloseTo(0, 1);
      robot.applyActuators({ servos: { servo1: 90 } });
      const trace: number[] = [];
      for (let tick = 0; tick < 60; tick++) {
        stepWorld(world, robot);
        trace.push(robot.servoAngles().servo1!);
      }
      // 90° at 60° per 0.1 s is 0.15 s, 18 ticks; the joint's first tick lags it by about 2°.
      const reached = trace.findIndex((deg) => Math.abs(deg - 90) <= 0.5) + 1;
      expect(reached).toBeGreaterThanOrEqual(18);
      expect(reached).toBeLessThanOrEqual(20);
      expect(Math.abs(trace[17]! - 90)).toBeLessThan(3);
      // Never faster than the servo: at most 5° per tick, and no swing past the target.
      trace.forEach((deg, tick) => expect(deg - (tick === 0 ? 0 : trace[tick - 1]!)).toBeLessThan(5.01));
      expect(Math.max(...trace)).toBeLessThan(90.5);
      expect(trace[59]).toBeCloseTo(90, 1);
    });
  });

  it('clamps its target to the servo range, and holds its angle while the robot spins', () => {
    withRobot(open, { xCm: 150, yCm: 150, yawDeg: 0 }, ({ world, robot }) => {
      steps(world, robot, 60, { servos: { servo1: 250 } });
      expect(robot.servoAngles().servo1).toBeCloseTo(180, 0);
      steps(world, robot, 40, { servos: { servo1: 120 } });
      let worst = 0;
      robot.applyActuators(spinLeft(255));
      for (let tick = 0; tick < 120; tick++) {
        stepWorld(world, robot);
        worst = Math.max(worst, Math.abs(robot.servoAngles().servo1! - 120));
      }
      expect(worst).toBeLessThan(1);
    });
  });

  it('collides: sweeping from 90° to 0° it pushes a 100 g box out of its way', () => {
    // The arm (6 cm, 6.25–7.75 cm above the floor) points forward at 90° from its axis 4.5 cm ahead of the centre, and
    // swings to the right as it goes to 0°. A 4 × 4 × 10 cm box stands in that sweep, against the front of the body.
    const arena: ArenaInput = {
      ...open,
      objects: [{ id: 'crate', shape: 'box', centerCm: [109.6, 96], sizeCm: [4, 4, 10], massG: 100 }],
    };
    withRobot(arena, { xCm: 100, yCm: 100, yawDeg: 0 }, ({ world, robot, arena: built }) => {
      const crate = built.dynamicBodies[0]!.body;
      const from = worldToArena(crate.translation());
      expect(robot.servoAngles().servo1).toBeCloseTo(90, 1);
      steps(world, robot, 60, { servos: { servo1: 0 } });
      const to = worldToArena(crate.translation());
      // Pushed to the right, out of the arc (hit 3 cm below its top, it tips over), and the arm got through to 0°.
      expect(to.yCm - from.yCm).toBeLessThan(-5);
      expect(Math.abs(to.xCm - from.xCm)).toBeLessThan(1);
      expect(robot.servoAngles().servo1).toBeCloseTo(0, 0);
    });
  });

  it('blocks: held at 90°, the arm stops a box pushed against it, and the robot feels it', () => {
    // A box slides at 1 m/s from ahead onto the arm's tip (10.5 cm ahead of the centre, 1.5 cm high blade at 7 cm).
    const arena: ArenaInput = {
      ...open,
      objects: [{ id: 'crate', shape: 'box', centerCm: [125, 100], sizeCm: [4, 4, 10], massG: 100 }],
    };
    withRobot(arena, { xCm: 100, yCm: 100, yawDeg: 0 }, ({ world, robot, arena: built }) => {
      const crate = built.dynamicBodies[0]!.body;
      crate.setLinvel({ x: -1, y: 0, z: 0 }, true);
      steps(world, robot, 60);
      // It stopped at the tip: its near face at 10.5 cm, not at the body's front (7.5 cm).
      expect(worldToArena(crate.translation()).xCm - 2).toBeGreaterThan(110);
      expect(robot.servoAngles().servo1).toBeCloseTo(90, 0);
      expect(at(robot).xCm).toBeLessThan(100);
    });
  });
});

describe('placeAt (reposition → propagate → refresh)', () => {
  it('moves the robot so rays and contacts see it at once, before any step', () => {
    withRobot(open, { xCm: 50, yCm: 50, yawDeg: 0 }, ({ world, robot }) => {
      const R = getRapier();
      const down = (xCm: number, yCm: number) => new R.Ray({ ...arenaToWorld(xCm, yCm, 30) }, { x: 0, y: -1, z: 0 });
      const hitsRobot = (xCm: number, yCm: number) => {
        const hit = world.castRay(down(xCm, yCm), 1, true);
        return hit !== null && robot.ownsCollider(hit.collider);
      };
      expect(hitsRobot(50, 50)).toBe(true);
      steps(world, robot, 60, both(run(200, 1)));
      robot.placeAt({ xCm: 200, yCm: 120, yawDeg: 90 });
      expect(hitsRobot(200, 120)).toBe(true);
      expect(hitsRobot(50, 50)).toBe(false);
      expect(robot.isGrounded()).toBe(true);
      // Rapier keeps float32: 1.2 m is 120.000005 cm.
      expect(at(robot).xCm).toBeCloseTo(200, 4);
      expect(at(robot).yCm).toBeCloseTo(120, 4);
      expect(headingDeg(robot)).toBeCloseTo(90, 4);
      expect(speed(robot.linvel())).toBe(0);
      // At rest: the motors coast from rest, nothing moves.
      steps(world, robot, 60);
      expect(speed(robot.linvel())).toBeLessThan(1e-5);
      expect(robot.servoAngles().servo1).toBeCloseTo(90, 1);
      // And it drives from there, along its new heading (+y on the arena).
      steps(world, robot, 120, both(run(255, 1)));
      expect(at(robot).yCm - 120).toBeGreaterThan(25);
      expect(Math.abs(at(robot).xCm - 200)).toBeLessThan(0.5);
    });
  });
});

describe('determinism', () => {
  /** A 3000-tick script: drive, spin, sweep the arm, reverse, brake, push an object of the arena (boxes.json). */
  function script(tick: number): ActuatorTargets {
    const s = tick / 120;
    if (s < 1.5) return both(run(128, 1));
    if (s < 2) return spinLeft(128);
    if (s < 2.5) return { ...both(brake), servos: { servo1: 0 } };
    if (s < 4.5) return { ...both(run(255, 1)), servos: { servo1: 180 } };
    if (s < 5) return { motors: { motorLeft: run(200, 1), motorRight: run(200, -1) } };
    if (s < 8) return { ...both(run(180, 1)), servos: { servo1: Math.floor(s * 2) % 2 === 0 ? 0 : 180 } };
    if (s < 9) return both(run(150, -1));
    if (s < 12) return { motors: { motorLeft: run(255, 1), motorRight: run(90, 1) } };
    if (s < 13) return both(run(0, 0));
    if (s < 18) return { motors: { motorLeft: run(100, 1), motorRight: run(255, 1) }, servos: { servo1: 45 } };
    if (s < 19) return both(brake);
    return { ...both(run(255, 1)), servos: { servo1: 135 } };
  }

  const f32 = new Float32Array(1);
  const u32 = new Uint32Array(f32.buffer);
  const f64 = new Float64Array(1);
  const u32x2 = new Uint32Array(f64.buffer);
  const mixWord = (hash: number, word: number) => {
    let h = hash;
    for (let i = 0; i < 4; i++) {
      h ^= (word >>> (i * 8)) & 0xff;
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h;
  };
  /** FNV-1a over the raw bits: float32 of every pose (Rapier's own precision), float64 of the wheel and servo angles. */
  function hashTick(hash: number, bodies: readonly RigidBody[], robot: RobotBody): number {
    let h = hash;
    for (const body of bodies) {
      const t = body.translation();
      const q = body.rotation();
      for (const value of [t.x, t.y, t.z, q.x, q.y, q.z, q.w]) {
        f32[0] = value;
        h = mixWord(h, u32[0]!);
      }
    }
    for (const value of [...robot.wheelAngles(), robot.servoAngles().servo1!]) {
      f64[0] = value;
      h = mixWord(mixWord(h, u32x2[0]!), u32x2[1]!);
    }
    return h;
  }

  function scriptedHash(using: Engine = engine): string {
    return withRobot(
      boxes,
      { xCm: 30, yCm: 100, yawDeg: 0 },
      ({ world, robot, arena }) => {
        const bodies = [...robot.bodies, ...arena.dynamicBodies.map((dynamic) => dynamic.body)];
        let hash = 0x811c9dc5;
        for (let tick = 0; tick < 3000; tick++) {
          robot.applyActuators(script(tick));
          using.stepWorld(world, robot);
          hash = hashTick(hash, bodies, robot);
        }
        return hash.toString(16).padStart(8, '0');
      },
      kit,
      using,
    );
  }

  it('same inputs → bit-identical poses: a 3000-tick scripted run hashes the same twice, and the golden hash', () => {
    const first = scriptedHash();
    expect(scriptedHash()).toBe(first);
    // Golden (moves to R3.5's snapshot file). A change here is a change of the engine: bump it on purpose. In this run the
    // robot drives 68 cm net, turns, sweeps its arm and pushes the crate 54 cm. (R3.3 fix round 1 re-pinned it: gearbox
    // friction, the Tustin lag, the drive as a force over the step, T_s 0.08 N·m; it had not shipped.)
    expect(first).toBe('9e89807b');
  });

  it(
    'the -compat build (plain Node scripts) gives the same golden hash',
    async () => {
      vi.resetModules();
      const physics = await import('../rapier');
      const arena = await import('../arena/build-arena');
      const assembly = await import('./assembly');
      await physics.initPhysics(async () => (await import('@dimforge/rapier3d-deterministic-compat')) as unknown as typeof RapierNamespace);
      const compat: Engine = {
        createPhysicsWorld: physics.createPhysicsWorld,
        buildArena: arena.buildArena,
        assembleRobot: assembly.assembleRobot,
        stepWorld: assembly.stepWorld,
      };
      expect(scriptedHash(compat)).toBe('9e89807b');
    },
    30_000,
  );

  it('costs well under the 0.5 ms/tick budget for robot + arena', () => {
    withRobot(boxes, { xCm: 30, yCm: 100, yawDeg: 0 }, ({ world, robot }) => {
      const times: number[] = [];
      for (let tick = 0; tick < 3000; tick++) {
        robot.applyActuators(script(tick));
        const begin = performance.now();
        stepWorld(world, robot);
        times.push(performance.now() - begin);
      }
      times.sort((a, b) => a - b);
      const median = times[1500]!;
      const p95 = times[2850]!;
      console.info(`robot + boxes arena: ${median.toFixed(4)} ms/tick median, ${p95.toFixed(4)} ms p95 over 3000 ticks`);
      expect(median).toBeLessThan(0.5);
    });
  });
});

/** Lifts the robot by hand: every body of it moved by the same offset, at rest, then propagated and refreshed. */
function liftTo(world: PhysicsWorld, robot: RobotBody, target: Vec3): void {
  const from = robot.chassis.translation();
  for (const body of robot.bodies) {
    const t = body.translation();
    body.setTranslation({ x: t.x + target.x - from.x, y: t.y + target.y - from.y, z: t.z + target.z - from.z }, true);
    body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }
  world.propagateModifiedBodyPositionsToColliders();
  refreshQueries(world);
}
