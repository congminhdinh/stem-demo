import { describe, expect, it } from 'vitest';
import { localDeviceDefinitions } from '../src/core/devices/local-catalog';
import { createDeviceRegistry } from '../src/core/devices/registry';
import { productionProfiles } from '../src/core/profiles';
import { createBlockPackCatalog } from '../src/core/program/block-packs';
import { pressedButtonNames } from '../src/core/constructs/ybc.input';

// N17 B6: the Basic and the Advanced boards differ for real. This is the final table, block by block, of what each level shows;
// it is the one place a reader (and the LMS's task B7) finds it. Basic is the original blocks plus the RGB display (colours,
// pixels, fill, built-in pictures), A+B, the running time and random numbers. Advanced is all of it: Basic plus the temperature,
// the accelerometer and its gestures, the melodies, the tone and stop, analog write (PWM) and the servo, with the servo in its
// palette and the controls of its sensors.

type Level = 'basic' | 'advanced';

const table: Readonly<Record<string, Level>> = {
  // Program structure.
  stem_on_start: 'basic',
  stem_forever: 'basic',
  // The display: the YB-3 blocks and the RGB display of N17 B1.
  ybc_display_show_image: 'basic',
  ybc_display_scroll_text: 'basic',
  ybc_display_scroll_number: 'basic',
  ybc_display_clear: 'basic',
  ybc_display_show_icon: 'basic',
  ybc_display_set_pixel: 'basic',
  ybc_colour: 'basic',
  ybc_display_clear_pixel: 'basic',
  ybc_display_set_all: 'basic',
  // Input: the buttons (A, B and A+B, N17 B4) and the light.
  ybc_button_pressed: 'basic',
  ybc_button_presses: 'basic',
  ybc_light_level: 'basic',
  // Sound: a note and a rest.
  ybc_sound_note: 'basic',
  ybc_sound_rest: 'basic',
  // Header pins: on/off write, on/off read, analog read.
  ybc_pin_write: 'basic',
  ybc_pin_read: 'basic',
  ybc_pin_analog: 'basic',
  // The language, with the running time and random numbers of N17 B4.
  logic_compare: 'basic',
  logic_operation: 'basic',
  logic_negate: 'basic',
  logic_boolean: 'basic',
  controls_if: 'basic',
  ybc_wait_ms: 'basic',
  ybc_running_time: 'basic',
  controls_repeat_ext: 'basic',
  ybc_while: 'basic',
  ybc_count_up: 'basic',
  math_number: 'basic',
  ybc_arith: 'basic',
  ybc_int_divide: 'basic',
  math_modulo: 'basic',
  ybc_random_int: 'basic',
  text_print: 'basic',
  text: 'basic',
  text_join: 'basic',
  variables_get: 'basic',
  variables_set: 'basic',
  // Advanced only: the sensors (N17 B2), the music (B3), analog write and the servo (B5).
  ybc_temperature: 'advanced',
  ybc_accel: 'advanced',
  ybc_gesture_is: 'advanced',
  ybc_sound_melody: 'advanced',
  ybc_sound_pitch: 'advanced',
  ybc_sound_stop: 'advanced',
  ybc_pin_write_analog: 'advanced',
  ybc_servo_write: 'advanced',
};

const registry = createDeviceRegistry(localDeviceDefinitions);
const packs = createBlockPackCatalog(registry);
const basic = productionProfiles.get('ybc-basic');
const advanced = productionProfiles.get('ybc-advanced');
const typesOf = (level: Level) => Object.keys(table).filter((type) => level === 'advanced' || table[type] === 'basic');

describe('the Basic and the Advanced boards (N17 B6)', () => {
  it('show exactly the blocks of the table: Basic its basic rows, Advanced every row', () => {
    expect([...packs.typesOf(basic?.blockPacks ?? [])].sort()).toEqual(typesOf('basic').sort());
    expect([...packs.typesOf(advanced?.blockPacks ?? [])].sort()).toEqual(typesOf('advanced').sort());
  });

  it('differ by the eight blocks of the sensors, the music, analog write and the servo', () => {
    expect(Object.keys(table).filter((type) => table[type] === 'advanced')).toEqual([
      'ybc_temperature',
      'ybc_accel',
      'ybc_gesture_is',
      'ybc_sound_melody',
      'ybc_sound_pitch',
      'ybc_sound_stop',
      'ybc_pin_write_analog',
      'ybc_servo_write',
    ]);
  });

  it('keep A+B in both: it is an option of "button is pressed", and Blockly dropdowns are the same everywhere', () => {
    expect(table.ybc_button_pressed).toBe('basic');
    expect(pressedButtonNames).toEqual(['A', 'B', 'A+B']);
  });

  it('give the servo to the Advanced palette only, and the controls of the temperature and the accelerometer to Advanced only', () => {
    expect(basic?.palette).toEqual(['ybc-board', 'led', 'resistor', 'push-button', 'potentiometer']);
    expect(advanced?.palette).toEqual(['ybc-board', 'led', 'resistor', 'push-button', 'potentiometer', 'servo']);
    expect(basic?.controls).toEqual(['button-a', 'button-b', 'light']);
    expect(advanced?.controls).toEqual(['button-a', 'button-b', 'light', 'temperature', 'accelerometer']);
  });

  it('promise no text variables: a variable holds a whole number at both levels', () => {
    expect(basic?.variableTypes).toEqual(['int']);
    expect(advanced?.variableTypes).toEqual(['int']);
  });
});
