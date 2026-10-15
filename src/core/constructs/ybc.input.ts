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
