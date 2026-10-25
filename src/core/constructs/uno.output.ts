import { TONE_HZ, TONE_MS } from '../hardware/drivers';
import type { BlockDefinitionJson } from '../program/blocks';
import type { UnoModuleConstruct } from './uno';

// The light and sound constructs of the robot (N18 R2.2, contract UNO §6.3, §6.4):
//
//   U-24  LED          LED [on|off]                       led.set(led1, on)              a truth value of the block
//   U-25  buzzer tone  buzzer tone (hz) Hz for (ms) ms    buzzer.tone(buzzer, hz, ms)    31..4000 Hz, 1..60000 ms, clamped
//   U-26  buzzer stop  stop the buzzer                    buzzer.stop(buzzer)            Advanced
//
// The first two are the `uno.output` pack of both profiles, stop the `uno.output.advanced` pack. A tone does not block: it plays in
// the background for its ms, and a new one replaces it. tone takes Timer2: no PWM on D3 or D11 while the program plays one (U-48).

export const outputPackId = 'uno.output';
export const advancedOutputPackId = 'uno.output.advanced';

export const ledSetType = 'uno_led_set';
export const buzzerToneType = 'uno_buzzer_tone';
export const buzzerStopType = 'uno_buzzer_stop';

/** The field of the LED block and the values it saves: on is true. */
export const LED_STATE_FIELD = 'STATE';
export const ledStates = { ON: true, OFF: false } as const;

/** U-25: Hz and ms, clamped (the driver's). */
export const HZ_RANGE = TONE_HZ;
export const MS_RANGE = TONE_MS;

export const outputConstructs: readonly UnoModuleConstruct[] = [
  { contractId: 'U-24', pack: outputPackId, blockTypes: [ledSetType], op: 'led.set', roles: ['led1'], roleField: false },
  { contractId: 'U-25', pack: outputPackId, blockTypes: [buzzerToneType], op: 'buzzer.tone', roles: ['buzzer'], roleField: false },
];

export const advancedOutputConstructs: readonly UnoModuleConstruct[] = [
  { contractId: 'U-26', pack: advancedOutputPackId, blockTypes: [buzzerStopType], op: 'buzzer.stop', roles: ['buzzer'], roleField: false },
];

export const outputDefinitions: readonly BlockDefinitionJson[] = [
  {
    type: ledSetType,
    message0: 'LED %1',
    args0: [
      {
        type: 'field_dropdown',
        name: LED_STATE_FIELD,
        options: [
          ['on', 'ON'],
          ['off', 'OFF'],
        ],
      },
    ],
    previousStatement: null,
    nextStatement: null,
    colour: 60,
    tooltip: 'Turns the LED on the robot on or off. It starts off.',
  },
  {
    type: buzzerToneType,
    message0: 'buzzer tone %1 Hz for %2 ms',
    args0: [
      { type: 'input_value', name: 'HZ', check: 'Number' },
      { type: 'input_value', name: 'MS', check: 'Number' },
    ],
    inputsInline: true,
    previousStatement: null,
    nextStatement: null,
    colour: 60,
    tooltip: `Plays a tone of ${HZ_RANGE.min} to ${HZ_RANGE.max} Hz for ${MS_RANGE.min} to ${MS_RANGE.max} ms. The program goes on at once; a new tone replaces the one that plays.`,
  },
];

export const advancedOutputDefinitions: readonly BlockDefinitionJson[] = [
  {
    type: buzzerStopType,
    message0: 'stop the buzzer',
    previousStatement: null,
    nextStatement: null,
    colour: 60,
    tooltip: 'Stops the tone that plays, at once.',
  },
];
