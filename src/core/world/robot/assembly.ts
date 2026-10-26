import type { Kit, RobotRole } from '../../hardware/kit';
import { gripperMovingMassG, robotMechanics } from '../../hardware/kit-mechanics';
import { getRapier, GRAVITY_M_S2, refreshQueries, type Collider, type ColliderDesc, type PhysicsWorld, type RigidBody } from '../rapier';
import { arenaToWorld, cmToM, degToRad, gToKg, yawToQuaternion, type Quat, type Vec3 } from '../units';
import { checkMotorCommand, createDcMotor, MOTOR_COAST, type DcMotor, type MotorCommand } from './dc-motor';
import { driveImpulse, groundFrame, type DriveGeometry, type GroundFrame } from './drive';
import { createGrasp, type Grasp, type GraspObject } from './grasp';
import { createGripper, type Gripper, type GripperPose, type GripperTargets } from './gripper';
import { conjugate, IDENTITY_ROTATION, localToWorld, multiplyQuaternions, robotPointToLocal } from './robot-frame';
import { checkServoAngle, createServoArm, type ServoArm } from './servo-arm';

// The physical robot (N18 R3.3): a kit's chassis and modules as Rapier bodies, and the drive and servos that move them.
//
// Bodies (ADR 0001 §5.3, model (c)):
// - The chassis is one dynamic body whose origin is the robot frame's (on the floor under the centre of the body box, kit.ts
//   `KitModule.mount`), with the kit's mass and centre of mass set explicitly and the inertia of the body box. Its colliders:
//   the body box; per drive wheel a support ball under the wheel (radius half the wheel's width, touching the floor where
//   the wheel does; its only friction is the gearbox's, below) and a frictionless wheel-shaped cylinder 1 mm off the floor
//   for side contacts; the frictionless caster ball. Only the three balls carry the robot: a wheel cylinder on the floor
//   drifts sideways (measured while building this: 90 mm over 1 m against 0 mm for balls), and a ball as large as the wheel
//   would make the robot 4 cm wider than it is.
// - Each servo adds its arm, a light dynamic body on a revolute joint (servo-arm.ts).
// - N19 B1: a kit with a gripper adds its boom, carriage and two fingers (gripper.ts), and the grasp machine over the arena's objects
//   (grasp.ts, `AssembleOptions.graspObjects`). The kit's `massG` is the whole car (§4.6): the chassis body is that less the servo arms and
//   the gripper's moving parts. A kit without a gripper builds exactly what it built before (no body, collider or joint more).
//
// Drive: the floor never pushes the robot along; each tick the drive gives the chassis the push towards the diff-drive
// velocity of its wheel references (drive.ts), from motors that follow their commands (dc-motor.ts), as forces over the
// step where the wheels meet the floor. A wheel pushes only while its support ball stands on something (`isGrounded`): a contact of the narrow phase, read
// from the contact pair's current state rather than from contact events, which a refresh or a settle step does not report.
// The support balls carry the gearbox's friction (`gearFrictionNm`) as contact friction, so the solver holds a stopped
// robot against a push and slows a running one, within the same step as the drive.
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
 * What the robot's actuators are told (R3.6 computes it from the virtual UNO's pins each tick).
 * - Motors are not sticky: a drive motor left out of `motors` stops (coasts: duty 0, dir 0), so a role the caller forgot can
 *   never keep running.
 * - A servo left out of `servos` keeps its last target, as a powered servo holds its angle (at first: its `restDeg`).
 * - A role named with the value `undefined` is a mistake, not a "leave out": it throws a RangeError, as does a role the kit
 *   has no motor or servo for, or a bad value. Nothing is applied when anything is refused.
 */
export type ActuatorTargets = {
  readonly motors?: Partial<Readonly<Record<RobotRole, MotorCommand>>>;
  /** Servo angles in degrees; clamped to each servo's minDeg..maxDeg. */
  readonly servos?: Partial<Readonly<Record<RobotRole, number>>>;
  /**
   * N19 B1: the gripper's two servos (the module models read them off the CLAW and LIFT pins), degrees, clamped to 0..90. Like a servo,
   * a field left out holds its last target (at first: setup()'s, claw 0°, lift 90°). A kit without a gripper refuses it.
   */
  readonly gripper?: GripperTargets;
};

/** A pose in the world (SI, +Y up): the robot frame's origin and the chassis rotation. */
export type RobotPose = { readonly position: Vec3; readonly rotation: Quat };

export type RobotBody = {
  readonly chassis: RigidBody;
  /**
   * The robot's dynamic bodies, the chassis first, then one arm per servo in kit order, then (N19) the gripper's (boom, carriage, left
   * and right finger): the order a hash reads them.
   */
  readonly bodies: readonly RigidBody[];
  /** N19 B1: the kit's gripper, or null for a kit without one. */
  readonly gripper: Gripper | null;
  /** N19 B2: the grasp machine of the gripper (null without one). Whoever steps the world runs `grasp.update` after each step (world.ts). */
  readonly grasp: Grasp | null;
  /** Whether a collider is the robot's own (a sensor ray skips those, R3.4). */
  ownsCollider(collider: Collider): boolean;
  /** Sets the actuator targets (see `ActuatorTargets`: motors left out stop, servos left out hold). Throws a RangeError for a bad target. */
  applyActuators(targets: ActuatorTargets): void;
  /** Before `world.step()`: moves the motors' references, gives the chassis the drive's impulse, drives the servos. */
  beforeStep(): void;
  /** After `world.step()`: turns the wheels by ω·dt. */
  afterStep(): void;
  /**
   * Puts the robot at rest at a new start, at the height it settled at (a teleport, e.g. a reset): motors coast, servos keep
   * their angles and targets. Then propagates the new positions to the colliders and refreshes the scene queries, so a ray
   * or a contact sees the robot where it now is before the next step. N19: a held object is let go first (its joint removed, it
   * stays where it was), then the gripper's bodies move with the chassis at their angles.
   */
  placeAt(start: RobotStart): void;
  /** The chassis pose: the robot frame's origin (on the floor under the body's centre at rest) and its rotation. */
  pose(): RobotPose;
  /** Velocity of the chassis' centre of mass at the end of the last step, m/s. */
  linvel(): Vec3;
  /** Angular velocity of the chassis, rad/s. */
  angvel(): Vec3;
  /**
   * How far each wheel has turned since the robot was built, rad: [left, right], positive rolling forward. Σ ω·dt, with ω
   * each step's rolling rate, from how far the wheel's floor contact moved along the heading (no atan2); a wheel off the
   * floor spins at its motor's reference.
   */
  wheelAngles(): readonly [number, number];
  /** Each servo's arm angle on the chassis, degrees, by role. */
  servoAngles(): Readonly<Partial<Record<RobotRole, number>>>;
  /** Whether both drive wheels stand on something (the drive pushes only with a wheel that does). */
  isGrounded(): boolean;
};

export type AssembleOptions = {
  /** Steps of the whole world run before t = 0 so the robot settles; default SETTLE_STEPS. */
  readonly settleSteps?: number;
  /** N19 B2: the arena's objects the gripper may hold (grasp.ts `graspObjects`); none by default. Unused by a kit without a gripper. */
  readonly graspObjects?: readonly GraspObject[];
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
  const { chassis: spec, motorLeft, motorRight, servos, gripper: gripperModule } = robotMechanics(kit);
  const armsKg = servos.reduce((sum, servo) => sum + gToKg(servo.spec.armMassG), 0);
  // N19 §4.6: massG is the whole car; the gripper's moving parts are bodies of their own. 0 for a kit without a gripper.
  const gripperKg = gripperModule === null ? 0 : gToKg(gripperMovingMassG(gripperModule.spec));
  const chassisKg = gToKg(spec.massG) - armsKg - gripperKg;
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

  // Static load on each wheel (the caster takes the rest), from where the centre of mass is between the axle and the caster. A gripper
  // hangs ahead of the caster, so its weight loads the caster and lightens the wheels a little; leaving it out is close enough (ADR 0004 §2
  // measured the car so): measured at rest, 1.80 N a wheel against the 1.867 N this gives. It only seeds the first tick's gear friction
  // (beforeStep follows the real load from then on) and the drive's grip limit.
  const axleX = motorLeft.mount.posCm[0];
  const [comX, comY] = spec.comCm;
  const halfTrackCm = spec.trackCm / 2;
  const axleLoadN = ((gToKg(spec.massG) - gripperKg) * GRAVITY_M_S2 * (spec.casterCm[0] - comX)) / (spec.casterCm[0] - axleX);
  const wheelLoadN: [number, number] = [
    (axleLoadN * (halfTrackCm + comY)) / (2 * halfTrackCm),
    (axleLoadN * (halfTrackCm - comY)) / (2 * halfTrackCm),
  ];

  attach(R.ColliderDesc.cuboid(lengthM / 2, heightM / 2, widthM / 2).setTranslation(0, cmToM(spec.clearanceCm) + heightM / 2, 0).setFriction(CHASSIS_FRICTION));
  const supports = [motorLeft, motorRight].map((motor, side) => {
    const centre = robotPointToLocal(motor.mount.posCm);
    const radius = cmToM(motor.spec.wheelRadiusCm);
    const halfWidth = cmToM(motor.spec.wheelWidthCm) / 2;
    const ball = Math.min(halfWidth, radius);
    attach(frictionless(R.ColliderDesc.cylinder(halfWidth, radius - WHEEL_SKIN_M).setRotation(AXLE_ALONG_Z).setTranslation(centre.x, centre.y, centre.z)));
    // The gearbox friction starts at the coefficient that gives T_f for the static load; beforeStep follows the real load.
    const gear = gearFriction(motor.spec.gearFrictionNm, radius, wheelLoadN[side]!);
    return attach(R.ColliderDesc.ball(ball).setTranslation(centre.x, ball, centre.z).setFriction(gear).setFrictionCombineRule(R.CoefficientCombineRule.Min));
  }) as [Collider, Collider];
  /**
   * The gearbox's Coulomb friction T_f at a wheel is a force T_f/r at its floor contact, whatever the wheel's load: the
   * support ball gets the friction coefficient T_f/(r·N) for its load N, never more than the tyre grips (`frictionWheel`).
   * The solver applies it within the step, so it holds against a push as much as against the drive.
   */
  function gearFriction(gearFrictionNm: number, radiusM: number, loadN: number): number {
    return Math.min(spec.frictionWheel, gearFrictionNm / (radiusM * loadN));
  }
  const caster = robotPointToLocal(spec.casterCm);
  attach(frictionless(R.ColliderDesc.ball(cmToM(spec.casterRadiusCm)).setTranslation(caster.x, caster.y, caster.z)));

  const arms = servos.map((servo) => createServoArm(world, chassis, servo));
  for (const arm of arms) owned.add(arm.collider.handle);
  const gripper = gripperModule === null ? null : createGripper(world, chassis, gripperModule);
  if (gripper !== null) for (const collider of gripper.colliders) owned.add(collider.handle);
  const grasp = gripper === null ? null : createGrasp(world, gripper, options.graspObjects ?? []);
  const armsByRole = new Map<RobotRole, ServoArm>(arms.map((arm) => [arm.role, arm]));
  const motors = new Map<RobotRole, DcMotor>([
    ['motorLeft', createDcMotor(motorLeft.spec)],
    ['motorRight', createDcMotor(motorRight.spec)],
  ]);
  const left = motors.get('motorLeft')!;
  const right = motors.get('motorRight')!;

  const geometry: DriveGeometry = {
    massKg: chassisKg,
    yawInertia: inertia.y,
    halfTrackM: cmToM(halfTrackCm),
    comAheadOfAxleM: cmToM(comX - axleX),
    gripForceN: [spec.frictionWheel * wheelLoadN[0], spec.frictionWheel * wheelLoadN[1]],
  };

  /**
   * Whether a support ball stands on a surface that is not the robot's own (contact pair state of the narrow phase), and the
   * normal impulse the last step pressed it on that surface with, along the contact normal (N·s).
   */
  const supportContact = (support: Collider): { grounded: boolean; normalImpulse: number } => {
    let grounded = false;
    let normalImpulse = 0;
    world.contactPairsWith(support, (other) => {
      if (owned.has(other.handle)) return;
      world.contactPair(support, other, (manifold, flipped) => {
        // The normal points from the manifold's first collider to its second: from `other` to the support when flipped.
        const normalY = manifold.normal().y;
        const upward = flipped ? normalY : 0 - normalY;
        if (upward < GROUND_NORMAL_MIN_Y) return;
        // The impulse is along the contact normal: the load the friction scales with, on a slope as on the flat.
        for (let i = 0; i < manifold.numContacts(); i++) {
          if (manifold.contactDist(i) <= GROUND_CONTACT_GAP_M) grounded = true;
          normalImpulse += manifold.contactImpulse(i);
        }
      });
    });
    return { grounded, normalImpulse };
  };
  const supportGrounded = (support: Collider) => supportContact(support).grounded;
  const motorSpecs = [motorLeft.spec, motorRight.spec] as const;

  let wheelAngles: [number, number] = [0, 0];
  let grounded: [boolean, boolean] = [false, false];
  let stepDt = world.timestep;
  /** The axle's midpoint in the chassis frame: the point a diff-drive turns about. */
  const axleLocal = robotPointToLocal([axleX, 0, 0]);
  /**
   * The drive's own share of the chassis' user force and torque about +Y (N, N·m). The drive pushes with a force over the
   * step, not an impulse before it, so the gearbox friction meets it in every solver substep: an impulse before the step
   * moved a robot the friction should hold by 2.6 mm a second (it stopped only at the end of each step). Other forces on the
   * chassis (a push) stay: each tick adds the change of the drive's share only.
   */
  const still: Vec3 = { x: 0, y: 0, z: 0 };
  let driveForce: Vec3 = still;
  let driveTorque: Vec3 = still;
  const setDrive = (force: Vec3, torque: Vec3) => {
    chassis.addForce({ x: force.x - driveForce.x, y: force.y - driveForce.y, z: force.z - driveForce.z }, true);
    chassis.addTorque({ x: torque.x - driveTorque.x, y: torque.y - driveTorque.y, z: torque.z - driveTorque.z }, true);
    driveForce = force;
    driveTorque = torque;
  };
  // Where the pushes act, in the chassis frame: each wheel where it meets the floor, the side push on the floor under the
  // centre of mass. On the floor, like the friction: a push at the centre of mass against friction at the floor makes a
  // pitch couple no robot has (measured: reversing, the caster's load fell from 0.84 N to 0.14 N, and a 1–3 mm bump left
  // the robot on its tail, 16° up). Under the centre of mass, the side push turns the robot no more than the drive's yaw
  // computation assumed.
  const contactLocal = [robotPointToLocal([axleX, halfTrackCm, 0]), robotPointToLocal([axleX, -halfTrackCm, 0])] as const;
  const underComLocal = robotPointToLocal([comX, comY, 0]);
  /** Before the step: where the axle's midpoint was, the chassis rotation and its heading on the floor. */
  let before: { axle: Vec3; rotation: Quat; frame: GroundFrame | null } | null = null;
  /** How far the chassis sank into its supports while it settled: where placeAt puts it. */
  let restHeight = 0;

  const robot: RobotBody = {
    chassis,
    bodies: [chassis, ...arms.map((arm) => arm.body), ...(gripper === null ? [] : gripper.bodies)],
    gripper,
    grasp,
    ownsCollider: (collider) => owned.has(collider.handle),
    applyActuators(targets) {
      // Check everything first, so a refused target changes nothing.
      const named = (targets.motors ?? {}) as Readonly<Record<string, MotorCommand | undefined>>;
      for (const [role, command] of Object.entries(named)) {
        if (!motors.has(role as RobotRole)) throw new RangeError(`The kit has no drive motor ${role}.`);
        if (command === undefined) throw new RangeError(`The target of motor ${role} is undefined: leave the role out to stop it.`);
        checkMotorCommand(command);
      }
      const angles = Object.entries((targets.servos ?? {}) as Readonly<Record<string, number | undefined>>);
      for (const [role, deg] of angles) {
        if (!armsByRole.has(role as RobotRole)) throw new RangeError(`The kit has no servo ${role}.`);
        if (deg === undefined) throw new RangeError(`The target of servo ${role} is undefined: leave the role out to hold it.`);
        checkServoAngle(deg);
      }
      if (targets.gripper !== undefined) {
        if (gripper === null) throw new RangeError('The kit has no gripper.');
        for (const [name, deg] of Object.entries(targets.gripper) as [string, unknown][]) {
          if (name !== 'clawDeg' && name !== 'liftDeg') throw new RangeError(`The gripper has no target ${name}: clawDeg or liftDeg.`);
          if (deg === undefined) throw new RangeError(`The gripper's ${name} is undefined: leave it out to hold it.`);
          checkServoAngle(deg);
        }
      }
      for (const [role, motor] of motors) motor.setCommand(named[role] ?? MOTOR_COAST);
      for (const [role, deg] of angles) armsByRole.get(role as RobotRole)!.setTarget(deg!);
      if (targets.gripper !== undefined) gripper!.setTargets(targets.gripper);
    },
    beforeStep() {
      stepDt = world.timestep;
      const contacts = [supportContact(supports[0]), supportContact(supports[1])] as const;
      grounded = [contacts[0].grounded, contacts[1].grounded];
      // Gear friction is the motor's, not the load's: follow the load the last step put on each support, which changes as the
      // robot accelerates, brakes, pushes something or stands on a slope (weight shifts between the wheels and the caster).
      contacts.forEach((contact, side) => {
        const loadN = contact.normalImpulse / stepDt;
        if (contact.grounded && loadN > 0) {
          supports[side]!.setFriction(gearFriction(motorSpecs[side]!.gearFrictionNm, cmToM(motorSpecs[side]!.wheelRadiusCm), loadN));
        }
      });
      // N19 fix round 1 (ADR 0004 §10b): the solver uses the friction a contact manifold combined from its two colliders, and Rapier combines
      // it again only when the narrow phase updates that pair, which a ball resting on the floor does not ask for. So the coefficient just
      // set reached the solver only now and then: a tick of the gripper's arm move that unloads a wheel caps it (up to 0.97), the manifold
      // kept it, and the car stood still at duty ≤ 160 (3.5 N of static friction against 2.3–3.0 N of drive). Setting a support ball's place
      // on the chassis to where it is marks it modified, so this step combines its contact's friction afresh. Only for a kit with a gripper:
      // the rover's manifolds are stale by about 1 % (0.4827 against 0.4875), and refreshing them would move its golden hashes (engine 1).
      if (gripper !== null) {
        for (const support of supports) support.setTranslationWrtParent(support.translationWrtParent()!);
      }
      left.advance(stepDt);
      right.advance(stepDt);
      const rotation = chassis.rotation();
      const frame = groundFrame(rotation);
      if (frame !== null && (grounded[0] || grounded[1])) {
        const impulse = driveImpulse(
          geometry,
          frame,
          chassis.linvel(),
          chassis.angvel().y,
          { motor: left.model, drive: left.drive, referenceRadS: left.referenceRadS, grounded: grounded[0], coasting: left.coasting },
          { motor: right.model, drive: right.drive, referenceRadS: right.referenceRadS, grounded: grounded[1], coasting: right.coasting },
          stepDt,
        );
        // The step's impulses as forces over the step (the same change of velocity, spread over the solver's substeps), each
        // where it acts: the force at the centre of mass plus the torque of each about it.
        const position = chassis.translation();
        const com = chassis.worldCom();
        const leftX = frame.fz;
        const leftZ = 0 - frame.fx;
        const pushes: { at: Vec3; force: Vec3 }[] = [
          ...impulse.wheelPush.map((push, side) => ({
            at: localToWorld(position, rotation, contactLocal[side]!),
            force: { x: (push * frame.fx) / stepDt, y: 0, z: (push * frame.fz) / stepDt },
          })),
          { at: localToWorld(position, rotation, underComLocal), force: { x: (impulse.sidePush * leftX) / stepDt, y: 0, z: (impulse.sidePush * leftZ) / stepDt } },
        ];
        const total = { x: 0, y: 0, z: 0 };
        const torque = { x: 0, y: 0, z: 0 };
        for (const { at, force } of pushes) {
          const arm = { x: at.x - com.x, y: at.y - com.y, z: at.z - com.z };
          total.x += force.x;
          total.z += force.z;
          torque.x += arm.y * force.z - arm.z * force.y;
          torque.y += arm.z * force.x - arm.x * force.z;
          torque.z += arm.x * force.y - arm.y * force.x;
        }
        setDrive(total, torque);
      } else {
        setDrive(still, still);
      }
      for (const arm of arms) arm.beforeStep(stepDt);
      gripper?.beforeStep(stepDt);
      before = { axle: localToWorld(chassis.translation(), rotation, axleLocal), rotation, frame };
    },
    afterStep() {
      // A wheel on the floor turns as its contact point moved along the heading this step: the axle's midpoint went
      // `forward`, and the chassis turned by `turned` about +Y (twice the twist quaternion's y/w: tan(θ/2)·2, within 1e-7
      // of θ for a step's turn). One off the floor spins free at its motor's reference.
      let rolled: [number, number] = [0, 0];
      if (before !== null && before.frame !== null) {
        const rotation = chassis.rotation();
        const axle = localToWorld(chassis.translation(), rotation, axleLocal);
        const forward = (axle.x - before.axle.x) * before.frame.fx + (axle.z - before.axle.z) * before.frame.fz;
        const twist = multiplyQuaternions(conjugate(before.rotation), rotation);
        const turned = twist.w === 0 ? 0 : (2 * twist.y) / twist.w;
        rolled = [forward - turned * geometry.halfTrackM, forward + turned * geometry.halfTrackM];
      }
      wheelAngles = [
        wheelAngles[0] + (grounded[0] ? rolled[0] / left.model.wheelRadiusM : left.referenceRadS * stepDt),
        wheelAngles[1] + (grounded[1] ? rolled[1] / right.model.wheelRadiusM : right.referenceRadS * stepDt),
      ];
      before = null;
    },
    placeAt(at) {
      grasp?.release();
      const angles = arms.map((arm) => arm.angleDeg());
      const gripperPose: GripperPose | null = gripper === null ? null : gripper.pose();
      const pose = startPose(at, restHeight);
      chassis.setTranslation(pose.position, true);
      chassis.setRotation(pose.rotation, true);
      chassis.setLinvel({ x: 0, y: 0, z: 0 }, true);
      chassis.setAngvel({ x: 0, y: 0, z: 0 }, true);
      setDrive(still, still);
      arms.forEach((arm, i) => arm.followChassis(angles[i]!));
      if (gripper !== null) gripper.followChassis(gripperPose!);
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
