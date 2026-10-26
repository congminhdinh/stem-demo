import type { ModuleIO } from '../capabilities/io';
import type { BoardProfile } from '../hardware/board';
import { DRIVE_ROLE, driveDirections, GRIPPER_ANGLE, MOTOR_SPEED, roleOps, type DriveDirection, type ModuleUse } from '../hardware/drivers';
import type { Kit } from '../hardware/kit';

// Teleop, "Lái tay" (N18 R4.8): the learner drives the robot by hand, with the 3D view's D-pad or the keyboard, while no program runs.
// It drives through the same hardware as a program, so the pins, the C++ view and the inspector stay true: a command is a call of the
// drive (`drive.move(direction, speed)` / `drive.stop` on the role `drive`) on the module binding of the run's virtual UNO, never a push
// of the physics body. This is the pure part: the commands the UI gives between two ticks wait in a queue, and the run session applies
// them at the start of the next tick (`apply(tick, modules)`), where a program's first statement of that tick would make the same calls.
// So a teleop session is fixed by its input log, (tick, command): the same log gives the same world, tick for tick, as a program that
// makes the same calls at the same ticks (robot-run-session.teleop.test.ts). A command that repeats what the drive was last told (a key
// held down) changes nothing and is not logged.
// N19 E3: on the gripper car the claw and the lift are two more commands of the same controller (`gripper`: a part and an angle), applied
// through the same binding (gripper.claw / gripper.lift on the role `gripper`) and logged the same way; each part keeps its own last
// angle, so a repeat of it is skipped whatever the drive or the other part was told in between.

/**
 * How long a teleop run lasts at most, s (N18 R4.8 fix round 1, controller ruling): teleop is exploration and is never scored, so the
 * scenario's time limit does not end it; this does, so that a run left driving does not tick forever. A crash (`endOnContact`) still ends it.
 */
export const TELEOP_LIMIT_S = 600;

/** N19 E3: the two servos of the gripper car's gripper module, the parts a teleop command moves. */
export const gripperParts = ['claw', 'lift'] as const;
export type GripperPart = (typeof gripperParts)[number];

/** N19 E3: the role of the kit's gripper (robotRoles `gripper`). */
export const GRIPPER_ROLE = 'gripper';
const gripperOps: Readonly<Record<GripperPart, string>> = { claw: 'gripper.claw', lift: 'gripper.lift' };
/** N19 E3: the colour sensor's op that a teleop run sets up (its setup step is `colorBegin`). */
const COLOR_IS_OP = 'color.is';

/**
 * One command of teleop: drive one way at `speed` (0..100, the drive's own scale), stop both motors, or (N19 E3) tell the claw or the lift
 * an angle, 0..90.
 */
export type TeleopCommand =
  | { readonly op: 'move'; readonly direction: DriveDirection; readonly speed: number }
  | { readonly op: 'stop' }
  | { readonly op: 'gripper'; readonly part: GripperPart; readonly deg: number };

/** A command as it was applied: at the start of world tick `tick`. */
export type TeleopEntry = { readonly tick: number; readonly command: TeleopCommand };

export type TeleopController = {
  /** Queues `command` for the next tick. Throws a RangeError for a command that is none (see `checkCommand`). */
  push(command: TeleopCommand): void;
  /**
   * Tick `tick` (whole, never before the last one): applies the queued commands in order through `modules`, each that changes what the
   * drive was last told, and logs it. The queue is empty after it.
   */
  apply(tick: number, modules: ModuleIO): void;
  /** The commands applied so far, with their ticks: a frozen copy. */
  log(): readonly TeleopEntry[];
  /** How many commands wait for the next tick. */
  pending(): number;
};

/**
 * What a teleop run sets up in setup(): the drive, which is both motors' `motor.set` (their EN, IN1, IN2 as OUTPUT), and no raw pin, as
 * a program that uses only the drive blocks.
 */
export const TELEOP_USES: { readonly modules: readonly ModuleUse[]; readonly inputPins: readonly never[]; readonly outputPins: readonly never[] } = Object.freeze({
  modules: Object.freeze([
    Object.freeze({ role: DRIVE_ROLE, op: 'drive.move' }),
    Object.freeze({ role: DRIVE_ROLE, op: 'drive.stop' }),
  ]),
  inputPins: Object.freeze([]),
  outputPins: Object.freeze([]),
});

/**
 * What a teleop run sets up for `kit` in setup() (N19 E3): the drive's, and on a kit with a gripper its two ops too, so that both servos
 * attach and setup() writes claw 0°, lift 90° as a program's would; and on a kit with a colour sensor `color.is`, so that setup() runs
 * `colorBegin` (Wire begins and the sensor starts, about 58 ms of the board's clock; the ports & pins tab then shows its colours while the
 * learner drives by hand). For a kit with neither it is `TELEOP_USES` itself.
 */
export function teleopUses(kit: Kit, board: BoardProfile): typeof TELEOP_USES {
  const gripper = canTeleopGripper(kit, board) ? gripperParts.map((part) => Object.freeze({ role: GRIPPER_ROLE, op: gripperOps[part] })) : [];
  const colorRole = kit.modules.find((module) => module.kind === 'color-sensor')?.role;
  const color = colorRole !== undefined && roleOps(kit, board, colorRole).includes(COLOR_IS_OP) ? [Object.freeze({ role: colorRole, op: COLOR_IS_OP })] : [];
  if (gripper.length === 0 && color.length === 0) {
    return TELEOP_USES;
  }
  return Object.freeze({
    modules: Object.freeze([...TELEOP_USES.modules, ...gripper, ...color]),
    inputPins: TELEOP_USES.inputPins,
    outputPins: TELEOP_USES.outputPins,
  });
}

/** Whether the kit can be driven by hand: it has the drive (motorLeft and motorRight). */
export function canTeleop(kit: Kit, board: BoardProfile): boolean {
  return roleOps(kit, board, DRIVE_ROLE).includes('drive.move');
}

/** N19 E3: whether the kit has a gripper whose claw and lift teleop can move (the keys Q, E, R, F and the four buttons are for it). */
export function canTeleopGripper(kit: Kit, board: BoardProfile): boolean {
  const ops = roleOps(kit, board, GRIPPER_ROLE);
  return gripperParts.every((part) => ops.includes(gripperOps[part]));
}

/** A copy of `command` that is one, frozen; throws a RangeError for anything else. */
function checkCommand(command: TeleopCommand): TeleopCommand {
  if (command.op === 'stop') {
    return Object.freeze({ op: 'stop' });
  }
  if (command.op === 'gripper') {
    if (!gripperParts.includes(command.part)) {
      throw new RangeError(`A teleop gripper command moves the claw or the lift, not ${String(command.part)}.`);
    }
    const { deg } = command;
    // The driver's own range (U-35, U-36): the claw and the lift both take 0..90 and the driver clamps to it.
    if (!Number.isInteger(deg) || deg < GRIPPER_ANGLE.min || deg > GRIPPER_ANGLE.max) {
      throw new RangeError(`A teleop gripper angle is a whole number from ${GRIPPER_ANGLE.min} to ${GRIPPER_ANGLE.max}, not ${String(deg)}.`);
    }
    return Object.freeze({ op: 'gripper', part: command.part, deg });
  }
  if (command.op !== 'move') {
    throw new RangeError(`A teleop command is a move or a stop, not ${String((command as { op?: unknown }).op)}.`);
  }
  if (!driveDirections.includes(command.direction)) {
    throw new RangeError(`A teleop move goes ${driveDirections.slice(0, -1).join(', ')} or ${driveDirections.at(-1)}, not ${String(command.direction)}.`);
  }
  const { speed } = command;
  if (!Number.isInteger(speed) || speed < 0 || speed > MOTOR_SPEED.max) {
    throw new RangeError(`A teleop speed is a whole number from 0 to ${MOTOR_SPEED.max}, not ${String(speed)}.`);
  }
  return Object.freeze({ op: 'move', direction: command.direction, speed });
}

const same = (a: TeleopCommand | null, b: TeleopCommand): boolean =>
  a !== null && a.op === b.op && (a.op === 'stop' || (a.op === 'move' && b.op === 'move' && a.direction === b.direction && a.speed === b.speed));

export function createTeleopController(): TeleopController {
  const queue: TeleopCommand[] = [];
  const entries: TeleopEntry[] = [];
  let last: TeleopCommand | null = null;
  /** N19 E3: the angle each gripper part was last told. */
  const lastGripper: Partial<Record<GripperPart, number>> = {};
  let lastTick = 0;

  return {
    push(command) {
      queue.push(checkCommand(command));
    },
    apply(tick, modules) {
      if (!Number.isInteger(tick) || tick < 0) {
        throw new RangeError(`A teleop tick is a whole number from 0, not ${tick}.`);
      }
      if (tick < lastTick) {
        throw new RangeError(`Teleop ticks only go forward: ${tick} is before ${lastTick}.`);
      }
      lastTick = tick;
      while (queue.length > 0) {
        const command = queue.shift()!;
        if (command.op === 'gripper') {
          if (lastGripper[command.part] === command.deg) {
            continue;
          }
          modules.call(GRIPPER_ROLE, gripperOps[command.part], [command.deg]);
          lastGripper[command.part] = command.deg;
          entries.push(Object.freeze({ tick, command }));
          continue;
        }
        if (same(last, command)) {
          continue;
        }
        if (command.op === 'move') {
          modules.call(DRIVE_ROLE, 'drive.move', [driveDirections.indexOf(command.direction), command.speed]);
        } else {
          modules.call(DRIVE_ROLE, 'drive.stop', []);
        }
        last = command;
        entries.push(Object.freeze({ tick, command }));
      }
    },
    log: () => Object.freeze([...entries]),
    pending: () => queue.length,
  };
}
