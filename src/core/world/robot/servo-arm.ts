import type { RobotRole } from '../../hardware/kit';
import type { KitMechanicalModule } from '../../hardware/kit-mechanics';
import { atan2 } from '../dmath';
import { getRapier, type Collider, type PhysicsWorld, type RapierModule, type RigidBody } from '../rapier';
import { cmToM, degToRad, gToKg, radToDeg, rotateVector, yawToQuaternion, type Quat, type Vec3 } from '../units';
import { conjugate, localToWorld, multiplyQuaternions, robotPointToLocal } from './robot-frame';

// A hobby servo and its arm (N18 R3.3): a light dynamic bar on a revolute joint about the mount's vertical axis, so it
// collides like any body: it pushes and blocks objects, a wall stops it, and what it hits pushes back on the robot.
//
// The servo is a speed-limited position controller, as a hobby servo is: each tick the joint's velocity motor is asked for
// the speed that reaches the target in one tick, at most 60° per `sPer60Deg`, and it pushes with at most `stallTorqueNm`.
// Unloaded, 0° → 90° takes 90/60 × 0.1 s = 0.15 s (18 ticks at 120 Hz); blocked, the arm holds against the obstacle with
// the stall torque. Targets are clamped to the servo's minDeg..maxDeg; the joint's limits back that up.
//
// Angles: servo angle θ points the arm at the mount's yaw + θ in the robot frame, counter-clockwise (towards the robot's
// left) as θ grows. The joint's angle is θ − θ_mid (θ_mid the middle of the range), so it stays inside (−180°, 180°) where
// the angle read back from the bodies' rotations is continuous.

/** The velocity motor's gain, N·m·s/rad. Stiff: the arm reaches the speed asked within a tick unless the torque limit stops it. */
export const SERVO_MOTOR_GAIN = 1;
/**
 * Extra internal PGS iterations for the island of the arm (the robot and what it touches). With the world's 4 + 1 the joint
 * lags its motor: measured 87.8° at 0.15 s on the way to 90°, then 1.3° past it. With 4 more, 89.6° and 0.3°.
 */
export const ARM_EXTRA_PGS_ITERATIONS = 4;
/** Friction of the arm on what it pushes. */
const ARM_FRICTION = 0.3;

type RevoluteJoint = InstanceType<RapierModule['RevoluteImpulseJoint']>;

export type ServoArm = {
  readonly role: RobotRole;
  readonly body: RigidBody;
  readonly collider: Collider;
  /** The angle the servo turns the arm to, degrees, within minDeg..maxDeg. */
  readonly targetDeg: number;
  /** Takes a new target angle, clamped to the servo's range; throws a RangeError for a value that is not a number. */
  setTarget(deg: number): void;
  /** Before a physics step of `dt` seconds: asks the joint's motor for the speed towards the target. */
  beforeStep(dt: number): void;
  /** The arm's angle on the chassis, degrees (read from the two bodies' rotations: atan2 of dmath, no Math trig). */
  angleDeg(): number;
  /**
   * After the chassis was put at a new pose by hand: puts the arm on it at servo angle `deg` (read with `angleDeg` before
   * the chassis moved), at rest. The caller then propagates the positions to the colliders (assembly.ts `placeAt`).
   */
  followChassis(deg: number): void;
};

export function createServoArm(world: PhysicsWorld, chassis: RigidBody, module: KitMechanicalModule<'servo'>): ServoArm {
  const R = getRapier();
  const { spec, mount } = module;
  const midDeg = (spec.minDeg + spec.maxDeg) / 2;
  const maxSpeedRadS = degToRad(60 / spec.sPer60Deg);
  const anchor = robotPointToLocal(mount.posCm);
  /** The arm body's rotation on the chassis at servo angle θ: the joint angle θ − θ_mid about +Y. */
  const onChassis = (deg: number): Quat => yawToQuaternion(degToRad(deg - midDeg));
  const armPose = (deg: number) => {
    const position = chassis.translation();
    const rotation = chassis.rotation();
    return { position: localToWorld(position, rotation, anchor), rotation: multiplyQuaternions(rotation, onChassis(deg)) };
  };

  const start = armPose(spec.restDeg);
  const body = world.createRigidBody(
    R.RigidBodyDesc.dynamic()
      .setTranslation(start.position.x, start.position.y, start.position.z)
      .setRotation(start.rotation)
      .setCanSleep(false)
      .setAdditionalPgsIterations(ARM_EXTRA_PGS_ITERATIONS),
  );
  // In the arm body's frame the bar points at the mount's yaw + θ_mid: at joint angle 0 that is servo angle θ_mid.
  const along = yawToQuaternion(degToRad(mount.yawDeg + midDeg));
  const centre: Vec3 = rotateVector(along, { x: cmToM(spec.armLengthCm) / 2, y: 0, z: 0 });
  const collider = world.createCollider(
    R.ColliderDesc.cuboid(cmToM(spec.armLengthCm) / 2, cmToM(spec.armHeightCm) / 2, cmToM(spec.armWidthCm) / 2)
      .setTranslation(centre.x, centre.y, centre.z)
      .setRotation(along)
      .setMass(gToKg(spec.armMassG))
      .setFriction(ARM_FRICTION),
    body,
  );
  const joint = world.createImpulseJoint(R.JointData.revolute(anchor, { x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }), chassis, body, true) as RevoluteJoint;
  joint.setContactsEnabled(false);
  joint.setLimits(degToRad(spec.minDeg - midDeg), degToRad(spec.maxDeg - midDeg));
  joint.configureMotorModel(R.MotorModel.ForceBased);
  joint.setMotorMaxForce(spec.stallTorqueNm);
  joint.configureMotorVelocity(0, SERVO_MOTOR_GAIN);

  let target = spec.restDeg;
  const angleDeg = () => {
    const relative = multiplyQuaternions(conjugate(chassis.rotation()), body.rotation());
    // The twist about +Y; q and −q are the same rotation, so take the half with w ≥ 0 (joint angle in [−180°, 180°]).
    const sign = relative.w < 0 ? -1 : 1;
    return midDeg + radToDeg(2 * atan2(sign * relative.y, sign * relative.w));
  };
  return {
    role: module.role,
    body,
    collider,
    get targetDeg() {
      return target;
    },
    setTarget(deg) {
      if (Number.isNaN(deg) || typeof deg !== 'number') {
        throw new RangeError(`A servo angle is a number of degrees, not ${String(deg)}.`);
      }
      target = Math.min(spec.maxDeg, Math.max(spec.minDeg, deg));
    },
    beforeStep(dt) {
      const speed = degToRad(target - angleDeg()) / dt;
      joint.configureMotorVelocity(Math.min(maxSpeedRadS, Math.max(-maxSpeedRadS, speed)), SERVO_MOTOR_GAIN);
    },
    angleDeg,
    followChassis(deg) {
      const pose = armPose(deg);
      body.setTranslation(pose.position, true);
      body.setRotation(pose.rotation, true);
      body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    },
  };
}
