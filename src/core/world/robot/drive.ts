import { rotateVector, type Quat, type Vec3 } from '../units';
import { torqueRange, type DcMotorModel } from './dc-motor';

// The drive of a two-wheeled robot, model (c) of ADR 0001 §5.3: velocity-level diff-drive on a dynamic chassis.
//
// The chassis rests on supports the floor never pushes along (assembly.ts). Each tick, before the physics step, this
// computes the impulse that brings the chassis to the velocity its wheels aim at (assembly.ts applies it as a force over the
// step): forward speed
// v = (s_L + s_R)/2 and yaw rate ω = (s_R − s_L)/track, from each wheel's reference ground speed s = r·ω_ref. The impulse is
// split between the wheels, and each wheel's share is held
// - between 0 and the motor's torque line at the speed the wheel rolls at (dc-motor.ts, `torqueRange`), and
// - within its grip, μ·N·dt, N being the wheel's share of the robot's weight;
// a wheel off the floor gives nothing. A side impulse then cancels the slip of the axle sideways (the wheels do not skid),
// within the grip of the wheels on the floor. Collisions with walls and objects stay the physics engine's, and so does the
// gearbox's friction: assembly.ts gives each wheel's floor support the friction coefficient that makes T_f at the wheel, so
// it acts within the step, against the drive and against whatever pushes the robot (a pre-step impulse here could not hold
// a stopped robot against a push that acts during the step: measured 2.7 cm of creep in 2 s under 1 N).
//
// Directions are on the floor plane (world +Y up): the chassis' forward axis (its local +X) laid flat, and left = up ×
// forward. Positive yaw turns left. Only + − × ÷ and Math.sqrt/abs/min/max: no trig in the tick (D-R12, ADR 0001 §4.6).
// Not modelled: a centre of mass off the centre line (the impulses act at the centre of mass), wheel spin while a wheel
// skids, tyre rolling resistance beyond the gearbox's friction.

/** What the drive needs to know about the robot, in SI. */
export type DriveGeometry = {
  /** The mass the drive accelerates: the chassis body's, kg. */
  readonly massKg: number;
  /** The chassis' moment of inertia about the vertical through its centre of mass, kg·m². */
  readonly yawInertia: number;
  /** Half the track: the wheels are this far left and right of the axle's midpoint, m. */
  readonly halfTrackM: number;
  /** How far the centre of mass is ahead of the axle, m (negative when behind it). */
  readonly comAheadOfAxleM: number;
  /** The most force each tyre can push with before it skids, μ·N, N: [left, right]. */
  readonly gripForceN: readonly [number, number];
};

/** One wheel this tick: its motor, the motor's drive u, the speed the wheel aims at, and whether it touches the floor. */
export type WheelDrive = {
  readonly motor: DcMotorModel;
  readonly drive: number;
  readonly referenceRadS: number;
  readonly grounded: boolean;
};

/** The chassis' forward direction on the floor, a unit vector (x, z). Left is (fz, −fx). */
export type GroundFrame = { readonly fx: number; readonly fz: number };

export type DriveImpulse = {
  /** To apply at the centre of mass, N·s. Horizontal. */
  readonly linear: Vec3;
  /** About world +Y, N·m·s. */
  readonly yaw: number;
  /** The speed each wheel rolls at before the impulse (its contact point's forward speed / r), rad/s: [left, right]. */
  readonly wheelSpeedsRadS: readonly [number, number];
};

/** Below this, the forward axis is too steep to say which way the robot drives on the floor (about 84° nose up or down). */
const MIN_FLAT_FORWARD = 0.1;

/** The chassis' forward axis laid flat on the floor, or null when the chassis stands on its nose or tail. */
export function groundFrame(rotation: Quat): GroundFrame | null {
  const forward = rotateVector(rotation, { x: 1, y: 0, z: 0 });
  const length = Math.sqrt(forward.x * forward.x + forward.z * forward.z);
  return length < MIN_FLAT_FORWARD ? null : { fx: forward.x / length, fz: forward.z / length };
}

/** The forward speed (m/s) of the floor contact of each wheel, from the chassis' velocity: [left, right]. */
export function wheelGroundSpeeds(geometry: DriveGeometry, frame: GroundFrame, linvel: Vec3, yawRate: number): [number, number] {
  const forwardSpeed = linvel.x * frame.fx + linvel.z * frame.fz;
  // A point `y` to the left of the axle's midpoint moves forward at v − ω·y.
  return [forwardSpeed - yawRate * geometry.halfTrackM, forwardSpeed + yawRate * geometry.halfTrackM];
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** The impulses of one wheel's share, held to its torque line and its grip; nothing when it is off the floor. */
function wheelLimits(wheel: WheelDrive, rollingRadS: number, gripForceN: number, dt: number): { min: number; max: number } {
  if (!wheel.grounded) {
    return { min: 0, max: 0 };
  }
  const torque = torqueRange(wheel.motor, wheel.drive, rollingRadS);
  const perTorque = dt / wheel.motor.wheelRadiusM;
  const grip = gripForceN * dt;
  return { min: Math.max(torque.min * perTorque, -grip), max: Math.min(torque.max * perTorque, grip) };
}

/**
 * The impulse the wheels give the chassis this tick (model (c)): `linvel` is the velocity of the centre of mass, `yawRate`
 * the angular velocity about world +Y, `dt` the step that follows.
 */
export function driveImpulse(
  geometry: DriveGeometry,
  frame: GroundFrame,
  linvel: Vec3,
  yawRate: number,
  left: WheelDrive,
  right: WheelDrive,
  dt: number,
): DriveImpulse {
  const { massKg, yawInertia, halfTrackM } = geometry;
  const leftX = frame.fz;
  const leftZ = 0 - frame.fx;
  const forwardSpeed = linvel.x * frame.fx + linvel.z * frame.fz;
  const leftSpeed = linvel.x * leftX + linvel.z * leftZ;
  const [groundLeft, groundRight] = wheelGroundSpeeds(geometry, frame, linvel, yawRate);
  const rollingLeft = groundLeft / left.motor.wheelRadiusM;
  const rollingRight = groundRight / right.motor.wheelRadiusM;

  // The diff-drive velocity of the references, and the impulses that reach it in one tick.
  const aimLeft = left.motor.wheelRadiusM * left.referenceRadS;
  const aimRight = right.motor.wheelRadiusM * right.referenceRadS;
  const aimSpeed = (aimLeft + aimRight) / 2;
  const aimYawRate = (aimRight - aimLeft) / (2 * halfTrackM);
  const linear = massKg * (aimSpeed - forwardSpeed);
  const turn = (yawInertia * (aimYawRate - yawRate)) / halfTrackM;
  const leftLimits = wheelLimits(left, rollingLeft, geometry.gripForceN[0], dt);
  const rightLimits = wheelLimits(right, rollingRight, geometry.gripForceN[1], dt);
  const pushLeft = clamp((linear - turn) / 2, leftLimits.min, leftLimits.max);
  const pushRight = clamp((linear + turn) / 2, rightLimits.min, rightLimits.max);

  // No skid sideways at the axle: rolling about the axle's midpoint, the centre of mass d ahead of it moves left at ω·d.
  const yawRateAfter = yawRate + (halfTrackM * (pushRight - pushLeft)) / yawInertia;
  const sideGrip = ((left.grounded ? geometry.gripForceN[0] : 0) + (right.grounded ? geometry.gripForceN[1] : 0)) * dt;
  const side = clamp(massKg * (yawRateAfter * geometry.comAheadOfAxleM - leftSpeed), -sideGrip, sideGrip);

  const push = pushLeft + pushRight;
  return {
    linear: { x: push * frame.fx + side * leftX, y: 0, z: push * frame.fz + side * leftZ },
    yaw: halfTrackM * (pushRight - pushLeft),
    wheelSpeedsRadS: [rollingLeft, rollingRight],
  };
}
