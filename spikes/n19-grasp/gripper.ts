// N19 G0.1 grasp spike: the 2-DOF gripper on the robot car (plan §4.4 "Lắp ráp"), with the variants the spike measured.
//
// Bodies (all dynamic, no sleeping, extra PGS/solver iterations (`tuning`; §4.4 says +4 PGS), collision group GRIPPER_GROUP):
// - boom: revolute about the robot's lateral axis (kit y, Rapier local Z) at the GR1 mount; two side plates outside the body and a
//   cross bar at the tip. Its velocity motor (≤ liftStallTorqueNm) follows a ServoLaw: 'servo' is servo-arm.ts's law; 'servo-brake'
//   adds a braking-distance limit. Optional reflected rotor inertia (`tuning.boomRotorInertia`, PLACEHOLDER).
// - carriage: revolute about the same axis at the boom tip, kept level (D-G6) by a LinkMode: 'hold-motor' (§4.4: a motor on that
//   revolute, LINK_HOLD_NM, the boom's speed fed forward) or 'chassis-lock' (a generic joint chassis↔carriage locking AngZ: what a
//   parallelogram does kinematically).
// - two fingers: revolute about the carriage's vertical at (0.5, ±2.2) cm, mirrored, β = fingerOpenDeg − 0.445·θ in [−23.6°, 12°].
//   One claw servo drives both through gears: each finger's motor follows the servo law with β's rate (0.445 × 600°/s) and half the
//   servo's torque through the gear ratio (T_s / (2·0.445)). grasp.ts freezes them on a held object and stalls the claw on a pinch.
//   Solid colliders or sensors (FingerMode: the D-G5 fallback).
//
// Angles are read from body rotations with dmath atan2 (no Math trig in the tick, ADR 0001 §4.6, D-R12). Rotations at build time use
// dmath sin/cos (units.ts yawToQuaternion and rotZ below). The braking law's √ is Math.sqrt (exact, IEEE 754).

import { atan2, cos, sin } from '../../src/core/world/dmath';
import { getRapier, type Collider, type PhysicsWorld, type RapierModule, type RigidBody } from '../../src/core/world/rapier';
import { conjugate, localToWorld, multiplyQuaternions, robotPointToLocal } from '../../src/core/world/robot/robot-frame';
import { SERVO_MOTOR_GAIN } from '../../src/core/world/robot/servo-arm';
import { cmToM, degToRad, gToKg, radToDeg, yawToQuaternion, type Quat, type Vec3 } from '../../src/core/world/units';
import {
  BOOM_BAR_HALF_CM,
  BOOM_ELEVATION_AT_LIFT0_DEG,
  BOOM_PLATE_HALF_CM,
  CARRIAGE_HALF_CM,
  FINGER_HINGE_U_CM,
  FINGER_HINGE_V_CM,
  FINGER_THICKNESS_CM,
  FINGER_TORQUE_NM,
  GRIPPER_EXTRA_PGS_ITERATIONS,
  GRIPPER_GROUP,
  GRIPPER_MOUNT_CM,
  GRIPPER_SPEC,
  JAW_HEIGHT_CM,
  LINK_HOLD_NM,
} from './params';

type RevoluteJoint = InstanceType<RapierModule['RevoluteImpulseJoint']>;

/** The link motor's speed limit, rad/s (well above the lift's 10.5: only a limit for the solver). */
const LINK_MAX_RAD_S = 40;

/** Gripper colliders: member of GRIPPER_GROUP only; interact with every group but their own. */
export const GRIPPER_COLLISION_GROUPS = ((GRIPPER_GROUP << 16) | (0xffff & ~GRIPPER_GROUP)) >>> 0;
/** Gripper colliders' solver groups: member of GRIPPER_GROUP only, so an object can opt out of solving contacts with them. */
export const GRIPPER_SOLVER_GROUPS = ((GRIPPER_GROUP << 16) | 0xffff) >>> 0;
/** Rapier's default groups (every bit). */
export const DEFAULT_GROUPS = 0xffffffff;
/** A held object's solver groups: every group but GRIPPER_GROUP's contacts are solved. */
export const HELD_SOLVER_GROUPS = ((0xffff << 16) | (0xffff & ~GRIPPER_GROUP)) >>> 0;

export type FingerMode = 'collider' | 'sensor';
/**
 * How the lift (and the 'hold-motor' link) aim:
 * - 'servo': servo-arm.ts's law exactly, the speed that closes the error in one tick (≤ 60°/sPer60Deg). It starts braking only
 *   within one tick of the target, so a loaded joint whose stall torque cannot stop it in a tick overshoots; and against a steady
 *   load τ (gravity) it leaves an error of τ·dt²/I.
 * - 'servo-brake': also no faster than √(2·a·|e|), so the joint can stop at the target with deceleration a = (stall − worst gravity)
 *   / worst inertia (the gripper with maxPayloadG held, boom level): LIFT_DECEL_RAD_S2.
 * - 'servo-brake-i': 'servo-brake' plus an integral bias (gain SERVO_I_GAIN, only within SERVO_I_WINDOW_DEG of the target, held
 *   within ±SERVO_I_MAX_DEG) that removes the steady error.
 * The fingers always use 'servo' (no gravity about their axis; their inertia is tiny).
 */
export type ServoLaw = 'servo' | 'servo-brake' | 'servo-brake-i';
export const SERVO_I_GAIN = 0.5;
export const SERVO_I_WINDOW_DEG = 2;
export const SERVO_I_MAX_DEG = 5;
/**
 * How the carriage is kept level (D-G6): 'hold-motor' is §4.4's (a velocity motor on the boom↔carriage revolute, LINK_HOLD_NM,
 * aiming at link angle = −elevation). 'chassis-lock' is what a parallelogram does kinematically: a generic joint chassis↔carriage
 * that locks their relative rotation about the lift axis (AngZ), linear axes free; the boom↔carriage revolute has no motor.
 */
export type LinkMode = 'hold-motor' | 'chassis-lock';

export type GripperOptions = {
  /** Finger colliders: solid ('collider') or sensors ('sensor', the D-G5 fallback). */
  readonly fingers: FingerMode;
  /** Finger friction against what they touch (only matters before an attach): spike variable. */
  readonly fingerFriction: number;
  readonly law: ServoLaw;
  readonly link: LinkMode;
  /** Exploration overrides: motor gain (GAIN), extra PGS / solver iterations per gripper body. */
  readonly tuning?: { readonly gain?: number; readonly extraPgs?: number; readonly extraSolver?: number; readonly boomRotorInertia?: number; readonly boomMassG?: number; readonly decelFactor?: number };
  /** The servo angles the gripper is built at (setup() writes claw 0°, lift 90°: D-G3). */
  readonly clawDeg?: number;
  readonly liftDeg?: number;
};

export type Finger = {
  readonly side: 1 | -1; // +1 left (v > 0), −1 right
  readonly body: RigidBody;
  readonly collider: Collider;
  readonly joint: RevoluteJoint;
  /** β, degrees: 12 open, −23.6 jaws meet; positive turns the finger outwards. */
  betaDeg(): number;
};

export type Gripper = {
  readonly boom: RigidBody;
  readonly carriage: RigidBody;
  readonly fingers: readonly [Finger, Finger];
  /** Every gripper body, in hash order: boom, carriage, left finger, right finger. */
  readonly bodies: readonly RigidBody[];
  readonly colliders: readonly Collider[];
  ownsCollider(collider: Collider): boolean;
  /** Servo commands, degrees 0..90 (clamped, D-G3). */
  setLift(deg: number): void;
  setClaw(deg: number): void;
  readonly liftCommandDeg: number;
  readonly clawCommandDeg: number;
  /** The lift servo's angle, from the boom's rotation on the chassis. */
  liftDeg(): number;
  /** The claw servo's angle, from the mean finger β. */
  clawDeg(): number;
  /** The carriage's pitch relative to the chassis (0 = level), degrees. */
  carriageLevelErrorDeg(): number;
  /** Freezes each finger's target at a β (attach) or lets it follow the claw command again (null). */
  freezeFingers(betaDeg: readonly [number, number] | null): void;
  /**
   * The servo stalls on what a finger touches: each finger is driven no further closed than its β limit (null: no limit). grasp.ts
   * sets it every tick from the fingers' contacts, so a claw closing on an object it does not hold (too heavy, after a break) stops at
   * the object's faces instead of crushing into it.
   */
  stallFingers(limitDeg: readonly [number | null, number | null]): void;
  /** Before world.step(): the motors' speeds for this tick. */
  beforeStep(dt: number): void;
  /** The lift motor's speed asked on the last beforeStep, rad/s (exploration). */
  readonly liftSpeedAsked: number;
};

/** Rotation by `rad` about local +Z (raises +X towards +Y). */
function rotZ(rad: number): Quat {
  return { x: 0, y: 0, z: sin(rad / 2), w: cos(rad / 2) };
}

/** Twist angle (rad, (−π, π]) of `relative` about the unit axis `axis` ('y' or 'z'), via dmath atan2. */
function twist(relative: Quat, axis: 'y' | 'z'): number {
  const sign = relative.w < 0 ? -1 : 1;
  return 2 * atan2(sign * relative[axis], sign * relative.w);
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** The aim of one motor under a law (see ServoLaw): error (rad) → speed (rad/s), at most `max`, plus a feed-forward speed. */
function createAim(law: ServoLaw, decel: number) {
  let bias = 0;
  const window = degToRad(SERVO_I_WINDOW_DEG);
  const most = degToRad(SERVO_I_MAX_DEG);
  return {
    speed(error: number, dt: number, max: number, feedForward = 0): number {
      if (law === 'servo-brake-i' && Math.abs(error) < window) bias = clamp(bias + SERVO_I_GAIN * error, -most, most);
      const aim = error + (law === 'servo-brake-i' ? bias : 0);
      let limit = max;
      if (law !== 'servo' && Number.isFinite(decel)) limit = Math.min(max, Math.sqrt(2 * decel * Math.abs(aim)));
      return feedForward + clamp(aim / dt, -limit, limit);
    },
  };
}

/**
 * The lift's braking deceleration for 'servo-brake' (rad/s²): stall torque less the worst gravity torque, over the worst inertia
 * about the pivot (boom level, maxPayloadG held at the carriage u 3 cm). Inertias are the colliders' (cuboids, setMass).
 */
export function liftDecelRadS2(rotorInertia = 0, boomMassG: number = GRIPPER_SPEC.boomMassG): number {
  const s = { ...GRIPPER_SPEC, boomMassG };
  const L = cmToM(s.boomLengthCm);
  const g = 9.81;
  const boomKg = gToKg(s.boomMassG);
  const carriageKg = gToKg(s.carriageMassG);
  const fingerKg = gToKg(s.fingerMassG);
  const payloadKg = gToKg(s.maxPayloadG);
  const fingerR = L + cmToM(FINGER_HINGE_U_CM + s.fingerLengthCm / 2);
  const payloadR = L + 0.03;
  // Boom: plates and bar, about its own centre (measured from the engine: principalInertia().z = 2.22e-5) plus m·r² of its centre.
  const inertia = rotorInertia + 2.22e-5 + boomKg * (L * 2 / 3) * (L * 2 / 3) + carriageKg * L * L + 2 * fingerKg * fingerR * fingerR + payloadKg * payloadR * payloadR;
  const gravity = g * (boomKg * (L * 2 / 3) + carriageKg * L + 2 * fingerKg * fingerR + payloadKg * payloadR);
  return (s.liftStallTorqueNm - gravity) / inertia;
}

export function createGripper(world: PhysicsWorld, chassis: RigidBody, options: GripperOptions): Gripper {
  const R = getRapier();
  const spec = GRIPPER_SPEC;
  const liftMaxRadS = degToRad(60 / spec.liftSPer60Deg);
  const fingerMaxRadS = degToRad((60 / spec.clawSPer60Deg) * spec.fingerDegPerServoDeg);
  const betaMin = spec.fingerOpenDeg - spec.fingerDegPerServoDeg * spec.jawsMeetDeg; // −23.6
  const betaMax = spec.fingerOpenDeg;
  const boomM = cmToM(spec.boomLengthCm);
  const elevationOf = (liftDeg: number) => liftDeg + BOOM_ELEVATION_AT_LIFT0_DEG;
  const betaOf = (clawDeg: number) => clamp(spec.fingerOpenDeg - spec.fingerDegPerServoDeg * clawDeg, betaMin, betaMax);

  const GAIN = options.tuning?.gain ?? SERVO_MOTOR_GAIN;
  let liftCommand = options.liftDeg ?? 90;
  let clawCommand = options.clawDeg ?? 0;
  let frozen: readonly [number, number] | null = null;
  let stall: readonly [number | null, number | null] = [null, null];
  let liftSpeedAsked = 0;

  const pivot = robotPointToLocal([...GRIPPER_MOUNT_CM]);
  const chassisPos = chassis.translation();
  const chassisRot = chassis.rotation();
  const owned = new Set<number>();
  const groups = <T extends InstanceType<RapierModule['ColliderDesc']>>(desc: T): T =>
    desc.setCollisionGroups(GRIPPER_COLLISION_GROUPS).setSolverGroups(GRIPPER_SOLVER_GROUPS) as T;
  const dynamic = (position: Vec3, rotation: Quat) =>
    world.createRigidBody(
      R.RigidBodyDesc.dynamic()
        .setTranslation(position.x, position.y, position.z)
        .setRotation(rotation)
        .setCanSleep(false)
        .setAdditionalPgsIterations(options.tuning?.extraPgs ?? GRIPPER_EXTRA_PGS_ITERATIONS)
        .setAdditionalSolverIterations(options.tuning?.extraSolver ?? 0),
    );
  const attach = (desc: InstanceType<RapierModule['ColliderDesc']>, body: RigidBody) => {
    const collider = world.createCollider(groups(desc), body);
    owned.add(collider.handle);
    return collider;
  };

  // ---- boom ----
  const elevation0 = degToRad(elevationOf(liftCommand));
  const boomRot = multiplyQuaternions(chassisRot, rotZ(elevation0));
  const boomPos = localToWorld(chassisPos, chassisRot, pivot);
  const boom = dynamic(boomPos, boomRot);
  const plateHalf = BOOM_PLATE_HALF_CM.map(cmToM) as [number, number, number];
  const barHalf = BOOM_BAR_HALF_CM.map(cmToM) as [number, number, number];
  const boomMassG = options.tuning?.boomMassG ?? spec.boomMassG;
  const plateKg = gToKg(boomMassG) / 3;
  const colliders: Collider[] = [];
  for (const side of [1, -1]) {
    colliders.push(
      attach(
        R.ColliderDesc.cuboid(...plateHalf)
          .setTranslation(boomM / 2, 0, 0 - side * cmToM(spec.boomHalfSpanCm))
          .setMass(plateKg),
        boom,
      ),
    );
  }
  colliders.push(attach(R.ColliderDesc.cuboid(...barHalf).setTranslation(boomM, 0, 0).setMass(plateKg), boom));
  const boomJoint = world.createImpulseJoint(R.JointData.revolute(pivot, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }), chassis, boom, true) as RevoluteJoint;
  boomJoint.setContactsEnabled(false);
  boomJoint.setLimits(degToRad(elevationOf(0)), degToRad(elevationOf(90)));
  boomJoint.configureMotorModel(R.MotorModel.ForceBased);
  boomJoint.setMotorMaxForce(spec.liftStallTorqueNm);
  boomJoint.configureMotorVelocity(0, GAIN);

  // ---- carriage (level: same rotation as the chassis) ----
  const tipLocal = { x: boomM, y: 0, z: 0 };
  const carriagePos = localToWorld(boomPos, boomRot, tipLocal);
  const carriage = dynamic(carriagePos, chassisRot);
  const carriageHalf = CARRIAGE_HALF_CM.map(cmToM) as [number, number, number];
  colliders.push(attach(R.ColliderDesc.cuboid(...carriageHalf).setMass(gToKg(spec.carriageMassG)), carriage));
  const linkJoint = world.createImpulseJoint(R.JointData.revolute(tipLocal, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }), boom, carriage, true) as RevoluteJoint;
  linkJoint.setContactsEnabled(false);
  linkJoint.setLimits(degToRad(-elevationOf(90) - 10), degToRad(-elevationOf(0) + 10));
  if (options.link === 'hold-motor') {
    linkJoint.configureMotorModel(R.MotorModel.ForceBased);
    linkJoint.setMotorMaxForce(LINK_HOLD_NM);
    linkJoint.configureMotorVelocity(0, GAIN);
  } else {
    // Anchors do not matter for angular locks; the frames are the bodies' (axis = local X), aligned when level.
    const lock = world.createImpulseJoint(R.JointData.generic({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, R.JointAxesMask.AngZ), chassis, carriage, true);
    lock.setContactsEnabled(false);
  }

  // ---- fingers ----
  const fingerHalf = { x: cmToM(spec.fingerLengthCm) / 2, y: cmToM(JAW_HEIGHT_CM) / 2, z: cmToM(FINGER_THICKNESS_CM) / 2 };
  const makeFinger = (side: 1 | -1): Finger => {
    // Carriage frame (u, v, w) → Rapier local (x = u, y = w, z = −v).
    const hinge = { x: cmToM(FINGER_HINGE_U_CM), y: 0, z: 0 - side * cmToM(FINGER_HINGE_V_CM) };
    // Rotation about +Y by γ turns +X towards −Z (the left, +v): the left finger opens with γ = β, the right one with γ = −β.
    const gamma0 = degToRad(side * betaOf(clawCommand));
    const rot = multiplyQuaternions(chassisRot, yawToQuaternion(gamma0));
    const body = dynamic(localToWorld(carriagePos, chassisRot, hinge), rot);
    const desc = R.ColliderDesc.cuboid(fingerHalf.x, fingerHalf.y, fingerHalf.z)
      .setTranslation(fingerHalf.x, 0, 0)
      .setMass(gToKg(spec.fingerMassG))
      .setFriction(options.fingerFriction)
      .setFrictionCombineRule(R.CoefficientCombineRule.Min);
    if (options.fingers === 'sensor') desc.setSensor(true);
    const collider = attach(desc, body);
    colliders.push(collider);
    const joint = world.createImpulseJoint(R.JointData.revolute(hinge, { x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }), carriage, body, true) as RevoluteJoint;
    joint.setContactsEnabled(false);
    const lo = side === 1 ? betaMin : -betaMax;
    const hi = side === 1 ? betaMax : -betaMin;
    joint.setLimits(degToRad(lo), degToRad(hi));
    joint.configureMotorModel(R.MotorModel.ForceBased);
    joint.setMotorMaxForce(FINGER_TORQUE_NM);
    joint.configureMotorVelocity(0, GAIN);
    return {
      side,
      body,
      collider,
      joint,
      betaDeg: () => side * radToDeg(twist(multiplyQuaternions(conjugate(carriage.rotation()), body.rotation()), 'y')),
    };
  };
  const fingers = [makeFinger(1), makeFinger(-1)] as const;

  const rotorInertia = options.tuning?.boomRotorInertia ?? 0;
  if (rotorInertia > 0) {
    // The lift servo's rotor and gears, reflected to the output shaft: inertia about the boom's axis, no mass (the servo is on the chassis).
    boom.setAdditionalMassProperties(1e-9, { x: 0, y: 0, z: 0 }, { x: 1e-12, y: 1e-12, z: rotorInertia }, { x: 0, y: 0, z: 0, w: 1 }, true);
  }
  const liftAim = createAim(options.law, (options.tuning?.decelFactor ?? 1) * liftDecelRadS2(rotorInertia, boomMassG));
  const linkAim = createAim(options.law === 'servo' ? 'servo' : 'servo-brake-i', Number.POSITIVE_INFINITY);
  const elevationRad = () => twist(multiplyQuaternions(conjugate(chassis.rotation()), boom.rotation()), 'z');
  const linkRad = () => twist(multiplyQuaternions(conjugate(boom.rotation()), carriage.rotation()), 'z');

  return {
    boom,
    carriage,
    fingers,
    bodies: [boom, carriage, fingers[0].body, fingers[1].body],
    colliders,
    ownsCollider: (collider) => owned.has(collider.handle),
    setLift(deg) {
      liftCommand = clamp(deg, 0, 90);
    },
    setClaw(deg) {
      clawCommand = clamp(deg, 0, 90);
    },
    get liftCommandDeg() {
      return liftCommand;
    },
    get clawCommandDeg() {
      return clawCommand;
    },
    liftDeg: () => radToDeg(elevationRad()) - BOOM_ELEVATION_AT_LIFT0_DEG,
    clawDeg: () => (spec.fingerOpenDeg - (fingers[0].betaDeg() + fingers[1].betaDeg()) / 2) / spec.fingerDegPerServoDeg,
    carriageLevelErrorDeg: () => radToDeg(twist(multiplyQuaternions(conjugate(chassis.rotation()), carriage.rotation()), 'z')),
    freezeFingers(beta) {
      frozen = beta;
    },
    stallFingers(limits) {
      stall = limits;
    },
    get liftSpeedAsked() {
      return liftSpeedAsked;
    },
    beforeStep(dt) {
      const elevation = elevationRad();
      const boomSpeed = liftAim.speed(degToRad(elevationOf(liftCommand)) - elevation, dt, liftMaxRadS);
      liftSpeedAsked = boomSpeed;
      boomJoint.configureMotorVelocity(boomSpeed, GAIN);
      // Level: link angle = −elevation; feed the boom's commanded speed forward.
      if (options.link === 'hold-motor') {
        const linkSpeed = linkAim.speed(0 - elevation - linkRad(), dt, LINK_MAX_RAD_S, -boomSpeed);
        linkJoint.configureMotorVelocity(linkSpeed, GAIN);
      }
      const target = betaOf(clawCommand);
      fingers.forEach((finger, i) => {
        const limit = stall[i] ?? null;
        const aim = frozen !== null ? frozen[i]! : limit === null ? target : Math.max(target, limit);
        const speed = clamp(degToRad(aim - finger.betaDeg()) / dt, -fingerMaxRadS, fingerMaxRadS);
        finger.joint.configureMotorVelocity(finger.side * speed, GAIN);
      });
    },
  };
}
