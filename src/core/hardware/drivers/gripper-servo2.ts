import { arduinoCore, clampTo, defineDriver, defineOp, pinOf, servoLibrary, type ArgRange, type DriverOp, type SetupStep } from './driver';

// The two-servo gripper on the Servo library 1.3.0 (N19 plan §4.1, §4.3, D-G2, D-G3; contract rows U-35, U-36 are task A5's). One port,
// two pins: the claw on CLAW (0° open … 80° the jaws meet) and the lift on LIFT (0° down, 90° up). Globals `Servo <role>Claw;` and
// `Servo <role>Lift;`, both attached in setup(), whichever op the program uses, and written 0 (claw open) and 90 (lift up), as the real
// arm starts. Each angle is clamped to 0..90 by `gripperSet` before Servo.write: past 90 the claw or the arm would only stall. The library
// takes Timer1 (servo claim): no PWM on D9/D10 (U-48).
//
// Time: Servo.write's cost (`servoWrite`) and the rest of gripperSet's measured time (`gripperSet`, 51.625 µs: the longest of claw 45,
// lift 45, 120 and -5, EMU-20; Servo.write alone 49.5 in EMU-08 and 50.4375 in EMU-20).

/** U-35, U-36: 0..90°, clamped (D-G3), for the claw and the lift alike. */
export const GRIPPER_ANGLE: ArgRange = { name: 'angle', min: 0, max: 90 };
/**
 * setup() writes the claw open and the lift up (D-G3): the angles the gripper car starts at. The one place they are written: the world builds
 * the gripper at them (world/robot/gripper.ts) and a teleop run starts its keys from them (the lab's tools store).
 */
export const GRIPPER_START: Readonly<{ clawDeg: number; liftDeg: number }> = Object.freeze({ clawDeg: 0, liftDeg: 90 });

const helper = ['void gripperSet(Servo &servo, long angle) {', '  if (angle < 0L) angle = 0L;', '  if (angle > 90L) angle = 90L;', '  servo.write((int)angle);', '}'].join('\n');

const setup: readonly SetupStep[] = [
  { kind: 'servoAttach', pin: 'CLAW', angle: GRIPPER_START.clawDeg, object: 'Claw' },
  { kind: 'servoAttach', pin: 'LIFT', angle: GRIPPER_START.liftDeg, object: 'Lift' },
];

const servoOp = (pin: 'CLAW' | 'LIFT', object: 'Claw' | 'Lift', row: string): DriverOp =>
  defineOp({
    kind: 'call',
    row,
    args: [GRIPPER_ANGLE],
    claims: 'servo',
    setup,
    sim(io, port, [angle = 0]) {
      io.servoWrite(pinOf(port, pin), clampTo(GRIPPER_ANGLE, angle));
      io.compute(io.costsUs.gripperSet - io.costsUs.servoWrite);
    },
    cpp: {
      libraries: [arduinoCore, servoLibrary],
      includes: ['#include <Servo.h>'],
      helper: { id: 'gripper-servo2', text: helper },
      globals: (_port, role) => [`Servo ${role}Claw;`, `Servo ${role}Lift;`],
      call: (_port, role, [angle = '0L']) => `gripperSet(${role}${object}, ${angle});`,
    },
  });

export const gripperDriver = defineDriver('gripper-servo2', {
  'gripper.claw': servoOp('CLAW', 'Claw', 'U-35'),
  'gripper.lift': servoOp('LIFT', 'Lift', 'U-36'),
});
