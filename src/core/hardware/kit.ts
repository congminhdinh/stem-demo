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
 * Physical parameters the world's module models read (plan R3.3, R3.4: a motor's maxRpm and tauS, …). The world tasks own
 * the keys; R1 checks only that they are numbers, booleans or strings.
 */
export type ModuleSpec = Readonly<Record<string, number | boolean | string>>;

/** The robot's body for the world (plan R3.3). As ModuleSpec: the world owns the keys, R1 checks they are numbers. */
export type ChassisSpec = Readonly<Record<string, number>>;

export type KitModule = {
  readonly role: RobotRole;
  readonly kind: ModuleKind;
  readonly port: string;
  /** Where the module sits on the robot, in cm in the robot frame of ADR 0001 §2 (+x forward, +y up, +z right), and its heading. */
  readonly mount: { readonly posCm: readonly [number, number, number]; readonly yawDeg: number };
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
