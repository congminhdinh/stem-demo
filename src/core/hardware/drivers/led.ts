import { defineDriver, defineOp, pinMacro, pinOf } from './driver';

// An LED on a digital pin (contract U-24, §6.4): OUTPUT in setup() (off at start), HIGH when on, LOW when off.

export const ledDriver = defineDriver('led-digital', {
  'led.set': defineOp({
    kind: 'call',
    row: 'U-24',
    args: [null],
    setup: [{ kind: 'pinMode', pin: 'PIN', mode: 'OUTPUT' }],
    sim(io, port, [on = 0]) {
      io.digitalWrite(pinOf(port, 'PIN'), on !== 0 ? 1 : 0);
    },
    cpp: { helper: null, call: (_port, role, [on = 'false']) => `digitalWrite(${pinMacro(role, 'PIN')}, (${on}) ? HIGH : LOW);` },
  }),
});
