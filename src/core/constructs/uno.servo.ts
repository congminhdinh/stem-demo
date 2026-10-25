import { SERVO_ANGLE, SERVO_START_DEG } from '../hardware/drivers';
import type { RobotRole } from '../hardware/kit';
import type { BlockDefinitionJson } from '../program/blocks';
import type { UnoModuleConstruct } from './uno';
import { roleDropdown } from './uno.roles';

// The servo construct of the robot (N18 R2.2, contract UNO §6.2), the `uno.servo` pack of both profiles:
//
//   U-23  servo angle   servo [1] angle (n) °   servo.set(role, angle)   0..180, clamped; the servo starts at 90°
//
// The angle is clamped before Servo.write, which reads 544 and above as microseconds. The Servo library takes Timer1: no PWM on D9
// or D10 while the program uses a servo (U-48).

export const servoPackId = 'uno.servo';

export const servoSetType = 'uno_servo_set';

/** The servos of the role vocabulary (robot plan §4.2). */
export const servoRoles: readonly RobotRole[] = ['servo1'];

/** U-23: 0..180°, clamped (the driver's). */
export const ANGLE_RANGE = SERVO_ANGLE;

export const servoConstructs: readonly UnoModuleConstruct[] = [
  { contractId: 'U-23', pack: servoPackId, blockTypes: [servoSetType], op: 'servo.set', roles: servoRoles, roleField: true },
];

export const servoDefinitions: readonly BlockDefinitionJson[] = [
  {
    type: servoSetType,
    message0: 'servo %1 angle %2 °',
    args0: [roleDropdown(servoRoles), { type: 'input_value', name: 'ANGLE', check: 'Number' }],
    inputsInline: true,
    previousStatement: null,
    nextStatement: null,
    colour: 270,
    tooltip: `Turns the servo to an angle from ${ANGLE_RANGE.min} to ${ANGLE_RANGE.max} degrees. It starts at ${SERVO_START_DEG}.`,
  },
];
