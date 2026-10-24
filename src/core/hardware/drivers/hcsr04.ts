import { defineDriver, defineOp, pinMacro, pinOf } from './driver';

// HC-SR04 ultrasonic sensor on pulseIn (contract U-27, §6.6). A 10 µs trigger, then the echo's width: cm = µs / 58 (whole
// cm), clamped to 2..400; no echo, or an echo that does not end within the 30 ms timeout, is 400.
//
// Time: the virtual UNO charges the trigger's digitalWrites and delays and pulseIn (wait + echo + 3.25 µs; 20 752 µs
// without an echo). The contract measured the whole helper with an echo as wait + echo + ultrasonicCmOverhead (65.5625 µs,
// EMU-13: 1675.5625 µs at 450 + 1160), so after an echo the helper's own division and clamps take the rest of it. Without
// an echo the helper returns at once: 20 777.6875 µs in all, where the board measured 20 812 µs with a Servo attached,
// whose interrupts the simulator does not charge (contract §13).

export const PULSE_TIMEOUT_US = 30_000;
export const US_PER_CM = 58;
export const MIN_CM = 2;
export const MAX_CM = 400;
export const NO_ECHO_CM = 400;
const TRIGGER_LOW_US = 2;
const TRIGGER_HIGH_US = 10;

/** cm from an echo of `us`, as the helper computes it (0: no echo). */
export function echoToCm(us: number): number {
  if (us === 0) {
    return NO_ECHO_CM;
  }
  const cm = Math.trunc(us / US_PER_CM);
  return cm < MIN_CM ? MIN_CM : cm > MAX_CM ? MAX_CM : cm;
}

const helper = [
  'long ultrasonicCm(uint8_t trig, uint8_t echo) {',
  '  digitalWrite(trig, LOW);',
  '  delayMicroseconds(2);',
  '  digitalWrite(trig, HIGH);',
  '  delayMicroseconds(10);',
  '  digitalWrite(trig, LOW);',
  '  long us = (long)pulseIn(echo, HIGH, 30000UL);',
  '  if (us == 0L) return 400L;',
  '  long cm = us / 58L;',
  '  if (cm < 2L) return 2L;',
  '  if (cm > 400L) return 400L;',
  '  return cm;',
  '}',
].join('\n');

export const hcsr04Driver = defineDriver('hcsr04-pulsein', {
  'ultrasonic.cm': defineOp({
    kind: 'read',
    row: 'U-27',
    args: [],
    setup: [
      { kind: 'pinMode', pin: 'TRIG', mode: 'OUTPUT' },
      { kind: 'pinMode', pin: 'ECHO', mode: 'INPUT' },
    ],
    sim(io, port) {
      const trig = pinOf(port, 'TRIG');
      io.digitalWrite(trig, 0);
      io.delayMicroseconds(TRIGGER_LOW_US);
      io.digitalWrite(trig, 1);
      io.delayMicroseconds(TRIGGER_HIGH_US);
      io.digitalWrite(trig, 0);
      const us = io.pulseIn(pinOf(port, 'ECHO'), 1, PULSE_TIMEOUT_US);
      if (us !== 0) {
        const costs = io.costsUs;
        io.compute(costs.ultrasonicCmOverhead - (3 * costs.digitalWrite + TRIGGER_LOW_US + TRIGGER_HIGH_US + costs.pulseInAfterPulse));
      }
      return echoToCm(us);
    },
    cpp: {
      helper: { id: 'hcsr04-pulsein', text: helper },
      call: (_port, role) => `ultrasonicCm(${pinMacro(role, 'TRIG')}, ${pinMacro(role, 'ECHO')})`,
    },
  }),
});
