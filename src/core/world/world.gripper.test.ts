import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { productionKits, referenceKitRef } from '../hardware/catalog';
import type { Kit } from '../hardware/kit';
import { gripperKit } from './__fixtures__/gripper-scene';
import { parseArena } from './arena/arena-schema';
import type { Collider, PhysicsWorld } from './rapier';
import { initPhysics, PHYSICS_DT_S } from './rapier';
import type { ActuatorTargets } from './robot/assembly';
import type { MotorCommand } from './robot/dc-motor';
import type { GripperTargets } from './robot/gripper';
import { snapshotText, type RobotSnapshot } from './snapshot';
import { createWorld, type World } from './world';

// N19 B1/B2 in the world facade (world.ts): the gripper car's snapshot, the grasp machine run after each step and before the sensors are
// measured, a held object's contacts counted as the robot's (plan §5 Review Focus 1), and no joint left behind by a stop (Review Focus 2).
// The world is driven through `applyActuators`, as the run session drives it, from scripts that set the targets each tick.
//
// The physics world is read through the factory the world is built from, wrapped to remember what it made (as tests/robot-world-counts
// does): `World` does not expose it.

const made = vi.hoisted(() => [] as unknown[]);

vi.mock('./rapier', async (importOriginal) => {
  const original = await importOriginal<typeof import('./rapier')>();
  return {
    ...original,
    createPhysicsWorld: () => {
      const world = original.createPhysicsWorld();
      made.push(world);
      return world;
    },
  };
});

beforeAll(() => initPhysics(), 30_000);
beforeEach(() => {
  made.length = 0;
});

const rover = productionKits.get(referenceKitRef) as Kit;
const DEG = Math.PI / 180;
const START = { xCm: 40, yCm: 50, yawDeg: 0 } as const;
/** The carriage origin ahead of the robot frame's origin at a lift angle, cm (mount x 4.5, boom 5 cm, elevation lift − 40°). */
const tipX = (liftDeg: number) => 4.5 + 5 * Math.cos((liftDeg - 40) * DEG);
const seconds = (s: number) => Math.round(s / PHYSICS_DT_S);
const COAST: MotorCommand = { duty: 0, dir: 0, brake: false };
const BRAKE: MotorCommand = { duty: 0, dir: 0, brake: true };
const forward = (duty: number): MotorCommand => ({ duty, dir: 1, brake: false });
const cube = (id: string, xCm: number, massG: number) => ({ shape: 'box' as const, id, centerCm: [xCm, START.yCm] as [number, number], sizeCm: [4, 4, 4] as [number, number, number], massG });

/** A world driven by a script that sets the motors and the gripper each tick (motors left out of a target stop, so both are kept here). */
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
    step() {
      const targets: ActuatorTargets = { motors: { motorLeft: motor, motorRight: motor }, gripper };
      world.applyActuators(targets);
      world.step(PHYSICS_DT_S);
    },
  };
}

const robotPart = (snapshot: RobotSnapshot) => snapshot.robot as RobotSnapshot['robot'] & { gripper?: unknown };
/** The cube's centre ahead of the carriage origin at lift 0°, cm (the robot heads along +x). */
const uOf = (snapshot: RobotSnapshot, id: string, liftDeg = 0) => snapshot.objects.find((object) => object.id === id)!.pose.xCm - snapshot.robot.xCm - tipX(liftDeg);
/** The chassis' nose-up pitch, degrees, from the snapshot's rotation (arena frame, z up). */
const pitchDeg = (snapshot: RobotSnapshot) => {
  const { x, y, z, w } = snapshot.robot.rotation;
  // The forward axis' z: 2(xz − wy).
  return Math.asin(Math.max(-1, Math.min(1, 2 * (x * z - w * y)))) / DEG;
};

/** The pick at lift 0°: lower and open, drive in until the cube's centre is at carriage u ≤ `u` + 0.25, brake, close 80°, until held. */
function* pick(world: World, control: ReturnType<typeof driver>, id: string, u: number) {
  control.set({ liftDeg: 0, clawDeg: 0 });
  for (let i = 0; i < seconds(0.35); i++) yield;
  control.drive(forward(140));
  for (let i = 0; i < seconds(4) && uOf(world.snapshot(), id) > u + 0.25; i++) yield;
  control.drive(BRAKE);
  for (let i = 0; i < seconds(0.3); i++) yield;
  control.set({ clawDeg: 80 });
  for (let i = 0; i < seconds(0.6) && world.snapshot().robot.gripper?.heldId !== id; i++) yield;
  for (let i = 0; i < seconds(0.2); i++) yield;
}

function physicsOf(): PhysicsWorld {
  expect(made).toHaveLength(1);
  return made[0] as PhysicsWorld;
}

describe('the gripper car in the world (N19 B1/B2)', () => {
  it('snapshots the gripper as robot.gripper {clawDeg, liftDeg, heldId}; a rover snapshot has no such field, its text unchanged', async () => {
    const world = await createWorld({ arena: parseArena({ ground: { sizeCm: [200, 100], color: '#ffffff' }, objects: [cube('cube', 70, 15)] }), start: START, kit: gripperKit, seed: 1 });
    try {
      const physics = physicsOf();
      // The arena's fixed body, the cube, the chassis and the gripper's four; the ground, the cube, the chassis' six and the gripper's six;
      // the gripper's five joints.
      expect([physics.bodies.len(), physics.colliders.len(), physics.impulseJoints.len()]).toEqual([7, 14, 5]);
      const gripper = world.snapshot().robot.gripper!;
      expect(Object.keys(gripper).sort()).toEqual(['clawDeg', 'heldId', 'liftDeg']);
      expect(gripper.clawDeg).toBeCloseTo(0, 1);
      expect(gripper.liftDeg).toBeCloseTo(90, 1);
      expect(gripper.heldId).toBeNull();
      expect(world.snapshot().robot.servoDeg).toEqual({});
      const control = driver(world);
      control.set({ liftDeg: 30, clawDeg: 50 });
      for (let i = 0; i < seconds(0.5); i++) control.step();
      expect(world.snapshot().robot.gripper!.liftDeg).toBeCloseTo(30, 1);
      expect(world.snapshot().robot.gripper!.clawDeg).toBeCloseTo(50, 1);
      expect(snapshotText(world.snapshot())).toContain('"gripper":{"clawDeg":');
    } finally {
      world.dispose();
    }
    made.length = 0;
    const roverWorld = await createWorld({ arena: parseArena({ ground: { sizeCm: [200, 100], color: '#ffffff' } }), start: START, kit: rover, seed: 1 });
    try {
      expect('gripper' in robotPart(roverWorld.snapshot())).toBe(false);
      expect(snapshotText(roverWorld.snapshot())).not.toContain('gripper');
      expect(() => roverWorld.applyActuators({ gripper: { clawDeg: 10 } })).toThrow(new RangeError('The kit has no gripper.'));
    } finally {
      roverWorld.dispose();
    }
  });

  it('holds a cube it picks (the grasp runs every step): one joint more while held, the cube carried up with the jaws', async () => {
    const arena = parseArena({ ground: { sizeCm: [200, 100], color: '#ffffff' }, objects: [cube('cube', START.xCm + tipX(0) + 3 + 8, 15)] });
    const world = await createWorld({ arena, start: START, kit: gripperKit, seed: 1 });
    try {
      const physics = physicsOf();
      const control = driver(world);
      const script = (function* () {
        yield* pick(world, control, 'cube', 3);
        control.set({ liftDeg: 90 });
        for (let i = 0; i < seconds(0.5); i++) yield;
      })();
      for (let tick = 0; tick < seconds(0.35 + 4 + 0.5); tick++) {
        script.next();
        control.step();
      }
      const snapshot = world.snapshot();
      expect(snapshot.robot.gripper!.heldId).toBe('cube');
      expect(physics.impulseJoints.len()).toBe(6);
      // Carried up: its bottom 7 cm above the floor at lift 90° (ADR 0004 §4.2).
      const zCm = snapshot.objects.find((object) => object.id === 'cube')!.pose.zCm;
      expect(zCm - 2).toBeGreaterThan(6.5);
      // A held cube is the robot's: the fingers touching it are not a contact.
      expect(world.sense.contacts().map((contact) => contact.otherId)).toEqual(['#ground']);
    } finally {
      world.dispose();
    }
  });

  it('held cube hitting a wall at 0.4 m/s breaks the grasp and counts as robot contact', async () => {
    // The spike's scenario 5b (ADR 0004 §4.2): grasped at u 4 the cube sticks 0.5 cm past the fingertips; lift 45°; duty 226 after a 60 cm
    // run-up; the motors coast once the robot touches the wall (what a scenario's endOnContact does).
    const graspU = 4;
    const cubeX = START.xCm + tipX(0) + graspU + 8;
    const wallX = cubeX + 60 + 1;
    const arena = parseArena({ ground: { sizeCm: [250, 100], color: '#ffffff' }, walls: [{ id: 'wall', fromCm: [wallX, 10], toCm: [wallX, 90] }], objects: [cube('cube', cubeX, 15)] });
    const world = await createWorld({ arena, start: START, kit: gripperKit, seed: 1 });
    try {
      const physics = physicsOf();
      const control = driver(world);
      const log: { heldWhenTouched?: string | null; speedMS?: number; ownTouching?: boolean; clawCommandAfter?: number; heldAfter?: string | null } = {};
      let previousX = 0;
      let speed = 0;
      let mostPitch = 0;
      let finite = true;
      // What is within 1 mm of the wall, by collider: the cube's, or one of the robot's own (every dynamic body but the cube is the robot).
      const touchingWall = () => {
        let wall: Collider | null = null;
        let cubeCollider: Collider | null = null;
        const cubeX = world.snapshot().objects[0]!.pose.xCm / 100;
        physics.forEachCollider((collider) => {
          const body = collider.parent();
          if (body === null) return;
          if (body.isFixed() && Math.abs(collider.translation().x - (wallX / 100)) < 0.01) wall = collider;
          if (body.isDynamic() && Math.abs(body.translation().x - cubeX) < 1e-6) cubeCollider = collider;
        });
        let own = false;
        physics.forEachCollider((collider) => {
          const body = collider.parent();
          if (body === null || !body.isDynamic() || collider === cubeCollider) return;
          const contact = collider.contactCollider(wall!, 0.001);
          if (contact !== null && contact.distance <= 0.001) own = true;
        });
        return own;
      };
      const script = (function* () {
        yield* pick(world, control, 'cube', graspU);
        control.set({ liftDeg: 45 });
        for (let i = 0; i < seconds(0.5); i++) yield;
        control.drive(forward(226));
        previousX = world.snapshot().robot.xCm;
        for (let i = 0; i < seconds(4); i++) {
          const contacts = world.sense.contacts().map((contact) => contact.otherId);
          if (contacts.includes('wall')) break;
          speed = (world.snapshot().robot.xCm - previousX) / 100 / PHYSICS_DT_S;
          previousX = world.snapshot().robot.xCm;
          yield;
        }
        log.speedMS = speed;
        log.ownTouching = touchingWall();
        control.drive(COAST);
        for (let i = 0; i < seconds(1.5); i++) yield;
        log.heldAfter = world.snapshot().robot.gripper!.heldId;
      })();
      let touchedTick = -1;
      for (let tick = 0; tick < seconds(0.35 + 4 + 0.5 + 4 + 1.5); tick++) {
        if (script.next().done === true) break;
        const heldBefore = world.snapshot().robot.gripper!.heldId;
        control.step();
        const snapshot = world.snapshot();
        if (touchedTick < 0 && world.sense.contacts().some((contact) => contact.otherId === 'wall')) {
          touchedTick = world.tick;
          log.heldWhenTouched = heldBefore;
        }
        mostPitch = Math.max(mostPitch, Math.abs(pitchDeg(snapshot)));
        finite &&= [snapshot.robot.xCm, snapshot.robot.yCm, snapshot.robot.zCm, ...snapshot.objects.map((object) => object.pose.zCm)].every(Number.isFinite);
      }
      expect(touchedTick).toBeGreaterThan(0);
      // It came in at about 0.4 m/s (the spike: 0.398), holding the cube, and only the cube met the wall: the robot touched it by the cube.
      expect(log.speedMS!).toBeGreaterThan(0.35);
      expect(log.speedMS!).toBeLessThan(0.45);
      expect(log.heldWhenTouched).toBe('cube');
      expect(log.ownTouching).toBe(false);
      // The hit broke the grasp (the claw still told 80°: no release).
      expect(log.heldAfter).toBeNull();
      expect(physics.impulseJoints.len()).toBe(5);
      // No NaN, and the car stays on its wheels (coasting on contact: the spike measured 1.0° at lift 45°).
      expect(finite).toBe(true);
      expect(mostPitch).toBeLessThan(8);
    } finally {
      world.dispose();
    }
  }, 60_000);

  it('a held cube against another object is the robot’s contact with it', async () => {
    const cubeX = START.xCm + tipX(0) + 3 + 8;
    // A post 6 cm past where the held cube ends up at lift 10°, standing 10 cm tall: the robot creeps up to it at duty 140.
    const arena = parseArena({
      ground: { sizeCm: [250, 100], color: '#ffffff' },
      objects: [cube('cube', cubeX, 15), { shape: 'box', id: 'post', centerCm: [cubeX + 20, START.yCm], sizeCm: [4, 8, 10], massG: 500 }],
    });
    const world = await createWorld({ arena, start: START, kit: gripperKit, seed: 1 });
    try {
      const control = driver(world);
      let seen: { held: string | null; contacts: string[] } | null = null;
      const script = (function* () {
        yield* pick(world, control, 'cube', 3);
        control.set({ liftDeg: 10 });
        for (let i = 0; i < seconds(0.4); i++) yield;
        control.drive(forward(140));
        for (let i = 0; i < seconds(4) && seen === null; i++) yield;
        control.drive(BRAKE);
      })();
      for (let tick = 0; tick < seconds(0.35 + 4 + 0.4 + 4 + 1); tick++) {
        if (script.next().done === true) break;
        control.step();
        const contacts = world.sense.contacts().map((contact) => contact.otherId);
        if (seen === null && contacts.includes('post')) seen = { held: world.snapshot().robot.gripper!.heldId, contacts };
      }
      expect(seen).not.toBeNull();
      expect(seen!.held).toBe('cube');
      expect(seen!.contacts).toEqual(['#ground', 'post']);
    } finally {
      world.dispose();
    }
  }, 60_000);

  it('stop while holding leaves no impulse joint after dispose', async () => {
    const arena = parseArena({ ground: { sizeCm: [200, 100], color: '#ffffff' }, objects: [cube('cube', START.xCm + tipX(0) + 3 + 8, 15)] });
    const world = await createWorld({ arena, start: START, kit: gripperKit, seed: 1 });
    const physics = physicsOf();
    const control = driver(world);
    const script = pick(world, control, 'cube', 3);
    for (let tick = 0; tick < seconds(0.35 + 4); tick++) {
      script.next();
      control.step();
    }
    expect(world.snapshot().robot.gripper!.heldId).toBe('cube');
    expect(physics.impulseJoints.len()).toBe(6);
    // What the world holds as it frees the physics: the gripper's own five joints, the held cube's let go first.
    let jointsAtFree = -1;
    const free = physics.free.bind(physics);
    physics.free = () => {
      jointsAtFree = physics.impulseJoints.len();
      free();
    };
    world.dispose();
    expect(jointsAtFree).toBe(5);
    expect(() => world.snapshot()).toThrow('The world has been disposed.');
    world.dispose();
  }, 60_000);
});
