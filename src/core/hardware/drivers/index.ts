import { boardPin, type BoardProfile } from '../board';
import { kitModule, kitPort, type DriverId, type Kit, type KitPort } from '../kit';
import { buttonDriver } from './button';
import { buzzerDriver } from './buzzer';
import type { CppLibrary, Driver, DriverOp } from './driver';
import { hbridgeDriver } from './hbridge';
import { hcsr04Driver } from './hcsr04';
import { ledDriver } from './led';
import { lineAnalogDriver, lineDigitalDriver } from './line-sensor';
import { servoDriver } from './servo-lib';

// The drivers by id (N18 R1.4), and what a program's module uses need from the kit's drivers: the C++ parts of a sketch
// (for C1) and the ops each role offers (for the compiler). Order rule of the generated setup() (contract §2.1, §7): the
// generator writes `Serial.begin(9600);` first when the program prints, then the ports' setup lines in kit port order,
// which `kitCpp` gives.

export * from './driver';
export { MOTOR_SPEED, motorDuty } from './hbridge';
export { SERVO_ANGLE, SERVO_START_DEG } from './servo-lib';
export { echoToCm, MAX_CM, MIN_CM, NO_ECHO_CM, PULSE_TIMEOUT_US, US_PER_CM } from './hcsr04';
export { TONE_HZ, TONE_MS } from './buzzer';

export const drivers: Readonly<Record<DriverId, Driver>> = {
  'hbridge-en-in1-in2': hbridgeDriver,
  'servo-lib': servoDriver,
  'hcsr04-pulsein': hcsr04Driver,
  'line-digital': lineDigitalDriver,
  'line-analog': lineAnalogDriver,
  'led-digital': ledDriver,
  'buzzer-tone': buzzerDriver,
  'button-pullup': buttonDriver,
};

/** The robot's drive (contract U-21, U-22) is not a module: it is both motors. A program calls it on this role. */
export const DRIVE_ROLE = 'drive';
export const driveOps = ['drive.move', 'drive.stop'] as const;
/** `drive.move(direction, speed)`: the direction is an index in this list. (left, right) = (+s, +s), (−s, −s), (−s, +s), (+s, −s). */
export const driveDirections = ['forward', 'backward', 'spinLeft', 'spinRight'] as const;
export type DriveDirection = (typeof driveDirections)[number];

/**
 * N18 R2.2: the board's own clock is not a module of the kit either. A program reads `millis()` (contract UNO U-19) as the op
 * `time.millis` on this role; every UNO has it, so the kit's board target does not list it.
 */
export const CLOCK_ROLE = 'clock';
export const MILLIS_OP = 'time.millis';

/** A module op a program uses: `{ role: 'motorLeft', op: 'motor.set' }`. */
export type ModuleUse = { readonly role: string; readonly op: string };

/** Whether the board pin meets an op's requirement (an analog pin for `line.raw`). */
function offered(op: DriverOp, port: KitPort, board: BoardProfile): boolean {
  return op.requires === undefined || (boardPin(board, port.pins[op.requires.pin] ?? '')?.caps.includes(op.requires.cap) ?? false);
}

/** The ops a role of the kit offers, in driver order; `drive` has the drive ops when both motors are there. */
export function roleOps(kit: Kit, board: BoardProfile, role: string): string[] {
  if (role === DRIVE_ROLE) {
    return kitModule(kit, 'motorLeft') && kitModule(kit, 'motorRight') ? [...driveOps] : [];
  }
  const module = kitModule(kit, role);
  const port = module ? kitPort(kit, module.port) : undefined;
  if (!port) {
    return [];
  }
  return Object.entries(drivers[port.driver].ops)
    .filter(([, op]) => offered(op, port, board))
    .map(([name]) => name);
}

/** Every op of every module of the kit (and the drive): what a program that used everything would set up. */
export function allUses(kit: Kit, board: BoardProfile): ModuleUse[] {
  return [...kit.modules.map((module) => module.role), DRIVE_ROLE].flatMap((role) => roleOps(kit, board, role).map((op) => ({ role, op })));
}

/** A drive op stands for `motor.set` of both motors; the rest as they are. */
export function moduleUses(uses: readonly ModuleUse[]): ModuleUse[] {
  return uses.flatMap((use) =>
    use.role === DRIVE_ROLE
      ? [
          { role: 'motorLeft', op: 'motor.set' },
          { role: 'motorRight', op: 'motor.set' },
        ]
      : [use],
  );
}

/** The C++ a sketch needs for its module uses, each part once, in kit port order (the generator adds Serial.begin before `setup`). */
export type KitCpp = {
  readonly libraries: readonly CppLibrary[];
  readonly includes: readonly string[];
  readonly defines: readonly string[];
  readonly globals: readonly string[];
  readonly helpers: readonly { readonly id: string; readonly text: string }[];
  readonly setup: readonly string[];
};

export function kitCpp(kit: Kit, uses: readonly ModuleUse[]): KitCpp {
  const used = new Set(moduleUses(uses).map((use) => `${use.role} ${use.op}`));
  const libraries = new Map<string, CppLibrary>();
  const helpers = new Map<string, { id: string; text: string }>();
  const includes = new Set<string>();
  const defines: string[] = [];
  const globals = new Set<string>();
  const setup = new Set<string>();
  for (const port of kit.ports) {
    const module = kit.modules.find((candidate) => candidate.port === port.id);
    if (!module) {
      continue;
    }
    const driver = drivers[port.driver];
    const ops = Object.entries(driver.ops).filter(([name]) => used.has(`${module.role} ${name}`));
    if (ops.length > 0) {
      defines.push(...driver.defines(port, module.role));
    }
    for (const [, op] of ops) {
      op.cpp.libraries.forEach((library) => libraries.set(`${library.name}@${library.version}`, library));
      op.cpp.includes.forEach((line) => includes.add(line));
      op.cpp.globals(port, module.role).forEach((line) => globals.add(line));
      if (op.cpp.helper) {
        helpers.set(op.cpp.helper.id, op.cpp.helper);
      }
      op.cpp.setup(port, module.role).forEach((line) => setup.add(line));
    }
  }
  return { libraries: [...libraries.values()], includes: [...includes], defines, globals: [...globals], helpers: [...helpers.values()], setup: [...setup] };
}

const motorArgs = (role: string) => `${role}_EN, ${role}_IN1, ${role}_IN2`;
const driveSigns: Readonly<Record<(typeof driveDirections)[number], readonly ['_s' | 'neg32(_s)', '_s' | 'neg32(_s)']>> = {
  forward: ['_s', '_s'],
  backward: ['neg32(_s)', 'neg32(_s)'],
  spinLeft: ['neg32(_s)', '_s'],
  spinRight: ['_s', 'neg32(_s)'],
};

/**
 * The C++ of the drive (contract U-21, U-22): `drive.move` evaluates the speed once into `_s` and gives each motor `_s` or
 * `neg32(_s)`; `drive.stop` sets both motors to 0. It needs the hbridge helper and, for `neg32`, the int32 helper of the
 * language (contract §3.2), which the generator writes.
 */
export function driveCall(op: (typeof driveOps)[number], direction?: (typeof driveDirections)[number], speedExpr = '0L'): string {
  if (op === 'drive.stop') {
    return `motorSet(${motorArgs('MOTOR_LEFT')}, 0L); motorSet(${motorArgs('MOTOR_RIGHT')}, 0L);`;
  }
  const [left, right] = driveSigns[direction ?? 'forward'];
  return `{ const long _s = (${speedExpr}); motorSet(${motorArgs('MOTOR_LEFT')}, ${left}); motorSet(${motorArgs('MOTOR_RIGHT')}, ${right}); }`;
}
