import { defineDriver, defineOp, pinMacro, pinOf } from './driver';

// A push button to GND with the internal pull-up (contract U-30, §6.4): INPUT_PULLUP in setup(); pressed when the pin reads
// LOW, released HIGH thanks to the pull-up (ARD-16). No debounce.

export const buttonDriver = defineDriver('button-pullup', {
  'button.pressed': defineOp({
    kind: 'read',
    row: 'U-30',
    args: [],
    setup: [{ kind: 'pinMode', pin: 'PIN', mode: 'INPUT_PULLUP' }],
    sim: (io, port) => io.digitalRead(pinOf(port, 'PIN')) === 0,
    cpp: { helper: null, call: (_port, role) => `(digitalRead(${pinMacro(role, 'PIN')}) == LOW)` },
  }),
});
