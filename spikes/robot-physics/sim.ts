// R0.1 physics spike (evidence, not production). Shared by Node, Vitest and the browser page.
//
// Units are SI (m, kg, s). Frame: +X robot forward, +Y up, +Z robot right. A positive
// yaw rate turns the robot left (counter-clockwise seen from above).
//
// Determinism rule followed in the tick path: only + - * /, Math.sqrt, Math.abs,
// Math.min/max and Math.round. No Math.sin/cos/atan2/pow/hypot/exp (not correctly
// rounded across JS engines). Trig appears only in measurement helpers (yawOf, tiltOf),
// which never feed back into the simulation or the hash.
import type * as RapierNs from '@dimforge/rapier3d-deterministic-compat';

export type Rapier = typeof RapierNs;
type World = RapierNs.World;
type RigidBody = RapierNs.RigidBody;
type Vec3 = { x: number; y: number; z: number };
type Quat = { x: number; y: number; z: number; w: number };

export const PHYSICS_HZ = 120;
export const DT = 1 / PHYSICS_HZ;

export type DriveModel = 'joint' | 'raycast' | 'velocity';
export const DRIVE_MODELS: DriveModel[] = ['joint', 'raycast', 'velocity'];

export type Tuning = { lengthUnit: number; solverIterations: number; pgsIterations: number };
/**
 * Per-model integration parameters chosen by the sweep (see ADR 0001). lengthUnit 0.1:
 * the typical dynamic object is ~10 cm, so Rapier's length tolerances scale by 0.1.
 */
export const MODEL_TUNING: Record<DriveModel, Tuning> = {
  joint: { lengthUnit: 0.1, solverIterations: 8, pgsIterations: 2 },
  raycast: { lengthUnit: 0.1, solverIterations: 4, pgsIterations: 1 },
  velocity: { lengthUnit: 0.1, solverIterations: 4, pgsIterations: 1 },
};

export const ROBOT = {
  bodyHalf: { x: 0.075, y: 0.025, z: 0.05 }, // body 15 x 5 x 10 cm
  bodyCenterY: 0.04, // 1.5 cm ground clearance under the body
  massTotal: 0.5,
  wheelRadius: 0.033,
  wheelHalfWidth: 0.0125,
  wheelMass: 0.03,
  track: 0.14, // distance between the two wheel centres
  axleX: -0.02,
  casterX: 0.055,
  casterRadius: 0.01,
  maxWheelTorque: 0.1, // N*m per wheel, order of a TT gear motor stall torque
  tireMu: 1.0,
};
const WHEEL_Y = ROBOT.wheelRadius - ROBOT.bodyCenterY; // wheel centre, chassis frame
const CASTER_Y = ROBOT.casterRadius - ROBOT.bodyCenterY;
const GRAVITY = 9.81;

/** Box inertia about its centre, principal axes = body axes. */
function boxInertia(m: number, h: Vec3): Vec3 {
  const lx = 2 * h.x, ly = 2 * h.y, lz = 2 * h.z;
  return { x: (m / 12) * (ly * ly + lz * lz), y: (m / 12) * (lx * lx + lz * lz), z: (m / 12) * (lx * lx + ly * ly) };
}

// ---------- trig-free quaternion helpers ----------
export const IDENTITY: Quat = { x: 0, y: 0, z: 0, w: 1 };
/** Yaw of -45 deg (heading along +X+Z diagonal) built from sqrt only, no Math.sin/cos. */
export function yawMinus45(): Quat {
  const c45 = Math.sqrt(0.5);
  return { x: 0, y: -Math.sqrt((1 - c45) / 2), z: 0, w: Math.sqrt((1 + c45) / 2) };
}
/** 90 deg about +X: turns Rapier's Y-axis cylinder into a Z-axis wheel. */
const ROT_X_90: Quat = { x: Math.sqrt(0.5), y: 0, z: 0, w: Math.sqrt(0.5) };

export function rotate(q: Quat, v: Vec3): Vec3 {
  // v' = v + 2w(u x v) + 2u x (u x v), u = (q.x, q.y, q.z)
  const tx = 2 * (q.y * v.z - q.z * v.y);
  const ty = 2 * (q.z * v.x - q.x * v.z);
  const tz = 2 * (q.x * v.y - q.y * v.x);
  return {
    x: v.x + q.w * tx + (q.y * tz - q.z * ty),
    y: v.y + q.w * ty + (q.z * tx - q.x * tz),
    z: v.z + q.w * tz + (q.x * ty - q.y * tx),
  };
}

// ---------- measurement-only helpers (trig allowed: never feed the sim) ----------
export function yawOf(q: Quat): number {
  const f = rotate(q, { x: 1, y: 0, z: 0 });
  return Math.atan2(-f.z, f.x);
}
export function tiltDegOf(q: Quat): number {
  const u = rotate(q, { x: 0, y: 1, z: 0 });
  return (Math.acos(Math.min(1, Math.max(-1, u.y))) * 180) / Math.PI;
}

// ---------- world ----------
export type SimOptions = {
  model: DriveModel;
  tuning?: Tuning;
  start: { x: number; z: number; q?: Quat };
  box?: { x: number; z: number };
  /** Joint model only: velocity-motor factor (damping) of the revolute motor. Default 50. */
  motorFactor?: number;
  /** Joint model only: wheel collider shape. Default 'ball' (cylinders jitter on a box floor). */
  wheelShape?: 'cylinder' | 'roundCylinder' | 'ball';
  /** Joint model only: revolute motor model. Default 'force' (torque-limited by setMotorMaxForce). */
  motorModel?: 'acceleration' | 'force';
  /** Raycast model only: tyre parameters (frictionSlip, sideFrictionStiffness) and P gain. */
  raycast?: { frictionSlip?: number; sideStiffness?: number; kp?: number; sag?: number; zeta?: number };
};

export type Sim = {
  readonly world: World;
  readonly chassis: RigidBody;
  readonly box: RigidBody | null;
  /** Dynamic bodies in creation order: what the determinism hash covers. */
  readonly dynamicBodies: RigidBody[];
  /** Wheel angular-velocity targets in rad/s (positive = rolls forward). */
  setWheelTargets(left: number, right: number): void;
  /** Measured wheel angular velocities (rad/s), from the model's own state. */
  wheelSpeeds(): [number, number];
  step(): void;
  /** World point under the axle midpoint: the spin centre of a diff-drive robot. */
  axleCenter(): Vec3;
  dispose(): void;
};

function buildArena(R: Rapier, world: World): void {
  const ground = world.createRigidBody(R.RigidBodyDesc.fixed());
  world.createCollider(R.ColliderDesc.cuboid(1.2, 0.05, 1.2).setTranslation(0, -0.05, 0).setFriction(1.0), ground);
  const walls: [number, number, number, number, number][] = [
    [1.01, 0, 0.01, 0.05, 1.02],
    [-1.01, 0, 0.01, 0.05, 1.02],
    [0, 1.01, 1.02, 0.05, 0.01],
    [0, -1.01, 1.02, 0.05, 0.01],
  ];
  for (const [x, z, hx, hy, hz] of walls) {
    world.createCollider(R.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, hy, z).setFriction(0.3), ground);
  }
}

function addBox(R: Rapier, world: World, x: number, z: number): RigidBody {
  const body = world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(x, 0.05, z));
  world.createCollider(
    R.ColliderDesc.cuboid(0.05, 0.05, 0.05)
      .setMass(0.1)
      .setFriction(0.4)
      .setFrictionCombineRule(R.CoefficientCombineRule.Min),
    body,
  );
  return body;
}

function createChassis(R: Rapier, world: World, start: SimOptions['start'], mass: number): RigidBody {
  const q = start.q ?? IDENTITY;
  const desc = R.RigidBodyDesc.dynamic()
    .setTranslation(start.x, ROBOT.bodyCenterY, start.z)
    .setRotation(q)
    .setCanSleep(false)
    .setAdditionalMassProperties(mass, { x: 0, y: 0, z: 0 }, boxInertia(mass, ROBOT.bodyHalf), IDENTITY);
  const chassis = world.createRigidBody(desc);
  const h = ROBOT.bodyHalf;
  world.createCollider(R.ColliderDesc.cuboid(h.x, h.y, h.z).setDensity(0).setFriction(0.3), chassis);
  return chassis;
}

function frictionlessBall(R: Rapier, radius: number, x: number, y: number, z: number): RapierNs.ColliderDesc {
  return R.ColliderDesc.ball(radius)
    .setTranslation(x, y, z)
    .setDensity(0)
    .setFriction(0)
    .setFrictionCombineRule(R.CoefficientCombineRule.Min);
}

export function createSim(R: Rapier, opts: SimOptions): Sim {
  const tuning = opts.tuning ?? MODEL_TUNING[opts.model];
  const world = new R.World({ x: 0, y: -GRAVITY, z: 0 });
  world.timestep = DT;
  world.lengthUnit = tuning.lengthUnit;
  world.numSolverIterations = tuning.solverIterations;
  world.numInternalPgsIterations = tuning.pgsIterations;
  buildArena(R, world);
  const build = opts.model === 'joint' ? buildJoint : opts.model === 'raycast' ? buildRaycast : buildVelocity;
  const parts = build(R, world, opts);
  const box = opts.box ? addBox(R, world, opts.box.x, opts.box.z) : null;
  const dynamicBodies = [...parts.bodies, ...(box ? [box] : [])];
  const chassis = parts.bodies[0]!;
  return {
    world,
    chassis,
    box,
    dynamicBodies,
    setWheelTargets: parts.setWheelTargets,
    wheelSpeeds: parts.wheelSpeeds,
    step() {
      parts.beforeStep();
      world.step();
    },
    axleCenter() {
      const p = chassis.translation();
      const o = rotate(chassis.rotation(), { x: ROBOT.axleX, y: 0, z: 0 });
      return { x: p.x + o.x, y: p.y + o.y, z: p.z + o.z };
    },
    dispose() {
      world.free();
    },
  };
}

type Parts = {
  bodies: RigidBody[];
  setWheelTargets(left: number, right: number): void;
  wheelSpeeds(): [number, number];
  beforeStep(): void;
};

// (a) Revolute joint + velocity motor: two dynamic wheel bodies with friction.
function buildJoint(R: Rapier, world: World, opts: SimOptions): Parts {
  const q = opts.start.q ?? IDENTITY;
  const chassisMass = ROBOT.massTotal - 2 * ROBOT.wheelMass;
  const chassis = createChassis(R, world, opts.start, chassisMass);
  world.createCollider(frictionlessBall(R, ROBOT.casterRadius, ROBOT.casterX, CASTER_Y, 0), chassis);
  const factor = opts.motorFactor ?? 50;
  const axis = { x: 0, y: 0, z: -1 }; // positive relative angvel about -Z rolls the wheel forward
  const wheels: RigidBody[] = [];
  const joints: RapierNs.RevoluteImpulseJoint[] = [];
  for (const side of [-1, 1]) {
    const anchor = { x: ROBOT.axleX, y: WHEEL_Y, z: (side * ROBOT.track) / 2 };
    const o = rotate(q, anchor);
    const wheel = world.createRigidBody(
      R.RigidBodyDesc.dynamic()
        .setTranslation(opts.start.x + o.x, ROBOT.bodyCenterY + o.y, opts.start.z + o.z)
        .setRotation(q)
        .setCanSleep(false),
    );
    const shape = opts.wheelShape ?? 'ball';
    const wheelDesc =
      shape === 'ball'
        ? R.ColliderDesc.ball(ROBOT.wheelRadius)
        : shape === 'roundCylinder'
          ? R.ColliderDesc.roundCylinder(ROBOT.wheelHalfWidth - 0.004, ROBOT.wheelRadius - 0.004, 0.004).setRotation(ROT_X_90)
          : R.ColliderDesc.cylinder(ROBOT.wheelHalfWidth, ROBOT.wheelRadius).setRotation(ROT_X_90);
    world.createCollider(wheelDesc.setMass(ROBOT.wheelMass).setFriction(ROBOT.tireMu), wheel);
    const joint = world.createImpulseJoint(
      R.JointData.revolute(anchor, { x: 0, y: 0, z: 0 }, axis),
      chassis,
      wheel,
      true,
    ) as RapierNs.RevoluteImpulseJoint;
    joint.setContactsEnabled(false);
    joint.configureMotorModel(opts.motorModel === 'acceleration' ? R.MotorModel.AccelerationBased : R.MotorModel.ForceBased);
    joint.setMotorMaxForce(ROBOT.maxWheelTorque);
    joint.configureMotorVelocity(0, factor);
    wheels.push(wheel);
    joints.push(joint);
  }
  return {
    bodies: [chassis, ...wheels],
    setWheelTargets(left, right) {
      joints[0]!.configureMotorVelocity(left, factor);
      joints[1]!.configureMotorVelocity(right, factor);
    },
    wheelSpeeds() {
      const a = rotate(chassis.rotation(), axis);
      const wc = chassis.angvel();
      const rel = (b: RigidBody) => {
        const w = b.angvel();
        return (w.x - wc.x) * a.x + (w.y - wc.y) * a.y + (w.z - wc.z) * a.z;
      };
      return [rel(wheels[0]!), rel(wheels[1]!)];
    },
    beforeStep() {},
  };
}

// (b) DynamicRayCastVehicleController: ray wheels with suspension; engine force from a
// saturated P controller on wheel speed (same torque limit as the other models).
function buildRaycast(R: Rapier, world: World, opts: SimOptions): Parts {
  const chassis = createChassis(R, world, opts.start, ROBOT.massTotal);
  const vehicle = world.createVehicleController(chassis);
  const rest = 0.01;
  const hardY = WHEEL_Y + rest; // wheel centre sits at WHEEL_Y when the spring is at rest
  // Spring stiffness is per unit chassis mass (Bullet heritage): ~2 mm static sag on 3 wheels.
  const stiffness = GRAVITY / (3 * (opts.raycast?.sag ?? 0.002));
  const damping = ((opts.raycast?.zeta ?? 0.7) * 2 * Math.sqrt(3 * stiffness)) / 3;
  const slip = opts.raycast?.frictionSlip ?? ROBOT.tireMu;
  const sideK = opts.raycast?.sideStiffness ?? 1;
  const wheelDefs = [
    { x: ROBOT.axleX, z: -ROBOT.track / 2, radius: ROBOT.wheelRadius, mu: slip, side: sideK },
    { x: ROBOT.axleX, z: ROBOT.track / 2, radius: ROBOT.wheelRadius, mu: slip, side: sideK },
    // caster: a third ray with no traction at all
    { x: ROBOT.casterX, z: 0, radius: ROBOT.casterRadius, mu: 0, side: 0 },
  ];
  wheelDefs.forEach((w, i) => {
    const y = w.side !== 0 ? hardY : CASTER_Y + rest;
    vehicle.addWheel({ x: w.x, y, z: w.z }, { x: 0, y: -1, z: 0 }, { x: 0, y: 0, z: 1 }, rest, w.radius);
    vehicle.setWheelSuspensionStiffness(i, stiffness);
    vehicle.setWheelSuspensionCompression(i, damping);
    vehicle.setWheelSuspensionRelaxation(i, damping);
    vehicle.setWheelMaxSuspensionTravel(i, 0.01);
    vehicle.setWheelMaxSuspensionForce(i, 100);
    vehicle.setWheelFrictionSlip(i, w.mu);
    vehicle.setWheelSideFrictionStiffness(i, w.side);
  });
  const fMax = ROBOT.maxWheelTorque / ROBOT.wheelRadius;
  const kp = opts.raycast?.kp ?? 0.2; // N per rad/s of wheel-speed error
  let target: [number, number] = [0, 0];
  let lastRot: [number, number] = [0, 0];
  let speed: [number, number] = [0, 0];
  return {
    bodies: [chassis],
    setWheelTargets(left, right) {
      target = [left, right];
    },
    wheelSpeeds() {
      return [speed[0], speed[1]];
    },
    beforeStep() {
      for (let i = 0; i < 2; i++) {
        const f = kp * (target[i]! - speed[i]!);
        vehicle.setWheelEngineForce(i, Math.max(-fMax, Math.min(fMax, f)));
      }
      vehicle.updateVehicle(DT);
      for (let i = 0; i < 2; i++) {
        const rot = vehicle.wheelRotation(i) ?? 0;
        speed[i] = (rot - lastRot[i]!) / DT;
        lastRot[i] = rot;
      }
    },
  };
}

// (c) Velocity-level diff-drive on a dynamic chassis: frictionless supports, traction is
// a per-wheel impulse that drives the body towards the kinematic diff-drive velocity,
// saturated by motor torque and tyre friction. Contacts (walls, box) stay physical.
function buildVelocity(R: Rapier, world: World, opts: SimOptions): Parts {
  const chassis = createChassis(R, world, opts.start, ROBOT.massTotal);
  for (const side of [-1, 1]) {
    world.createCollider(frictionlessBall(R, ROBOT.wheelRadius, ROBOT.axleX, WHEEL_Y, (side * ROBOT.track) / 2), chassis);
  }
  world.createCollider(frictionlessBall(R, ROBOT.casterRadius, ROBOT.casterX, CASTER_Y, 0), chassis);
  const m = ROBOT.massTotal;
  const iyy = boxInertia(m, ROBOT.bodyHalf).y;
  const r = ROBOT.wheelRadius;
  const half = ROBOT.track / 2;
  // Per-wheel ground impulse limit for one tick: motor torque or tyre grip (each wheel
  // carries roughly 40 % of the weight; the caster takes the rest).
  const jMax = Math.min(ROBOT.maxWheelTorque / r, ROBOT.tireMu * 0.4 * m * GRAVITY) * DT;
  const jSide = ROBOT.tireMu * 0.8 * m * GRAVITY * DT;
  let target: [number, number] = [0, 0];
  let speed: [number, number] = [0, 0];
  return {
    bodies: [chassis],
    setWheelTargets(left, right) {
      target = [left, right];
    },
    wheelSpeeds() {
      return [speed[0], speed[1]];
    },
    beforeStep() {
      const q = chassis.rotation();
      const f0 = rotate(q, { x: 1, y: 0, z: 0 });
      const fl = Math.sqrt(f0.x * f0.x + f0.z * f0.z);
      const fx = f0.x / fl, fz = f0.z / fl; // forward on the ground plane
      const lx = -fz, lz = fx; // right-hand lateral (+Z when facing +X)
      const v = chassis.linvel();
      const w = chassis.angvel();
      const vf = v.x * fx + v.z * fz;
      const vl = v.x * lx + v.z * lz;
      // wheel ground speeds now (yaw > 0 turns left: right wheel faster)
      speed = [(vf - w.y * half) / r, (vf + w.y * half) / r];
      const vt = (r * (target[0] + target[1])) / 2;
      const wt = (r * (target[1] - target[0])) / ROBOT.track;
      const jLin = m * (vt - vf);
      const jYaw = (iyy * (wt - w.y)) / half;
      const jl = Math.max(-jMax, Math.min(jMax, jLin / 2 - jYaw / 2));
      const jr = Math.max(-jMax, Math.min(jMax, jLin / 2 + jYaw / 2));
      // No side slip at the axle: the COM (ahead of the axle) moves sideways at wy * axleX.
      const wyNext = w.y + ((jr - jl) * half) / iyy;
      const js = Math.max(-jSide, Math.min(jSide, m * (wyNext * ROBOT.axleX - vl)));
      chassis.applyImpulse({ x: (jl + jr) * fx + js * lx, y: 0, z: (jl + jr) * fz + js * lz }, true);
      chassis.applyTorqueImpulse({ x: 0, y: (jr - jl) * half, z: 0 }, true);
    },
  };
}

// ---------- hashing ----------
const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);
function fnvInt32(h: number, v: number): number {
  for (let i = 0; i < 4; i++) {
    h ^= (v >>> (i * 8)) & 0xff;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}
export const FNV_OFFSET = 0x811c9dc5;
/** FNV-1a over poses quantised to 1e-6 (translation xyz + quaternion xyzw per body). */
export function hashQ6(h: number, bodies: RigidBody[]): number {
  for (const b of bodies) {
    const t = b.translation();
    const q = b.rotation();
    for (const v of [t.x, t.y, t.z, q.x, q.y, q.z, q.w]) h = fnvInt32(h, Math.round(v * 1e6) | 0);
  }
  return h;
}
/** FNV-1a over the raw float32 bits of the same values (stricter than q6). */
export function hashBits(h: number, bodies: RigidBody[]): number {
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
export const hex = (h: number) => h.toString(16).padStart(8, '0');
