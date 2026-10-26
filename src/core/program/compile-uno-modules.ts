import { unoModuleConstructOf, type UnoModuleConstruct } from '../constructs/uno';
import { driveMoveType, SPEED_RANGE } from '../constructs/uno.drive';
import { HZ_RANGE, LED_STATE_FIELD, ledStates, MS_RANGE } from '../constructs/uno.output';
import { LEVEL_FIELD, PIN_FIELD, pinLevels, PWM_RANGE } from '../constructs/uno.pins';
import { clampWarning, DRIVE_NAME, ROLE_FIELD, roleNames } from '../constructs/uno.roles';
import { ANGLE_RANGE } from '../constructs/uno.servo';
import { CHANNEL_FIELD, COLOR_FIELD } from '../constructs/uno.color';
import { CLAW_FIELD, clawPositions, clawType, GRIPPER_ANGLE_RANGE, LIFT_FIELD, liftPositions, liftType } from '../constructs/uno.gripper';
import type { BoardTarget } from '../devices/board-pins';
import type { KitBoardTarget } from '../hardware/board-target';
import { clampTo, COLOR_CHANNELS, COLOR_NAMES, DRIVE_ROLE, driveDirections, type ArgRange, type DriveDirection } from '../hardware/drivers';
import { kitKey, type RobotRole } from '../hardware/kit';
import { rawPinCheck, type KitUsage, type RawPinOp } from '../hardware/pin-rules';
import { INT32_MIN } from './limits';
import type { YbcDiagnosticCode } from './compile-ybc-program';
import { moduleReadType, type Expr, type Type, type YbcStatement } from './ybc-ir';

// The robot's blocks in the compiler of the uno family (N18 R2.2, robot plan §4.4), a part of compileYbcProgram: every module op of
// a uno IR with its operand and its typed arguments, against the kit's board target (kitBoardTarget, with the capabilities of
// kitBoardContext). Like the rest of the compiler it never throws: what it cannot compile is a diagnostic on its block.
//
// - A role the kit lacks, or an op its driver does not offer there (`line.raw` on a pin without analog input), is
//   capability-unavailable on the block (the target's `ops`). The drive needs both motors.
// - A typed-in number outside its range (speed, angle, Hz, ms, PWM value) is written clamped, with a `value-clamped` warning on the
//   block (contract UNO §0.5), so the generator can write the IR's literals as they are. The drive's speed is clamped per motor
//   after its sign; INT32_MIN is kept (neg32 leaves it negative), and the run clamps it.
// - A raw pin (Advanced) is checked by the kit's pin rules (`rawPinCheck`, contract §9) once the whole program is known, since what
//   the program uses decides them: a servo claims Timer1, a tone Timer2, printing holds D0/D1. N19 A4: what an op claims is its
//   driver's (`KitBoardTarget.opClaims`), so the gripper's claw and arm claim Timer1 as the servo does.
// - N19 A4: the claw's and the arm's two positions are their angles as literals (open 0, close 80; up 90, down 0); the colour and the
//   channel of a colour block are the names the dropdown saved.

type RawBlock = { type: string; id: string; fields?: Record<string, unknown> };

/** What `rawPinCheck` reports, as a compile diagnostic of the block. */
type UnoPinDiagnosticCode = Extract<YbcDiagnosticCode, 'pin-unavailable' | 'timer-claimed' | 'not-pwm'>;

/** What the module compiler needs of compileYbcProgram. */
export type UnoModuleContext = {
  report(severity: 'error' | 'warning', code: YbcDiagnosticCode, message: string, blockId?: string): void;
  /** The typed expression in an input, or null after a diagnostic. */
  operand(owner: RawBlock, name: string, label: string, wanted: Type, what: string, depth: number): Expr | null;
  target: BoardTarget | undefined;
};

export type UnoModuleCompiler = {
  /** Whether the block type is one of the robot's statements, or of its values. */
  isStatement(type: string): boolean;
  isValue(type: string): boolean;
  compileStatement(block: RawBlock, depth: number): YbcStatement | null;
  compileValue(block: RawBlock, depth: number): Expr | null;
  /** The program prints (`Serial` holds D0, D1). */
  notePrint(): void;
  /** The pin rules of the raw pins, now that the program's use of the servo, the tone and Serial is known. */
  finish(): void;
};

const isKitTarget = (target: BoardTarget | undefined): target is KitBoardTarget =>
  target !== undefined && 'roles' in target && 'ops' in target && 'raw' in target;

const valueOps = new Set(['ultrasonic.cm', 'line.dark', 'line.raw', 'button.pressed', 'digital.read', 'analogIn.read', 'time.millis', 'ir.detect', 'color.is', 'color.raw']);
/** The capability a raw pin op or millis needs on the board; every other op needs `modules`. */
const capabilityOf: Readonly<Record<string, string>> = { 'digital.write': 'digital', 'digital.read': 'digital', 'pwm.write': 'pwm', 'analogIn.read': 'analogIn' };

export function createUnoModuleCompiler(context: UnoModuleContext): UnoModuleCompiler {
  const { report, operand, target } = context;
  const kit = isKitTarget(target) ? target : undefined;
  const usage = { servo: false, tone: false, serial: false };
  const rawPins: { op: RawPinOp; pin: string; blockId: string }[] = [];

  /** Whether the board (with its kit) has what the block reaches; says why not otherwise. */
  const available = (block: RawBlock, construct: UnoModuleConstruct, role: RobotRole | null): boolean => {
    const capability = capabilityOf[construct.op] ?? 'modules';
    if (target === undefined || !target.capabilities.includes(capability)) {
      report('error', 'capability-unavailable', `This board has no ${capability} for "${block.type}".`, block.id);
      return false;
    }
    if (kit === undefined) {
      // A raw pin is checked by the kit's pin rules, and every module op (millis too) runs through the kit's binding.
      if (capability === 'modules') {
        report('error', 'capability-unavailable', `This board has no modules for "${block.type}".`, block.id);
      } else {
        report('error', 'capability-unavailable', `"${block.type}" needs the robot's kit, to know which pins are free.`, block.id);
      }
      return false;
    }
    if (capability !== 'modules' || construct.op === 'time.millis') {
      return true;
    }
    const key = role ?? DRIVE_ROLE;
    if (kit.ops[key]?.includes(construct.op)) {
      return true;
    }
    const name = role === null ? DRIVE_NAME : roleNames[role];
    if (role !== null && kit.roles.includes(role)) {
      report('error', 'capability-unavailable', `The kit ${kitKey(kit.kit)} has ${name}, but not for "${block.type}".`, block.id);
    } else {
      report('error', 'capability-unavailable', `"${block.type}" needs ${name}, which the kit ${kitKey(kit.kit)} does not have.`, block.id);
    }
    return false;
  };

  /** The role of the block: its dropdown's choice among its roles, or the one role it is about. */
  const roleOf = (block: RawBlock, construct: UnoModuleConstruct): RobotRole | null => {
    if (!construct.roleField) {
      return construct.roles[0] ?? null;
    }
    const role = block.fields?.[ROLE_FIELD];
    if (typeof role !== 'string') {
      report('error', 'malformed-program', 'A robot block needs its module.', block.id);
      return null;
    }
    const offered = construct.roles.find((candidate) => candidate === role);
    if (offered === undefined) {
      report('error', 'value-out-of-range', `"${role}" is not one of the modules this block offers.`, block.id);
      return null;
    }
    return offered;
  };

  /** A whole-number argument; a typed-in one outside `range` is written clamped, with a warning on the block. */
  const intArg = (block: RawBlock, input: string, label: string, what: string, depth: number, range: ArgRange, who: string): Expr | null => {
    const expr = operand(block, input, label, 'int', what, depth);
    if (expr?.kind !== 'int') {
      return expr;
    }
    // The drive's INT32_MIN is clamped per motor after neg32, which leaves it INT32_MIN: −100 for both, whatever the direction.
    if (block.type === driveMoveType && expr.value === INT32_MIN) {
      return expr;
    }
    const clamped = clampTo(range, expr.value);
    if (clamped === expr.value) {
      return expr;
    }
    report('warning', 'value-clamped', clampWarning(range, expr.value, clamped, who).message, block.id);
    return { ...expr, value: clamped };
  };

  /** A choice of a dropdown field among `options` (its values); null after a diagnostic. */
  const choice = <Value extends string>(block: RawBlock, field: string, options: readonly Value[], missing: string, wrong: string): Value | null => {
    const value = block.fields?.[field];
    if (typeof value !== 'string') {
      report('error', 'malformed-program', missing, block.id);
      return null;
    }
    const found = options.find((option) => option === value);
    if (found === undefined) {
      report('error', 'value-out-of-range', wrong, block.id);
    }
    return found ?? null;
  };

  /** N19 A4: `choice` with the two diagnostics said by the caller (so each block's own words are in its code). */
  const pick = <Value extends string>(block: RawBlock, field: string, options: readonly Value[], missing: () => void, wrong: () => void): Value | null => {
    const value = block.fields?.[field];
    if (typeof value !== 'string') {
      missing();
      return null;
    }
    const found = options.find((option) => option === value);
    if (found === undefined) {
      wrong();
    }
    return found ?? null;
  };

  const pinOf = (block: RawBlock, op: RawPinOp): string | null => {
    const pin = block.fields?.[PIN_FIELD];
    if (typeof pin !== 'string') {
      report('error', 'malformed-program', 'A pin block needs its pin.', block.id);
      return null;
    }
    rawPins.push({ op, pin, blockId: block.id });
    return pin;
  };

  const truth = (value: boolean, blockId: string): Expr => ({ blockId, type: 'bool', kind: 'bool', value });

  /**
   * N19 A4: the angle of a claw or arm block: the literal of its position (claw open 0, close 80; arm up 90, down 0), or its ANGLE input,
   * a typed-in one clamped to 0..90 with a warning.
   */
  const gripperAngle = (block: RawBlock, op: 'gripper.claw' | 'gripper.lift', depth: number, who: string): Expr | null => {
    const literal = (value: number | undefined): Expr | null => (value === undefined ? null : { blockId: block.id, type: 'int', kind: 'int', value });
    if (block.type === clawType) {
      const position = pick(
        block,
        CLAW_FIELD,
        Object.keys(clawPositions) as (keyof typeof clawPositions)[],
        () => report('error', 'malformed-program', 'A claw block needs open or close.', block.id),
        () => report('error', 'value-out-of-range', 'A claw is open or closed.', block.id),
      );
      return literal(position === null ? undefined : clawPositions[position]);
    }
    if (block.type === liftType) {
      const position = pick(
        block,
        LIFT_FIELD,
        Object.keys(liftPositions) as (keyof typeof liftPositions)[],
        () => report('error', 'malformed-program', 'An arm block needs up or down.', block.id),
        () => report('error', 'value-out-of-range', 'An arm is up or down.', block.id),
      );
      return literal(position === null ? undefined : liftPositions[position]);
    }
    return op === 'gripper.claw'
      ? intArg(block, 'ANGLE', 'claw angle', 'The angle', depth, GRIPPER_ANGLE_RANGE, who)
      : intArg(block, 'ANGLE', 'arm angle', 'The angle', depth, GRIPPER_ANGLE_RANGE, who);
  };

  const compileStatement = (block: RawBlock, depth: number): YbcStatement | null => {
    const construct = unoModuleConstructOf(block.type);
    if (!construct || valueOps.has(construct.op)) {
      report('error', 'unsupported-construct', `"${block.type}" cannot be used as a statement.`, block.id);
      return null;
    }
    const role = roleOf(block, construct);
    if ((construct.roleField && role === null) || !available(block, construct, role)) {
      return null;
    }
    // What the op takes of the board's timers, by its driver (N19 A4).
    const claim = kit?.opClaims[role ?? DRIVE_ROLE]?.[construct.op];
    if (claim !== undefined) {
      usage[claim] = true;
    }
    const blockId = block.id;
    switch (construct.op) {
      case 'drive.move': {
        const direction = choice<DriveDirection>(block, 'DIRECTION', driveDirections, 'A drive block needs its direction.', 'A direction is forward, backward, spin left or spin right.');
        const speed = intArg(block, 'SPEED', 'robot go', 'The speed', depth, SPEED_RANGE, DRIVE_NAME);
        return direction !== null && speed ? { kind: 'call', op: 'drive.move', operand: { kind: 'drive', direction }, args: [speed], blockId } : null;
      }
      case 'drive.stop':
        return { kind: 'call', op: 'drive.stop', blockId };
      case 'motor.set': {
        const speed = role === null ? null : intArg(block, 'SPEED', 'motor', 'The speed', depth, SPEED_RANGE, roleNames[role]);
        return role !== null && speed ? { kind: 'call', op: 'motor.set', operand: { kind: 'role', role }, args: [speed], blockId } : null;
      }
      case 'servo.set': {
        const angle = role === null ? null : intArg(block, 'ANGLE', 'servo', 'The angle', depth, ANGLE_RANGE, roleNames[role]);
        return role !== null && angle ? { kind: 'call', op: 'servo.set', operand: { kind: 'role', role }, args: [angle], blockId } : null;
      }
      case 'led.set': {
        const state = choice(block, LED_STATE_FIELD, ['ON', 'OFF'] as const, 'An LED block needs on or off.', 'An LED is on or off.');
        return role !== null && state !== null ? { kind: 'call', op: 'led.set', operand: { kind: 'role', role }, args: [truth(ledStates[state], blockId)], blockId } : null;
      }
      case 'buzzer.tone': {
        if (role === null) {
          return null;
        }
        const hz = intArg(block, 'HZ', 'buzzer tone', 'The frequency', depth, HZ_RANGE, roleNames[role]);
        const ms = intArg(block, 'MS', 'buzzer tone', 'The length of a tone', depth, MS_RANGE, roleNames[role]);
        return hz && ms ? { kind: 'call', op: 'buzzer.tone', operand: { kind: 'role', role }, args: [hz, ms], blockId } : null;
      }
      case 'buzzer.stop':
        return role === null ? null : { kind: 'call', op: 'buzzer.stop', operand: { kind: 'role', role }, blockId };
      case 'gripper.claw':
      case 'gripper.lift': {
        if (role === null) {
          return null;
        }
        const angle = gripperAngle(block, construct.op, depth, roleNames[role]);
        return angle ? { kind: 'call', op: construct.op, operand: { kind: 'role', role }, args: [angle], blockId } : null;
      }
      case 'digital.write': {
        const pin = pinOf(block, 'digital.write');
        const level = choice(block, LEVEL_FIELD, ['HIGH', 'LOW'] as const, 'A digital write needs HIGH or LOW.', 'A pin is written HIGH or LOW.');
        return pin !== null && level !== null ? { kind: 'call', op: 'digital.write', operand: { kind: 'pin', pin }, args: [truth(pinLevels[level], blockId)], blockId } : null;
      }
      case 'pwm.write': {
        const pin = pinOf(block, 'pwm.write');
        const value = pin === null ? null : intArg(block, 'VALUE', 'PWM write', 'A PWM value', depth, PWM_RANGE, pin);
        return pin !== null && value ? { kind: 'call', op: 'pwm.write', operand: { kind: 'pin', pin }, args: [value], blockId } : null;
      }
      default:
        report('error', 'unsupported-construct', `"${block.type}" is not supported by the compiler.`, block.id);
        return null;
    }
  };

  const compileValue = (block: RawBlock): Expr | null => {
    const construct = unoModuleConstructOf(block.type);
    if (!construct || !valueOps.has(construct.op)) {
      report('error', 'unsupported-construct', `"${block.type}" cannot be used as a value.`, block.id);
      return null;
    }
    const role = roleOf(block, construct);
    if ((construct.roleField && role === null) || !available(block, construct, role)) {
      return null;
    }
    const blockId = block.id;
    switch (construct.op) {
      case 'ultrasonic.cm':
      case 'line.dark':
      case 'line.raw':
      case 'button.pressed':
      case 'ir.detect':
        return role === null ? null : { blockId, type: moduleReadType(construct.op), kind: 'read', op: construct.op, operand: { kind: 'role', role } };
      case 'color.is': {
        const color = pick(
          block,
          COLOR_FIELD,
          COLOR_NAMES,
          () => report('error', 'malformed-program', 'A colour block needs its colour.', block.id),
          () => report('error', 'value-out-of-range', 'That is not a colour the colour sensor knows.', block.id),
        );
        return role === null || color === null ? null : { blockId, type: 'bool', kind: 'read', op: 'color.is', operand: { kind: 'role', role }, color };
      }
      case 'color.raw': {
        const channel = pick(
          block,
          CHANNEL_FIELD,
          COLOR_CHANNELS,
          () => report('error', 'malformed-program', 'A raw colour block needs its channel.', block.id),
          () => report('error', 'value-out-of-range', 'A channel is red, green, blue or clear.', block.id),
        );
        return role === null || channel === null ? null : { blockId, type: 'int', kind: 'read', op: 'color.raw', operand: { kind: 'role', role }, channel };
      }
      case 'time.millis':
        return { blockId, type: 'int', kind: 'read', op: 'time.millis' };
      case 'digital.read':
      case 'analogIn.read': {
        const pin = pinOf(block, construct.op);
        return pin === null ? null : { blockId, type: construct.op === 'digital.read' ? 'bool' : 'int', kind: 'read', op: construct.op, operand: { kind: 'pin', pin }, args: [] };
      }
      default:
        report('error', 'unsupported-construct', `"${block.type}" cannot be used as a value.`, block.id);
        return null;
    }
  };

  const statementOps = (type: string) => {
    const construct = unoModuleConstructOf(type);
    return construct !== undefined && !valueOps.has(construct.op);
  };

  return {
    isStatement: statementOps,
    isValue: (type) => {
      const construct = unoModuleConstructOf(type);
      return construct !== undefined && valueOps.has(construct.op);
    },
    compileStatement,
    compileValue,
    notePrint() {
      usage.serial = true;
    },
    finish() {
      if (kit === undefined) {
        return; // Every raw pin was refused already: no kit, no pin rules.
      }
      const used: KitUsage = { ...usage };
      for (const { op, pin, blockId } of rawPins) {
        const problem = rawPinCheck(kit, op, pin, used);
        if (problem) {
          report(problem.severity, problem.code as UnoPinDiagnosticCode, problem.message, blockId);
        }
      }
    },
  };
}
