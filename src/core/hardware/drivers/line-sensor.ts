import { portParam } from '../kit';
import { defineDriver, defineOp, pinMacro, pinOf, type DriverOp } from './driver';

// Line sensors (contract U-28, U-29, §6.5). line-digital: `line.dark` reads the pin, dark at LOW when the kit says
// activeLow, at HIGH otherwise (the generator writes the level the kit gives); `line.raw` (Advanced) is analogRead of the
// same pin, when it is an analog pin. line-analog has only `line.raw`: the contract has no row for a dark threshold on an
// analog sensor, so `line.dark` is not offered on it (capability-unavailable) until one is established.

const darkLevel = (port: Parameters<DriverOp['sim']>[1]): 0 | 1 => (portParam(port, 'activeLow') === true ? 0 : 1);

const raw = defineOp({
  kind: 'read',
  row: 'U-29',
  args: [],
  requires: { pin: 'PIN', cap: 'analogIn' },
  setup: [],
  sim: (io, port) => io.analogRead(pinOf(port, 'PIN')),
  cpp: { helper: null, call: (_port, role) => `(long)analogRead(${pinMacro(role, 'PIN')})` },
});

export const lineDigitalDriver = defineDriver('line-digital', {
  'line.dark': defineOp({
    kind: 'read',
    row: 'U-28',
    args: [],
    setup: [{ kind: 'pinMode', pin: 'PIN', mode: 'INPUT' }],
    sim: (io, port) => io.digitalRead(pinOf(port, 'PIN')) === darkLevel(port),
    cpp: { helper: null, call: (port, role) => `(digitalRead(${pinMacro(role, 'PIN')}) == ${darkLevel(port) === 0 ? 'LOW' : 'HIGH'})` },
  }),
  'line.raw': raw,
});

export const lineAnalogDriver = defineDriver('line-analog', { 'line.raw': raw });
