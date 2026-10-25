import type { PinCap } from './board';

// The kit (N18 R1.1, robot plan §4.2): which modules a robot has and how they are wired, as data (`kits/*.kit.json`,
// validated by kit-schema.ts). The chain is role → port → driver → pins: a program names a role (`motorLeft`), the kit says
// which port holds it (`M1`), the port says which driver runs it (`hbridge-en-in1-in2`) and on which board pins (EN=D5…).
// A vendor kit is a new JSON file; a new module kind or driver is engine work (plan VG).

/** What a module is. Closed: a new kind needs a block, an IR op, a contract row, a model and a goal (plan VG). */
export const moduleKinds = ['dc-motor', 'servo', 'ultrasonic', 'line-sensor', 'led', 'buzzer', 'button'] as const;
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
] as const;
export type DriverId = (typeof driverIds)[number];

/** The role vocabulary of the robot (plan §4.2): the blocks' dropdowns list all of it; a role the kit lacks is capability-unavailable. */
export const robotRoles = ['motorLeft', 'motorRight', 'ultrasonic', 'lineLeft', 'lineCenter', 'lineRight', 'servo1', 'led1', 'buzzer', 'button1'] as const;
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
};

export type DriverPinSpec = {
  /** The capability the board pin must have. */
  readonly needs: PinCap;
  /** The driver drives this pin (`out`) or reads it (`in`). */
  readonly dir: 'out' | 'in';
  /** The program may also read the module's signal on this pin as an analog value (`line.raw`, contract U-29) when the board pin has analogIn. */
  readonly analog?: true;
};

export type DriverParamSpec = { readonly type: 'boolean'; readonly default: boolean };

/** What a port of a driver must wire: its pins, by the names the C++ forms use (`<ROLE>_EN`), and its params. */
export type DriverPortSpec = {
  readonly kind: ModuleKind;
  readonly pins: Readonly<Record<string, DriverPinSpec>>;
  readonly params?: Readonly<Record<string, DriverParamSpec>>;
  /** The board `timerClaims` entry the driver's code takes while the program uses it (Servo library: servo; tone: tone). */
  readonly claims?: string;
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
 * u = duty/255 × dir and ω₀ = maxRpm in rad/s, and a first-order lag of `tauS` on the wheel speed it aims at.
 */
export type DcMotorSpec = {
  /** No-load wheel speed at full duty (ω₀), in rpm. */
  readonly maxRpm: number;
  /** Time constant of the first-order response of the wheel speed to a new command, in s (0: none). */
  readonly tauS: number;
  /** Torque at the wheel when stalled at full duty (T_s), in N·m. */
  readonly stallTorqueNm: number;
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
  /** Where the arm points when the world is built, before any command. */
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
  /** The whole robot as weighed, servo arms included. */
  readonly massG: number;
  /** Centre of mass of the robot without its servo arms. */
  readonly comCm: RobotPointCm;
  /** Distance between the two wheel centres; the left wheel is at y = +trackCm / 2. */
  readonly trackCm: number;
  /** Centre of the ball caster, which rests on the floor: z = casterRadiusCm. */
  readonly casterCm: RobotPointCm;
  readonly casterRadiusCm: number;
  /** Friction coefficient of the tyres on the floor: the grip that limits a wheel's push. */
  readonly frictionWheel: number;
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
  readonly mount: { readonly posCm: RobotPointCm; readonly yawDeg: number };
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
