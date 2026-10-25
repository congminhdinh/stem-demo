import type { ModuleIO } from '../capabilities/io';
import type { BoardProfile } from '../hardware/board';
import { DRIVE_ROLE, driveDirections, MOTOR_SPEED, roleOps, type DriveDirection, type ModuleUse } from '../hardware/drivers';
import type { Kit } from '../hardware/kit';

// Teleop, "Lái tay" (N18 R4.8): the learner drives the robot by hand, with the 3D view's D-pad or the keyboard, while no program runs.
// It drives through the same hardware as a program, so the pins, the C++ view and the inspector stay true: a command is a call of the
// drive (`drive.move(direction, speed)` / `drive.stop` on the role `drive`) on the module binding of the run's virtual UNO, never a push
// of the physics body. This is the pure part: the commands the UI gives between two ticks wait in a queue, and the run session applies
// them at the start of the next tick (`apply(tick, modules)`), where a program's first statement of that tick would make the same calls.
// So a teleop session is fixed by its input log, (tick, command): the same log gives the same world, tick for tick, as a program that
// makes the same calls at the same ticks (robot-run-session.teleop.test.ts). A command that repeats what the drive was last told (a key
// held down) changes nothing and is not logged.

/** One command of teleop: drive one way at `speed` (0..100, the drive's own scale), or stop both motors. */
export type TeleopCommand = { readonly op: 'move'; readonly direction: DriveDirection; readonly speed: number } | { readonly op: 'stop' };

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

/** Whether the kit can be driven by hand: it has the drive (motorLeft and motorRight). */
export function canTeleop(kit: Kit, board: BoardProfile): boolean {
  return roleOps(kit, board, DRIVE_ROLE).includes('drive.move');
}

/** A copy of `command` that is one, frozen; throws a RangeError for anything else. */
function checkCommand(command: TeleopCommand): TeleopCommand {
  if (command.op === 'stop') {
    return Object.freeze({ op: 'stop' });
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
  a !== null && a.op === b.op && (a.op === 'stop' || (b.op === 'move' && a.direction === b.direction && a.speed === b.speed));

export function createTeleopController(): TeleopController {
  const queue: TeleopCommand[] = [];
  const entries: TeleopEntry[] = [];
  let last: TeleopCommand | null = null;
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
