import { clampTo, defineDriver, defineOp, pinMacro, pinOf, type ArgRange } from './driver';

// A passive buzzer on tone() (contract U-25, U-26, §6.3). hz 31..4000 and ms 1..60000 are clamped (ms 0 would play
// forever); the tone plays in the background and a new one on the pin replaces it. `buzzer.stop` (Advanced) is noTone: the
// pin is LOW at once. tone takes Timer2 (tone claim): no PWM on D3/D11 while it plays (U-48).

export const TONE_HZ: ArgRange = { name: 'hz', min: 31, max: 4000 };
export const TONE_MS: ArgRange = { name: 'ms', min: 1, max: 60_000 };

const helper = [
  'void buzzerTone(uint8_t pin, long hz, long ms) {',
  '  if (hz < 31L) hz = 31L;',
  '  if (hz > 4000L) hz = 4000L;',
  '  if (ms < 1L) ms = 1L;',
  '  if (ms > 60000L) ms = 60000L;',
  '  tone(pin, (unsigned int)hz, (unsigned long)ms);',
  '}',
].join('\n');

export const buzzerDriver = defineDriver('buzzer-tone', {
  'buzzer.tone': defineOp({
    kind: 'call',
    row: 'U-25',
    args: [TONE_HZ, TONE_MS],
    setup: [],
    sim(io, port, [hz = 0, ms = 0]) {
      io.tone(pinOf(port, 'PIN'), clampTo(TONE_HZ, hz), clampTo(TONE_MS, ms));
    },
    cpp: {
      helper: { id: 'buzzer-tone', text: helper },
      call: (_port, role, [hz = '0L', ms = '0L']) => `buzzerTone(${pinMacro(role, 'PIN')}, ${hz}, ${ms});`,
    },
  }),
  'buzzer.stop': defineOp({
    kind: 'call',
    row: 'U-26',
    args: [],
    setup: [],
    sim(io, port) {
      io.noTone(pinOf(port, 'PIN'));
    },
    cpp: { helper: null, call: (_port, role) => `noTone(${pinMacro(role, 'PIN')});` },
  }),
});
