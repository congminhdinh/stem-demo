import type { Rgbc } from '../hardware/devices/tcs34725';
import { portOfRole, portParam, type ColorSensorSpec, type IrObstacleSpec, type Kit, type LineSensorSpec, type ModuleSpecs, type UltrasonicSpec } from '../hardware/kit';
import { robotMechanics } from '../hardware/kit-mechanics';
import { ScenarioError, type Scenario } from '../scenario/scenario-schema';
import { applyVariant, kitFootprintRadiusCm, variantOffsets, type VariantOffsets } from '../scenario/variants';
import type { Arena, PointCm } from './arena/arena-schema';
import { buildArena, type ArenaColliderInfo, type BuiltArena } from './arena/build-arena';
import { createGroundPaint } from './arena/ground-paint';
import type { GoalFrame } from '../scenario/goals/frame';
import { toGoalFrame, type GoalFrameExtras, type GoalFrameObjectExtras, type GoalFrameSource } from './goal-frame';
import { createPhysicsWorld, initPhysics, PHYSICS_DT_S, PHYSICS_HZ, type Collider, type PhysicsWorld, type RigidBody } from './rapier';
import { assembleRobot, stepWorld, type ActuatorTargets, type RobotBody, type RobotStart } from './robot/assembly';
import { robotFootprint, startFootprintIssues } from './robot/footprint';
import { graspObjects } from './robot/grasp';
import { localToWorld, multiplyQuaternions, robotPointToLocal } from './robot/robot-frame';
import { createWorldRng } from './rng';
import type { ColliderLookup, SensedCollider } from './sensors/collider-lookup';
import { measureColor } from './sensors/color';
import { readContacts } from './sensors/contacts';
import { measureIr } from './sensors/ir';
import { restingOn } from './sensors/resting';
import { LIFTED_HEIGHT_CM, measureLine, type LineReading } from './sensors/line';
import { isOutOfArena } from './sensors/out-of-arena';
import { sensedBodies } from './sensors/sensed-bodies';
import { measureUltrasonic, type UltrasonicNoise } from './sensors/ultrasonic';
import type { ContactEvent, Pose, RobotSnapshot, ScoreState, SensorReadout, SnapshotGripper } from './snapshot';
import { CM_PER_M, degToRad, radToDeg, worldToArena, yawOfQuaternion, yawToQuaternion, type Quat, type Vec3 } from './units';

// The robot world (N18 R3.5, robot plan §3, §4.5): one object that holds a physics world, the arena built in it, the kit's
// robot and its sensors, steps in fixed ticks and tells what it looks like on each one. The run session (R3.6) is its only
// driver: it sets the actuator targets from the virtual UNO's pins, steps, reads the sensors back into the pins, feeds the goals
// and publishes snapshots. The view (R4) never sees a World, only the snapshots (snapshot.ts).
//
// Entry points:
//   - `createScenarioWorld(scenario, kit, variantIndex)` is the main one, what a run of a scenario builds (R3.6): it takes the
//     variant's offsets (variants.ts `variantOffsets`, with the floor the kit keeps clear at a start, `kitFootprintRadiusCm`), applies them
//     (`applyVariant`) and builds the world with the variant's seed.
//   - `createWorld({ arena, start, kit, seed, variant? })` is what that calls: an arena and a start already varied (or none to
//     vary: a sandbox, a test, a tool). It never applies `variant` again; it only keeps it, and checks that `seed` is its seed.
//
// Building (before t = 0):
//   1. The start is checked against the arena: a start where any part of the robot (body, wheels, caster, each servo arm at every
//      angle it can turn to) would stand in a wall, box, cylinder or object is a ScenarioError on `start` that names the thing
//      (robot/footprint.ts). Nothing is shoved aside.
//   2. Physics is loaded (`initPhysics`, once per page), the arena is built, the robot is assembled at the start and the whole
//      world settles for SETTLE_STEPS (assembly.ts): the robot comes to rest on its supports, and so does everything else.
//      **For scenario authors: t = 0 is after the settle.** An arena's moving bodies (dynamic boxes and cylinders, objects) stand
//      at t = 0 where the settle left them: one authored standing on the floor sinks a tenth of a millimetre, two authored into
//      each other have been pushed apart. Goals and snapshots only ever see the poses after the settle.
//   3. The sensors are read for tick 0.
//
// Ticks (plan §3): `step(PHYSICS_DT_S)` and nothing else; the world counts them, and `t` is `tick / PHYSICS_HZ`, never a sum of
// steps. R3.6 advances the program to `tick * 1000 / PHYSICS_HZ` ms from the count, so the program's clock and the world's never
// drift apart. N19 B2: a kit with a gripper runs its grasp machine after each step, before the measure (robot/grasp.ts). After each step
// the world measures once, and everything that tick reads shares that measure:
//   - `readContacts` runs once per tick (it costs ~20 µs); `sense.contacts()`, the snapshot and the goal frame read its result. N19: an
//     object held during the tick (before or after its grasp update) is part of the robot for it (plan §4.4), so a held cube that meets a
//     wall is the robot meeting the wall, also on the tick the hit breaks the grasp;
//   - each ultrasonic is measured once per tick, its noise (if any) drawn once per tick from the seed, so what the program reads
//     does not depend on how often it reads, nor on whether a view is listening;
//   - each line sensor is read once per tick;
//   - N19 B3: each IR obstacle sensor and each colour sensor is measured once per tick (sensors/ir.ts, sensors/color.ts), after the grasp
//     machine, so a cube attached in this tick's update is seen held;
//   - `outOfArena` is latched: once the robot has left the arena (R3.4 `isOutOfArena`, a step with no hysteresis), it stays out for
//     the rest of the run.
// The snapshot of a tick is built when first asked for, frozen, and the same object until the next step.
//
// Sensors compose the kit's mount with the chassis pose (kit.ts `KitModule.mount`): the ultrasonic looks along the mount's yaw from
// its position, a line sensor looks down from its position (R3.4's pure measures).
//
// N19 B3, the gripper car (plan §4.4). A module with `mount.on: 'gripper'` rides on the carriage: its mount is in the carriage frame (u
// forward, v left, w up from the boom's tip), composed with the carriage's pose. The IR and the colour sensor look ahead of the carriage
// along the mount's yaw and meet the bodies `sensedBodies` names: the arena's, each with its colour, and the gripper's own parts
// (`#gripper`); they pass through the carriage they sit in and the boom's cross bar at its hinge, and the colour sensor through the floor
// (it looks ahead, never at the mat).
// Its ultrasonic reads the same lookup and leaves out the chassis only: it hears the jaws and the carriage when they are in its cone, as a
// real HC-SR04 does (never at lift 0° nor 90°: world.gripper-sensors.test.ts). A kit without a gripper (the rover) measures its ultrasonic
// exactly as before: the arena's lookup, the robot's every collider left out.
//
// What the goals need besides the snapshot (`frameExtras`, goal-frame.ts):
//   - `speedCmS`, how fast the robot drives: the speed over the floor of the middle of its wheel axle, the point a two-wheel robot
//     turns about, less what turning about a point up to TURN_IN_PLACE_TOLERANCE_CM (1 cm) from it accounts for: max(0, |v_axle| −
//     |ω| · 1 cm), the speed of the slowest point within 1 cm of the axle's middle. Driving straight it is the axle's speed; spinning
//     in place it is 0, though the middle of the body (2 cm ahead of the axle on ref-uno-rover@0) circles; pivoting on one wheel it is
//     (7.5 − 1) / 7.5 of the axle's. `stay-on-line` weighs its share of the distance by it and `stop-in-zone` holds it under its limit,
//     so a robot that only spins drives no distance, and is stopped. Where the robot *is* stays the middle of its body (the pose, R6.1),
//     which is what the guard goals' reach (the farthest from the start, R5.2a fix round 1) is measured from.
//   - `servoRangeDeg`, each servo's minDeg..maxDeg, which the adapter clamps the arm's physical angle to (the snapshot keeps it).
//   - the contacts of the tick and the robot's outline on the floor.
//   - N19 B4, for a kit with a gripper only: each arena object's shape and what it rests on (`objects`, sensors/resting.ts), for the frame's
//     `tiltDeg` and `restingOn`; its source then carries the gripper and each object's height and rotation (goal-frame.ts). A kit without a
//     gripper gives exactly what it gave before.

/** What a world is built from. The arena and the start are the variant's already (`applyVariant`). */
export type WorldInput = {
  /** A validated arena (`parseArena`). */
  readonly arena: Arena;
  /** Where the robot starts: the point under the middle of its body and its heading (arena frame). */
  readonly start: RobotStart;
  readonly kit: Kit;
  /** The seed of the world's random numbers (the ultrasonic noise): the variant's (`variantSeed`). A safe whole number. */
  readonly seed: number;
  /** The variant the arena and start come from, kept for the run (`world.variant`); its `seed` must be `seed`. */
  readonly variant?: VariantOffsets;
  /** Uniform noise on every ultrasonic reading, ±cm, drawn from the seed; 0 (the default) is none (plan §9: no noise by default). */
  readonly ultrasonicNoiseCm?: number;
};

/** What an ultrasonic hears on this tick. */
export type UltrasonicSense = {
  /** Distance, cm: within the sensor's range, or 400 without an echo (R3.4). */
  readonly cm: number;
  /** The echo pulse's width for pulseIn, µs; 0 without an echo. */
  readonly echoUs: number;
  /** What the echo came from (an arena id; N19 B3 on a gripper car `#gripper`, its own gripper), or null without one. */
  readonly hitId: string | null;
};

export type WorldSense = {
  /** The ultrasonic's distance on this tick, cm. Throws a RangeError for a role the kit has no ultrasonic for. */
  distanceCm(role: string): number;
  /** The ultrasonic's whole reading on this tick, the echo width included. */
  ultrasonic(role: string): UltrasonicSense;
  /** The mean reflectance under a line sensor on this tick, 0 (black) to 1 (white). Throws a RangeError for a role the kit has no line sensor for. */
  groundReflectance(role: string): number;
  /** The line sensor's whole reading on this tick: reflectance, dark, the pin's ADC value and level (the kit port's polarity). */
  line(role: string): LineReading;
  /** What the robot touches on this tick, the floor included, once per id in id order (R3.4 `readContacts`). The same array all tick. */
  contacts(): readonly ContactEvent[];
  /** N19 B3: the IR obstacle sensor's reading on this tick. Throws a RangeError for a role the kit has no IR sensor for. */
  ir(role: string): IrSense;
  /** N19 B3: the colour sensor's reading on this tick, the light on its photodiodes included. Throws a RangeError for a role the kit has no colour sensor for. */
  color(role: string): ColorSense;
};

/** N19 B3: what an IR obstacle sensor sees on this tick (sensors/ir.ts). */
export type IrSense = {
  readonly detected: boolean;
  /** The pin's level for the ir-digital driver's digitalRead (the kit port's polarity: active low, LOW while it sees). */
  readonly level: 0 | 1;
  /** The first body its ray met within range (an arena id, or `#gripper`), seen or not; null without one. */
  readonly hitId: string | null;
};

/** N19 B3: what a colour sensor sees on this tick (sensors/color.ts). */
export type ColorSense = {
  readonly hitId: string | null;
  readonly distanceCm: number | null;
  /** The light on its photodiodes, counts per second at 1× gain, whole numbers: what the run session integrates for the TCS34725 model. */
  readonly light: Rgbc;
};

export type World = {
  /** Ticks stepped since t = 0. */
  readonly tick: number;
  /** Simulated time, s: `tick / PHYSICS_HZ`. */
  readonly t: number;
  /** Whether the robot has left the arena, at any tick so far (latched). */
  readonly outOfArena: boolean;
  /** The arena the world was built from (the variant's). */
  readonly arena: Arena;
  readonly kit: Kit;
  /** The variant the world was built for, or null when it was built without one. */
  readonly variant: VariantOffsets | null;
  /** One tick: `dt` must be PHYSICS_DT_S (1/120 s); anything else is a RangeError. Then the sensors are read for the new tick. */
  step(dt: number): void;
  /** The actuator targets for the next steps (assembly.ts `ActuatorTargets`: motors left out stop, servos left out hold). */
  applyActuators(targets: ActuatorTargets): void;
  readonly sense: WorldSense;
  /** The snapshot of this tick: frozen, the same object until the next step (snapshot.ts). */
  snapshot(): RobotSnapshot;
  /** What a goal frame needs besides the snapshot (goal-frame.ts `toGoalFrame`): this tick's contacts, speed and outline. */
  frameExtras(): GoalFrameExtras;
  /**
   * N18 R3.6: this tick's goal frame straight from the bodies and this tick's measures, without building the snapshot (a run feeds
   * its goals every tick and builds a snapshot only for a view). `run` is what only the run session knows: the LEDs and the buzzer
   * (from the virtual UNO's pins). Equal to `toGoalFrame({ ...snapshot(), leds }, { ...frameExtras(), buzzerHz })`; a new object each call.
   */
  goalFrame(run: { readonly leds: Readonly<Record<string, boolean>>; readonly buzzerHz: number | null }): GoalFrame;
  /** Frees the physics world. Every other use after it throws; a second call does nothing. */
  dispose(): void;
};

/** What a scenario world can be asked for besides the scenario, kit and variant. */
export type ScenarioWorldOptions = Pick<WorldInput, 'ultrasonicNoiseCm'>;

/**
 * The world of variant `variantIndex` of `scenario` for `kit`: the variant's offsets applied to the scenario's start and arena, the
 * variant's seed. The main entry point (see the top of this file). Throws a RangeError for a kit that is not the scenario's or a
 * variant it does not have, and a ScenarioError (with the scenario's key) for a start that overlaps the arena.
 */
export async function createScenarioWorld(scenario: Scenario, kit: Kit, variantIndex: number, options: ScenarioWorldOptions = {}): Promise<World> {
  if (scenario.kit !== kit.id) {
    throw new RangeError(`Scenario "${scenario.key}" runs on the kit "${scenario.kit}", not "${kit.id}".`);
  }
  const offsets = variantOffsets(scenario, variantIndex, kitFootprintRadiusCm(kit));
  const { start, arena } = applyVariant(scenario, offsets);
  const input: WorldInput = { ...options, arena, start, kit, seed: offsets.seed, variant: offsets };
  checkInput(input);
  await initPhysics();
  return buildWorld(input, scenario.key);
}

/**
 * A world for an arena and a start (already varied, see the top of this file). Loads physics first (once per page). Throws a
 * ScenarioError on `start` when the robot would overlap the arena, a RangeError for a bad seed or noise, and a HardwareDataError for
 * a kit without valid mechanics.
 */
export async function createWorld(input: WorldInput): Promise<World> {
  checkInput(input);
  await initPhysics();
  return buildWorld(input, undefined);
}

function checkInput(input: WorldInput): void {
  createWorldRng(input.seed);
  if (input.variant !== undefined && input.variant.seed !== input.seed) {
    throw new RangeError(`The seed of variant ${input.variant.index} is ${input.variant.seed}, not ${input.seed}.`);
  }
  const noise = input.ultrasonicNoiseCm ?? 0;
  if (!(noise >= 0 && Number.isFinite(noise))) {
    throw new RangeError(`The ultrasonic noise is a finite number of cm, 0 or more, not ${noise}.`);
  }
}

/**
 * A robot turning about a point this close to the middle of its wheel axle is turning in place: it is not driving (its
 * `speedCmS` is 0). R3.3's drive spins a robot told to spin about a point 0.3 to 0.6 cm from the axle's middle (measured, duty
 * 100 to 255, after the first second), not about the middle itself.
 */
export const TURN_IN_PLACE_TOLERANCE_CM = 1;

type UltrasonicSensor = { readonly role: string; readonly spec: UltrasonicSpec; readonly at: Vec3; readonly turn: Quat };
type LineSensor = { readonly role: string; readonly spec: LineSensorSpec; readonly at: Vec3; readonly activeLow: boolean };
type LineState = { readonly reading: LineReading; readonly spotCm: readonly [number, number] | null };
/** N19 B3: a sensor on the chassis, or on the gripper's carriage (`mount.on: 'gripper'`), at `at` of that body, turned by `turn`. */
type RidingSensor<S> = { readonly role: string; readonly spec: S; readonly on: 'chassis' | 'gripper'; readonly at: Vec3; readonly turn: Quat };
type IrSensor = RidingSensor<IrObstacleSpec> & { readonly activeLow: boolean };
type ColorSensor = RidingSensor<ColorSensorSpec>;

const NO_SCORE: ScoreState = deepFreeze({ points: 0, maxScore: null, goals: [] });
/** The kinds of module the snapshot's `sensors` reads, in kit order (N19 B3: the IR and the colour sensor too). */
const SENSOR_KINDS: ReadonlySet<string> = new Set(['ultrasonic', 'line-sensor', 'ir-obstacle', 'color-sensor']);
const NO_PINS = Object.freeze([]);

/** The world, from an input `checkInput` has passed, once physics is loaded. */
function buildWorld(input: WorldInput, scenarioKey: string | undefined): World {
  const { arena, start, kit } = input;
  const issues = startFootprintIssues(arena, kit, start, input.variant?.index);
  if (issues.length > 0) throw new ScenarioError(scenarioKey, issues);

  const footprint = robotFootprint(kit);
  const mechanics = robotMechanics(kit);
  // The middle of the wheel axle on the floor: where the robot's drive speed is measured (`buildExtras`).
  const [axleX, leftY] = mechanics.motorLeft.mount.posCm;
  const axle = robotPointToLocal([axleX, (leftY + mechanics.motorRight.mount.posCm[1]) / 2, 0]);
  const servoRangeDeg: Readonly<Record<string, readonly [number, number]>> = Object.freeze(
    Object.fromEntries(mechanics.servos.map((servo) => [servo.role, Object.freeze([servo.spec.minDeg, servo.spec.maxDeg] as const)])),
  );
  const ultrasonics: UltrasonicSensor[] = [];
  const lines: LineSensor[] = [];
  const irs: IrSensor[] = [];
  const colors: ColorSensor[] = [];
  for (const module of kit.modules) {
    const at = robotPointToLocal(module.mount.posCm);
    const turn = yawToQuaternion(degToRad(module.mount.yawDeg));
    const on = module.mount.on === 'gripper' ? 'gripper' : 'chassis';
    if (module.kind === 'ultrasonic') {
      ultrasonics.push({ role: module.role, spec: module.spec as unknown as ModuleSpecs['ultrasonic'], at, turn });
    } else if (module.kind === 'line-sensor') {
      const port = portOfRole(kit, module.role);
      lines.push({ role: module.role, spec: module.spec as unknown as ModuleSpecs['line-sensor'], at, activeLow: port !== undefined && portParam(port, 'activeLow') === true });
    } else if (module.kind === 'ir-obstacle') {
      // ir-digital's activeLow defaults to true (the common modules pull LOW when they see), as the driver reads it.
      const port = portOfRole(kit, module.role);
      irs.push({ role: module.role, spec: module.spec as unknown as ModuleSpecs['ir-obstacle'], on, at, turn, activeLow: port === undefined || portParam(port, 'activeLow') !== false });
    } else if (module.kind === 'color-sensor') {
      colors.push({ role: module.role, spec: module.spec as unknown as ModuleSpecs['color-sensor'], on, at, turn });
    }
  }
  const sensorOrder = kit.modules.filter((module) => SENSOR_KINDS.has(module.kind)).map((module) => module.role);
  const leds: Readonly<Record<string, boolean>> = Object.freeze(Object.fromEntries(kit.modules.filter((module) => module.kind === 'led').map((module) => [module.role, false])));
  const outline = footprint.outlineCm.map(([x, y]) => robotPointToLocal([x, y, 0]));
  const noiseCm = input.ultrasonicNoiseCm ?? 0;
  const noise: UltrasonicNoise | undefined = noiseCm > 0 ? { rng: createWorldRng(input.seed), amplitudeCm: noiseCm } : undefined;
  const paint = createGroundPaint(arena);

  const physics: PhysicsWorld = createPhysicsWorld();
  let built: BuiltArena;
  let robot: RobotBody;
  try {
    built = buildArena(physics, arena);
    robot = assembleRobot(physics, kit, start, mechanics.gripper === null ? {} : { graspObjects: graspObjects(arena, built) });
  } catch (error) {
    physics.free();
    throw error;
  }

  // N19 B3: what the gripper car's sensors meet (see the top of this file); a rover never builds it. Its ultrasonic leaves out the chassis
  // only; the rover's leaves out every collider of the robot, through the arena's lookup, as before.
  const gripper = robot.gripper;
  const sensed = gripper === null && irs.length === 0 && colors.length === 0 ? null : sensedBodies(built, gripper);
  // `sensed` is never null with a gripper; testing it too only narrows the type.
  const ultrasonicLookup: ColliderLookup<SensedCollider> = gripper === null || sensed === null ? built : sensed;
  const ultrasonicExclude: (collider: Collider) => boolean = gripper === null ? robot.ownsCollider : (collider) => robot.ownsCollider(collider) && !gripper.ownsCollider(collider);
  // The sensors on the carriage sit in it, by its hinge, where the boom's cross bar meets it: their mount (u 0.3) lies inside the carriage's
  // box (u ±0.5) and inside the bar's square section (0.3 cm half, turned with the boom: from its centre at u 0, 0.39 cm along u at lift 0°).
  // A ray from inside a solid meets it at once, so both are left out; behind the sensors, neither is ever ahead of them. The fingers, the one
  // part of the gripper ahead of them, stay in: with nothing between the jaws the rays never meet them (world.gripper-sensors.test.ts).
  const onMount = (collider: Collider) => {
    const handle = collider.parent()?.handle;
    return gripper !== null && (handle === gripper.carriage.handle || handle === gripper.boom.handle);
  };
  const isFloor = (collider: Collider) => built.infoOf(collider)?.kind === 'ground';
  const lookColor = (collider: Collider) => onMount(collider) || isFloor(collider);
  /** Where a sensor riding on the chassis or the carriage is now, and where it looks. */
  const ridingPose = (sensor: RidingSensor<unknown>) => {
    const body = sensor.on === 'gripper' && gripper !== null ? gripper.carriage : robot.chassis;
    const position = body.translation();
    const rotation = body.rotation();
    return { position: localToWorld(position, rotation, sensor.at), rotation: multiplyQuaternions(rotation, sensor.turn) };
  };

  let tick = 0;
  let disposed = false;
  let outOfArena = false;
  // This tick's measures, and what is built from them on demand.
  let contacts: readonly ContactEvent[] = [];
  const heard = new Map<string, UltrasonicSense>();
  const seen = new Map<string, LineState>();
  const irSeen = new Map<string, IrSense>();
  const colorSeen = new Map<string, ColorSense>();
  let snapshot: RobotSnapshot | null = null;
  let extras: GoalFrameExtras | null = null;

  const events = new Map<string, ContactEvent>();
  const eventOf = (info: ArenaColliderInfo): ContactEvent => {
    let event = events.get(info.id);
    if (event === undefined) {
      event = deepFreeze({ otherId: info.id, kind: info.kind, tags: [...info.tags] });
      events.set(info.id, event);
    }
    return event;
  };

  /** What the robot is for the contacts of a tick: its bodies, and (N19) the object it held during the tick, before or after the grasp's update. */
  const touchingBodies = (heldBefore: RigidBody | null) => {
    const heldNow = robot.grasp === null ? null : robot.grasp.heldBody;
    const held = [heldBefore, heldNow].filter((body, i, all): body is RigidBody => body !== null && all.indexOf(body) === i);
    return held.length === 0 ? robot.bodies : [...robot.bodies, ...held];
  };

  const measure = (heldBefore: RigidBody | null) => {
    const position = robot.chassis.translation();
    const rotation = robot.chassis.rotation();
    contacts = Object.freeze(readContacts(physics, built, touchingBodies(heldBefore)).map(eventOf));
    for (const sensor of ultrasonics) {
      const pose = { position: localToWorld(position, rotation, sensor.at), rotation: multiplyQuaternions(rotation, sensor.turn) };
      const reading = measureUltrasonic(physics, ultrasonicLookup, pose, sensor.spec, { exclude: ultrasonicExclude, ...(noise === undefined ? {} : { noise }) });
      heard.set(sensor.role, Object.freeze({ cm: reading.cm, echoUs: reading.echoUs, hitId: reading.hit === null ? null : reading.hit.id }));
    }
    for (const sensor of lines) {
      const at = localToWorld(position, rotation, sensor.at);
      const reading = Object.freeze(measureLine(paint, at, sensor.spec, { activeLow: sensor.activeLow }));
      const point = worldToArena(at);
      const onFloor = point.heightCm <= LIFTED_HEIGHT_CM && Number.isFinite(point.xCm) && Number.isFinite(point.yCm);
      seen.set(sensor.role, { reading, spotCm: onFloor ? Object.freeze([plain(point.xCm), plain(point.yCm)] as const) : null });
    }
    if (sensed !== null) {
      for (const sensor of irs) {
        const reading = measureIr(physics, sensed, ridingPose(sensor), sensor.spec, { exclude: onMount, activeLow: sensor.activeLow });
        irSeen.set(sensor.role, Object.freeze({ detected: reading.detected, level: reading.level, hitId: reading.hit === null ? null : reading.hit.id }));
      }
      for (const sensor of colors) {
        const reading = measureColor(physics, sensed, ridingPose(sensor), sensor.spec, { exclude: lookColor });
        colorSeen.set(sensor.role, deepFreeze({ hitId: reading.hit === null ? null : reading.hit.id, distanceCm: reading.distanceCm === null ? null : plain(reading.distanceCm), light: { ...reading.light } }));
      }
    }
    outOfArena = outOfArena || isOutOfArena(arena, position);
    snapshot = null;
    extras = null;
  };

  const alive = () => {
    if (disposed) throw new Error('The world has been disposed.');
  };
  const ultrasonicOf = (role: string): UltrasonicSense => {
    alive();
    const reading = heard.get(role);
    if (reading === undefined) throw new RangeError(`The kit has no ultrasonic sensor "${role}".`);
    return reading;
  };
  const irOf = (role: string): IrSense => {
    alive();
    const reading = irSeen.get(role);
    if (reading === undefined) throw new RangeError(`The kit has no IR sensor "${role}".`);
    return reading;
  };
  const colorOf = (role: string): ColorSense => {
    alive();
    const reading = colorSeen.get(role);
    if (reading === undefined) throw new RangeError(`The kit has no colour sensor "${role}".`);
    return reading;
  };
  const lineOf = (role: string): LineState => {
    alive();
    const state = seen.get(role);
    if (state === undefined) throw new RangeError(`The kit has no line sensor "${role}".`);
    return state;
  };

  const servoDegOf = (): Record<string, number> => Object.fromEntries(Object.entries(robot.servoAngles()).map(([role, deg]) => [role, plain(deg!)]));
  /** N19: the gripper of the snapshot, only for a kit that has one. */
  const gripperOf = (): { gripper?: SnapshotGripper } =>
    robot.gripper === null ? {} : { gripper: { clawDeg: plain(robot.gripper.clawDeg()), liftDeg: plain(robot.gripper.liftDeg()), heldId: robot.grasp!.heldId } };

  const buildSnapshot = (): RobotSnapshot => {
    const [left, right] = robot.wheelAngles();
    const sensors: SensorReadout[] = sensorOrder.map((role): SensorReadout => {
      const echo = heard.get(role);
      if (echo !== undefined) return { role, kind: 'ultrasonic', cm: plain(echo.cm), hitId: echo.hitId };
      const ir = irSeen.get(role);
      if (ir !== undefined) return { role, kind: 'ir-obstacle', detected: ir.detected, hitId: ir.hitId };
      const color = colorSeen.get(role);
      if (color !== undefined) return { role, kind: 'color-sensor', hitId: color.hitId, distanceCm: color.distanceCm };
      const { reading, spotCm } = seen.get(role)!;
      return { role, kind: 'line-sensor', reflectance: plain(reading.reflectance), dark: reading.dark, spotCm };
    });
    return deepFreeze({
      t: tick / PHYSICS_HZ,
      robot: {
        ...poseOf(robot.chassis.translation(), robot.chassis.rotation()),
        wheelRad: [plain(left), plain(right)] as const,
        servoDeg: servoDegOf(),
        ...gripperOf(),
      },
      objects: built.dynamicBodies.map(({ id, kind, body }) => ({ id, kind, pose: poseOf(body.translation(), body.rotation()) })),
      sensors,
      pins: NO_PINS,
      leds,
      activeBlockId: null,
      status: 'idle',
      outOfArena,
      score: NO_SCORE,
    });
  };

  /** What toGoalFrame reads of this tick, without what only a view needs (see `World.goalFrame`). N19 B4: with a gripper, its snapshot's gripper and each object's height and rotation. */
  const goalSource = (leds: Readonly<Record<string, boolean>>): GoalFrameSource => {
    const sensors: GoalFrameSource['sensors'][number][] = [];
    for (const sensor of lines) sensors.push({ kind: 'line-sensor', spotCm: seen.get(sensor.role)!.spotCm });
    const objectPose = gripper === null ? standingPoseOf : poseOf;
    return {
      t: tick / PHYSICS_HZ,
      robot: { ...standingPoseOf(robot.chassis.translation(), robot.chassis.rotation()), servoDeg: servoDegOf(), ...gripperOf() },
      objects: built.dynamicBodies.filter(({ kind }) => kind === 'object').map(({ id, kind, body }) => ({ id, kind, pose: objectPose(body.translation(), body.rotation()) })),
      sensors,
      leds,
      outOfArena,
    };
  };

  const buildExtras = (): GoalFrameExtras => {
    const position = robot.chassis.translation();
    const rotation = robot.chassis.rotation();
    // The drive speed (see the top of this file): the axle's middle moves at the centre of mass's velocity plus ω × (axle − centre
    // of mass); seen over the floor, the slowest point within TURN_IN_PLACE_TOLERANCE_CM of it moves at that speed less ω times it.
    const v = robot.linvel();
    const w = robot.angvel();
    const com = robot.chassis.worldCom();
    const at = localToWorld(position, rotation, axle);
    const r = { x: at.x - com.x, y: at.y - com.y, z: at.z - com.z };
    const vx = v.x + (w.y * r.z - w.z * r.y);
    const vz = v.z + (w.x * r.y - w.y * r.x);
    const axleCmS = Math.sqrt(vx * vx + vz * vz) * CM_PER_M;
    const speedCmS = Math.max(0, axleCmS - Math.abs(w.y) * TURN_IN_PLACE_TOLERANCE_CM);
    const pointsCm: PointCm[] = outline.map((local) => {
      const point = worldToArena(localToWorld(position, rotation, local));
      return [plain(point.xCm), plain(point.yCm)];
    });
    const objects = gripper === null ? {} : { objects: objectExtras() };
    return deepFreeze({ contacts, speedCmS: plain(speedCmS), footprint: { kind: 'polygon', pointsCm }, servoRangeDeg, ...objects });
  };

  /** N19 B4: each arena object's shape and what it rests on, for a gripper car's goal frame (see the top of this file). */
  const objectShapes = new Map(arena.objects.map((object) => [object.id, object.shape]));
  const objectExtras = (): Record<string, GoalFrameObjectExtras> =>
    Object.fromEntries(
      built.dynamicBodies
        .filter(({ kind }) => kind === 'object')
        .map(({ id, body }) => [id, { shape: objectShapes.get(id) ?? 'box', restingOn: restingOn(physics, built, body.collider(0)) }]),
    );

  try {
    measure(null);
  } catch (error) {
    physics.free();
    throw error;
  }

  const world: World = {
    get tick() {
      return tick;
    },
    get t() {
      return tick / PHYSICS_HZ;
    },
    get outOfArena() {
      return outOfArena;
    },
    arena,
    kit,
    variant: input.variant ?? null,
    step(dt) {
      alive();
      if (dt !== PHYSICS_DT_S) {
        throw new RangeError(`The world steps in ticks of 1/${PHYSICS_HZ} s (PHYSICS_DT_S) only, not ${dt} s.`);
      }
      const heldBefore = robot.grasp === null ? null : robot.grasp.heldBody;
      stepWorld(physics, robot);
      tick += 1;
      robot.grasp?.update(PHYSICS_DT_S);
      measure(heldBefore);
    },
    applyActuators(targets) {
      alive();
      robot.applyActuators(targets);
    },
    sense: {
      distanceCm: (role) => ultrasonicOf(role).cm,
      ultrasonic: ultrasonicOf,
      groundReflectance: (role) => lineOf(role).reading.reflectance,
      line: (role) => lineOf(role).reading,
      contacts: () => {
        alive();
        return contacts;
      },
      ir: irOf,
      color: colorOf,
    },
    snapshot() {
      alive();
      snapshot ??= buildSnapshot();
      return snapshot;
    },
    frameExtras() {
      alive();
      extras ??= buildExtras();
      return extras;
    },
    goalFrame(run) {
      alive();
      extras ??= buildExtras();
      return toGoalFrame(goalSource(run.leds), { ...extras, buzzerHz: run.buzzerHz });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      // N19: a held object is let go first, so no joint of the grasp outlives the run (plan §5 Review Focus 2).
      robot.grasp?.release();
      physics.free();
    },
  };
  return world;
}

/** `-0` becomes `+0` (JSON writes both as 0, and a round trip must give the same snapshot). */
function plain(n: number): number {
  return n + 0;
}

/** A body's pose in the arena frame (snapshot.ts `Pose`). The rotation's vector part goes from world (x, y, z) to arena (x, −z, y). */
function poseOf(position: Vec3, rotation: Quat): Pose {
  const point = worldToArena(position);
  return {
    xCm: plain(point.xCm),
    yCm: plain(point.yCm),
    zCm: plain(point.heightCm),
    yawDeg: plain(radToDeg(yawOfQuaternion(rotation))),
    rotation: { x: plain(rotation.x), y: plain(0 - rotation.z), z: plain(rotation.y), w: plain(rotation.w) },
  };
}

/** Where a body stands on the floor, as a goal reads it: the x, y and yaw of `poseOf`, the same numbers. */
function standingPoseOf(position: Vec3, rotation: Quat): Pick<Pose, 'xCm' | 'yCm' | 'yawDeg'> {
  const point = worldToArena(position);
  return { xCm: plain(point.xCm), yCm: plain(point.yCm), yawDeg: plain(radToDeg(yawOfQuaternion(rotation))) };
}

/** Freezes a JSON value and everything in it; returns it. */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const item of Object.values(value)) deepFreeze(item);
  }
  return value;
}
