import type { Capabilities } from '../capabilities/io';
import { clampTo, CLOCK_ROLE, COLOR_CHANNELS, COLOR_NAMES, COLOR_RAW_MAX, DRIVE_ROLE, GRIPPER_ANGLE, MILLIS_OP, type ArgRange } from '../hardware/drivers';
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
//
// N19 A4: the claw and the lift clamp their angle to 0..90 and warn once per role (both are the role `gripper`); a colour read asks the
// board with the index of its colour or channel (`modules.read(role, op, [n])`, one frozen array per index: a read allocates nothing).

/** A clamped value: the role or pin it is about (the run warns once per one), and the warning. */
export type UnoClamp = { key: string; warning: { code: 'value-clamped'; message: string } };

function required<K extends keyof Capabilities>(capabilities: Capabilities, key: K): NonNullable<Capabilities[K]> {
  const capability = capabilities[key];
  if (capability === undefined) {
    throw new RuntimeFault('internal-error', 'The board is missing a part this block needs.');
  }
  return capability as NonNullable<Capabilities[K]>;
}

/** The roles of a robot, for a lookup that allocates nothing (N18 P1: a module op of a tight loop names its role every time). */
const roles: ReadonlySet<unknown> = new Set<unknown>(robotRoles);
const isRole = (role: unknown): role is RobotRole => roles.has(role);

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

/**
 * The speed of one motor of the drive (contract UNO U-21): the speed once, −s as neg32 (`| 0`), each then clamped as U-20. N18 P1: one
 * motor at a time, so a drive in a tight loop makes no pair.
 */
function driveSpeed(direction: unknown, speed: number, motor: 'left' | 'right'): number {
  const s = speed | 0;
  const minus = -s | 0;
  switch (direction) {
    case 'forward':
      return s;
    case 'backward':
      return minus;
    case 'spinLeft':
      return motor === 'left' ? minus : s;
    case 'spinRight':
      return motor === 'left' ? s : minus;
    default:
      throw new RuntimeFault('internal-error', 'A drive block names a direction that does not exist.');
  }
}

/** A module op of a uno program with its arguments evaluated (U-20…U-26; N19: the claw and the lift, U-35/U-36). */
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
      const direction = statement.operand.kind === 'drive' ? statement.operand.direction : undefined;
      const speed = asInt(argument(args, 0));
      const left = driveSpeed(direction, speed, 'left');
      const right = driveSpeed(direction, speed, 'right');
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
    case 'gripper.claw':
    case 'gripper.lift': {
      const role = roleOf(statement.operand);
      modules.call(role, statement.op, [clamped(asInt(argument(args, 0)), GRIPPER_ANGLE, role, roleNames[role], onClamp)]);
      return;
    }
  }
}

/** A whole number from the board within `low..high`; anything else is a broken capability. */
function boardInt(value: number | boolean, low: number, high: number, what: string): Value {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < low || value > high) {
    throw new RuntimeFault('internal-error', `${what} is not a whole number from ${low} to ${high}.`);
  }
  return int(value === 0 ? 0 : value);
}

/**
 * N18 P1: the two truth values a read gives, one object each: a loop() reads its sensors some hundred times a tick, and a value is
 * never written to (a variable, an operation and a comparison each make or take a value, none changes one).
 */
const TRUE_VALUE = bool(true);
const FALSE_VALUE = bool(false);
const truthValue = (value: boolean): Value => (value ? TRUE_VALUE : FALSE_VALUE);

function boardBool(value: number | boolean): Value {
  if (typeof value !== 'boolean') {
    throw new RuntimeFault('internal-error', 'A sensor gave no true / false value.');
  }
  return truthValue(value);
}

/** N19 A4: the argument of a colour read, by index: one array each, never written (N18 P1). */
const indexArgs = (count: number): readonly (readonly number[])[] => Array.from({ length: count }, (_, index) => Object.freeze([index]));
const colorArgs = indexArgs(COLOR_NAMES.length);
const channelArgs = indexArgs(COLOR_CHANNELS.length);

/** The argument of `color.is` for its colour, or of `color.raw` for its channel. */
function choiceArgs(list: readonly string[], args: readonly (readonly number[])[], choice: unknown, what: string): readonly number[] {
  const found = args[list.indexOf(choice as string)];
  if (found === undefined) {
    throw new RuntimeFault('internal-error', `A colour block names a ${what} that does not exist.`);
  }
  return found;
}

/** A module read of a uno program (U-19, U-27…U-30; N19 A4: U-37…U-39), as the board answers it. */
export function runModuleRead(expr: ModuleReadExpr, capabilities: Capabilities): Value {
  const modules = required(capabilities, 'modules');
  switch (expr.op) {
    case 'ultrasonic.cm':
      return boardInt(modules.read(roleOf(expr.operand), expr.op), ULTRASONIC_CM[0], ULTRASONIC_CM[1], 'The ultrasonic distance');
    case 'line.dark':
    case 'button.pressed':
    case 'ir.detect':
      return boardBool(modules.read(roleOf(expr.operand), expr.op));
    case 'color.is':
      return boardBool(modules.read(roleOf(expr.operand), expr.op, choiceArgs(COLOR_NAMES, colorArgs, expr.color, 'colour')));
    case 'color.raw':
      return boardInt(modules.read(roleOf(expr.operand), expr.op, choiceArgs(COLOR_CHANNELS, channelArgs, expr.channel, 'channel')), 0, COLOR_RAW_MAX, 'The raw colour value');
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
    return truthValue(required(capabilities, 'digital').digitalRead(pin) === 1);
  }
  return boardInt(required(capabilities, 'analogIn').analogRead(pin), 0, UNO_ADC_MAX, 'The analog value');
}
