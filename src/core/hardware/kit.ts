import type { PinCap } from './board';
import { TCS34725_ADDRESS } from './devices/tcs34725';

// The kit (N18 R1.1, robot plan §4.2): which modules a robot has and how they are wired, as data (`kits/*.kit.json`,
// validated by kit-schema.ts). The chain is role → port → driver → pins: a program names a role (`motorLeft`), the kit says
// which port holds it (`M1`), the port says which driver runs it (`hbridge-en-in1-in2`) and on which board pins (EN=D5…).
// A vendor kit is a new JSON file; a new module kind or driver is engine work (plan VG).

/**
 * What a module is. Closed: a new kind needs a block, an IR op, a contract row, a model and a goal (plan VG). N19 A2 adds the gripper car's:
 * the two-servo gripper (claw and lift), the IR obstacle sensor between its jaws and the TCS34725 colour sensor.
 */
export const moduleKinds = ['dc-motor', 'servo', 'ultrasonic', 'line-sensor', 'led', 'buzzer', 'button', 'gripper', 'ir-obstacle', 'color-sensor'] as const;
export type ModuleKind = (typeof moduleKinds)[number];

/** The drivers: reviewed TS (simulator) and C++ (generated sketch) code, referenced by id (B6). */
export const driverIds = [
  'hbridge-en-in1-in2',
  'servo-lib',
  'hcsr04-pulsein',
  'line-digital',
  'line-analog',
  'led-digital',
  'buzzer-tone',
  'button-pullup',
  // N19 A3: the gripper's two servos on the Servo library, a digital IR obstacle sensor, the TCS34725 on raw Wire.
  'gripper-servo2',
  'ir-digital',
  'tcs34725-wire',
] as const;
export type DriverId = (typeof driverIds)[number];

/** The role vocabulary of the robot (plan §4.2): the blocks' dropdowns list all of it; a role the kit lacks is capability-unavailable. */
export const robotRoles = [
  'motorLeft',
  'motorRight',
  'ultrasonic',
  'lineLeft',
  'lineCenter',
  'lineRight',
  'servo1',
  'led1',
  'buzzer',
  'button1',
  // N19 A2: the gripper, the IR sensor between its jaws, the colour sensor.
  'gripper',
  'irClaw',
  'color1',
] as const;
export type RobotRole = (typeof robotRoles)[number];

/** The module kind each role is. */
export const roleKinds: Readonly<Record<RobotRole, ModuleKind>> = {
  motorLeft: 'dc-motor',
  motorRight: 'dc-motor',
  ultrasonic: 'ultrasonic',
  lineLeft: 'line-sensor',
  lineCenter: 'line-sensor',
  lineRight: 'line-sensor',
  servo1: 'servo',
  led1: 'led',
  buzzer: 'buzzer',
  button1: 'button',
  gripper: 'gripper',
  irClaw: 'ir-obstacle',
  color1: 'color-sensor',
};

export type DriverPinSpec = {
  /** The capability the board pin must have. */
  readonly needs: PinCap;
  /** The driver drives this pin (`out`) or reads it (`in`). */
  readonly dir: 'out' | 'in';
  /** The program may also read the module's signal on this pin as an analog value (`line.raw`, contract U-29) when the board pin has analogIn. */
  readonly analog?: true;
  /**
   * N19 A2: the I²C line this pin is (with `needs: 'i2c'`): it must be the board's own pin of that line (`BoardProfile.i2c`), since Wire
   * runs on the MCU's TWI there and nowhere else (kit rule wrong-i2c-pin). Neither line is a raw input, so both are `dir: 'out'`.
   */
  readonly i2c?: 'sda' | 'scl';
};

export type DriverParamSpec = { readonly type: 'boolean'; readonly default: boolean };

/** What a port of a driver must wire: its pins, by the names the C++ forms use (`<ROLE>_EN`), and its params. */
export type DriverPortSpec = {
  readonly kind: ModuleKind;
  readonly pins: Readonly<Record<string, DriverPinSpec>>;
  readonly params?: Readonly<Record<string, DriverParamSpec>>;
  /** The board `timerClaims` entry the driver's code takes while the program uses it (Servo library: servo; tone: tone). */
  readonly claims?: string;
  /** N19 A2: the I²C address the device answers at; two devices of a kit at one address is the kit rule i2c-address-conflict. */
  readonly i2cAddress?: number;
};

export const driverPortSpecs: Readonly<Record<DriverId, DriverPortSpec>> = {
  'hbridge-en-in1-in2': {
    kind: 'dc-motor',
    pins: { EN: { needs: 'pwm', dir: 'out' }, IN1: { needs: 'digital', dir: 'out' }, IN2: { needs: 'digital', dir: 'out' } },
  },
  'servo-lib': { kind: 'servo', pins: { PIN: { needs: 'digital', dir: 'out' } }, claims: 'servo' },
  'hcsr04-pulsein': { kind: 'ultrasonic', pins: { TRIG: { needs: 'digital', dir: 'out' }, ECHO: { needs: 'digital', dir: 'in' } } },
  'line-digital': {
    kind: 'line-sensor',
    pins: { PIN: { needs: 'digital', dir: 'in', analog: true } },
    // Contract U-28: dark is LOW when the kit says activeLow, HIGH otherwise.
    params: { activeLow: { type: 'boolean', default: false } },
  },
  'line-analog': { kind: 'line-sensor', pins: { PIN: { needs: 'analogIn', dir: 'in', analog: true } } },
  'led-digital': { kind: 'led', pins: { PIN: { needs: 'digital', dir: 'out' } } },
  'buzzer-tone': { kind: 'buzzer', pins: { PIN: { needs: 'digital', dir: 'out' } }, claims: 'tone' },
  'button-pullup': { kind: 'button', pins: { PIN: { needs: 'digital', dir: 'in' } } },
  // N19 A3 (plan §4.1, D-G2): one port, two servos on the Servo library, which takes Timer1 as servo-lib does (U-48).
  'gripper-servo2': {
    kind: 'gripper',
    pins: { CLAW: { needs: 'digital', dir: 'out' }, LIFT: { needs: 'digital', dir: 'out' } },
    claims: 'servo',
  },
  // An IR obstacle module's output: LOW while it sees something when the kit says activeLow (the common modules do, hence the default).
  'ir-digital': { kind: 'ir-obstacle', pins: { PIN: { needs: 'digital', dir: 'in' } }, params: { activeLow: { type: 'boolean', default: true } } },
  // The TCS34725 on Wire (D-G7): the board's SDA and SCL, at the part's one address (datasheet TAOS135: 0x29).
  'tcs34725-wire': {
    kind: 'color-sensor',
    pins: { SDA: { needs: 'i2c', dir: 'out', i2c: 'sda' }, SCL: { needs: 'i2c', dir: 'out', i2c: 'scl' } },
    i2cAddress: TCS34725_ADDRESS,
  },
};

export type KitPort = {
  /** The port's label on the robot: `M1`. */
  readonly id: string;
  readonly driver: DriverId;
  /** Driver pin name → board pin: `{ EN: 'D5', IN1: 'D7', IN2: 'D8' }`. */
  readonly pins: Readonly<Record<string, string>>;
  readonly params?: Readonly<Record<string, number | boolean>>;
};

/**
 * A module's physical parameters, as the kit schema gives them to everyone: a record. Its keys depend on the module's kind
 * (`ModuleSpecs`); loadKit checks them (kit-mechanics.ts), and the world reads them typed through `modulesOfKind` /
 * `robotMechanics`.
 */
export type ModuleSpec = Readonly<Record<string, number | boolean | string>>;

/**
 * A DC gear motor and the wheel on its shaft (N18 R3.3). The world turns it into the torque line T = T_s·(u − ω/ω₀), with
 * u = duty/255 × dir and ω₀ = maxRpm in rad/s, a first-order lag of `tauS` on the wheel speed it aims at, and the gearbox's
 * Coulomb friction T_f, which holds a stopped wheel and slows a running one: unloaded, the wheel runs at ω₀·(u − T_f/T_s),
 * so at full duty at 1 − T_f/T_s of ω₀ (about 69 % for ref-uno-rover@0's placeholders).
 */
export type DcMotorSpec = {
  /**
   * ω₀ of the torque line, in rpm: the wheel speed at full duty with no load and no gearbox friction. The wheel runs free at
   * ω₀·(1 − T_f/T_s), so a datasheet's measured no-load speed n₀ is maxRpm = n₀ / (1 − gearFrictionNm/stallTorqueNm).
   */
  readonly maxRpm: number;
  /** Time constant of the first-order response of the wheel speed to a new command, in s (0: none). */
  readonly tauS: number;
  /** Torque at the wheel when stalled at full duty (T_s), in N·m. */
  readonly stallTorqueNm: number;
  /**
   * The gearbox's Coulomb friction at the wheel (T_f), in N·m: it resists the wheel turning either way, and a wheel at rest
   * stays at rest until more than this turns it. Less than `stallTorqueNm`.
   */
  readonly gearFrictionNm: number;
  readonly wheelRadiusCm: number;
  readonly wheelWidthCm: number;
};

/** A hobby servo and the arm on its horn (N18 R3.3). The arm swings in the horizontal plane, about the mount's z axis. */
export type ServoSpec = {
  /** The time the servo takes to turn 60° unloaded, in s (0.1 for an SG90). */
  readonly sPer60Deg: number;
  /** The angles the servo can reach, in degrees. Angle 0 points the arm along the mount's yaw; it grows counter-clockwise. */
  readonly minDeg: number;
  readonly maxDeg: number;
  /**
   * Where the arm points when the world is built, before any command. Keep it inside the body's footprint: an arm that sticks
   * out at rest is what meets a wall first, and at its height it tips the robot nose-up (ADR 0001 §9).
   */
  readonly restDeg: number;
  /** The most torque the servo holds or pushes with, in N·m. */
  readonly stallTorqueNm: number;
  /** The arm: a bar from the servo's axis outwards, `armLengthCm` long, `armWidthCm` across and `armHeightCm` high, centred on the mount's height. */
  readonly armLengthCm: number;
  readonly armWidthCm: number;
  readonly armHeightCm: number;
  readonly armMassG: number;
};

/** An HC-SR04-like ultrasonic ranger (read by the world's sensors, R3.4). */
export type UltrasonicSpec = {
  /** Half the opening angle of the beam, in degrees. */
  readonly coneHalfDeg: number;
  /** Nearest and farthest distance it measures, in cm. */
  readonly minCm: number;
  readonly maxCm: number;
};

/** A reflective (infrared) line sensor looking down at the floor (R3.4). */
export type LineSensorSpec = {
  /** Its height above the floor when the robot rests, in cm: the same as the mount's z (loadKit checks it). */
  readonly heightCm: number;
  /** Radius of the floor spot it averages, in cm. */
  readonly spotRadiusCm: number;
  /** The floor reflectance (0 black … 1 white) below which it reads "dark". */
  readonly darkBelow: number;
};

/**
 * N19 A2 (plan §4.1, §4.4, §4.6; ADR 0004 §2, §5): the two-servo gripper, PLACEHOLDER numbers until a vendor's arm is measured. A boom
 * turns about the mount's y axis (the lift servo, 0° down … 90° up) and carries a carriage that stays level (a parallel link); on the
 * carriage, the claw servo (0° open … `jawsMeetDeg` closed) turns two fingers that mirror each other. The carriage frame (for the mount of a
 * module that rides on it, `KitModule.mount.on`): u forward, v left, w up, cm, from the boom's tip, the chassis' axes while it is level.
 */
export type GripperSpec = {
  /** The lift servo: s per 60° unloaded, its stall torque (N·m) and its rotor's inertia as the boom feels it (kg·m², §4.6). */
  readonly liftSPer60Deg: number;
  readonly liftStallTorqueNm: number;
  readonly liftRotorInertiaKgM2: number;
  /** The boom: from its pivot (the mount) to the carriage hinge, cm; its side plates at y = ±boomHalfSpanCm; its mass, g. */
  readonly boomLengthCm: number;
  readonly boomHalfSpanCm: number;
  readonly boomMassG: number;
  /** The boom's elevation at lift 0°, degrees above level (−40: down); a degree of lift raises it a degree, so lift 0° is its lowest. */
  readonly boomElevationAtLift0Deg: number;
  readonly carriageMassG: number;
  /** The claw servo: s per 60°, stall torque (N·m), and the claw angle at which the fingers meet (its stop), 0 < … ≤ 90. */
  readonly clawSPer60Deg: number;
  readonly clawStallTorqueNm: number;
  readonly jawsMeetDeg: number;
  /** Each finger's angle out from straight ahead at claw 0°, degrees, and how far it turns in a degree of claw (one servo, gears). */
  readonly fingerOpenDeg: number;
  readonly fingerDegPerServoDeg: number;
  /** A finger's hinge in the carriage frame (u, ±v), its length, thickness and height (the jaw's), cm; its mass, g. */
  readonly fingerHingeUCm: number;
  readonly fingerHingeVCm: number;
  readonly fingerLengthCm: number;
  readonly fingerThicknessCm: number;
  readonly jawHeightCm: number;
  readonly fingerMassG: number;
  /** How hard the jaws hold (friction coefficient): for the slip threshold only, the fingers' colliders have none (§4.6). */
  readonly jawFriction: number;
  /** The heaviest object the gripper lifts, g. */
  readonly maxPayloadG: number;
};

/**
 * N19 A2: an IR obstacle sensor between the jaws (PLACEHOLDER): it sees what is within `rangeCm` and reflects at least `minReflectance`
 * (0..1].
 */
export type IrObstacleSpec = { readonly rangeCm: number; readonly minReflectance: number };

/**
 * N19 A2: the TCS34725 colour sensor and its light (PLACEHOLDER): it looks `rangeCm` ahead; the counts per ms at 1× gain each channel reads
 * in front of a white object (`whiteR/G/BPerMs`), with nothing in front (`ambientPerMs`), and the distance at which the light of an object
 * falls to half (`halfLightCm`). The world turns them into the light the register model integrates (task B3).
 */
export type ColorSensorSpec = {
  readonly rangeCm: number;
  readonly halfLightCm: number;
  readonly whiteRPerMs: number;
  readonly whiteGPerMs: number;
  readonly whiteBPerMs: number;
  readonly ambientPerMs: number;
};

/** A module the world does not move or measure (LED, buzzer, button): no parameters. */
export type EmptySpec = Readonly<Record<string, never>>;

/** The spec keys of each module kind. */
export type ModuleSpecs = {
  readonly 'dc-motor': DcMotorSpec;
  readonly servo: ServoSpec;
  readonly ultrasonic: UltrasonicSpec;
  readonly 'line-sensor': LineSensorSpec;
  readonly led: EmptySpec;
  readonly buzzer: EmptySpec;
  readonly button: EmptySpec;
  readonly gripper: GripperSpec;
  readonly 'ir-obstacle': IrObstacleSpec;
  readonly 'color-sensor': ColorSensorSpec;
};

/** A point of the robot frame, in cm: [x forward, y left, z up] (see `KitModule.mount`). */
export type RobotPointCm = readonly [number, number, number];

/**
 * The robot's body (N18 R3.3), in the robot frame of `KitModule.mount`. The world builds it as one rigid body that rests on
 * the two drive wheels and the caster; `massG` and `comCm` set its mass, and its inertia is that of the `bodyCm` box with
 * the whole mass.
 */
export type ChassisSpec = {
  /** The body box: [length along x, width along y, height along z], centred on the frame's x = y = 0. */
  readonly bodyCm: RobotPointCm;
  /** How high the underside of the body box is above the floor. */
  readonly clearanceCm: number;
  /** The whole robot as weighed, servo arms and (N19 §4.6) the gripper included. */
  readonly massG: number;
  /** Centre of mass of the robot without its servo arms (and without its gripper's moving parts). */
  readonly comCm: RobotPointCm;
  /** Distance between the two wheel centres; the left wheel is at y = +trackCm / 2. */
  readonly trackCm: number;
  /** Centre of the ball caster, which rests on the floor: z = casterRadiusCm. */
  readonly casterCm: RobotPointCm;
  readonly casterRadiusCm: number;
  /** Friction coefficient of the tyres on the floor: the grip that limits a wheel's push. */
  readonly frictionWheel: number;
  /**
   * N19 D-G8: the floor, as a circle around the point of the robot's pose, that the scenario variants keep clear of walls and things at a
   * start. Optional, with no default here: a kit that leaves it out (the rover) gets `ROBOT_FOOTPRINT_RADIUS_CM`, 11 cm, from
   * `kitFootprintRadiusCm` (scenario/variants.ts). A kit that reaches farther (a gripper in front of the body) says how far. A kit's
   * value is a PLACEHOLDER like every number of its chassis.
   */
  readonly footprintRadiusCm?: number;
};

export type KitModule = {
  readonly role: RobotRole;
  readonly kind: ModuleKind;
  readonly port: string;
  /**
   * Where the module sits on the robot and where it faces, in the robot frame (N18 R3.3): chassis-centred, with its origin
   * on the floor under the centre of the chassis body (`ChassisSpec.bodyCm`) when the robot rests on level ground; x forward,
   * y left, z up, in cm. So z is a height above the floor. `yawDeg` turns the module about z, counter-clockwise (towards +y)
   * from forward. A wheel's mount is its centre; a servo's is the point of its axis where the arm is fixed.
   */
  readonly mount: {
    readonly posCm: RobotPointCm;
    readonly yawDeg: number;
    /**
     * N19 A2: the module rides on the gripper's carriage (only an IR or a colour sensor does): `posCm` and `yawDeg` are then in the carriage
     * frame (GripperSpec), so the sensor moves with the jaws.
     */
    readonly on?: 'gripper';
  };
  readonly spec: ModuleSpec;
};

export type Kit = {
  readonly id: string;
  readonly version: string;
  /** The board profile id the kit is wired to. */
  readonly board: string;
  readonly chassis?: ChassisSpec;
  /** In port order: the generated setup() sets up the ports in this order (after Serial.begin). */
  readonly ports: readonly KitPort[];
  readonly modules: readonly KitModule[];
};

/** `id@version`, how a project names its kit (plan §4.0). */
export type KitRef = { readonly id: string; readonly version: string };

export const kitKey = (ref: KitRef): string => `${ref.id}@${ref.version}`;

export function kitModule(kit: Kit, role: string): KitModule | undefined {
  return kit.modules.find((module) => module.role === role);
}

export function kitPort(kit: Kit, id: string): KitPort | undefined {
  return kit.ports.find((port) => port.id === id);
}

/** The port that holds `role`, or undefined when the kit has no such role. */
export function portOfRole(kit: Kit, role: string): KitPort | undefined {
  const module = kitModule(kit, role);
  return module ? kitPort(kit, module.port) : undefined;
}

/** A port's param, or the driver's default for it. */
export function portParam(port: KitPort, name: string): number | boolean | undefined {
  return port.params?.[name] ?? driverPortSpecs[port.driver].params?.[name]?.default;
}
