import type { Kit, RobotRole } from '../../hardware/kit';
import { robotMechanics } from '../../hardware/kit-mechanics';
import { getRapier, GRAVITY_M_S2, refreshQueries, type Collider, type ColliderDesc, type PhysicsWorld, type RigidBody } from '../rapier';
import { arenaToWorld, cmToM, degToRad, gToKg, yawToQuaternion, type Quat, type Vec3 } from '../units';
import { createDcMotor, type DcMotor, type MotorCommand } from './dc-motor';
import { driveImpulse, groundFrame, wheelGroundSpeeds, type DriveGeometry } from './drive';
import { IDENTITY_ROTATION, robotPointToLocal } from './robot-frame';
import { createServoArm, type ServoArm } from './servo-arm';

// The physical robot (N18 R3.3): a kit's chassis and modules as Rapier bodies, and the drive and servos that move them.
//
// Bodies (ADR 0001 §5.3, model (c)):
// - The chassis is one dynamic body whose origin is the robot frame's (on the floor under the centre of the body box, kit.ts
//   `KitModule.mount`), with the kit's mass and centre of mass set explicitly and the inertia of the body box. Its colliders:
//   the body box; per drive wheel a frictionless support ball under the wheel (radius half the wheel's width, touching the
//   floor where the wheel does) and a frictionless wheel-shaped cylinder 1 mm off the floor for side contacts; the
//   frictionless caster ball. Only the three balls carry the robot: a wheel cylinder on the floor drifts sideways (measured
//   while building this: 90 mm over 1 m against 0 mm for balls), and a ball as large as the wheel would make the robot 4 cm
//   wider than it is.
// - Each servo adds its arm, a light dynamic body on a revolute joint (servo-arm.ts).
//
// Drive: the floor never pushes the robot (frictionless supports); each tick the drive gives the chassis an impulse towards
// the diff-drive velocity of its wheel references (drive.ts), from motors that follow their commands (dc-motor.ts). A wheel
// pushes only while its support ball stands on something (`isGrounded`): a contact of the narrow phase, read from the
// contact pair's current state rather than from contact events, which a refresh or a settle step does not report.
//
// Tick, for whoever steps the world (R3.5's World): applyActuators (when the targets change) → beforeStep() → world.step()
// → afterStep(). `stepWorld` does the last three.

/** Steps run before t = 0 so the robot rests on its supports (ADR 0001 §7.2): 0.5 s, as the spike's rest phase. */
export const SETTLE_STEPS = 60;
/** The wheel's side collider stops this far above the floor, so only the support ball carries the robot. */
export const WHEEL_SKIN_M = 0.001;
/** A support stands on a surface when a contact of it lies within this gap... */
export const GROUND_CONTACT_GAP_M = 0.001;
/** ...and the surface faces up, its normal within about 45° of +Y. A wall the ball rubs against is not ground. */
export const GROUND_NORMAL_MIN_Y = 0.7;
/** Friction of the chassis body box on walls and objects. */
const CHASSIS_FRICTION = 0.3;
/** Turns Rapier's +Y cylinder axis into the wheel's axle, local Z. */
const AXLE_ALONG_Z: Quat = { x: Math.sqrt(0.5), y: 0, z: 0, w: Math.sqrt(0.5) };

/** Where the robot starts: an arena point (cm, units.ts frame) and a heading (degrees counter-clockwise from arena +x). */
export type RobotStart = { readonly xCm: number; readonly yCm: number; readonly yawDeg: number };

/**
 * What the robot's actuators are told this tick (R3.6 computes it from the virtual UNO's pins). Roles left out keep their
 * last target; at first every motor coasts and every servo holds its `restDeg`.
 */
export type ActuatorTargets = {
  readonly motors?: Partial<Readonly<Record<RobotRole, MotorCommand>>>;
  /** Servo angles in degrees; clamped to each servo's minDeg..maxDeg. */
  readonly servos?: Partial<Readonly<Record<RobotRole, number>>>;
};

/** A pose in the world (SI, +Y up): the robot frame's origin and the chassis rotation. */
export type RobotPose = { readonly position: Vec3; readonly rotation: Quat };

export type RobotBody = {
  readonly chassis: RigidBody;
  /** The robot's dynamic bodies, the chassis first, then one arm per servo in kit order: the order a hash reads them. */
  readonly bodies: readonly RigidBody[];
  /** Whether a collider is the robot's own (a sensor ray skips those, R3.4). */
  ownsCollider(collider: Collider): boolean;
  /** Sets the targets of the roles it names. Throws a RangeError for a role the kit has no motor or servo for, or a bad value. */
  applyActuators(targets: ActuatorTargets): void;
  /** Before `world.step()`: moves the motors' references, gives the chassis the drive's impulse, drives the servos. */
  beforeStep(): void;
  /** After `world.step()`: turns the wheels by ω·dt. */
  afterStep(): void;
  /**
   * Puts the robot at rest at a new start, at the height it settled at (a teleport, e.g. a reset): motors coast, servos keep
   * their angles and targets. Then propagates the new positions to the colliders and refreshes the scene queries, so a ray
   * or a contact sees the robot where it now is before the next step.
   */
  placeAt(start: RobotStart): void;
  /** The chassis pose: the robot frame's origin (on the floor under the body's centre at rest) and its rotation. */
  pose(): RobotPose;
  /** Velocity of the chassis' centre of mass, m/s. */
  linvel(): Vec3;
  /** Angular velocity of the chassis, rad/s. */
  angvel(): Vec3;
  /** How far each wheel has turned since the robot was built, rad: [left, right], positive rolling forward (∑ ω·dt, no atan2). */
  wheelAngles(): readonly [number, number];
  /** Each servo's arm angle on the chassis, degrees, by role. */
  servoAngles(): Readonly<Partial<Record<RobotRole, number>>>;
  /** Whether both drive wheels stand on something (the drive pushes only with a wheel that does). */
  isGrounded(): boolean;
};

export type AssembleOptions = {
  /** Steps of the whole world run before t = 0 so the robot settles; default SETTLE_STEPS. */
  readonly settleSteps?: number;
};

/** One tick of a world that holds `robot`: beforeStep, world.step(), afterStep. */
export function stepWorld(world: PhysicsWorld, robot: RobotBody): void {
  robot.beforeStep();
  world.step();
  robot.afterStep();
}

/**
 * Builds the kit's robot in `world` at `start` and lets it settle (ADR 0001 §7.2): it is created with its supports just
 * touching the floor, and the whole world (arena objects included) steps `settleSteps` times with the motors coasting, so at
 * t = 0 the robot rests at its height. Then the wheel angles start from 0 and the scene queries are refreshed.
 *
 * `world` comes from `createPhysicsWorld()` with the arena built (buildArena). Throws a HardwareDataError when the kit has
 * no chassis or invalid mechanics (kit-mechanics.ts).
 */
export function assembleRobot(world: PhysicsWorld, kit: Kit, start: RobotStart, options: AssembleOptions = {}): RobotBody {
  const R = getRapier();
  const { chassis: spec, motorLeft, motorRight, servos } = robotMechanics(kit);
  const armsKg = servos.reduce((sum, servo) => sum + gToKg(servo.spec.armMassG), 0);
  const chassisKg = gToKg(spec.massG) - armsKg;
  const [lengthM, widthM, heightM] = spec.bodyCm.map(cmToM) as [number, number, number];
  // The body box's inertia with the chassis' whole mass, about local X (forward), Y (up), Z (right).
  const inertia: Vec3 = {
    x: (chassisKg / 12) * (heightM * heightM + widthM * widthM),
    y: (chassisKg / 12) * (lengthM * lengthM + widthM * widthM),
    z: (chassisKg / 12) * (lengthM * lengthM + heightM * heightM),
  };

  const startPose = (at: RobotStart, height: number) => {
    const point = arenaToWorld(at.xCm, at.yCm, 0);
    return { position: { x: point.x, y: point.y + height, z: point.z }, rotation: yawToQuaternion(degToRad(at.yawDeg)) };
  };
  const first = startPose(start, 0);
  const chassis = world.createRigidBody(
    R.RigidBodyDesc.dynamic()
      .setTranslation(first.position.x, first.position.y, first.position.z)
      .setRotation(first.rotation)
      .setCanSleep(false)
      .setAdditionalMassProperties(chassisKg, robotPointToLocal(spec.comCm), inertia, IDENTITY_ROTATION),
  );
  const owned = new Set<number>();
  const attach = (desc: ColliderDesc): Collider => {
    const collider = world.createCollider(desc.setDensity(0), chassis);
    owned.add(collider.handle);
    return collider;
  };
  const frictionless = (desc: ColliderDesc) => desc.setFriction(0).setFrictionCombineRule(R.CoefficientCombineRule.Min);

  attach(R.ColliderDesc.cuboid(lengthM / 2, heightM / 2, widthM / 2).setTranslation(0, cmToM(spec.clearanceCm) + heightM / 2, 0).setFriction(CHASSIS_FRICTION));
  const supports = [motorLeft, motorRight].map((motor) => {
    const centre = robotPointToLocal(motor.mount.posCm);
    const radius = cmToM(motor.spec.wheelRadiusCm);
    const halfWidth = cmToM(motor.spec.wheelWidthCm) / 2;
    const ball = Math.min(halfWidth, radius);
    attach(frictionless(R.ColliderDesc.cylinder(halfWidth, radius - WHEEL_SKIN_M).setRotation(AXLE_ALONG_Z).setTranslation(centre.x, centre.y, centre.z)));
    return attach(frictionless(R.ColliderDesc.ball(ball).setTranslation(centre.x, ball, centre.z)));
  }) as [Collider, Collider];
  const caster = robotPointToLocal(spec.casterCm);
  attach(frictionless(R.ColliderDesc.ball(cmToM(spec.casterRadiusCm)).setTranslation(caster.x, caster.y, caster.z)));

  const arms = servos.map((servo) => createServoArm(world, chassis, servo));
  for (const arm of arms) owned.add(arm.collider.handle);
  const armsByRole = new Map<RobotRole, ServoArm>(arms.map((arm) => [arm.role, arm]));
  const motors = new Map<RobotRole, DcMotor>([
    ['motorLeft', createDcMotor(motorLeft.spec)],
    ['motorRight', createDcMotor(motorRight.spec)],
  ]);
  const left = motors.get('motorLeft')!;
  const right = motors.get('motorRight')!;

  // Static load on each wheel (the caster takes the rest), from where the centre of mass is between the axle and the caster.
  const axleX = motorLeft.mount.posCm[0];
  const [comX, comY] = spec.comCm;
  const halfTrackCm = spec.trackCm / 2;
  const axleLoadN = (gToKg(spec.massG) * GRAVITY_M_S2 * (spec.casterCm[0] - comX)) / (spec.casterCm[0] - axleX);
  const geometry: DriveGeometry = {
    massKg: chassisKg,
    yawInertia: inertia.y,
    halfTrackM: cmToM(halfTrackCm),
    comAheadOfAxleM: cmToM(comX - axleX),
    gripForceN: [
      (spec.frictionWheel * axleLoadN * (halfTrackCm + comY)) / (2 * halfTrackCm),
      (spec.frictionWheel * axleLoadN * (halfTrackCm - comY)) / (2 * halfTrackCm),
    ],
  };

  /** Whether a support ball stands on a surface that is not the robot's own (contact pair state of the narrow phase). */
  const supportGrounded = (support: Collider): boolean => {
    let grounded = false;
    world.contactPairsWith(support, (other) => {
      if (grounded || owned.has(other.handle)) return;
      world.contactPair(support, other, (manifold, flipped) => {
        // The normal points from the manifold's first collider to its second: from `other` to the support when flipped.
        const normalY = manifold.normal().y;
        const upward = flipped ? normalY : 0 - normalY;
        if (upward < GROUND_NORMAL_MIN_Y) return;
        for (let i = 0; i < manifold.numContacts(); i++) {
          if (manifold.contactDist(i) <= GROUND_CONTACT_GAP_M) grounded = true;
        }
      });
    });
    return grounded;
  };

  let wheelAngles: [number, number] = [0, 0];
  let grounded: [boolean, boolean] = [false, false];
  let stepDt = world.timestep;
  /** How far the chassis sank into its supports while it settled: where placeAt puts it. */
  let restHeight = 0;

  const robot: RobotBody = {
    chassis,
    bodies: [chassis, ...arms.map((arm) => arm.body)],
    ownsCollider: (collider) => owned.has(collider.handle),
    applyActuators(targets) {
      for (const [role, command] of Object.entries(targets.motors ?? {}) as [RobotRole, MotorCommand][]) {
        const motor = motors.get(role);
        if (!motor) throw new RangeError(`The kit has no drive motor ${role}.`);
        motor.setCommand(command);
      }
      for (const [role, deg] of Object.entries(targets.servos ?? {}) as [RobotRole, number][]) {
        const arm = armsByRole.get(role);
        if (!arm) throw new RangeError(`The kit has no servo ${role}.`);
        arm.setTarget(deg);
      }
    },
    beforeStep() {
      stepDt = world.timestep;
      grounded = [supportGrounded(supports[0]), supportGrounded(supports[1])];
      left.advance(stepDt);
      right.advance(stepDt);
      const frame = groundFrame(chassis.rotation());
      if (frame !== null && (grounded[0] || grounded[1])) {
        const impulse = driveImpulse(
          geometry,
          frame,
          chassis.linvel(),
          chassis.angvel().y,
          { motor: left.model, drive: left.drive, referenceRadS: left.referenceRadS, grounded: grounded[0] },
          { motor: right.model, drive: right.drive, referenceRadS: right.referenceRadS, grounded: grounded[1] },
          stepDt,
        );
        chassis.applyImpulse(impulse.linear, true);
        chassis.applyTorqueImpulse({ x: 0, y: impulse.yaw, z: 0 }, true);
      }
      for (const arm of arms) arm.beforeStep(stepDt);
    },
    afterStep() {
      // A wheel on the floor turns as its contact point moves; one off the floor spins free at its motor's reference.
      const frame = groundFrame(chassis.rotation());
      const ground = frame === null ? [0, 0] : wheelGroundSpeeds(geometry, frame, chassis.linvel(), chassis.angvel().y);
      const omega = [
        grounded[0] ? ground[0]! / left.model.wheelRadiusM : left.referenceRadS,
        grounded[1] ? ground[1]! / right.model.wheelRadiusM : right.referenceRadS,
      ];
      wheelAngles = [wheelAngles[0] + omega[0]! * stepDt, wheelAngles[1] + omega[1]! * stepDt];
    },
    placeAt(at) {
      const angles = arms.map((arm) => arm.angleDeg());
      const pose = startPose(at, restHeight);
      chassis.setTranslation(pose.position, true);
      chassis.setRotation(pose.rotation, true);
      chassis.setLinvel({ x: 0, y: 0, z: 0 }, true);
      chassis.setAngvel({ x: 0, y: 0, z: 0 }, true);
      arms.forEach((arm, i) => arm.followChassis(angles[i]!));
      left.reset();
      right.reset();
      world.propagateModifiedBodyPositionsToColliders();
      refreshQueries(world);
    },
    pose: () => ({ position: chassis.translation(), rotation: chassis.rotation() }),
    linvel: () => chassis.linvel(),
    angvel: () => chassis.angvel(),
    wheelAngles: () => wheelAngles,
    servoAngles: () => Object.fromEntries(arms.map((arm) => [arm.role, arm.angleDeg()])),
    isGrounded: () => supportGrounded(supports[0]) && supportGrounded(supports[1]),
  };

  for (let step = 0; step < (options.settleSteps ?? SETTLE_STEPS); step++) {
    stepWorld(world, robot);
  }
  restHeight = chassis.translation().y - first.position.y;
  wheelAngles = [0, 0];
  refreshQueries(world);
  return robot;
}
