import { portParam } from '../kit';
import { defineDriver, defineOp, pinMacro, pinOf, type DriverOp } from './driver';

// An IR obstacle sensor read as a digital input (N19 plan §4.3; contract row U-37 is task A5's). `ir.detect` is true while the module
// sees something: its output LOW when the kit says activeLow (the driver's default: the common modules pull it LOW), HIGH otherwise,
// written by the level the kit gives, as line-digital does. Time: one digitalRead (3.9375 µs on A3, EMU-20, as EMU-08 on A1).

const detectLevel = (port: Parameters<DriverOp['sim']>[1]): 0 | 1 => (portParam(port, 'activeLow') === false ? 1 : 0);

export const irDigitalDriver = defineDriver('ir-digital', {
  'ir.detect': defineOp({
    kind: 'read',
    row: 'U-37',
    args: [],
    setup: [{ kind: 'pinMode', pin: 'PIN', mode: 'INPUT' }],
    sim: (io, port) => io.digitalRead(pinOf(port, 'PIN')) === detectLevel(port),
    cpp: { helper: null, call: (port, role) => `(digitalRead(${pinMacro(role, 'PIN')}) == ${detectLevel(port) === 0 ? 'LOW' : 'HIGH'})` },
  }),
});
