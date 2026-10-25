import { driveDirections, MOTOR_SPEED } from '../hardware/drivers';
import type { RobotRole } from '../hardware/kit';
import type { BlockDefinitionJson } from '../program/blocks';
import type { UnoModuleConstruct } from './uno';
import { roleDropdown } from './uno.roles';

// The drive constructs of the robot (N18 R2.2, contract UNO §6.1), the `uno.drive` pack of both profiles:
//
//   U-21  drive        robot go [forward|backward|spin left|spin right] speed (n) %   drive.move(direction, speed)
//   U-22  stop         stop the robot                                                drive.stop
//   U-20  motor speed  motor [left|right] speed (n) %                                motor.set(role, speed)
//
// A speed is −100..100 %: outside, it is clamped (with a warning once per role per run), and a typed-in one is written clamped. The
// drive evaluates its speed once and gives each motor +s or −s by the direction, then each motor clamps its own (U-21). The drive
// needs both motors of the kit, a motor block its own: a kit without them is capability-unavailable on the block.

export const drivePackId = 'uno.drive';

export const driveMoveType = 'uno_drive_move';
export const driveStopType = 'uno_drive_stop';
export const motorSetType = 'uno_motor_set';

/** The motors of the role vocabulary (robot plan §4.2): what the motor block's dropdown offers. */
export const motorRoles: readonly RobotRole[] = ['motorLeft', 'motorRight'];

/** The speed of a motor, −100..100 % (U-20), clamped. The driver's own range, so the block, the run and the helper agree. */
export const SPEED_RANGE = MOTOR_SPEED;

const directionLabels: Readonly<Record<(typeof driveDirections)[number], string>> = {
  forward: 'forward',
  backward: 'backward',
  spinLeft: 'spin left',
  spinRight: 'spin right',
};

export const driveConstructs: readonly UnoModuleConstruct[] = [
  { contractId: 'U-21', pack: drivePackId, blockTypes: [driveMoveType], op: 'drive.move', roles: [], roleField: false },
  { contractId: 'U-22', pack: drivePackId, blockTypes: [driveStopType], op: 'drive.stop', roles: [], roleField: false },
  { contractId: 'U-20', pack: drivePackId, blockTypes: [motorSetType], op: 'motor.set', roles: motorRoles, roleField: true },
];

export const driveDefinitions: readonly BlockDefinitionJson[] = [
  {
    type: driveMoveType,
    message0: 'robot go %1 speed %2 %',
    args0: [
      { type: 'field_dropdown', name: 'DIRECTION', options: driveDirections.map((direction) => [directionLabels[direction], direction]) },
      { type: 'input_value', name: 'SPEED', check: 'Number' },
    ],
    inputsInline: true,
    previousStatement: null,
    nextStatement: null,
    colour: 0,
    tooltip: `Drives both motors: forward, backward, or spins on the spot. The speed is ${SPEED_RANGE.min} to ${SPEED_RANGE.max} %; the robot keeps going until another drive or stop block.`,
  },
  {
    type: driveStopType,
    message0: 'stop the robot',
    previousStatement: null,
    nextStatement: null,
    colour: 0,
    tooltip: 'Stops both motors.',
  },
  {
    type: motorSetType,
    message0: 'motor %1 speed %2 %',
    args0: [roleDropdown(motorRoles), { type: 'input_value', name: 'SPEED', check: 'Number' }],
    inputsInline: true,
    previousStatement: null,
    nextStatement: null,
    colour: 0,
    tooltip: `Turns one motor: ${SPEED_RANGE.min} to ${SPEED_RANGE.max} %, forward above 0, backward below 0, stopped at 0.`,
  },
];
