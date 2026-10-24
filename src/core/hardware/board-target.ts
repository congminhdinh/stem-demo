import { capabilityKeys } from '../capabilities/io';
import type { BoardTarget } from '../devices/board-pins';
import type { BoardContext, CapabilitySet } from '../profiles/board-context';
import { boardPin, reservedPins, type BoardProfile } from './board';
import { DRIVE_ROLE, roleOps } from './drivers';
import { driverPortSpecs, robotRoles, type Kit, type KitRef, type RobotRole } from './kit';

// What the compiler knows of a kit (N18 R1.2, robot plan §4.2): the roles present (a role the kit lacks is
// capability-unavailable), the pins a raw Advanced op may name (contract §9), and the capability set. It extends the
// compiler's BoardTarget, so code written for a board target takes it as it is.
//
// The `modules` capability comes from the kit, not from the board: the uno-r3 device definition offers what its pins do
// (`digital`, `pwm`, `analogIn`), and a robot's modules are the kit's. `kitBoardContext` adds `modules` to a resolved board
// context, so composeCapabilities keeps the module binding instead of rejecting it.

export type KitBoardTarget = BoardTarget & {
  readonly kit: KitRef;
  readonly board: string;
  /** The roles of the kit, in vocabulary order. */
  readonly roles: readonly RobotRole[];
  /**
   * The module ops each role offers (`line.raw` only on an analog pin), and `drive` with the drive ops when both motors are
   * there. An op a block needs that is missing here is capability-unavailable.
   */
  readonly ops: Readonly<Record<string, readonly string[]>>;
  /** The board pins a raw op (U-31…U-34) may name, in board order. */
  readonly raw: {
    /** Pins no port uses: digital.write and pwm.write. */
    readonly free: readonly string[];
    /** The free PWM pins whose timer none of the kit's drivers can claim: pwm.write drives a duty there. */
    readonly pwm: readonly string[];
    /** Pins wired to an input module (button, line sensor, echo): digital.read. A floating pin reads at random (ARD-06). */
    readonly read: readonly string[];
    /** Analog pins wired to a module read as analog (line sensors): analogIn.read. */
    readonly analogRead: readonly string[];
    /** Reserved while the program prints (D0, D1). */
    readonly serial: readonly string[];
  };
  /** Board pin → the port that uses it. */
  readonly usedBy: Readonly<Record<string, string>>;
  /** Each PWM pin's timer, and what claims which timer (board data). */
  readonly pwmTimers: Readonly<Record<string, string>>;
  readonly timerClaims: Readonly<Record<string, string>>;
  /** The timer claims the kit's drivers can take (`servo` for servo-lib, `tone` for buzzer-tone), in board order of the claims. */
  readonly claimers: readonly string[];
};

const known = new Set<string>(capabilityKeys);

/** The capability set of a board with its kit: the board's, plus `modules` when the kit has modules. */
export function kitCapabilities(boardCapabilities: CapabilitySet, kit: Kit): string[] {
  const set = [...boardCapabilities];
  return kit.modules.length > 0 && !set.includes('modules') ? [...set, 'modules'] : set;
}

/** The capabilities the board profile's pins give, each once, in pin order (the device definition's board context gives the same). */
function boardCapabilities(board: BoardProfile): string[] {
  return [...new Set(board.pins.flatMap((pin) => pin.caps.filter((cap) => known.has(cap))))];
}

export function kitBoardTarget(kit: Kit, board: BoardProfile): KitBoardTarget {
  const usedBy: Record<string, string> = {};
  const read = new Set<string>();
  const analogRead = new Set<string>();
  for (const port of kit.ports) {
    const spec = driverPortSpecs[port.driver];
    for (const [name, pin] of Object.entries(port.pins)) {
      usedBy[pin] ??= port.id;
      const pinSpec = spec.pins[name];
      if (pinSpec?.dir === 'in') {
        read.add(pin);
      }
      if (pinSpec?.analog && boardPin(board, pin)?.caps.includes('analogIn')) {
        analogRead.add(pin);
      }
    }
  }
  const claims = new Set(kit.ports.flatMap((port) => driverPortSpecs[port.driver].claims ?? []));
  const claimers = Object.keys(board.timerClaims).filter((claimer) => claims.has(claimer));
  const claimedTimers = new Set(claimers.map((claimer) => board.timerClaims[claimer]));
  const pwmTimers = Object.fromEntries(board.pins.flatMap((pin) => (pin.pwmTimer === undefined ? [] : [[pin.id, pin.pwmTimer]])));

  const inBoardOrder = (pins: ReadonlySet<string>) => board.pins.map((pin) => pin.id).filter((id) => pins.has(id));
  const free = board.pins.map((pin) => pin.id).filter((id) => usedBy[id] === undefined);
  const pwm = free.filter((id) => pwmTimers[id] !== undefined && !claimedTimers.has(pwmTimers[id]));
  const raw = { free, pwm, read: inBoardOrder(read), analogRead: inBoardOrder(analogRead), serial: reservedPins(board, 'serial') };
  const present = new Set(kit.modules.map((module) => module.role));
  const roles = robotRoles.filter((role) => present.has(role));
  const ops = Object.fromEntries(
    [...roles, DRIVE_ROLE].map((role) => [role, roleOps(kit, board, role)] as const).filter(([, list]) => list.length > 0),
  );

  return {
    capabilities: kitCapabilities(boardCapabilities(board), kit),
    pins: { digital: raw.free, analogIn: raw.analogRead, pwm: raw.pwm, servo: [] },
    kit: { id: kit.id, version: kit.version },
    board: board.id,
    roles,
    ops,
    raw,
    usedBy,
    pwmTimers,
    timerClaims: board.timerClaims,
    claimers,
  };
}

/**
 * A resolved board context with its kit: a ready board gets the kit's `modules` (kitCapabilities). Everything else is the
 * context as `resolveBoardContext` gave it; a board that is not ready stays as it is.
 */
export function kitBoardContext(context: BoardContext, kit: Kit): BoardContext {
  if (!context.readiness.ok) {
    return context;
  }
  return { ...context, readiness: { ...context.readiness, capabilities: kitCapabilities(context.readiness.capabilities, kit) } };
}
