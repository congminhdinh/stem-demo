import type { ArgRange } from '../hardware/drivers';
import { unoR3Board } from '../hardware/catalog';
import type { BlockDefinitionJson } from '../program/blocks';
import type { UnoModuleConstruct } from './uno';
import type { PinChoices } from './ybc.pins';

// The raw pins and the time of the Advanced robot (N18 R2.2, contract UNO §9, §4.3), the `uno.pins` pack:
//
//   U-31  digital write   digital write pin [D0…A5] [HIGH|LOW]   digital.write(pin, level)   a pin the kit leaves free
//   U-32  PWM write       PWM write pin [D3…D11] value (n)       pwm.write(pin, value)       0..255, clamped
//   U-33  digital read    digital read pin [D0…A5]               digital.read(pin)           a pin wired to an input module
//   U-34  analog read     analog read pin [A0…A5]                analogIn.read(pin)          0..1023, a pin wired to an analog module
//   U-19  millis          time since start (ms)                  time.millis                 the board's (long)millis()
//
// The dropdowns offer the pins of the board (the UNO header): every pin for the digital ones, the PWM pins for a PWM write, the
// analog pins for an analog read. The kit decides at compile time which of them a program may name (hardware/pin-rules.ts
// `rawPinCheck`): `ref-uno-rover@0` uses every PWM pin, so a PWM write is pin-unavailable on it (contract §5.3).

export const pinsPackId = 'uno.pins';

export const digitalWriteType = 'uno_digital_write';
export const pwmWriteType = 'uno_pwm_write';
export const digitalReadType = 'uno_digital_read';
export const analogReadType = 'uno_analog_read';
export const millisType = 'uno_millis';

export const PIN_FIELD = 'PIN';
/** The field of a digital write and the values it saves: HIGH is true. */
export const LEVEL_FIELD = 'LEVEL';
export const pinLevels = { HIGH: true, LOW: false } as const;

/** U-32: the PWM value, 0..255 (analogWrite's duty), clamped by the pwmWrite helper. */
export const PWM_RANGE: ArgRange = { name: 'value', min: 0, max: unoR3Board.pwmMax };

export const pinConstructs: readonly UnoModuleConstruct[] = [
  { contractId: 'U-31', pack: pinsPackId, blockTypes: [digitalWriteType], op: 'digital.write', roles: [], roleField: false },
  { contractId: 'U-32', pack: pinsPackId, blockTypes: [pwmWriteType], op: 'pwm.write', roles: [], roleField: false },
  { contractId: 'U-33', pack: pinsPackId, blockTypes: [digitalReadType], op: 'digital.read', roles: [], roleField: false },
  { contractId: 'U-34', pack: pinsPackId, blockTypes: [analogReadType], op: 'analogIn.read', roles: [], roleField: false },
  { contractId: 'U-19', pack: pinsPackId, blockTypes: [millisType], op: 'time.millis', roles: [], roleField: false },
];

/** With no UNO board in the registry, the pins of the board profile stand in (no profile shows the blocks then). */
const fallback = (cap: 'digital' | 'pwm' | 'analogIn') => unoR3Board.pins.filter((pin) => pin.caps.includes(cap)).map((pin) => pin.id);
const pinDropdown = (names: readonly string[], cap: 'digital' | 'pwm' | 'analogIn') => ({
  type: 'field_dropdown',
  name: PIN_FIELD,
  options: (names.length > 0 ? names : fallback(cap)).map((name) => [name, name]),
});

/** The blocks of the `uno.pins` pack, with the pins of the UNO boards of the registry (`boardPinChoices(registry, 'uno')`). */
export function createUnoPinBlockDefinitions(choices: PinChoices): BlockDefinitionJson[] {
  return [
    {
      type: digitalWriteType,
      message0: 'digital write pin %1 %2',
      args0: [
        pinDropdown(choices.digital, 'digital'),
        {
          type: 'field_dropdown',
          name: LEVEL_FIELD,
          options: [
            ['HIGH', 'HIGH'],
            ['LOW', 'LOW'],
          ],
        },
      ],
      previousStatement: null,
      nextStatement: null,
      colour: 210,
      tooltip: 'Sets a free pin of the board HIGH or LOW.',
    },
    {
      type: pwmWriteType,
      message0: 'PWM write pin %1 value %2',
      args0: [pinDropdown(choices.pwm, 'pwm'), { type: 'input_value', name: 'VALUE', check: 'Number' }],
      inputsInline: true,
      previousStatement: null,
      nextStatement: null,
      colour: 210,
      tooltip: `Writes a PWM value to a free pin: 0 (always off) to ${PWM_RANGE.max} (always on).`,
    },
    {
      type: digitalReadType,
      message0: 'digital read pin %1',
      args0: [pinDropdown(choices.digital, 'digital')],
      output: 'Boolean',
      colour: 210,
      tooltip: 'True while a pin wired to a sensor or the button reads HIGH.',
    },
    {
      type: analogReadType,
      message0: 'analog read pin %1',
      args0: [pinDropdown(choices.analogIn, 'analogIn')],
      output: 'Number',
      colour: 210,
      tooltip: `The analog value of a pin wired to an analog sensor: 0 to ${unoR3Board.adcMax}.`,
    },
    {
      type: millisType,
      message0: 'time since start (ms)',
      output: 'Number',
      colour: 120,
      tooltip: 'The whole milliseconds the board counted since the program started.',
    },
  ];
}
