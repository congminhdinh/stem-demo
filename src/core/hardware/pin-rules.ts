import type { Diagnostic, HardwareDiagnosticCode } from '../capabilities/diagnostics';
import { boardPin, reservedPins, type BoardProfile } from './board';
import type { KitBoardTarget } from './board-target';
import { driverPortSpecs, type Kit } from './kit';

// The pin rules of the robot (N18 R1.2, contract §5.2, §5.3, §9). A kit's ports must not share a pin, must leave D0/D1
// alone while the program prints, and must not need PWM on a timer the Servo library (T1: D9, D10) or tone (T2: D3, D11)
// takes: R0.4 traced that such a pin stays LOW (EMU-04, EMU-05), so the program would not do what it says and Run/Check is
// refused (timer-claimed, U-48). What the program uses decides the claims: the generated sketch attaches a servo or plays a
// tone only when the program does (contract §2.3), so a kit with an unused servo leaves T1 to PWM.

export type HardwareDiagnostic = Diagnostic<HardwareDiagnosticCode> & {
  /** The board pin the problem is on. */
  pin?: string;
  /** The kit ports involved, in kit order. */
  ports?: readonly string[];
  /** The role, for a warning of the module binding. */
  role?: string;
  /** The I²C address, for wire-nack. */
  address?: number;
};

/** What the program uses that changes the pin rules: a servo (Timer1), a tone (Timer2), printing (D0, D1). */
export type KitUsage = { readonly servo: boolean; readonly tone: boolean; readonly serial: boolean };

/** The timers the program's use takes: board `timerClaims` of `servo` and `tone`, when used. */
function claimedTimers(board: Pick<BoardProfile, 'timerClaims'>, usage: Pick<KitUsage, 'servo' | 'tone'>): Map<string, string> {
  const claimed = new Map<string, string>();
  for (const claimer of ['servo', 'tone'] as const) {
    const timer = board.timerClaims[claimer];
    if (usage[claimer] && timer !== undefined && !claimed.has(timer)) {
      claimed.set(timer, claimer);
    }
  }
  return claimed;
}

/**
 * The diagnostics of a kit for a program's use: pin-conflict (one board pin, more than one port pin), timer-claimed (a
 * driver needs PWM on a pin whose timer the program's servo or tone takes), pin-reserved (a port on D0/D1 while the program
 * prints). Every one is an error: Run and Check are refused. In board order of the pin, conflicts first.
 */
export function checkKit(kit: Kit, board: BoardProfile, usage: KitUsage): HardwareDiagnostic[] {
  const users = new Map<string, { port: string; name: string }[]>();
  for (const port of kit.ports) {
    for (const [name, pin] of Object.entries(port.pins)) {
      users.set(pin, [...(users.get(pin) ?? []), { port: port.id, name }]);
    }
  }
  const boardOrder = board.pins.map((pin) => pin.id).filter((pin) => users.has(pin));
  const portsOf = (pin: string) => [...new Set((users.get(pin) ?? []).map((user) => user.port))];
  const diagnostics: HardwareDiagnostic[] = [];

  for (const pin of boardOrder) {
    const wired = users.get(pin) ?? [];
    if (wired.length > 1) {
      diagnostics.push({
        severity: 'error',
        code: 'pin-conflict',
        pin,
        ports: portsOf(pin),
        message: `Pin ${pin} is wired to more than one port: ${wired.map((user) => `${user.port} (${user.name})`).join(', ')}.`,
      });
    }
  }

  const claimed = claimedTimers(board, usage);
  for (const port of kit.ports) {
    for (const [name, pinSpec] of Object.entries(driverPortSpecs[port.driver].pins)) {
      const pin = port.pins[name];
      const timer = pin === undefined ? undefined : boardPin(board, pin)?.pwmTimer;
      const claimer = timer === undefined ? undefined : claimed.get(timer);
      if (pinSpec.needs === 'pwm' && pin !== undefined && claimer !== undefined) {
        diagnostics.push({
          severity: 'error',
          code: 'timer-claimed',
          pin,
          ports: [port.id],
          message: `Port ${port.id} needs PWM on ${pin}, but the ${claimer} holds timer ${String(timer)} there: the pin would stay LOW (contract U-48).`,
        });
      }
    }
  }

  if (usage.serial) {
    const serialPins = reservedPins(board, 'serial');
    for (const pin of boardOrder.filter((candidate) => serialPins.includes(candidate))) {
      for (const port of portsOf(pin)) {
        diagnostics.push({
          severity: 'error',
          code: 'pin-reserved',
          pin,
          ports: [port],
          message: `Port ${port} uses ${pin}, but the program prints: Serial holds ${serialPins.join(' and ')}.`,
        });
      }
    }
  }
  return diagnostics;
}

/** The raw pin ops of the Advanced profile (contract U-31…U-34). */
export type RawPinOp = 'digital.write' | 'pwm.write' | 'digital.read' | 'analogIn.read';

/**
 * Whether an Advanced program may name `pin` in a raw op (contract §9): null when it may, otherwise the diagnostic the
 * compiler reports. pin-unavailable (error) for a pin the kit uses, a pin Serial holds while the program prints, a pin
 * that does not exist, or (reads) a pin no input/analog module is wired to; timer-claimed (error) for pwm.write on a PWM
 * pin whose timer the program's servo or tone takes; not-pwm (warning) for pwm.write on a pin without PWM, which then drives
 * HIGH from 128 up and LOW below.
 */
export function rawPinCheck(target: KitBoardTarget, op: RawPinOp, pin: string, usage: KitUsage): HardwareDiagnostic | null {
  const unavailable = (why: string): HardwareDiagnostic => ({ severity: 'error', code: 'pin-unavailable', pin, message: `${op} cannot use ${pin}: ${why}.` });
  if (!target.raw.free.includes(pin) && target.usedBy[pin] === undefined) {
    return unavailable(`it is not a pin of ${target.board}`);
  }
  if (usage.serial && target.raw.serial.includes(pin)) {
    return unavailable(`the program prints, and Serial holds ${target.raw.serial.join(' and ')}`);
  }
  switch (op) {
    case 'digital.read':
      return target.raw.read.includes(pin) ? null : unavailable('no input module is wired to it, and a floating pin reads at random');
    case 'analogIn.read':
      return target.raw.analogRead.includes(pin) ? null : unavailable('no module read as analog is wired to it');
    case 'digital.write':
    case 'pwm.write': {
      const port = target.usedBy[pin];
      if (port !== undefined) {
        return unavailable(`port ${port} of the kit uses it`);
      }
      if (op === 'digital.write') {
        return null;
      }
      const timer = target.pwmTimers[pin];
      if (timer === undefined) {
        return { severity: 'warning', code: 'not-pwm', pin, message: `${pin} has no PWM: pwm.write drives it HIGH from 128 up and LOW below.` };
      }
      const claimer = claimedTimers(target, usage).get(timer);
      return claimer === undefined
        ? null
        : { severity: 'error', code: 'timer-claimed', pin, message: `PWM on ${pin} is not possible: the ${claimer} holds timer ${timer} there, so the pin would stay LOW (contract U-48).` };
    }
  }
}
