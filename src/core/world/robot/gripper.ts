import { GRIPPER_START } from '../../hardware/drivers/gripper-servo2';
import type { ModuleSpecs } from '../../hardware/kit';
import type { KitMechanicalModule } from '../../hardware/kit-mechanics';
import { atan2, cos, sin } from '../dmath';
import { getRapier, type Collider, type ColliderDesc, type PhysicsWorld, type RapierModule, type RigidBody } from '../rapier';
import { cmToM, degToRad, gToKg, radToDeg, yawToQuaternion, type Quat, type Vec3 } from '../units';
import { BOOM_BAR_HALF_CM, BOOM_PLATE_HALF_CM, CARRIAGE_HALF_CM } from './gripper-geometry';
import { conjugate, IDENTITY_ROTATION, localToWorld, multiplyQuaternions, robotPointToLocal } from './robot-frame';
import { SERVO_MOTOR_GAIN } from './servo-arm';

// The 2-DOF gripper of a kit's `gripper` module (N19 B1, plan §4.4 with §4.6 and §4.7; ADR 0004 §2, §5.2, measured by the G0.1 spike in
// spikes/n19-grasp/gripper.ts), as dynamic bodies on the chassis. Built only for a kit that has one (assembly.ts): a rover world never
// sees any of this.
//
// Bodies (in this order, the order a hash reads them): boom, carriage, left finger, right finger. All dynamic, never asleep, each asking
// +8 PGS and +4 solver iterations for its island (the car and what it touches): PGS converges badly through a light link (chassis 426 g →
// boom 6 g → carriage 22 g, plus up to 50 g held), and these numbers keep the carriage within 0.23° of level holding 50 g (ADR 0004 §4.1).
// Every gripper collider is a member of GRIPPER_GROUP only, for collisions (the gripper's parts never collide with each other) and for the
// solver (so a held object can leave the gripper's contacts out of the solver, grasp.ts).
//   - Boom: a revolute joint about the robot's lateral axis (Rapier local Z) at the mount, two side plates outside the body (y = ±
//     boomHalfSpanCm) and a cross bar at the tip. The lift servo drives it: a velocity motor of at most `liftStallTorqueNm`, aimed by the
//     braking servo law (`liftSpeed`). The servo's rotor and gears, reflected to the output shaft, add `liftRotorInertiaKgM2` about the
//     boom's axis (no mass: the servo sits on the chassis).
//   - Carriage: a revolute joint without a motor at the boom's tip, kept level by an AngZ lock chassis↔carriage (`JointData.generic`, the
//     linear axes free): what a parallelogram link does. The hold motor of plan §4.4 (`LINK_HOLD_NM`) let the carriage fold 9.8° and drop
//     50 g (ADR 0004 §4.1), so there is none.
//   - Fingers: revolute joints about the carriage's vertical at (u, ±v) = (fingerHingeUCm, ±fingerHingeVCm), mirrored. Finger angle β
//     (out from straight ahead, positive opening) = fingerOpenDeg − fingerDegPerServoDeg·θ for claw angle θ, held within
//     [fingerOpenDeg − fingerDegPerServoDeg·jawsMeetDeg, fingerOpenDeg] (ref-uno-gripper@0: β = 12 − 0.445·θ in [−23.6°, 12°]). One claw
//     servo drives both through gears: each finger's motor follows servo-arm.ts's law at β's rate and pushes with half the servo's torque
//     through the gear ratio (`fingerTorqueNm`). Solid colliders with no friction (§4.6): an attached joint holds an object, not friction;
//     `jawFriction` is only the grasp's slip threshold. The grasp machine (grasp.ts) freezes the fingers on a held object and stalls the
//     claw on an object pinched across it.
//   - The claw servo's case (B5, ruling E67 I4): a second collider on the carriage, the kit's `clawServo*` box that the 3D view draws, so
//     the visual is the collider; massless (the carriage's mass counts it). The ultrasonic hears it where it is raised in front of the
//     HC-SR04 (lift 8–40° on ref-uno-gripper@0).
//
// Frames: the carriage frame of kit.ts `GripperSpec` (u forward, v left, w up, cm, from the boom's tip; the chassis' axes while level) is
// Rapier local (x = u, y = w, z = −v) of the carriage body. The lift angle 0..90° turns the boom's elevation from boomElevationAtLift0Deg up
// by as much.
//
// Determinism (ADR 0001 §4.6): angles come from the bodies' rotations through dmath's atan2; build-time rotations use dmath's sin and cos;
// the braking law's square root is Math.sqrt (correctly rounded).

/** The gripper's collision and solver group (plan §4.4). */
export const GRIPPER_GROUP = 0x0004;
/** A gripper collider's collision groups: member of GRIPPER_GROUP only, colliding with every group but its own. */
export const GRIPPER_COLLISION_GROUPS = ((GRIPPER_GROUP << 16) | (0xffff & ~GRIPPER_GROUP)) >>> 0;
/** A gripper collider's solver groups: member of GRIPPER_GROUP only, so an object can leave the gripper out of its solved contacts. */
export const GRIPPER_SOLVER_GROUPS = ((GRIPPER_GROUP << 16) | 0xffff) >>> 0;
/** Extra internal PGS iterations each gripper body asks for its island (§4.6). */
export const GRIPPER_EXTRA_PGS_ITERATIONS = 8;
/** Extra solver iterations each gripper body asks for its island (§4.6). E9 drops them if the school-PC budget needs it (0.91° held). */
export const GRIPPER_EXTRA_SOLVER_ITERATIONS = 4;
/**
 * The deceleration the lift servo's braking law plans for, rad/s² (plan §4.6, ADR 0004 §5.2, §10b): half of (stall torque − worst gravity
 * torque) / worst inertia, boom level and maxPayloadG held at carriage u 3 cm, the reflected rotor inertia included, for ref-uno-gripper@0's
 * PLACEHOLDER numbers: the 125.235 the G0.1 spike ran with (spikes/n19-grasp/gripper.ts `liftDecelRadS2(5e-5) / 2`), rounded. ADR 0004 §5.2
 * wrote 139.4, the same half without the rotor. With 125.2 ADR 0004 §4.1's chosen row comes back (0→90° in 22 ticks, 0.045° past 90→40);
 * with 139.4, 21 ticks and 0.069°, and holding 50 g 1.67° past a lift move against 1.09°. A vendor's arm derives its own (VG).
 */
export const LIFT_BRAKE_DECEL_RAD_S2 = 125.2;
/** The servo angles the gripper is built at: what setup() writes (D-G3), which the driver owns (drivers/gripper-servo2.ts): claw open, lift up. */
export { GRIPPER_START };
/** The geometry the kit does not name: the carriage box, the boom's plates and cross bar (gripper-geometry.ts, which footprint.ts reads too). */
export { BOOM_BAR_HALF_CM, BOOM_PLATE_HALF_CM, CARRIAGE_HALF_CM };
/** The boom↔carriage hinge may turn this far past the lift's range, degrees: a margin only, the AngZ lock holds the carriage level. */
const LINK_LIMIT_MARGIN_DEG = 10;
/** The reflected rotor inertia is set on the boom as additional mass properties with this (negligible) mass, kg. */
const ROTOR_MASS_KG = 1e-9;
/** ...and this (negligible) inertia about the two other axes, kg·m². */
const ROTOR_OFF_AXIS_INERTIA = 1e-12;

type RevoluteJoint = InstanceType<RapierModule['RevoluteImpulseJoint']>;
type GripperSpec = ModuleSpecs['gripper'];

/** The gripper's servo targets, degrees (0..90, clamped); a field left out holds its last target. */
export type GripperTargets = { readonly clawDeg?: number; readonly liftDeg?: number };

export type GripperFinger = {
  /** +1 the left finger (v > 0), −1 the right one. */
  readonly side: 1 | -1;
  readonly body: RigidBody;
  readonly collider: Collider;
  readonly joint: RevoluteJoint;
  /** β, degrees: fingerOpenDeg open … the jaws' meeting angle; positive opens. */
  betaDeg(): number;
};

export type Gripper = {
  readonly spec: GripperSpec;
  readonly boom: RigidBody;
  readonly carriage: RigidBody;
  readonly fingers: readonly [GripperFinger, GripperFinger];
  /** The gripper's bodies in hash order: boom, carriage, left finger, right finger. */
  readonly bodies: readonly RigidBody[];
  readonly colliders: readonly Collider[];
  ownsCollider(collider: Collider): boolean;
  /** Takes new servo targets, each clamped to 0..90 (the caller has checked them: assembly.ts `applyActuators`). */
  setTargets(targets: GripperTargets): void;
  readonly clawCommandDeg: number;
  readonly liftCommandDeg: number;
  /** The lift servo's angle, from the boom's rotation on the chassis, degrees. */
  liftDeg(): number;
  /** The claw servo's angle, from the fingers' mean β, degrees. */
  clawDeg(): number;
  /** The carriage's pitch on the chassis about the lift axis, degrees (0 = level). */
  carriageLevelErrorDeg(): number;
  /** Holds each finger's target at a β (grasp.ts, on a held object), or lets the fingers follow the claw command again (null). */
  freezeFingers(betaDeg: readonly [number, number] | null): void;
  /** Drives each finger no further closed than a β (null: no limit): the claw stalls on an object pinched across it (grasp.ts). */
  stallFingers(limitDeg: readonly [number | null, number | null]): void;
  /** Before world.step(): the motors' speeds for this tick. */
  beforeStep(dt: number): void;
  /** Where the arm is on the chassis (read before the chassis is moved by hand, `followChassis`). */
  pose(): GripperPose;
  /** After the chassis was put at a new pose by hand: puts every gripper body back on it at `pose`, at rest (assembly.ts `placeAt`). */
  followChassis(pose: GripperPose): void;
};

/** The arm's joint angles on the chassis: the boom's elevation and each finger's β, radians. */
export type GripperPose = { readonly elevationRad: number; readonly betaRad: readonly [number, number] };

/** One claw servo drives both fingers through gears: the torque each finger gets, N·m (T_s / (2 · fingerDegPerServoDeg)). */
export function fingerTorqueNm(spec: GripperSpec): number {
  return spec.clawStallTorqueNm / (2 * spec.fingerDegPerServoDeg);
}

/** β of claw angle θ, degrees: fingerOpenDeg − fingerDegPerServoDeg·θ, within [the jaws' meeting β, fingerOpenDeg]. */
export function betaOfClawDeg(spec: GripperSpec, clawDeg: number): number {
  const closed = spec.fingerOpenDeg - spec.fingerDegPerServoDeg * spec.jawsMeetDeg;
  return clamp(spec.fingerOpenDeg - spec.fingerDegPerServoDeg * clawDeg, closed, spec.fingerOpenDeg);
}

/** A finger's inner face at carriage u (cm), as its distance |v| from the centre line, cm, the finger at β degrees (dmath). */
export function innerFaceVCm(spec: GripperSpec, betaDeg: number, uCm: number): number {
  const b = degToRad(betaDeg);
  const c = cos(b);
  const s = sin(b);
  const halfThickness = spec.fingerThicknessCm / 2;
  const along = (uCm - spec.fingerHingeUCm - halfThickness * s) / c;
  return spec.fingerHingeVCm + along * s - halfThickness * c;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Rotation by `rad` about local +Z (raises +X towards +Y), with dmath. */
function rotZ(rad: number): Quat {
  return { x: 0, y: 0, z: sin(rad / 2), w: cos(rad / 2) };
}

/** The twist angle (rad, (−π, π]) of `relative` about the unit axis local 'y' or 'z', via dmath atan2 (q and −q are one rotation). */
function twist(relative: Quat, axis: 'y' | 'z'): number {
  const sign = relative.w < 0 ? -1 : 1;
  return 2 * atan2(sign * relative[axis], sign * relative.w);
}

/**
 * The lift servo's braking law (§4.6): towards an error `error` (rad), the speed that closes it in one tick, no faster than `maxRadS` nor
 * than √(2·a·|e|), the speed from which the joint can still stop at the target decelerating at LIFT_BRAKE_DECEL_RAD_S2. servo-arm.ts's law
 * (one tick) alone starts braking a tick before the target, which 0.18 N·m cannot do with the boom loaded: 7.3–8.6° past it.
 */
function liftSpeed(error: number, dt: number, maxRadS: number): number {
  const limit = Math.min(maxRadS, Math.sqrt(2 * LIFT_BRAKE_DECEL_RAD_S2 * Math.abs(error)));
  return clamp(error / dt, 0 - limit, limit);
}

/** The kit's gripper on `chassis`, built at GRIPPER_START (what setup() writes). */
export function createGripper(world: PhysicsWorld, chassis: RigidBody, module: KitMechanicalModule<'gripper'>): Gripper {
  const R = getRapier();
  const { spec } = module;
  const liftMaxRadS = degToRad(60 / spec.liftSPer60Deg);
  const fingerMaxRadS = degToRad((60 / spec.clawSPer60Deg) * spec.fingerDegPerServoDeg);
  const betaMin = spec.fingerOpenDeg - spec.fingerDegPerServoDeg * spec.jawsMeetDeg;
  const betaMax = spec.fingerOpenDeg;
  const boomM = cmToM(spec.boomLengthCm);
  const elevationOf = (liftDeg: number) => liftDeg + spec.boomElevationAtLift0Deg;
  const fingerTorque = fingerTorqueNm(spec);

  let liftCommand = GRIPPER_START.liftDeg;
  let clawCommand = GRIPPER_START.clawDeg;
  let frozen: readonly [number, number] | null = null;
  let stall: readonly [number | null, number | null] = [null, null];

  const pivot = robotPointToLocal(module.mount.posCm);
  const owned = new Set<number>();
  const colliders: Collider[] = [];
  const dynamic = (position: Vec3, rotation: Quat) =>
    world.createRigidBody(
      R.RigidBodyDesc.dynamic()
        .setTranslation(position.x, position.y, position.z)
        .setRotation(rotation)
        .setCanSleep(false)
        .setAdditionalPgsIterations(GRIPPER_EXTRA_PGS_ITERATIONS)
        .setAdditionalSolverIterations(GRIPPER_EXTRA_SOLVER_ITERATIONS),
    );
  const attach = (desc: ColliderDesc, body: RigidBody): Collider => {
    const collider = world.createCollider(desc.setCollisionGroups(GRIPPER_COLLISION_GROUPS).setSolverGroups(GRIPPER_SOLVER_GROUPS), body);
    owned.add(collider.handle);
    colliders.push(collider);
    return collider;
  };

  // Where each body is on the chassis at a pose (also `followChassis`).
  const tipLocal: Vec3 = { x: boomM, y: 0, z: 0 };
  const hingeLocal = (side: 1 | -1): Vec3 => ({ x: cmToM(spec.fingerHingeUCm), y: 0, z: 0 - side * cmToM(spec.fingerHingeVCm) });
  const placement = (pose: GripperPose) => {
    const position = chassis.translation();
    const rotation = chassis.rotation();
    const boomRot = multiplyQuaternions(rotation, rotZ(pose.elevationRad));
    const boomPos = localToWorld(position, rotation, pivot);
    const carriagePos = localToWorld(boomPos, boomRot, tipLocal);
    // Rotation about +Y by γ turns +X towards −Z (the left, +v): the left finger opens with γ = β, the right one with γ = −β.
    const finger = (side: 1 | -1, betaRad: number) => ({
      position: localToWorld(carriagePos, rotation, hingeLocal(side)),
      rotation: multiplyQuaternions(rotation, yawToQuaternion(side * betaRad)),
    });
    return {
      boom: { position: boomPos, rotation: boomRot },
      carriage: { position: carriagePos, rotation },
      fingers: [finger(1, pose.betaRad[0]), finger(-1, pose.betaRad[1])] as const,
    };
  };
  const startBeta = degToRad(betaOfClawDeg(spec, clawCommand));
  const built = placement({ elevationRad: degToRad(elevationOf(liftCommand)), betaRad: [startBeta, startBeta] });

  // ---- boom ----
  const boom = dynamic(built.boom.position, built.boom.rotation);
  const plateKg = gToKg(spec.boomMassG) / 3;
  for (const side of [1, -1] as const) {
    attach(
      R.ColliderDesc.cuboid(boomM / 2, cmToM(BOOM_PLATE_HALF_CM.up), cmToM(BOOM_PLATE_HALF_CM.across))
        .setTranslation(boomM / 2, 0, 0 - side * cmToM(spec.boomHalfSpanCm))
        .setMass(plateKg),
      boom,
    );
  }
  const barHalf = cmToM(BOOM_BAR_HALF_CM);
  attach(R.ColliderDesc.cuboid(barHalf, barHalf, cmToM(spec.boomHalfSpanCm + BOOM_PLATE_HALF_CM.across)).setTranslation(boomM, 0, 0).setMass(plateKg), boom);
  const boomJoint = world.createImpulseJoint(R.JointData.revolute(pivot, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }), chassis, boom, true) as RevoluteJoint;
  boomJoint.setContactsEnabled(false);
  boomJoint.setLimits(degToRad(elevationOf(0)), degToRad(elevationOf(90)));
  boomJoint.configureMotorModel(R.MotorModel.ForceBased);
  boomJoint.setMotorMaxForce(spec.liftStallTorqueNm);
  boomJoint.configureMotorVelocity(0, SERVO_MOTOR_GAIN);

  // ---- carriage: level, the chassis' rotation ----
  const carriage = dynamic(built.carriage.position, built.carriage.rotation);
  attach(R.ColliderDesc.cuboid(cmToM(CARRIAGE_HALF_CM.u), cmToM(CARRIAGE_HALF_CM.w), cmToM(CARRIAGE_HALF_CM.v)).setMass(gToKg(spec.carriageMassG)), carriage);
  const linkJoint = world.createImpulseJoint(R.JointData.revolute(tipLocal, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }), boom, carriage, true) as RevoluteJoint;
  linkJoint.setContactsEnabled(false);
  linkJoint.setLimits(degToRad(0 - elevationOf(90) - LINK_LIMIT_MARGIN_DEG), degToRad(0 - elevationOf(0) + LINK_LIMIT_MARGIN_DEG));
  // The parallelogram: chassis and carriage keep their rotation about the lift axis (local Z); anchors do not matter for an angular lock.
  const lock = world.createImpulseJoint(R.JointData.generic({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, R.JointAxesMask.AngZ), chassis, carriage, true);
  lock.setContactsEnabled(false);

  // ---- fingers ----
  const fingerHalf = { x: cmToM(spec.fingerLengthCm) / 2, y: cmToM(spec.jawHeightCm) / 2, z: cmToM(spec.fingerThicknessCm) / 2 };
  const makeFinger = (side: 1 | -1, at: { position: Vec3; rotation: Quat }): GripperFinger => {
    const body = dynamic(at.position, at.rotation);
    const collider = attach(
      R.ColliderDesc.cuboid(fingerHalf.x, fingerHalf.y, fingerHalf.z)
        .setTranslation(fingerHalf.x, 0, 0)
        .setMass(gToKg(spec.fingerMassG))
        .setFriction(0)
        .setFrictionCombineRule(R.CoefficientCombineRule.Min),
      body,
    );
    const hinge = hingeLocal(side);
    const joint = world.createImpulseJoint(R.JointData.revolute(hinge, { x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }), carriage, body, true) as RevoluteJoint;
    joint.setContactsEnabled(false);
    joint.setLimits(degToRad(side === 1 ? betaMin : 0 - betaMax), degToRad(side === 1 ? betaMax : 0 - betaMin));
    joint.configureMotorModel(R.MotorModel.ForceBased);
    joint.setMotorMaxForce(fingerTorque);
    joint.configureMotorVelocity(0, SERVO_MOTOR_GAIN);
    return {
      side,
      body,
      collider,
      joint,
      betaDeg: () => side * radToDeg(twist(multiplyQuaternions(conjugate(carriage.rotation()), body.rotation()), 'y')),
    };
  };
  const fingers = [makeFinger(1, built.fingers[0]), makeFinger(-1, built.fingers[1])] as const;

  // ---- the claw servo's case on the carriage (B5, ruling E67 I4): the kit's box, the one the 3D view draws ----
  // The ultrasonic hears it (a servo raised in front of an HC-SR04 blocks it, at lift ~10–35°); the IR and the colour sensor leave the
  // carriage's colliders out, and it sits above their rays. Made after the fingers, so every other collider keeps the handle it had.
  // Massless: the carriage's mass already counts the servo. A density of 0 is not enough to leave the carriage as it was: Rapier adds every
  // collider's mass properties to its body's, and a sum with a massless part still rebuilds the inertia matrix and diagonalises it again
  // (measured: the carriage's principal axes came back permuted, its inertia off in the last bits, and the claw of a held cube 0.15° off).
  // Only mass properties that are exactly zero once moved by the collider's offset are skipped, so the case's are: no mass, no inertia, and
  // its (meaningless) centre of mass at the carriage's origin, the offset's opposite.
  const servoAt = { x: cmToM(spec.clawServoCenterUCm), y: cmToM(spec.clawServoCenterWCm), z: 0 - cmToM(spec.clawServoCenterVCm) };
  attach(
    R.ColliderDesc.cuboid(cmToM(spec.clawServoSizeUCm / 2), cmToM(spec.clawServoSizeWCm / 2), cmToM(spec.clawServoSizeVCm / 2))
      .setTranslation(servoAt.x, servoAt.y, servoAt.z)
      .setMassProperties(0, { x: 0 - servoAt.x, y: 0 - servoAt.y, z: 0 - servoAt.z }, { x: 0, y: 0, z: 0 }, IDENTITY_ROTATION),
    carriage,
  );

  if (spec.liftRotorInertiaKgM2 > 0) {
    boom.setAdditionalMassProperties(ROTOR_MASS_KG, { x: 0, y: 0, z: 0 }, { x: ROTOR_OFF_AXIS_INERTIA, y: ROTOR_OFF_AXIS_INERTIA, z: spec.liftRotorInertiaKgM2 }, IDENTITY_ROTATION, true);
  }

  const elevationRad = () => twist(multiplyQuaternions(conjugate(chassis.rotation()), boom.rotation()), 'z');
  const bodies = [boom, carriage, fingers[0].body, fingers[1].body] as const;

  return {
    spec,
    boom,
    carriage,
    fingers,
    bodies,
    colliders,
    ownsCollider: (collider) => owned.has(collider.handle),
    setTargets(targets) {
      if (targets.clawDeg !== undefined) clawCommand = clamp(targets.clawDeg, 0, 90);
      if (targets.liftDeg !== undefined) liftCommand = clamp(targets.liftDeg, 0, 90);
    },
    get clawCommandDeg() {
      return clawCommand;
    },
    get liftCommandDeg() {
      return liftCommand;
    },
    liftDeg: () => radToDeg(elevationRad()) - spec.boomElevationAtLift0Deg,
    clawDeg: () => (spec.fingerOpenDeg - (fingers[0].betaDeg() + fingers[1].betaDeg()) / 2) / spec.fingerDegPerServoDeg,
    carriageLevelErrorDeg: () => radToDeg(twist(multiplyQuaternions(conjugate(chassis.rotation()), carriage.rotation()), 'z')),
    freezeFingers(beta) {
      frozen = beta;
    },
    stallFingers(limits) {
      stall = limits;
    },
    beforeStep(dt) {
      boomJoint.configureMotorVelocity(liftSpeed(degToRad(elevationOf(liftCommand)) - elevationRad(), dt, liftMaxRadS), SERVO_MOTOR_GAIN);
      const target = betaOfClawDeg(spec, clawCommand);
      fingers.forEach((finger, i) => {
        const limit = stall[i] ?? null;
        const aim = frozen !== null ? frozen[i]! : limit === null ? target : Math.max(target, limit);
        const speed = clamp(degToRad(aim - finger.betaDeg()) / dt, 0 - fingerMaxRadS, fingerMaxRadS);
        finger.joint.configureMotorVelocity(finger.side * speed, SERVO_MOTOR_GAIN);
      });
    },
    pose: () => ({ elevationRad: elevationRad(), betaRad: [degToRad(fingers[0].betaDeg()), degToRad(fingers[1].betaDeg())] }),
    followChassis(pose) {
      const at = placement(pose);
      const put = (body: RigidBody, where: { position: Vec3; rotation: Quat }) => {
        body.setTranslation(where.position, true);
        body.setRotation(where.rotation, true);
        body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      };
      put(boom, at.boom);
      put(carriage, at.carriage);
      put(fingers[0].body, at.fingers[0]);
      put(fingers[1].body, at.fingers[1]);
    },
  };
}
