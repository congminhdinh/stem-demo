// N19 B7 spike (eslint-ignored): why the gripper car turns at rest after rb-grip-stack's reference, and which suspect gives the yaw rate.
//
// A real run session (the lab's Chạy: variant 0, or any variant) runs a lesson's reference to the end of its program; then `rest()` lets it
// settle and measures the chassis over a window, with a set of "removals" switched on at the window's start (never before, so every case
// measures the same end state). The removals patch Rapier's own prototypes, which the production code calls through getRapier():
//   - refresh:   the gripper kit's per-tick support-ball refresh (assembly.ts `setTranslationWrtParent`) does nothing;
//   - friction:  the per-tick gear friction coefficient (assembly.ts `setFriction` from the last load) is frozen at its last value;
//   - drive:     the drive's forces on the chassis (assembly.ts `setDrive`: the coast's side push) are cleared and no longer added;
//   - servos:    the joint motors (lift, fingers; the rover's arm) keep the last velocity they were told (no per-tick re-aim);
//   - objects:   every dynamic body that is not the robot's is moved 1 m away (onto the floor, far from the car);
//   - sleep:     every body may sleep (set before the world is built: the chassis, the servo arm and the gripper's bodies are
//                setCanSleep(false) in production); wake-ups the tick asks for (addForce/addTorque(…, true)) do not wake.
import { productionKits, unoR3Board } from '../../src/core/hardware/catalog';
import type { Kit } from '../../src/core/hardware/kit';
import { registry } from '../../src/core/program/__fixtures__/uno-blocks';
import { createRobotRunSession, type RobotRunSession } from '../../src/core/run/robot-run-session';
import type { Scenario } from '../../src/core/scenario/scenario';
import { getRapier, initPhysics, type PhysicsWorld, type RigidBody } from '../../src/core/world/rapier';
import { scenarioCatalog } from '../../src/samples/robot-scenarios';
import { robotSolutions, type BlocklyJson } from '../../src/samples/robot-solutions';
import { robotStarterDocument } from '../../src/samples/robot-templates';
import type { RobotTemplateKey } from '../../src/samples/robot-keys';

export const gripperKit = productionKits.get({ id: 'ref-uno-gripper', version: '0' }) as Kit;
export const roverKit = productionKits.get({ id: 'ref-uno-rover', version: '0' }) as Kit;

export type Removal = 'refresh' | 'friction' | 'drive' | 'servos' | 'objects' | 'sleep' | 'zero' | 'iter8' | 'iter16' | 'pgs4' | 'fingersOff' | 'gripIters0' | 'noLock' | 'liftLimit' | 'liftPos' | 'liftZeroVel' | 'liftLimitMotorOn' | 'fingersStill' | 'objectsWeightless';
export const ALL_REMOVALS: readonly Removal[] = ['refresh', 'friction', 'drive', 'servos', 'objects', 'sleep'];

const on = new Set<Removal>();
let sleepAtBuild = false;
let lastWorld: PhysicsWorld | null = null;
let patched = false;
/** Joints whose configureMotorVelocity calls are ignored (by handle). */
const blocked = new Set<number>();

/** The physics world stepped last (the session's). */
export const lastPhysics = (): PhysicsWorld => lastWorld!;

/** Patches Rapier's prototypes once (after initPhysics). */
export async function setup(): Promise<void> {
  await initPhysics();
  if (patched) return;
  patched = true;
  const R = getRapier();
  const world = R.World.prototype as unknown as Record<string, (...args: unknown[]) => unknown>;
  const step = world.step!;
  world.step = function (this: PhysicsWorld, ...args: unknown[]) {
    lastWorld = this;
    return step.apply(this, args);
  };
  const collider = R.Collider.prototype as unknown as Record<string, (...args: unknown[]) => unknown>;
  const setTwp = collider.setTranslationWrtParent!;
  collider.setTranslationWrtParent = function (...args: unknown[]) {
    if (on.has('refresh')) return undefined;
    return setTwp.apply(this, args);
  };
  const setFriction = collider.setFriction!;
  collider.setFriction = function (...args: unknown[]) {
    if (on.has('friction')) return undefined;
    return setFriction.apply(this, args);
  };
  const body = R.RigidBody.prototype as unknown as Record<string, (...args: unknown[]) => unknown>;
  for (const name of ['addForce', 'addTorque'] as const) {
    const original = body[name]!;
    body[name] = function (this: RigidBody, value: unknown, wake: unknown) {
      if (on.has('drive')) return undefined;
      return original.call(this, value, on.has('sleep') ? false : wake);
    };
  }
  const desc = R.RigidBodyDesc.prototype as unknown as Record<string, (...args: unknown[]) => unknown>;
  const setCanSleep = desc.setCanSleep!;
  desc.setCanSleep = function (this: unknown, can: unknown) {
    return setCanSleep.call(this, sleepAtBuild ? true : can);
  };
  for (const [, value] of Object.entries(R)) {
    if (typeof value !== 'function' || value.prototype === undefined) continue;
    const proto = value.prototype as Record<string, (...args: unknown[]) => unknown>;
    if (!Object.prototype.hasOwnProperty.call(proto, 'configureMotorVelocity')) continue;
    const original = proto.configureMotorVelocity!;
    proto.configureMotorVelocity = function (this: { handle: number }, ...args: unknown[]) {
      if (on.has('servos') || blocked.has(this.handle)) return undefined;
      return original.apply(this, args);
    };
  }
}

export const projectOf = (key: string, blocks: BlocklyJson) => ({ ...robotStarterDocument(key as RobotTemplateKey), program: { blocks: structuredClone(blocks) } });

export type RestCase = {
  readonly key: string;
  readonly program?: BlocklyJson;
  readonly variant?: number;
  /** Seconds after the program finished before the window starts. */
  readonly settleS?: number;
  /** The window, s. */
  readonly windowS?: number;
  readonly removals?: readonly Removal[];
  /** Which program of the lesson: 'reference' (default), 'blind' or 'exploit-<i>'. */
  readonly which?: string;
};

export type RestResult = {
  key: string;
  which: string;
  variant: number;
  removals: readonly Removal[];
  finishedAtS: number;
  windowFromS: number;
  windowS: number;
  /** The chassis' yaw change over the window / its length, deg/s (float64, from the chassis quaternion). */
  yawRateDegS: number;
  /** The chassis origin's horizontal travel over the window / its length, cm/s. */
  driftCmS: number;
  /** The largest |angvel.y| and |linvel| of the chassis read at each tick of the window. */
  maxYawRateDegS: number;
  maxSpeedCmS: number;
  wheelRadRate: [number, number];
  gripper: { clawDeg: number; liftDeg: number; heldId: string | null } | null;
  /** Non-robot colliders the robot's colliders have a contact pair with at the window's start, by the robot body's index (0 chassis). */
  touching: string[];
  objectContacts: string[];
  sleeping: number;
  joints0: ReturnType<typeof jointErrors>;
  boomLimits0: [number, number] | null;
  boomLimits1: [number, number] | null;
  joints1: ReturnType<typeof jointErrors>;
  /** The chassis at the window's start: world position (m) and rotation. */
  pose0: { p: { x: number; y: number; z: number }; q: { x: number; y: number; z: number; w: number } };
};

const yawOf = (q: { x: number; y: number; z: number; w: number }) => Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.z * q.z));

/** Runs the case: the program to its end, a settle, then the window with the removals on. */
export async function rest(c: RestCase): Promise<RestResult> {
  await setup();
  const scenario = scenarioCatalog.get(c.key) as Scenario;
  const kit = scenario.kit === 'ref-uno-gripper' ? gripperKit : roverKit;
  const solution = robotSolutions[c.key as keyof typeof robotSolutions];
  const which = c.which ?? 'reference';
  const blocks = c.program ?? (which === 'reference' ? solution.reference : which === 'blind' ? solution.blind! : solution.exploits![Number(which.slice('exploit-'.length))]!.program);
  on.clear();
  sleepAtBuild = (c.removals ?? []).includes('sleep');
  const session: RobotRunSession = createRobotRunSession({ scenario, kit, board: unoR3Board, registry });
  const started = await session.start(projectOf(c.key, blocks), c.variant ?? 0);
  if (!started.ok) throw new Error(JSON.stringify(started));
  sleepAtBuild = false;
  const physics = lastWorld!;
  // The robot's bodies: created after the arena's; the chassis is the dynamic body with 6 colliders.
  const dynamic: RigidBody[] = [];
  physics.forEachRigidBody((body) => {
    if (body.isDynamic()) dynamic.push(body);
  });
  const chassis = dynamic.find((body) => body.numColliders() === 6)!;
  const robot = dynamic.filter((body) => body.handle >= chassis.handle);
  const others = dynamic.filter((body) => body.handle < chassis.handle);
  let t = 0;
  let finishedAtS = -1;
  while (t < scenario.timeLimitS) {
    t = Math.round((t + 0.1) * 1e6) / 1e6;
    await session.runUntil(t);
    if (session.getSnapshot().status === 'finished') {
      finishedAtS = session.getSnapshot().world!.t;
      break;
    }
  }
  if (finishedAtS < 0) return { key: c.key, which, variant: c.variant ?? 0, removals: c.removals ?? [], finishedAtS: -1 } as unknown as RestResult;
  const settleS = c.settleS ?? 2;
  const windowS = c.windowS ?? 10;
  const from = finishedAtS + settleS;
  if (from + windowS > scenario.timeLimitS) return { key: c.key, which, variant: c.variant ?? 0, removals: c.removals ?? [], finishedAtS, windowFromS: from, windowS: -1 } as unknown as RestResult;
  await session.runUntil(from);
  const touching: string[] = [];
  robot.forEach((body, index) => {
    for (let i = 0; i < body.numColliders(); i++) {
      physics.contactPairsWith(body.collider(i), (other) => {
        const parent = other.parent();
        if (parent !== null && robot.some((own) => own.handle === parent.handle)) return;
        let n = 0;
        let impulse = 0;
        physics.contactPair(body.collider(i), other, (manifold) => {
          for (let k = 0; k < manifold.numContacts(); k++) {
            if (manifold.contactDist(k) <= 0.001) n += 1;
            impulse += manifold.contactImpulse(k);
          }
        });
        if (n > 0 || impulse > 0) touching.push(`body${index}.c${i}→${parent === null ? 'fixed' : parent.isDynamic() ? `dyn#${parent.handle}` : 'fixed'}(${n} pts, ${impulse.toExponential(2)} N·s)`);
      });
    }
  });
  /** Each non-robot dynamic body's contacts with anything but the robot's colliders: what an object rests on. */
  const objectContacts: string[] = [];
  others.forEach((body) => {
    for (let i = 0; i < body.numColliders(); i++) {
      physics.contactPairsWith(body.collider(i), (other) => {
        const parent = other.parent();
        if (parent !== null && robot.some((own) => own.handle === parent.handle)) return;
        let n = 0;
        let impulse = 0;
        physics.contactPair(body.collider(i), other, (manifold) => {
          for (let k = 0; k < manifold.numContacts(); k++) {
            if (manifold.contactDist(k) <= 0.001) n += 1;
            impulse += manifold.contactImpulse(k);
          }
        });
        if (n > 0 || impulse > 0) objectContacts.push(`dyn#${body.handle}→${parent === null || !parent.isDynamic() ? 'fixed' : `dyn#${parent.handle}`}(${n} pts, ${impulse.toExponential(2)} N·s, sleeping ${body.isSleeping()})`);
      });
    }
  });
  const removals = c.removals ?? [];
  for (const removal of removals) on.add(removal);
  if (on.has('drive')) {
    chassis.resetForces(true);
    chassis.resetTorques(true);
  }
  if (on.has('zero')) {
    for (const body of robot) {
      body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }
  }
  if (on.has('fingersOff') || on.has('gripIters0')) {
    const carriage = robot.find((body) => body.numColliders() === 2)!;
    const R = getRapier();
    const motorVel = R.RevoluteImpulseJoint.prototype.configureMotorVelocity;
    physics.impulseJoints.forEach((joint) => {
      if (on.has('fingersOff') && joint.body1().handle === carriage.handle && joint.body2().numColliders() === 1) {
        (joint as unknown as { setMotorMaxForce(f: number): void }).setMotorMaxForce(0);
        motorVel.call(joint as never, 0, 0);
      }
    });
    if (on.has('gripIters0')) for (const body of robot) if (body.handle !== chassis.handle) { body.setAdditionalSolverIterations(0); body.setAdditionalPgsIterations(0); }
  }
  if (on.has('noLock')) {
    const locks: unknown[] = [];
    physics.impulseJoints.forEach((joint) => {
      if (joint.type() === getRapier().JointType.Generic) locks.push(joint);
    });
    for (const lock of locks) physics.removeImpulseJoint(lock as never, true);
  }
  if (on.has('liftLimit')) {
    // The boom held by its joint's limits at the angle it is at (as at lift 0° and 90°), the motor off.
    physics.impulseJoints.forEach((joint) => {
      if (joint.body1().handle === chassis.handle && joint.type() === getRapier().JointType.Revolute && joint.body2().numColliders() === 3) {
        const j = joint as unknown as { setLimits(a: number, b: number): void; setMotorMaxForce(f: number): void };
        const q1 = joint.body1().rotation();
        const q2 = joint.body2().rotation();
        // relative twist about z
        const rz = q1.w * q2.z - q1.z * q2.w + q1.x * q2.y - q1.y * q2.x;
        const rw = q1.w * q2.w + q1.x * q2.x + q1.y * q2.y + q1.z * q2.z;
        const angle = 2 * Math.atan2(rz, rw);
        j.setLimits(angle, angle);
        j.setMotorMaxForce(0);
      }
    });
  }
  if (on.has('objectsWeightless')) for (const body of others) body.setGravityScale(0, false);
  if (on.has('fingersStill')) {
    // The fingers' motors told to stand still (speed 0), and the per-tick aims (the grasp's trim) no longer reach them.
    const carriage = robot.find((body) => body.numColliders() === 2)!;
    physics.impulseJoints.forEach((joint) => {
      if (joint.body1().handle !== carriage.handle || joint.type() !== getRapier().JointType.Revolute) return;
      const j = joint as unknown as { handle: number; configureMotorVelocity(v: number, f: number): void };
      j.configureMotorVelocity(0, 1);
      blocked.add(j.handle);
    });
  }
  if (on.has('liftLimitMotorOn')) {
    physics.impulseJoints.forEach((joint) => {
      if (joint.body1().handle === chassis.handle && joint.type() === getRapier().JointType.Revolute && joint.body2().numColliders() === 3) {
        const j = joint as unknown as { setLimits(a: number, b: number): void };
        const q1 = joint.body1().rotation();
        const q2 = joint.body2().rotation();
        const rz = q1.w * q2.z - q1.z * q2.w + q1.x * q2.y - q1.y * q2.x;
        const rw = q1.w * q2.w + q1.x * q2.x + q1.y * q2.y + q1.z * q2.z;
        const angle = 2 * Math.atan2(rz, rw);
        j.setLimits(angle, angle);
      }
    });
  }
  if (on.has('liftPos') || on.has('liftZeroVel')) {
    physics.impulseJoints.forEach((joint) => {
      if (joint.body1().handle === chassis.handle && joint.type() === getRapier().JointType.Revolute && joint.body2().numColliders() === 3) {
        const j = joint as unknown as { handle: number; configureMotorPosition(t: number, k: number, d: number): void; configureMotorVelocity(v: number, f: number): void };
        const q1 = joint.body1().rotation();
        const q2 = joint.body2().rotation();
        const rz = q1.w * q2.z - q1.z * q2.w + q1.x * q2.y - q1.y * q2.x;
        const rw = q1.w * q2.w + q1.x * q2.x + q1.y * q2.y + q1.z * q2.z;
        const angle = 2 * Math.atan2(rz, rw);
        if (on.has('liftPos')) j.configureMotorPosition(angle, Number(process.env.LIFT_K ?? 200), Number(process.env.LIFT_D ?? 1));
        else j.configureMotorVelocity(0, 1);
        blocked.add(j.handle);
      }
    });
  }
  const iterations = physics.numSolverIterations;
  const pgs = physics.numInternalPgsIterations;
  if (on.has('iter8')) physics.numSolverIterations = 8;
  if (on.has('iter16')) physics.numSolverIterations = 16;
  if (on.has('pgs4')) physics.numInternalPgsIterations = 4;
  if (on.has('objects')) {
    others.forEach((body, i) => {
      const p = body.translation();
      body.setTranslation({ x: p.x > 0.5 ? 0.15 + 0.1 * i : 1.5 + 0.1 * i, y: p.y < 0.05 ? p.y : 0.03, z: p.z }, true);
      body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    });
  }
  const joints0 = jointErrors(physics);
  /** The boom joint's limits (equal: the lift holds, B7), at the window's start and end. */
  const boomLimits = () => {
    let limits: [number, number] | null = null;
    physics.impulseJoints.forEach((joint) => {
      if (joint.body1().handle === chassis.handle && joint.type() === getRapier().JointType.Revolute && joint.body2().numColliders() === 3) {
        const j = joint as unknown as { limitsMin(): number; limitsMax(): number };
        limits = [j.limitsMin(), j.limitsMax()];
      }
    });
    return limits as [number, number] | null;
  };
  const boomLimits0 = boomLimits();
  const q0 = chassis.rotation();
  const p0 = chassis.translation();
  const w0 = session.getSnapshot().world!.robot.wheelRad;
  let maxYaw = 0;
  let maxSpeed = 0;
  const ticks = Math.round(windowS * 120);
  const start = session.getSnapshot().world!.t;
  for (let k = 1; k <= ticks; k++) {
    await session.runUntil(start + k / 120);
    maxYaw = Math.max(maxYaw, Math.abs(chassis.angvel().y));
    const v = chassis.linvel();
    maxSpeed = Math.max(maxSpeed, Math.hypot(v.x, v.z));
  }
  const q1 = chassis.rotation();
  const p1 = chassis.translation();
  const snap = session.getSnapshot().world!;
  const w1 = snap.robot.wheelRad;
  let dyaw = yawOf(q1) - yawOf(q0);
  if (dyaw > Math.PI) dyaw -= 2 * Math.PI;
  if (dyaw < -Math.PI) dyaw += 2 * Math.PI;
  let sleeping = 0;
  physics.forEachRigidBody((body) => {
    if (body.isDynamic() && body.isSleeping()) sleeping += 1;
  });
  const result: RestResult = {
    key: c.key,
    which,
    variant: c.variant ?? 0,
    removals,
    finishedAtS,
    windowFromS: start,
    windowS,
    yawRateDegS: (dyaw * 180) / Math.PI / windowS,
    driftCmS: (Math.hypot(p1.x - p0.x, p1.z - p0.z) * 100) / windowS,
    maxYawRateDegS: (maxYaw * 180) / Math.PI,
    maxSpeedCmS: maxSpeed * 100,
    wheelRadRate: [(w1[0] - w0[0]) / windowS, (w1[1] - w0[1]) / windowS],
    gripper: snap.robot.gripper ?? null,
    touching,
    objectContacts,
    sleeping,
    joints0,
    joints1: jointErrors(physics),
    boomLimits0,
    boomLimits1: boomLimits(),
    pose0: { p: { x: p0.x, y: p0.y, z: p0.z }, q: { x: q0.x, y: q0.y, z: q0.z, w: q0.w } },
  };
  on.clear();
  blocked.clear();
  physics.numSolverIterations = iterations;
  physics.numInternalPgsIterations = pgs;
  session.stop();
  return result;
}

/** Each impulse joint of the world: its bodies' handles, type, and how far apart its two anchors are in the world, m. */
export function jointErrors(physics: PhysicsWorld): { b1: number; b2: number; type: number; sepM: number }[] {
  const out: { b1: number; b2: number; type: number; sepM: number }[] = [];
  physics.impulseJoints.forEach((joint) => {
    const b1 = joint.body1();
    const b2 = joint.body2();
    const at = (body: RigidBody, local: { x: number; y: number; z: number }) => {
      const p = body.translation();
      const q = body.rotation();
      // rotate local by q
      const ix = q.w * local.x + q.y * local.z - q.z * local.y;
      const iy = q.w * local.y + q.z * local.x - q.x * local.z;
      const iz = q.w * local.z + q.x * local.y - q.y * local.x;
      const iw = -q.x * local.x - q.y * local.y - q.z * local.z;
      return {
        x: p.x + ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y,
        y: p.y + iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z,
        z: p.z + iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x,
      };
    };
    const a1 = at(b1, joint.anchor1());
    const a2 = at(b2, joint.anchor2());
    out.push({ b1: b1.handle, b2: b2.handle, type: joint.type(), sepM: Math.hypot(a1.x - a2.x, a1.y - a2.y, a1.z - a2.z) });
  });
  return out;
}

/** The chassis' ball colliders' contacts with fixed colliders this step: friction, impulses, points. */
export function ballContacts(physics: PhysicsWorld, chassis: RigidBody) {
  const R = getRapier();
  const out: Record<string, unknown>[] = [];
  for (let i = 0; i < chassis.numColliders(); i++) {
    const c = chassis.collider(i);
    if (c.shape.type !== R.ShapeType.Ball) continue;
    physics.contactPairsWith(c, (other) => {
      if (other.parent() !== null && other.parent()!.isDynamic()) return;
      physics.contactPair(c, other, (m, flipped) => {
        const pts = [];
        for (let k = 0; k < m.numContacts(); k++) {
          pts.push({ dist: m.contactDist(k), n: m.contactImpulse(k), tx: m.contactTangentImpulseX(k), ty: m.contactTangentImpulseY(k), p1: m.localContactPoint1(k), fid1: m.contactFid1(k), fid2: m.contactFid2(k) });
        }
        out.push({ ball: i, r: c.radius(), friction: m.friction(), colliderFriction: c.friction(), flipped, normal: m.normal(), solver: m.numSolverContacts(), tv: m.numSolverContacts() > 0 ? m.solverContactTangentVelocity(0) : null, pts });
      });
    });
  }
  return out;
}

/** The boom joint (chassis → boom) held by its limits at the angle it is at, its motor off (`liftLimit`); returns a function that undoes it. */
export function holdLiftByLimits(physics: PhysicsWorld, chassis: RigidBody, boom: RigidBody): () => void {
  let undo = () => {};
  physics.impulseJoints.forEach((joint) => {
    if (joint.body1().handle !== chassis.handle || joint.body2().handle !== boom.handle) return;
    const j = joint as unknown as { handle: number; limitsMin(): number; limitsMax(): number; setLimits(a: number, b: number): void; setMotorMaxForce(f: number): void };
    const q1 = joint.body1().rotation();
    const q2 = joint.body2().rotation();
    const rz = q1.w * q2.z - q1.z * q2.w + q1.x * q2.y - q1.y * q2.x;
    const rw = q1.w * q2.w + q1.x * q2.x + q1.y * q2.y + q1.z * q2.z;
    const angle = 2 * Math.atan2(rz, rw);
    const [min, max] = [j.limitsMin(), j.limitsMax()];
    j.setLimits(angle, angle);
    j.setMotorMaxForce(0);
    undo = () => j.setLimits(min, max);
  });
  return undo;
}
