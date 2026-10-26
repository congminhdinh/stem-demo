// N19 G0.1 grasp spike: the gripper world.
//
// Production code builds everything it can without edits: createPhysicsWorld (rapier.ts: 1/120 s, lengthUnit 0.1, 4 + 1 iterations),
// buildArena (arena/build-arena.ts) and assembleRobot + stepWorld (robot/assembly.ts, drive model (c)). production `createWorld`
// (world.ts) keeps its Rapier world private, so it cannot take the gripper's bodies; the spike composes the same builders instead and
// adds the gripper (gripper.ts) and the grasp machine (grasp.ts) to their world. Sensors, contacts-for-goals and snapshots are not
// built (ms/tick compares like with like: see `createRoverSim`).

import { parseArena } from '../../src/core/world/arena/arena-schema';
import type { ArenaInput } from '../../src/core/world/arena/arena-schema';
import { buildArena, type BuiltArena } from '../../src/core/world/arena/build-arena';
import { loadKit } from '../../src/core/hardware/kit-schema';
import { unoR3Board } from '../../src/core/hardware/catalog';
import type { Kit } from '../../src/core/hardware/kit';
import roverJson from '../../src/core/hardware/kits/ref-uno-rover.kit.json';
import { createPhysicsWorld, PHYSICS_DT_S, refreshQueries, type Collider, type PhysicsWorld, type RigidBody } from '../../src/core/world/rapier';
import { assembleRobot, SETTLE_STEPS, stepWorld, type RobotBody, type RobotStart } from '../../src/core/world/robot/assembly';
import type { MotorCommand } from '../../src/core/world/robot/dc-motor';
import { conjugate, localToWorld, multiplyQuaternions, robotPointToLocal } from '../../src/core/world/robot/robot-frame';
import { cmToM, rotateVector, type Quat, type Vec3 } from '../../src/core/world/units';
import { createGrasp, type Grasp, type GraspObject } from './grasp';
import { createGripper, type FingerMode, type Gripper, type GripperOptions, type LinkMode, type ServoLaw } from './gripper';
import { gripperKitJson } from './params';

export const DT = PHYSICS_DT_S;

const gripperKits = new Map<number, Kit>();
let roverKitCache: Kit | null = null;
/** The gripper kit; a heavier boom (exploration) takes its extra grams from the chassis body, so the robot still weighs 460 g. */
export function gripperKit(boomMassG?: number): Kit {
  const key = boomMassG ?? -1;
  let kit = gripperKits.get(key);
  if (kit === undefined) {
    kit = loadKit(gripperKitJson(boomMassG), unoR3Board);
    gripperKits.set(key, kit);
  }
  return kit;
}
export function roverKit(): Kit {
  roverKitCache ??= loadKit(roverJson, unoR3Board);
  return roverKitCache;
}

export type SimOptions = {
  readonly arena: ArenaInput;
  readonly start: RobotStart;
  readonly fingers: FingerMode;
  readonly fingerFriction: number;
  readonly law: ServoLaw;
  readonly link: LinkMode;
  readonly tuning?: GripperOptions['tuning'];
  /** Servo angles at build (setup(): claw 0°, lift 90°). */
  readonly liftDeg?: number;
  readonly clawDeg?: number;
};

export type Sim = {
  readonly world: PhysicsWorld;
  readonly arena: BuiltArena;
  readonly robot: RobotBody;
  readonly gripper: Gripper;
  readonly grasp: Grasp;
  readonly objects: readonly GraspObject[];
  readonly tick: number;
  /** Every dynamic body in hash order: chassis, boom, carriage, fingers, then the arena's. */
  readonly bodies: readonly RigidBody[];
  readonly caster: Collider;
  readonly ground: Collider;
  drive(command: MotorCommand): void;
  step(): void;
  object(id: string): GraspObject;
  dispose(): void;
};

const FNV_OFFSET = 0x811c9dc5;
const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);
function fnvInt32(h: number, v: number): number {
  for (let i = 0; i < 4; i++) {
    h ^= (v >>> (i * 8)) & 0xff;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}
/** FNV-1a over poses quantised to 1e-6 (translation xyz + quaternion xyzw per body), as spikes/robot-physics. */
export function hashQ6(h: number, bodies: readonly RigidBody[]): number {
  for (const b of bodies) {
    const t = b.translation();
    const q = b.rotation();
    for (const v of [t.x, t.y, t.z, q.x, q.y, q.z, q.w]) h = fnvInt32(h, Math.round(v * 1e6) | 0);
  }
  return h;
}
/** FNV-1a over the raw float32 bits of the same values (stricter). */
export function hashBits(h: number, bodies: readonly RigidBody[]): number {
  for (const b of bodies) {
    const t = b.translation();
    const q = b.rotation();
    for (const v of [t.x, t.y, t.z, q.x, q.y, q.z, q.w]) {
      f32[0] = v;
      h = fnvInt32(h, u32[0]!);
    }
  }
  return h;
}
export const hashInt = fnvInt32;
export const HASH_OFFSET = FNV_OFFSET;
export const hex = (h: number) => h.toString(16).padStart(8, '0');

function groundOf(world: PhysicsWorld, built: BuiltArena): Collider {
  for (const [handle, info] of built.colliders) if (info.id === '#ground') return world.getCollider(handle);
  throw new Error('no ground');
}

/** The arena's objects the grasp machine knows (box objects), with their masses and half extents. */
function graspObjects(arena: ArenaInput, built: BuiltArena): GraspObject[] {
  const out: GraspObject[] = [];
  for (const dynamic of built.dynamicBodies) {
    if (dynamic.kind !== 'object') continue;
    const spec = (arena.objects ?? []).find((object) => object.id === dynamic.id);
    if (spec === undefined || spec.shape !== 'box') continue;
    const [sx, sy, sz] = spec.sizeCm;
    out.push({ id: dynamic.id, body: dynamic.body, collider: dynamic.body.collider(0), massG: spec.massG, half: { x: cmToM(sx) / 2, y: cmToM(sz) / 2, z: cmToM(sy) / 2 } });
  }
  return out;
}

export function createSim(options: SimOptions): Sim {
  const world = createPhysicsWorld();
  const arenaData = parseArena(options.arena);
  const built = buildArena(world, arenaData);
  // The robot is built without its own settle: the gripper is added first, then the whole world settles together.
  const robot = assembleRobot(world, gripperKit(options.tuning?.boomMassG), options.start, { settleSteps: 0 });
  const gripper = createGripper(world, robot.chassis, {
    fingers: options.fingers,
    fingerFriction: options.fingerFriction,
    law: options.law,
    link: options.link,
    ...(options.tuning === undefined ? {} : { tuning: options.tuning }),
    liftDeg: options.liftDeg ?? 90,
    clawDeg: options.clawDeg ?? 0,
  });
  const objects = graspObjects(options.arena, built);
  const grasp = createGrasp(world, gripper, objects);
  const bodies = [robot.chassis, ...gripper.bodies, ...built.dynamicBodies.map((d) => d.body)];
  const caster = robot.chassis.collider(5);
  const ground = groundOf(world, built);
  let tick = 0;
  for (let i = 0; i < SETTLE_STEPS; i++) {
    gripper.beforeStep(DT);
    stepWorld(world, robot);
  }
  refreshQueries(world);
  return {
    world,
    arena: built,
    robot,
    gripper,
    grasp,
    objects,
    get tick() {
      return tick;
    },
    bodies,
    caster,
    ground,
    drive(command) {
      robot.applyActuators({ motors: { motorLeft: command, motorRight: command } });
    },
    step() {
      gripper.beforeStep(DT);
      stepWorld(world, robot);
      tick += 1;
      grasp.update(tick, DT);
    },
    object(id) {
      const found = objects.find((o) => o.id === id);
      if (found === undefined) throw new Error(`no object ${id}`);
      return found;
    },
    dispose() {
      grasp.dropAll(tick);
      world.free();
    },
  };
}

/** The rover baseline for ms/tick: the same builders with ref-uno-rover@0 (servo arm included), no gripper. */
export type RoverSim = { readonly bodies: readonly RigidBody[]; drive(command: MotorCommand): void; step(): void; dispose(): void };
export function createRoverSim(arena: ArenaInput, start: RobotStart): RoverSim {
  const world = createPhysicsWorld();
  const built = buildArena(world, parseArena(arena));
  const robot = assembleRobot(world, roverKit(), start);
  return {
    bodies: [...robot.bodies, ...built.dynamicBodies.map((d) => d.body)],
    drive(command) {
      robot.applyActuators({ motors: { motorLeft: command, motorRight: command } });
    },
    step() {
      stepWorld(world, robot);
    },
    dispose() {
      world.free();
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------------------
// Measures (not in the timed tick; Math trig allowed here: never written back into the world, ADR 0001 §4.6)

const DEG = 180 / Math.PI;

/** Nose-up pitch and left-up roll of a rotation, degrees. */
export function pitchRollDeg(q: Quat): { pitch: number; roll: number } {
  const forward = rotateVector(q, { x: 1, y: 0, z: 0 });
  const left = rotateVector(q, { x: 0, y: 0, z: -1 });
  return { pitch: Math.asin(Math.max(-1, Math.min(1, forward.y))) * DEG, roll: Math.asin(Math.max(-1, Math.min(1, left.y))) * DEG };
}

/** Rotation angle of a unit quaternion, degrees. */
export function angleDeg(q: Quat): number {
  return 2 * Math.acos(Math.min(1, Math.abs(q.w))) * DEG;
}

/** The pose of `body` in `frame`'s frame. */
export function relativePose(frame: RigidBody, body: RigidBody): { p: Vec3; q: Quat } {
  const inverse = conjugate(frame.rotation());
  const a = frame.translation();
  const b = body.translation();
  return { p: rotateVector(inverse, { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z }), q: multiplyQuaternions(inverse, body.rotation()) };
}

/** Caster contact with the ground on the last step: the gap (m, min contact distance; +∞ without a contact) and the load (N). */
export function casterContact(sim: Sim): { gapM: number; loadN: number; heightM: number } {
  let gap = Number.POSITIVE_INFINITY;
  let impulse = 0;
  sim.world.contactPair(sim.caster, sim.ground, (manifold) => {
    for (let i = 0; i < manifold.numContacts(); i++) {
      gap = Math.min(gap, manifold.contactDist(i));
      impulse += manifold.contactImpulse(i);
    }
  });
  // Height of the caster ball's bottom above the floor, from the chassis pose (independent of the manifold).
  const kit = gripperKit();
  const casterCm = kit.chassis!.casterCm;
  const centre = localToWorld(sim.robot.chassis.translation(), sim.robot.chassis.rotation(), robotPointToLocal(casterCm));
  return { gapM: gap, loadN: impulse / DT, heightM: centre.y - cmToM(kit.chassis!.casterRadiusCm) };
}

/** Deepest penetration (m, ≥ 0) of any gripper collider into a collider, by shape query. */
export function gripperPenetrationM(sim: Sim, target: Collider, which: 'fingers' | 'carriage'): number {
  let deepest = 0;
  const colliders = which === 'fingers' ? sim.gripper.fingers.map((f) => f.collider) : [sim.gripper.carriage.collider(0)];
  for (const collider of colliders) {
    const contact = collider.contactCollider(target, 0);
    if (contact !== null && contact.distance < 0) deepest = Math.max(deepest, 0 - contact.distance);
  }
  return deepest;
}

/** Whether any gripper collider touches a chassis collider (they must never: the geometry keeps them apart). */
export function gripperTouchesChassis(sim: Sim): boolean {
  let touches = false;
  for (const collider of sim.gripper.colliders) {
    sim.world.contactPairsWith(collider, (other) => {
      if (other.parent()?.handle !== sim.robot.chassis.handle) return;
      sim.world.contactPair(collider, other, (manifold) => {
        for (let i = 0; i < manifold.numContacts(); i++) if (manifold.contactDist(i) <= 0) touches = true;
      });
    });
  }
  return touches;
}

export function anyNaN(bodies: readonly RigidBody[]): boolean {
  for (const b of bodies) {
    const t = b.translation();
    const q = b.rotation();
    for (const v of [t.x, t.y, t.z, q.x, q.y, q.z, q.w]) if (!Number.isFinite(v)) return true;
  }
  return false;
}
