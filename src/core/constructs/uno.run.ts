import type { Capabilities } from '../capabilities/io';
import { clampTo, CLOCK_ROLE, DRIVE_ROLE, MILLIS_OP, type ArgRange } from '../hardware/drivers';
import { robotRoles, type RobotRole } from '../hardware/kit';
import { RuntimeFault, asBool, asInt, bool, int, type Value } from '../program/values';
import type { BoardPinOperand, ModuleCallStatement, ModuleReadExpr, RoleOperand } from '../program/ybc-ir';
import { SPEED_RANGE } from './uno.drive';
import { HZ_RANGE, MS_RANGE } from './uno.output';
import { PWM_RANGE } from './uno.pins';
import { clampWarning, roleNames } from './uno.roles';
import { ULTRASONIC_CM, UNO_ADC_MAX } from './uno.sensors';
import { ANGLE_RANGE } from './uno.servo';

// Running the ops of a uno program (N18 R2.2, robot plan §4.4). The interpreter evaluates the arguments (order, budget, the wait for
// the world before the hardware are its business); these functions clamp them to their contract range, tell the run of a clamped
// value, and call the board: a module op through `capabilities.modules` (role → port → driver, hardware/binding.ts), a raw pin
// through the UnoPinIO-backed `digital`, `pwm` and `analogIn` of the virtual UNO. What the board answers is checked against the
// contract domain of the row: an answer outside it is a broken capability, an internal error, never a crash.

/** A clamped value: the role or pin it is about (the run warns once per one), and the warning. */
export type UnoClamp = { key: string; warning: { code: 'value-clamped'; message: string } };

function required<K extends keyof Capabilities>(capabilities: Capabilities, key: K): NonNullable<Capabilities[K]> {
  const capability = capabilities[key];
  if (capability === undefined) {
    throw new RuntimeFault('internal-error', 'The board is missing a part this block needs.');
  }
  return capability as NonNullable<Capabilities[K]>;
}

const isRole = (role: unknown): role is RobotRole => robotRoles.some((known) => known === role);

function roleOf(operand: RoleOperand | undefined): RobotRole {
  if (operand?.kind !== 'role' || !isRole(operand.role)) {
    throw new RuntimeFault('internal-error', 'A robot block names a module that does not exist.');
  }
  return operand.role;
}

/** An int argument clamped to `range`; `onClamp` hears of it once it had to be (`who`, the role's name or the pin). */
function clamped(value: number, range: ArgRange, key: string, who: string, onClamp: (clamp: UnoClamp) => void): number {
  const result = clampTo(range, value);
  if (result !== value) {
    onClamp({ key, warning: clampWarning(range, value, result, who) });
  }
  return result;
}

function argument(args: readonly Value[], index: number): Value {
  const value = args[index];
  if (value === undefined) {
    throw new RuntimeFault('internal-error', 'A robot block was given the wrong number of values.');
  }
  return value;
}

/** The two motors' speeds of the drive (contract UNO U-21): the speed once, −s as neg32 (`| 0`), each then clamped as U-20. */
function driveSpeeds(direction: unknown, speed: number): [left: number, right: number] {
  const s = speed | 0;
  const minus = -s | 0;
  switch (direction) {
    case 'forward':
      return [s, s];
    case 'backward':
      return [minus, minus];
    case 'spinLeft':
      return [minus, s];
    case 'spinRight':
      return [s, minus];
    default:
      throw new RuntimeFault('internal-error', 'A drive block names a direction that does not exist.');
  }
}

/** A module op of a uno program with its arguments evaluated (U-20…U-26). */
export function runModuleCall(statement: ModuleCallStatement, args: readonly Value[], capabilities: Capabilities, onClamp: (clamp: UnoClamp) => void): void {
  const modules = required(capabilities, 'modules');
  switch (statement.op) {
    case 'motor.set': {
      const role = roleOf(statement.operand);
      modules.call(role, 'motor.set', [clamped(asInt(argument(args, 0)), SPEED_RANGE, role, roleNames[role], onClamp)]);
      return;
    }
    case 'drive.move': {
      // Both motors through their own role: each clamps its own speed and is warned of on its own (U-21).
      const [left, right] = driveSpeeds(statement.operand.kind === 'drive' ? statement.operand.direction : undefined, asInt(argument(args, 0)));
      modules.call('motorLeft', 'motor.set', [clamped(left, SPEED_RANGE, 'motorLeft', roleNames.motorLeft, onClamp)]);
      modules.call('motorRight', 'motor.set', [clamped(right, SPEED_RANGE, 'motorRight', roleNames.motorRight, onClamp)]);
      return;
    }
    case 'drive.stop':
      modules.call(DRIVE_ROLE, 'drive.stop', []);
      return;
    case 'servo.set': {
      const role = roleOf(statement.operand);
      modules.call(role, 'servo.set', [clamped(asInt(argument(args, 0)), ANGLE_RANGE, role, roleNames[role], onClamp)]);
      return;
    }
    case 'led.set': {
      const role = roleOf(statement.operand);
      modules.call(role, 'led.set', [asBool(argument(args, 0)) ? 1 : 0]);
      return;
    }
    case 'buzzer.tone': {
      const role = roleOf(statement.operand);
      const hz = clamped(asInt(argument(args, 0)), HZ_RANGE, role, roleNames[role], onClamp);
      const ms = clamped(asInt(argument(args, 1)), MS_RANGE, role, roleNames[role], onClamp);
      modules.call(role, 'buzzer.tone', [hz, ms]);
      return;
    }
    case 'buzzer.stop':
      modules.call(roleOf(statement.operand), 'buzzer.stop', []);
      return;
  }
}

/** A whole number from the board within `low..high`; anything else is a broken capability. */
function boardInt(value: number | boolean, low: number, high: number, what: string): Value {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < low || value > high) {
    throw new RuntimeFault('internal-error', `${what} is not a whole number from ${low} to ${high}.`);
  }
  return int(value === 0 ? 0 : value);
}

function boardBool(value: number | boolean): Value {
  if (typeof value !== 'boolean') {
    throw new RuntimeFault('internal-error', 'A sensor gave no true / false value.');
  }
  return bool(value);
}

/** A module read of a uno program (U-19, U-27…U-30), as the board answers it. */
export function runModuleRead(expr: ModuleReadExpr, capabilities: Capabilities): Value {
  const modules = required(capabilities, 'modules');
  switch (expr.op) {
    case 'ultrasonic.cm':
      return boardInt(modules.read(roleOf(expr.operand), expr.op), ULTRASONIC_CM[0], ULTRASONIC_CM[1], 'The ultrasonic distance');
    case 'line.dark':
    case 'button.pressed':
      return boardBool(modules.read(roleOf(expr.operand), expr.op));
    case 'line.raw':
      return boardInt(modules.read(roleOf(expr.operand), expr.op), 0, UNO_ADC_MAX, 'The raw line value');
    case 'time.millis': {
      // (long)millis(): an unsigned long cast to long (contract UNO U-19), never past 2^31 ms in a run.
      const ms = modules.read(CLOCK_ROLE, MILLIS_OP);
      if (typeof ms !== 'number' || !Number.isSafeInteger(ms) || ms < 0) {
        throw new RuntimeFault('internal-error', 'The time since the start is not a whole number of ms.');
      }
      return int(ms | 0);
    }
  }
}

function pinOf(operand: BoardPinOperand): string {
  if (operand.kind !== 'pin' || typeof operand.pin !== 'string') {
    throw new RuntimeFault('internal-error', 'A pin block names a pin that does not exist.');
  }
  return operand.pin;
}

/** A raw pin op of a uno program (U-31, U-32) with its argument evaluated: the level, or the PWM value clamped to 0..255. */
export function runBoardPinCall(op: 'digital.write' | 'pwm.write' | 'servo.write', operand: BoardPinOperand, args: readonly Value[], capabilities: Capabilities, onClamp: (clamp: UnoClamp) => void): void {
  const pin = pinOf(operand);
  switch (op) {
    case 'digital.write':
      required(capabilities, 'digital').digitalWrite(pin, asBool(argument(args, 0)) ? 1 : 0);
      return;
    case 'pwm.write':
      required(capabilities, 'pwm').pwmWrite(pin, clamped(asInt(argument(args, 0)), PWM_RANGE, pin, pin, onClamp));
      return;
    case 'servo.write':
      throw new RuntimeFault('internal-error', 'This block is not known to the board.');
  }
}

/** A raw pin read of a uno program (U-33, U-34). */
export function runBoardPinRead(op: 'digital.read' | 'analogIn.read', operand: BoardPinOperand, capabilities: Capabilities): Value {
  const pin = pinOf(operand);
  if (op === 'digital.read') {
    // `(digitalRead(<pin>) == HIGH)`: a truth value whatever the call returns.
    return bool(required(capabilities, 'digital').digitalRead(pin) === 1);
  }
  return boardInt(required(capabilities, 'analogIn').analogRead(pin), 0, UNO_ADC_MAX, 'The analog value');
}
