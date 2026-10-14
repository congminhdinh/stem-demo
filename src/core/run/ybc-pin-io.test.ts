import { describe, expect, it, vi } from 'vitest';
import type { AnalogInIO, DigitalIO } from '../capabilities/io';
import type { RuntimeServices } from '../capabilities/services';
import { localDeviceDefinitions } from '../devices/local-catalog';
import { createDeviceRegistry } from '../devices/registry';
import { RuntimeFault } from '../program/values';
import type { NetLevel, SimulationResult } from '../simulation/simulate-circuit';
import type { RunEnvironment } from './run-session';
import { createPinCapabilities } from './ybc-pin-io';

// The pin factory against a hand-made RunEnvironment (YB-CP amendment 1): it sees the run only through
// `drivePin` and `simulation()`, and what it does when the environment says the run is over (YB-4). The
// RunSession wiring is tested in run-session.ybc-pins*.test.ts, with the real session.

const registry = createDeviceRegistry(localDeviceDefinitions);
const board = { id: 'ybc-board-1', deviceType: 'ybc-board', position: { x: 0, y: 0 } };

/** A simulation in which each pin's net has the given level (and percent for `analog`); pins left out are floating. */
function simulationOf(levels: Partial<Record<'p0' | 'p1' | 'p2', NetLevel | { analog: number }>>): SimulationResult {
  return {
    nets: Object.entries(levels).map(([portId, level]) => {
      const ports = [{ componentId: board.id, portId }];
      return typeof level === 'object' ? { ports, level: 'analog' as const, analogPercent: level.analog } : { ports, level: level as NetLevel };
    }),
    components: {},
    pinReads: { P0: 0, P1: 0, P2: 0 },
  };
}

function fakeEnvironment(simulation: () => SimulationResult | null = () => null) {
  const drivePin = vi.fn<(pin: string, level: 0 | 1) => void>();
  const environment: RunEnvironment = {
    board,
    capabilitySet: ['digital', 'analogIn'],
    services: {} as RuntimeServices,
    input: () => undefined,
    takePresses: () => 0,
    report: () => {},
    simulation,
    drivePin,
  };
  return { environment, drivePin };
}

function pinsOver(simulation: () => SimulationResult | null) {
  const { environment, drivePin } = fakeEnvironment(simulation);
  const capabilities = createPinCapabilities(registry)(environment);
  return { digital: capabilities.digital as DigitalIO, analogIn: capabilities.analogIn as AnalogInIO, drivePin };
}

const fault = (action: () => unknown) => {
  try {
    action();
  } catch (error) {
    return error instanceof RuntimeFault ? { code: error.code, message: error.message } : error;
  }
  return 'no fault';
};

describe('the pin factory', () => {
  it('offers the digital and analog-in capabilities of the header pins and nothing else, new for every run', () => {
    const { environment } = fakeEnvironment();
    const factory = createPinCapabilities(registry);
    const first = factory(environment);
    const second = factory(environment);
    expect(Object.keys(first).sort()).toEqual(['analogIn', 'digital']);
    expect(first.digital).not.toBe(second.digital);
    expect(first.analogIn).not.toBe(second.analogIn);
  });

  it('drives a pin only through environment.drivePin, with the pin and the level', () => {
    const { digital, drivePin } = pinsOver(() => simulationOf({}));
    digital.digitalWrite('P0', 1);
    digital.digitalWrite('P2', 0);
    expect(drivePin.mock.calls).toEqual([['P0', 1], ['P2', 0]]);
  });

  it('refuses a pin that is not on the board and a level that is not 0 or 1, before the run is touched', () => {
    const { digital, analogIn, drivePin } = pinsOver(() => simulationOf({ p0: 'high' }));
    expect(fault(() => digital.digitalWrite('P3', 1))).toEqual({ code: 'out-of-domain', message: 'Pin P3 cannot be used on this board.' });
    expect(fault(() => digital.digitalWrite('P0', 2 as never))).toMatchObject({ code: 'out-of-domain' });
    expect(fault(() => digital.digitalRead('P9'))).toMatchObject({ code: 'out-of-domain' });
    expect(fault(() => analogIn.analogRead('constructor'))).toMatchObject({ code: 'out-of-domain' });
    expect(drivePin).not.toHaveBeenCalled();
  });

  it('reads the signal of the net the pin is on, from environment.simulation()', () => {
    const { digital, analogIn } = pinsOver(() => simulationOf({ p0: 'high', p1: 'low', p2: { analog: 50 } }));
    expect(digital.digitalRead('P0')).toBe(1);
    expect(digital.digitalRead('P1')).toBe(0);
    expect(analogIn.analogRead('P0')).toBe(4095);
    expect(analogIn.analogRead('P1')).toBe(0);
    // The wiper at 50 % is percentToNative(50, 4095).
    expect(analogIn.analogRead('P2')).toBe(2048);
  });

  it('stops the program for a signal it must not read: floating, a conflict, an analog level read as on/off', () => {
    const { digital, analogIn } = pinsOver(() => simulationOf({ p1: 'conflict', p2: { analog: 10 } }));
    expect(fault(() => digital.digitalRead('P0'))).toEqual({ code: 'out-of-domain', message: 'Pin P0 is not connected to anything, so it cannot be read.' });
    expect(fault(() => analogIn.analogRead('P0'))).toMatchObject({ code: 'out-of-domain' });
    expect(fault(() => digital.digitalRead('P1'))).toEqual({ code: 'out-of-domain', message: 'Pin P1 is driven by two things at once, so it cannot be read.' });
    expect(fault(() => analogIn.analogRead('P1'))).toMatchObject({ code: 'out-of-domain' });
    expect(fault(() => digital.digitalRead('P2'))).toEqual({
      code: 'out-of-domain',
      message: 'Pin P2 carries an analog level, which is neither on nor off. Use "analog read".',
    });
  });

  it('cannot read a pin this program has set, and keeps that to the capabilities of the run that wrote it', () => {
    const levels = simulationOf({ p0: 'high', p1: 'high' });
    const run = pinsOver(() => levels);
    run.digital.digitalWrite('P0', 1);
    expect(fault(() => run.digital.digitalRead('P0'))).toEqual({
      code: 'out-of-domain',
      message: 'Pin P0 is set by this program, so it cannot be read as well.',
    });
    expect(fault(() => run.analogIn.analogRead('P0'))).toMatchObject({ code: 'out-of-domain' });
    expect(run.digital.digitalRead('P1')).toBe(1);
    // Another run's capabilities start with nothing written.
    expect(pinsOver(() => levels).digital.digitalRead('P0')).toBe(1);
  });

  it('is inert once the environment says the run is over: a read is 0 and never a fault, a write is only handed to the inert drivePin', () => {
    const { digital, analogIn, drivePin } = pinsOver(() => null);
    expect(digital.digitalRead('P0')).toBe(0);
    expect(analogIn.analogRead('P1')).toBe(0);
    digital.digitalWrite('P0', 1);
    expect(drivePin).toHaveBeenCalledTimes(1);
  });

  it('follows the environment, not a copy it kept: the run ends between two reads', () => {
    let current: SimulationResult | null = simulationOf({ p0: 'high' });
    const { digital } = pinsOver(() => current);
    expect(digital.digitalRead('P0')).toBe(1);
    current = null;
    expect(digital.digitalRead('P0')).toBe(0);
  });

  it('only reads the simulation it is given: a frozen copy is enough, and it is not changed', () => {
    const frozen = structuredClone(simulationOf({ p0: 'high', p1: { analog: 30 } }));
    const before = JSON.stringify(frozen);
    Object.freeze(frozen);
    for (const net of frozen.nets) {
      Object.freeze(net);
      Object.freeze(net.ports);
    }
    const { digital, analogIn } = pinsOver(() => frozen);
    expect(digital.digitalRead('P0')).toBe(1);
    expect(analogIn.analogRead('P1')).toBe(1229);
    expect(JSON.stringify(frozen)).toBe(before);
  });
});
