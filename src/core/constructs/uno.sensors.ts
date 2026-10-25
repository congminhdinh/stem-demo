import { unoR3Board } from '../hardware/catalog';
import { MAX_CM, MIN_CM } from '../hardware/drivers';
import type { RobotRole } from '../hardware/kit';
import type { BlockDefinitionJson } from '../program/blocks';
import type { UnoModuleConstruct } from './uno';
import { roleDropdown } from './uno.roles';

// The sensor constructs of the robot (N18 R2.2, contract UNO §6.4–§6.6):
//
//   U-27  ultrasonic distance   ultrasonic distance (cm)              ultrasonic.cm(ultrasonic)   int, 2..400; no echo is 400
//   U-28  line sees dark        line sensor [left|center|right] sees the dark line   line.dark(role)   bool
//   U-30  button pressed        button is pressed                     button.pressed(button1)     bool
//   U-29  line raw value        line sensor [left|center|right] raw value            line.raw(role)    int, 0..1023 (Advanced)
//
// The first three are the `uno.sensors` pack of both profiles, the raw value the `uno.sensors.advanced` pack. A read is a call into
// the board: it takes the time the board takes (an ultrasonic read without an echo, 20.8 ms).

export const sensorsPackId = 'uno.sensors';
export const advancedSensorsPackId = 'uno.sensors.advanced';

export const ultrasonicType = 'uno_ultrasonic_cm';
export const lineDarkType = 'uno_line_dark';
export const buttonPressedType = 'uno_button_pressed';
export const lineRawType = 'uno_line_raw';

/** The line sensors of the role vocabulary (robot plan §4.2): what the line blocks' dropdowns offer. */
export const lineRoles: readonly RobotRole[] = ['lineLeft', 'lineCenter', 'lineRight'];

/** U-27: whole cm, 2..400 (the driver's). */
export const ULTRASONIC_CM: readonly [min: number, max: number] = [MIN_CM, MAX_CM];
/** U-29, U-34: the UNO's ADC, 0..1023 (contract UNO §6.5, DS-01), the board profile's. */
export const UNO_ADC_MAX = unoR3Board.adcMax;

export const sensorConstructs: readonly UnoModuleConstruct[] = [
  { contractId: 'U-27', pack: sensorsPackId, blockTypes: [ultrasonicType], op: 'ultrasonic.cm', roles: ['ultrasonic'], roleField: false },
  { contractId: 'U-28', pack: sensorsPackId, blockTypes: [lineDarkType], op: 'line.dark', roles: lineRoles, roleField: true },
  { contractId: 'U-30', pack: sensorsPackId, blockTypes: [buttonPressedType], op: 'button.pressed', roles: ['button1'], roleField: false },
];

export const advancedSensorConstructs: readonly UnoModuleConstruct[] = [
  { contractId: 'U-29', pack: advancedSensorsPackId, blockTypes: [lineRawType], op: 'line.raw', roles: lineRoles, roleField: true },
];

export const sensorDefinitions: readonly BlockDefinitionJson[] = [
  {
    type: ultrasonicType,
    message0: 'ultrasonic distance (cm)',
    output: 'Number',
    colour: 195,
    tooltip: `The distance to what is in front of the ultrasonic sensor, in whole cm from ${MIN_CM} to ${MAX_CM}. Nothing in front reads ${MAX_CM}.`,
  },
  {
    type: lineDarkType,
    message0: 'line sensor %1 sees the dark line',
    args0: [roleDropdown(lineRoles)],
    output: 'Boolean',
    colour: 195,
    tooltip: 'True while the line sensor is over the dark line.',
  },
  {
    type: buttonPressedType,
    message0: 'button is pressed',
    output: 'Boolean',
    colour: 195,
    tooltip: 'True while the button on the robot is held down.',
  },
];

export const advancedSensorDefinitions: readonly BlockDefinitionJson[] = [
  {
    type: lineRawType,
    message0: 'line sensor %1 raw value',
    args0: [roleDropdown(lineRoles)],
    output: 'Number',
    colour: 195,
    tooltip: `The line sensor's analog value, 0 to ${UNO_ADC_MAX}.`,
  },
];
