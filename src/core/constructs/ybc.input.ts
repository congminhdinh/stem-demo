import type { BlockDefinitionJson } from '../program/blocks';
import type { HardwareConstruct } from './ybc';

// The input constructs of YB-3 (contract §5, §6): the two onboard buttons and the light sensor.
//   C-12 button held   button_a.is_pressed()    True while the button is held at the call; not latched
//   C-13 press count   button_a.get_presses()   the presses since the last read, then 0 again (NICE)
//   C-15 light level   light_level()            an int, 0 (darkest) to 100 (brightest), as the tooltip states
// A+B (C-47) is EXCLUDED: the dropdown offers A and B and nothing else. Button events (C-14) are DEFERRED.

export const buttonPressedType = 'ybc_button_pressed';
export const buttonPressesType = 'ybc_button_presses';
export const lightLevelType = 'ybc_light_level';

/** The buttons of the contract's domain (C-12, C-13): `oneOf ['A', 'B']`. */
export const buttonNames = ['A', 'B'] as const;
export type ButtonName = (typeof buttonNames)[number];

export const isButtonName = (value: unknown): value is ButtonName => buttonNames.some((name) => name === value);

const buttonDropdown = { type: 'field_dropdown', name: 'BUTTON', options: buttonNames.map((name) => [name, name]) };

export const buttonPressedDefinition: BlockDefinitionJson = {
  type: buttonPressedType,
  message0: 'button %1 is pressed',
  args0: [buttonDropdown],
  // Boolean, so it fits the conditions of "if", "while", "and", "or" and "not".
  output: 'Boolean',
  colour: 20,
  tooltip: 'True while the button is held down at this moment.',
};

export const buttonPressesDefinition: BlockDefinitionJson = {
  type: buttonPressesType,
  message0: 'presses of button %1',
  args0: [buttonDropdown],
  output: 'Number',
  colour: 20,
  tooltip: 'How many times the button was pressed since it was last read (by any block); reading it starts the count again from 0.',
};

export const lightLevelDefinition: BlockDefinitionJson = {
  type: lightLevelType,
  message0: 'light level',
  output: 'Number',
  colour: 20,
  tooltip: 'The brightness, a whole number from 0 (darkest) to 100 (brightest).',
};

export const inputConstructs: readonly HardwareConstruct[] = [
  { contractId: 'C-12', pack: 'ybc.input', blockTypes: [buttonPressedType], capability: 'buttons' },
  { contractId: 'C-13', pack: 'ybc.input', blockTypes: [buttonPressesType], capability: 'buttons' },
  { contractId: 'C-15', pack: 'ybc.input', blockTypes: [lightLevelType], capability: 'light' },
];

export const inputDefinitions: readonly BlockDefinitionJson[] = [buttonPressedDefinition, buttonPressesDefinition, lightLevelDefinition];

// N17 B2 (owner, 2026-10-19: "Mô phỏng đủ chức năng"): the sensors of the Advanced board, in a pack of their own (`ybc.sensors`),
// because the contract meant these rows for Advanced only (C-16) and N17 opens C-17 and C-18 for it too.
//   C-16 temperature   int(temperature())                    whole °C; the simulator's slider is −10..50 (a domain, not physics)
//   C-17 acceleration  accelerometer.get_x()                 whole mg in −2048..2048; get_y() and get_z() are UNVERIFIED forms
//   C-18 gesture       accelerometer.is_gesture("shake")     True while the board makes the gesture; the six other names are UNVERIFIED
// The axis and the gesture are dropdown fields: operands the compiler checks, never values.

export const temperatureType = 'ybc_temperature';
export const accelerationType = 'ybc_accel';
export const gestureIsType = 'ybc_gesture_is';

/** The axes of C-17, as the dropdown saves them. */
export const axisNames = ['x', 'y', 'z'] as const;
export type AxisName = (typeof axisNames)[number];
export const isAxisName = (value: unknown): value is AxisName => axisNames.some((name) => name === value);

/** The gestures of C-18, as the dropdown saves them and the generator writes them (`accelerometer.is_gesture("<name>")`). */
export const gestureNames = ['shake', 'tilt_left', 'tilt_right', 'face_up', 'face_down', 'logo_up', 'logo_down'] as const;
export type GestureName = (typeof gestureNames)[number];
export const isGestureName = (value: unknown): value is GestureName => gestureNames.some((name) => name === value);

/** What the English block says for each gesture; the Vietnamese is overlaid in the UI (src/ui/i18n/blocks.ts). */
const gestureLabels: Readonly<Record<GestureName, string>> = {
  shake: 'shaken',
  tilt_left: 'tilted left',
  tilt_right: 'tilted right',
  face_up: 'face up',
  face_down: 'face down',
  logo_up: 'logo up',
  logo_down: 'logo down',
};

export const temperatureDefinition: BlockDefinitionJson = {
  type: temperatureType,
  message0: 'temperature (°C)',
  output: 'Number',
  colour: 20,
  tooltip: 'The temperature in degrees Celsius, a whole number.',
};

export const accelerationDefinition: BlockDefinitionJson = {
  type: accelerationType,
  message0: 'acceleration %1 (mg)',
  args0: [{ type: 'field_dropdown', name: 'AXIS', options: axisNames.map((axis) => [axis, axis]) }],
  output: 'Number',
  colour: 20,
  tooltip: 'The acceleration along one axis, in mg (1024 mg is the pull of gravity). Lying flat, face up: x 0, y 0, z −1024.',
};

export const gestureIsDefinition: BlockDefinitionJson = {
  type: gestureIsType,
  message0: 'gesture is %1',
  args0: [{ type: 'field_dropdown', name: 'GESTURE', options: gestureNames.map((name) => [gestureLabels[name], name]) }],
  // Boolean, so it fits the conditions of "if", "while", "and", "or" and "not".
  output: 'Boolean',
  colour: 20,
  tooltip: 'True while the board makes the gesture: shaken (for 1 second after a shake), tilted left or right, face up or down, logo up or down.',
};

export const sensorConstructs: readonly HardwareConstruct[] = [
  { contractId: 'C-16', pack: 'ybc.sensors', blockTypes: [temperatureType], capability: 'temperature' },
  { contractId: 'C-17', pack: 'ybc.sensors', blockTypes: [accelerationType], capability: 'motion' },
  { contractId: 'C-18', pack: 'ybc.sensors', blockTypes: [gestureIsType], capability: 'motion' },
];

export const sensorDefinitions: readonly BlockDefinitionJson[] = [temperatureDefinition, accelerationDefinition, gestureIsDefinition];
