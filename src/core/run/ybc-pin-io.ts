import { usablePins } from '../devices/board-pins';
import type { DeviceRegistry } from '../devices/registry';
import { RuntimeFault } from '../program/values';
import { analogValueOf, pinSignal, type PinSignal } from '../simulation/pin-signal';
import type { CapabilityFactory } from './run-session';

// The header pins of a Yolo:Bit-compatible board as the `digital` and `analogIn` capabilities (YB plan §10, §11.1;
// contract C-23, C-24, C-25), built through the one seam RunSession offers (YB-CP amendment 1): a
// `CapabilityFactory`, given the `RunEnvironment` of one run. A write is `environment.drivePin`; a read is the
// signal of the net the pin is on in `environment.simulation()`. RunSession knows nothing of pins, of the
// potentiometer or of this module: the composition root passes the factory in. Nothing global is kept here: every
// run builds its own capabilities, and they are gone with the run (B2). Once the run is over or replaced, its
// environment is inert, and so are they: a write is ignored and a read is 0.
//
// A read is the signal of the net the pin is on, from the latest simulation of the run. The simulator does not
// guess a signal the evidence does not define (plan §6.2, domain guard): a pin nothing drives, a pin two things
// drive, a pin at an analog level read as on/off, and a pin the program itself sets all stop the program with
// `out-of-domain` at the block that read it.

export function createPinCapabilities(registry: DeviceRegistry): CapabilityFactory {
  return (environment) => {
    const definition = registry.get(environment.board.deviceType);
    const digitalPins = new Set(usablePins(definition, 'digital'));
    const analogPins = new Set(usablePins(definition, 'analogIn'));
    const portOf = (pin: string) => definition.board?.pins.find((candidate) => candidate.name === pin)?.portId;
    /** The pins this program has set: it cannot read them as well. Per run, like the capabilities. */
    const written = new Set<string>();

    const usable = (pin: string, pins: ReadonlySet<string>) => {
      if (!pins.has(pin)) {
        throw new RuntimeFault('out-of-domain', `Pin ${pin} cannot be used on this board.`);
      }
    };

    /** The signal a program may read on `pin`; stops the program for one it must not. Null once the run is over. */
    const readable = (pin: string): PinSignal | null => {
      const simulation = environment.simulation();
      if (simulation === null) {
        return null;
      }
      const portId = portOf(pin);
      if (portId === undefined) {
        throw new RuntimeFault('internal-error', `Pin ${pin} could not be read.`);
      }
      if (written.has(pin)) {
        throw new RuntimeFault('out-of-domain', `Pin ${pin} is set by this program, so it cannot be read as well.`);
      }
      const signal = pinSignal(simulation, environment.board.id, portId);
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
          usable(pin, digitalPins);
          // The interpreter has checked this already; a capability does not trust its caller.
          if (level !== 0 && level !== 1) {
            throw new RuntimeFault('out-of-domain', `A pin is set to 0 (off) or 1 (on), not ${String(level)}.`);
          }
          written.add(pin);
          environment.drivePin(pin, level);
        },
        digitalRead(pin) {
          usable(pin, digitalPins);
          const signal = readable(pin);
          if (signal === null) {
            return 0;
          }
          if (signal.kind === 'analog') {
            throw new RuntimeFault('out-of-domain', `Pin ${pin} carries an analog level, which is neither on nor off. Use "analog read".`);
          }
          return signal.kind === 'high' ? 1 : 0;
        },
      },
      analogIn: {
        analogRead(pin) {
          usable(pin, analogPins);
          const signal = readable(pin);
          if (signal === null) {
            return 0;
          }
          const value = analogValueOf(signal);
          if (value === null) {
            throw new RuntimeFault('internal-error', `Pin ${pin} could not be read.`);
          }
          return value;
        },
      },
    };
  };
}
