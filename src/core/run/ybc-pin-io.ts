import type { AnalogInIO, DigitalIO } from '../capabilities/io';
import { RuntimeFault } from '../program/values';
import { analogValueOf, pinSignal, type PinSignal } from '../simulation/pin-signal';
import type { SimulationResult } from '../simulation/simulate-circuit';

// The header pins of a Yolo:Bit-compatible board as the `digital` and `analogIn` capabilities (YB plan §10, §11.1;
// contract C-23, C-24, C-25). RunSession owns the run, so it hands this module the few things it needs
// (`PinIoAccess`); what comes out is the capability the interpreter calls, and nothing global is kept here: every
// run builds its own, and it is gone with the run (B2).
//
// A read is the signal of the net the pin is on, from the latest simulation of the run. The simulator does not
// guess a signal the evidence does not define (plan §6.2, domain guard): a pin nothing drives, a pin two things
// drive, a pin at an analog level read as on/off, and a pin the program itself sets all stop the program with
// `out-of-domain` at the block that read it.

export type PinIoAccess = {
  /** Whether the run is still the session's current one. A run that lost it writes nothing and reads 0. */
  owns(): boolean;
  /** The component id of the board in the circuit. */
  boardId: string;
  /** The port a pin is on; undefined for a name that is not a pin of the board. */
  portOf(pin: string): string | undefined;
  /** The pins usable for each capability (the board's data, reserved pins left out). */
  digitalPins: ReadonlySet<string>;
  analogPins: ReadonlySet<string>;
  /** The latest simulation of the run. */
  simulation(): SimulationResult | null;
  /** Whether the program itself drives the pin (it was written). */
  isDriven(pin: string): boolean;
  /** Drives the pin to a level and simulates again. */
  drive(pin: string, level: 0 | 1): void;
};

export function createPinCapabilities(access: PinIoAccess): { digital: DigitalIO; analogIn: AnalogInIO } {
  const usable = (pin: string, pins: ReadonlySet<string>) => {
    if (!pins.has(pin)) {
      throw new RuntimeFault('out-of-domain', `Pin ${pin} cannot be used on this board.`);
    }
  };

  /** The signal a program may read on `pin`; stops the program for one it must not. */
  const readable = (pin: string): PinSignal => {
    const simulation = access.simulation();
    const portId = access.portOf(pin);
    if (simulation === null || portId === undefined) {
      throw new RuntimeFault('internal-error', `Pin ${pin} could not be read.`);
    }
    if (access.isDriven(pin)) {
      throw new RuntimeFault('out-of-domain', `Pin ${pin} is set by this program, so it cannot be read as well.`);
    }
    const signal = pinSignal(simulation, access.boardId, portId);
    if (signal.kind === 'floating') {
      throw new RuntimeFault('out-of-domain', `Pin ${pin} is not connected to anything, so it cannot be read.`);
    }
    if (signal.kind === 'conflict') {
      throw new RuntimeFault('out-of-domain', `Pin ${pin} is driven by two things at once, so it cannot be read.`);
    }
    return signal;
  };

  return {
    digital: {
      digitalWrite(pin, level) {
        if (!access.owns()) {
          return;
        }
        usable(pin, access.digitalPins);
        // The interpreter has checked this already; a capability does not trust its caller.
        if (level !== 0 && level !== 1) {
          throw new RuntimeFault('out-of-domain', `A pin is set to 0 (off) or 1 (on), not ${String(level)}.`);
        }
        access.drive(pin, level);
      },
      digitalRead(pin) {
        if (!access.owns()) {
          return 0;
        }
        usable(pin, access.digitalPins);
        const signal = readable(pin);
        if (signal.kind === 'analog') {
          throw new RuntimeFault('out-of-domain', `Pin ${pin} carries an analog level, which is neither on nor off. Use "analog read".`);
        }
        return signal.kind === 'high' ? 1 : 0;
      },
    },
    analogIn: {
      analogRead(pin) {
        if (!access.owns()) {
          return 0;
        }
        usable(pin, access.analogPins);
        const value = analogValueOf(readable(pin));
        if (value === null) {
          throw new RuntimeFault('internal-error', `Pin ${pin} could not be read.`);
        }
        return value;
      },
    },
  };
}
