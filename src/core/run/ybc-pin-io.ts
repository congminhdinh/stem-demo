import { isContractPin, PWM_MAX, SERVO_MAX_ANGLE } from '../constructs/ybc.pins';
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
// guess a signal the evidence does not define (plan §6.2, domain guard): a pin two things drive, a pin at an analog
// level read as on/off, a pin the program itself sets, and an analog read of a pin nothing drives all stop the program
// with `out-of-domain` at the block that read it. N17 B4 (owner, 2026-10-19; the old B9): an on/off read of a pin nothing
// drives reads 0, as a pin with a pull-down would, and the run gets a warning once per pin (the pull of the board is
// UNVERIFIED, contract C-24); the program goes on.
//
// N17 B5: `pwm` (`write_analog`, C-26) and `servo` (`servo_write`, C-27) drive the pin with a PWM duty 0..1023 or a servo signal
// 0..180° through the same `drivePin`; the simulation carries it on the pin's net (an LED there glows at duty / 1023, a servo
// there turns). The interpreter has clamped the value (and warned the run); a value outside the range here is a caller that does
// not keep the contract, refused like a level that is not 0 or 1. A pin driven so is one the program set: it cannot be read.

export function createPinCapabilities(registry: DeviceRegistry): CapabilityFactory {
  return (environment) => {
    const definition = registry.get(environment.board.deviceType);
    // The pins a program may use: the three the contract opens (C-23, C-24, C-25), and of those only the ones the board's
    // data gives the capability and does not reserve. The contract domain is checked here, not trusted to the blocks, the
    // compiler or the metadata: a board that lists P3 does not open it.
    const digitalPins = new Set(usablePins(definition, 'digital').filter(isContractPin));
    const analogPins = new Set(usablePins(definition, 'analogIn').filter(isContractPin));
    const pwmPins = new Set(usablePins(definition, 'pwm').filter(isContractPin));
    const servoPins = new Set(usablePins(definition, 'servo').filter(isContractPin));
    const portOf = (pin: string) => definition.board?.pins.find((candidate) => candidate.name === pin)?.portId;
    /** The pins this program has set: it cannot read them as well. Per run, like the capabilities. */
    const written = new Set<string>();
    /** The pins whose floating read the run was already warned about (N17 B4): once per pin and run. */
    const warned = new Set<string>();

    const usable = (pin: string, pins: ReadonlySet<string>) => {
      if (!pins.has(pin)) {
        throw new RuntimeFault('out-of-domain', `Pin ${pin} cannot be used on this board.`);
      }
    };
    /** A whole number in 0..max, else the caller broke the contract. */
    const within = (value: number, max: number, fault: () => RuntimeFault) => {
      if (!Number.isInteger(value) || value < 0 || value > max) {
        throw fault();
      }
    };

    /**
     * The signal a program may read on `pin`; stops the program for one it must not. Null once the run is over. `floating` is
     * returned only for an on/off read, which reads it as 0 (N17 B4); any other read of a floating pin stops the program.
     */
    const readable = (pin: string, floating: 'reads-0' | 'stops'): PinSignal | null => {
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
      if (signal.kind === 'floating' && floating === 'stops') {
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
          const signal = readable(pin, 'reads-0');
          if (signal === null) {
            return 0;
          }
          if (signal.kind === 'floating') {
            if (!warned.has(pin)) {
              warned.add(pin);
              environment.warn({ code: 'floating-pin', message: `Pin ${pin} is floating, so it reads 0. Connect the button to 3V3 or GND.` });
            }
            return 0;
          }
          if (signal.kind === 'analog') {
            throw new RuntimeFault('out-of-domain', `Pin ${pin} carries an analog level, which is neither on nor off. Use "analog read".`);
          }
          return signal.kind === 'high' ? 1 : 0;
        },
      },
      pwm: {
        pwmWrite(pin, duty) {
          usable(pin, pwmPins);
          within(duty, PWM_MAX, () => new RuntimeFault('out-of-domain', `An analog value is between 0 and ${PWM_MAX}, not ${String(duty)}.`));
          written.add(pin);
          environment.drivePin(pin, { kind: 'pwm', duty });
        },
      },
      servo: {
        servoWrite(pin, angle) {
          usable(pin, servoPins);
          within(angle, SERVO_MAX_ANGLE, () => new RuntimeFault('out-of-domain', `A servo angle is between 0 and ${SERVO_MAX_ANGLE}, not ${String(angle)}.`));
          written.add(pin);
          environment.drivePin(pin, { kind: 'servo', angle });
        },
      },
      analogIn: {
        analogRead(pin) {
          usable(pin, analogPins);
          const signal = readable(pin, 'stops');
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
