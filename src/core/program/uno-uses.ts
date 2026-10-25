import { DRIVE_ROLE, driverPinMode, setupPinsOf, type ModuleUse } from '../hardware/drivers';
import type { Kit } from '../hardware/kit';
import type { KitUsage } from '../hardware/pin-rules';
import type { PinMode } from '../hardware/virtual-uno';
import { isBoardPinOp, isModuleCall, isModuleRead, type Expr, type YbcProgramIR, type YbcStatement } from './ybc-ir';

// What a uno program uses of the robot (N18 R2.2), read from its IR: the module ops whose setup() steps the binding runs and whose
// C++ the generator writes (hardware/binding.ts `createModuleIO`, drivers `kitCpp`), the raw pins it writes (pinMode OUTPUT in
// setup(), contract UNO U-31) and the module-wired pins it reads raw (their driver's pinMode in setup(), U-33), and what decides
// the kit's pin rules (a servo claims Timer1, a tone Timer2, printing holds D0/D1).

export type UnoProgramUses = {
  /** Each module op once, in the order the program meets them (the drive on its role `drive`; millis is the board's, not a use). */
  readonly modules: readonly ModuleUse[];
  /** The pins a digital write sets, each once, in the order the program meets them: OUTPUT in setup(). */
  readonly outputPins: readonly string[];
  /**
   * Fix round 1: the pins a raw digital read names that the kit wires to a module, each once, in the order the program meets them,
   * with the pinMode the module's driver gives them (contract UNO U-33): setup() sets it, as if the program used the module for its
   * setup only, so a released button reads HIGH through its pull-up. A pin the setup of a used module op already sets is not here.
   */
  readonly inputPins: readonly { readonly pin: string; readonly mode: PinMode }[];
  readonly usage: KitUsage;
};

/** The first block of each use that changes the pin rules: for the diagnostics of the kit's rules. */
export type UsageBlocks = { readonly servo?: string; readonly tone?: string; readonly serial?: string };

/** What the program uses of `kit`, the kit it was compiled against. */
export function unoUsesOf(ir: YbcProgramIR, kit: Kit): UnoProgramUses {
  return unoUsesAndBlocks(ir, kit).uses;
}

/** The uses and the first block of each use of the servo, the tone and Serial. */
export function unoUsesAndBlocks(ir: YbcProgramIR, kit: Kit): { uses: UnoProgramUses; blocks: UsageBlocks } {
  const modules: ModuleUse[] = [];
  const seen = new Set<string>();
  const outputPins: string[] = [];
  const readPins: string[] = [];
  const blocks: { servo?: string; tone?: string; serial?: string } = {};
  const use = (role: string, op: string) => {
    const key = `${role} ${op}`;
    if (!seen.has(key)) {
      seen.add(key);
      modules.push({ role, op });
    }
  };

  const expression = (expr: Expr): void => {
    switch (expr.kind) {
      case 'arith':
      case 'compare':
      case 'logic':
        expression(expr.left);
        expression(expr.right);
        return;
      case 'not':
        expression(expr.value);
        return;
      case 'join':
        expr.parts.forEach(expression);
        return;
      case 'read':
        if (isModuleRead(expr)) {
          if (expr.op !== 'time.millis') {
            use(expr.operand.role, expr.op);
          }
          return;
        }
        if (expr.op === 'digital.read' && isBoardPinOp(expr) && !readPins.includes(expr.operand.pin)) {
          readPins.push(expr.operand.pin);
        }
        if ('args' in expr) {
          expr.args.forEach(expression);
        }
        return;
      default:
        return;
    }
  };

  const statements = (list: readonly YbcStatement[]): void => {
    for (const statement of list) {
      switch (statement.kind) {
        case 'set':
          expression(statement.value);
          break;
        case 'print':
          blocks.serial ??= statement.blockId;
          expression(statement.value);
          break;
        case 'if':
          for (const branch of statement.branches) {
            expression(branch.condition);
            statements(branch.body);
          }
          statements(statement.else);
          break;
        case 'repeat':
          expression(statement.times);
          statements(statement.body);
          break;
        case 'while':
          expression(statement.condition);
          statements(statement.body);
          break;
        case 'countUp':
          expression(statement.from);
          expression(statement.to);
          statements(statement.body);
          break;
        case 'waitMs':
          expression(statement.ms);
          break;
        case 'call':
          if ('args' in statement) {
            statement.args.forEach(expression);
          }
          if (isModuleCall(statement)) {
            use(statement.op === 'drive.move' || statement.op === 'drive.stop' ? DRIVE_ROLE : statement.operand.role, statement.op);
            if (statement.op === 'servo.set') {
              blocks.servo ??= statement.blockId;
            } else if (statement.op === 'buzzer.tone') {
              blocks.tone ??= statement.blockId;
            }
          } else if (statement.op === 'digital.write' && isBoardPinOp(statement) && !outputPins.includes(statement.operand.pin)) {
            outputPins.push(statement.operand.pin);
          }
          break;
        case 'noop':
          break;
      }
    }
  };

  statements(ir.onStart);
  statements(ir.forever ?? []);
  const setUp = setupPinsOf(kit, modules);
  const inputPins = readPins.flatMap((pin) => {
    const mode = driverPinMode(kit, pin);
    return mode === undefined || setUp.has(pin) ? [] : [{ pin, mode }];
  });
  return {
    uses: { modules, outputPins, inputPins, usage: { servo: blocks.servo !== undefined, tone: blocks.tone !== undefined, serial: blocks.serial !== undefined } },
    blocks,
  };
}
