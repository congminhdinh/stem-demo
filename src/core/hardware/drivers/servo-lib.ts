import { clampTo, defineDriver, defineOp, pinOf, servoLibrary, arduinoCore, type ArgRange } from './driver';

// A hobby servo on the Servo library 1.3.0 (contract U-23, §6.2). Global `Servo <role>;`, attached in setup() and written
// 90 at once, so it starts at 90° on the board and in the simulator. The angle is clamped to 0..180 before Servo.write,
// which reads 544 and above as microseconds. The library takes Timer1 (servo claim): no PWM on D9/D10 (U-48).

export const SERVO_ANGLE: ArgRange = { name: 'angle', min: 0, max: 180 };
export const SERVO_START_DEG = 90;

const helper = ['void servoSet(Servo &servo, long angle) {', '  if (angle < 0L) angle = 0L;', '  if (angle > 180L) angle = 180L;', '  servo.write((int)angle);', '}'].join('\n');

export const servoDriver = defineDriver('servo-lib', {
  'servo.set': defineOp({
    kind: 'call',
    row: 'U-23',
    args: [SERVO_ANGLE],
    setup: [{ kind: 'servoAttach', pin: 'PIN', angle: SERVO_START_DEG }],
    sim(io, port, [angle = 0]) {
      io.servoWrite(pinOf(port, 'PIN'), clampTo(SERVO_ANGLE, angle));
    },
    cpp: {
      libraries: [arduinoCore, servoLibrary],
      includes: ['#include <Servo.h>'],
      helper: { id: 'servo-lib', text: helper },
      globals: (_port, role) => [`Servo ${role};`],
      call: (_port, role, [angle = '0L']) => `servoSet(${role}, ${angle});`,
    },
  }),
});
