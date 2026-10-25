import { describe, expect, it } from 'vitest';
import { localDeviceDefinitions } from '../devices/local-catalog';
import { createDeviceRegistry } from '../devices/registry';
import { testExtendedPack, testMarkerType } from '../profiles/__fixtures__/test-profiles';
import {
  buildToolbox,
  createBlockPackCatalog,
  createGenericPack,
  genericBoardPins,
  genericPackId,
  ybcStructurePackId,
  type BlockPack,
} from './block-packs';
import { blockTypes, buildBlockDefinitions, toolbox } from './blocks';

const registry = createDeviceRegistry(localDeviceDefinitions);
const packs = createBlockPackCatalog(registry);

describe('block packs', () => {
  it('know the generic pack, the YBC structure pack, the YB-3 hardware packs, the YB-4 pins pack and the YB-2a language packs', () => {
    expect(packs.list().map((pack) => pack.id)).toEqual([
      genericPackId,
      ybcStructurePackId,
      'ybc.display',
      'ybc.input',
      'ybc.sound',
      'ybc.sensors',
      'ybc.music',
      'ybc.pins',
      // N17 B5: analog write and the servo of the Advanced board.
      'ybc.pwm',
      'lang.logic',
      'lang.loops',
      'lang.math',
      'lang.text',
      'lang.variables',
      // N18 R2.2: the robot lab's packs (family uno), after every pack known before.
      'uno.structure',
      'uno.drive',
      'uno.sensors',
      'uno.servo',
      'uno.output',
      'uno.logic',
      'uno.loops',
      'uno.math',
      'uno.text',
      'uno.variables',
      'uno.sensors.advanced',
      'uno.output.advanced',
      'uno.pins',
    ]);
  });

  it('take the generic pins from the generic boards of the registry, not from the ybc board', () => {
    expect(genericBoardPins(registry)).toEqual(['D13', 'D12', 'D11', 'D10', 'D9', 'D8', 'D7', 'D6', 'D5', 'D4', 'D3', 'D2']);
  });

  it('give the generic toolbox exactly as before (GB2)', () => {
    expect(buildToolbox([genericPackId], packs)).toEqual(toolbox);
  });

  it('give a YBC project only the program structure', () => {
    expect(buildToolbox([ybcStructurePackId], packs)).toEqual({
      kind: 'categoryToolbox',
      contents: [
        {
          kind: 'category',
          name: 'Program',
          colour: '45',
          contents: [
            { kind: 'block', type: blockTypes.onStart },
            { kind: 'block', type: blockTypes.forever },
          ],
        },
      ],
    });
  });

  it('register the blocks of every pack once, the shared hats included only once', () => {
    const types = packs.definitions().map((definition) => definition.type);
    expect(new Set(types).size).toBe(types.length);
    expect(types).toEqual([
      ...buildBlockDefinitions(genericBoardPins(registry)).map((definition) => definition.type),
      // The hardware packs come before the language ones, in the order of the catalog: YB-3's onboard parts, then YB-4's pins.
      'ybc_display_show_image',
      'ybc_display_scroll_text',
      'ybc_display_scroll_number',
      'ybc_display_clear',
      // N17 B1: the RGB display.
      'ybc_display_show_icon',
      'ybc_display_set_pixel',
      'ybc_display_clear_pixel',
      'ybc_display_set_all',
      'ybc_colour',
      'ybc_button_pressed',
      'ybc_button_presses',
      'ybc_light_level',
      'ybc_sound_note',
      'ybc_sound_rest',
      // N17 B2: the sensors of the Advanced board.
      'ybc_temperature',
      'ybc_accel',
      'ybc_gesture_is',
      // N17 B3: the melodies, the tone and stop of the Advanced board.
      'ybc_sound_melody',
      'ybc_sound_pitch',
      'ybc_sound_stop',
      'ybc_pin_write',
      'ybc_pin_read',
      'ybc_pin_analog',
      // N17 B5: analog write and the servo of the Advanced board.
      'ybc_pin_write_analog',
      'ybc_servo_write',
      'ybc_while',
      'ybc_count_up',
      'ybc_wait_ms',
      // N17 B4: the running time (Time) and random numbers (Math).
      'ybc_running_time',
      'ybc_arith',
      'ybc_int_divide',
      'ybc_random_int',
      // N18 R2.2: the robot's blocks (the language ones of the uno packs are the dialect's, registered once above).
      'uno_drive_move',
      'uno_drive_stop',
      'uno_motor_set',
      'uno_ultrasonic_cm',
      'uno_line_dark',
      'uno_button_pressed',
      'uno_servo_set',
      'uno_led_set',
      'uno_buzzer_tone',
      'uno_line_raw',
      'uno_buzzer_stop',
      'uno_digital_write',
      'uno_pwm_write',
      'uno_digital_read',
      'uno_analog_read',
      'uno_millis',
    ]);
  });

  it('merge a category a later pack shows under a name an earlier pack already used (N17 B2: the sensors join Input), and never a dynamic one', () => {
    const toolbox = buildToolbox(['ybc.input', 'ybc.sound', 'ybc.sensors', 'lang.variables'], packs);
    expect(toolbox.contents.map((category) => category.name)).toEqual(['Input', 'Sound', 'Variables']);
    const input = toolbox.contents[0]?.contents as { type: string; fields?: Record<string, unknown> }[];
    expect(input.map((block) => block.type)).toEqual([
      'ybc_button_pressed', 'ybc_button_pressed', 'ybc_button_presses', 'ybc_button_presses', 'ybc_light_level',
      'ybc_temperature', 'ybc_accel', 'ybc_gesture_is', 'ybc_gesture_is',
    ]);
    // The pack's own category is not changed by the merge.
    expect(packs.get('ybc.input')?.categories[0]?.contents).toHaveLength(5);
    // Alone, the sensors pack shows its own Input category.
    expect(buildToolbox(['ybc.sensors'], packs).contents.map((category) => category.name)).toEqual(['Input']);
  });

  it('merge the music of N17 B3 into the Sound category, after the note and the rest, with presets inside the contract domain', () => {
    const toolbox = buildToolbox(['ybc.sound', 'ybc.music'], packs);
    expect(toolbox.contents.map((category) => category.name)).toEqual(['Sound']);
    const sound = toolbox.contents[0]?.contents as { type: string; fields?: Record<string, unknown>; inputs?: Record<string, unknown> }[];
    expect(sound.map((block) => block.type)).toEqual(['ybc_sound_note', 'ybc_sound_rest', 'ybc_sound_melody', 'ybc_sound_melody', 'ybc_sound_pitch', 'ybc_sound_stop']);
    expect(sound.filter((block) => block.type === 'ybc_sound_melody').map((block) => block.fields)).toEqual([
      { MELODY: 'BIRTHDAY', MODE: 'wait' },
      { MELODY: 'JUMP_UP', MODE: 'background' },
    ]);
    expect(sound.find((block) => block.type === 'ybc_sound_pitch')?.inputs).toEqual({
      HZ: { shadow: { type: 'math_number', fields: { NUM: 440 } } },
      MS: { shadow: { type: 'math_number', fields: { NUM: 500 } } },
    });
    expect(packs.get('ybc.sound')?.categories[0]?.contents).toHaveLength(2);
  });

  it('tell the types of a pack set, and refuse an unknown pack', () => {
    expect([...packs.typesOf([ybcStructurePackId])].sort()).toEqual([blockTypes.forever, blockTypes.onStart].sort());
    expect(packs.typesOf([genericPackId]).has('controls_if')).toBe(true);
    expect(() => packs.typesOf(['nope'])).toThrow('Unknown block pack "nope"');
    expect(() => buildToolbox(['nope'], packs)).toThrow('Unknown block pack "nope"');
  });

  it('know the types some pack owns, and not the Blockly built-ins no pack lists', () => {
    expect(packs.isKnown(blockTypes.wait)).toBe(true);
    expect(packs.isKnown('math_single')).toBe(false);
    expect(packs.isKnown(testMarkerType)).toBe(false);
  });

  it('take extra packs for tests and know their blocks', () => {
    const withFixture = createBlockPackCatalog(registry, [testExtendedPack]);
    expect(withFixture.isKnown(testMarkerType)).toBe(true);
    expect(withFixture.definitions().map((definition) => definition.type)).toContain(testMarkerType);
    expect(packs.definitions().map((definition) => definition.type)).not.toContain(testMarkerType);
  });

  it('refuse two packs with one id, and two different definitions of one block type', () => {
    expect(() => createBlockPackCatalog(registry, [createGenericPack([])])).toThrow('Duplicate block pack');
    const clash: BlockPack = { ...testExtendedPack, blocks: [{ type: blockTypes.wait, message0: 'other' }] };
    expect(() => createBlockPackCatalog(registry, [clash])).toThrow('defined differently');
  });
});
