import { GRIPPER_ANGLE } from '../hardware/drivers';
import type { RobotRole } from '../hardware/kit';
import type { BlockDefinitionJson } from '../program/blocks';
import type { UnoModuleConstruct } from './uno';

// The gripper constructs of the robot (N19 A4, plan §4.3, D-G3, D-G4), the `uno.gripper` pack of both profiles:
//
//   U-35  claw    claw [open|close]  · claw angle (n) °     gripper.claw(gripper, angle)   open 0, close 80; 0..90, clamped
//   U-36  lift    arm [up|down]      · arm angle (n) °      gripper.lift(gripper, angle)   up 90, down 0; 0..90, clamped
//   U-37  IR      object between the jaws?                  ir.detect(irClaw)              bool
//
// Each of U-35 and U-36 has two blocks: the one with the two positions a learner needs first, written as its literal angle (the claw
// open at 0°, closed at 80°, where the jaws meet: `jawsMeetDeg`; the arm down at 0°, up at 90°), and the one with any angle. Both are
// the same op. No speed (D-G4): the world turns a servo at its own rate (60° in 0.1 s), and a slower sweep is a loop of the learner's.
// The gripper's two servos take Timer1 like the robot's servo (its driver claims `servo`): no PWM on D9 or D10 (U-48).

export const gripperPackId = 'uno.gripper';

export const clawType = 'uno_gripper_claw';
export const clawAngleType = 'uno_gripper_claw_angle';
export const liftType = 'uno_gripper_lift';
export const liftAngleType = 'uno_gripper_lift_angle';
export const irDetectType = 'uno_ir_detect';

/** The field of the claw block and the angle each choice writes (D-G3: open 0°, closed 80°). */
export const CLAW_FIELD = 'STATE';
export const clawPositions = { OPEN: 0, CLOSE: 80 } as const;
/** The field of the arm block and the angle each choice writes (D-G3: up 90°, down 0°). */
export const LIFT_FIELD = 'STATE';
export const liftPositions = { UP: 90, DOWN: 0 } as const;

/** U-35, U-36: 0..90°, clamped (the driver's), for the claw and the arm. */
export const GRIPPER_ANGLE_RANGE = GRIPPER_ANGLE;

/** The roles of the gripper car's blocks (plan §4.2). */
export const gripperRoles: readonly RobotRole[] = ['gripper'];
export const irRoles: readonly RobotRole[] = ['irClaw'];

export const gripperConstructs: readonly UnoModuleConstruct[] = [
  { contractId: 'U-35', pack: gripperPackId, blockTypes: [clawType, clawAngleType], op: 'gripper.claw', roles: gripperRoles, roleField: false },
  { contractId: 'U-36', pack: gripperPackId, blockTypes: [liftType, liftAngleType], op: 'gripper.lift', roles: gripperRoles, roleField: false },
  { contractId: 'U-37', pack: gripperPackId, blockTypes: [irDetectType], op: 'ir.detect', roles: irRoles, roleField: false },
];

const statement = { previousStatement: null, nextStatement: null, colour: 300 } as const;

export const gripperDefinitions: readonly BlockDefinitionJson[] = [
  {
    type: clawType,
    message0: 'claw %1',
    args0: [
      {
        type: 'field_dropdown',
        name: CLAW_FIELD,
        options: [
          ['open', 'OPEN'],
          ['close', 'CLOSE'],
        ],
      },
    ],
    ...statement,
    tooltip: `Opens the claw (${clawPositions.OPEN}°) or closes it (${clawPositions.CLOSE}°, where the jaws meet). The claw starts open.`,
  },
  {
    type: clawAngleType,
    message0: 'claw angle %1 °',
    args0: [{ type: 'input_value', name: 'ANGLE', check: 'Number' }],
    inputsInline: true,
    ...statement,
    tooltip: `Turns the claw to an angle from ${GRIPPER_ANGLE_RANGE.min} (open) to ${GRIPPER_ANGLE_RANGE.max}; the jaws meet at ${clawPositions.CLOSE}.`,
  },
  {
    type: liftType,
    message0: 'arm %1',
    args0: [
      {
        type: 'field_dropdown',
        name: LIFT_FIELD,
        options: [
          ['up', 'UP'],
          ['down', 'DOWN'],
        ],
      },
    ],
    ...statement,
    tooltip: `Lifts the arm up (${liftPositions.UP}°) or lowers it down (${liftPositions.DOWN}°). The arm starts up.`,
  },
  {
    type: liftAngleType,
    message0: 'arm angle %1 °',
    args0: [{ type: 'input_value', name: 'ANGLE', check: 'Number' }],
    inputsInline: true,
    ...statement,
    tooltip: `Turns the arm to an angle from ${GRIPPER_ANGLE_RANGE.min} (down) to ${GRIPPER_ANGLE_RANGE.max} (up).`,
  },
  {
    type: irDetectType,
    message0: 'object between the jaws?',
    output: 'Boolean',
    colour: 195,
    tooltip: 'True while the IR sensor between the jaws sees an object. A black object reflects too little to be seen.',
  },
];
