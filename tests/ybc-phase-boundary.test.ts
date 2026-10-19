import { describe, expect, it } from 'vitest';
import { generatedConstructs, generateYbcMicroPython } from '../src/core/codegen/yolobit/generate';
import { compileBlocks } from '../src/core/codegen/yolobit/__fixtures__/compile-case';
import { pinCases } from '../src/core/codegen/yolobit/__fixtures__/pin-cases';
import { yolobitContract } from '../src/core/compat/yolobit-contract';
import { localDeviceDefinitions } from '../src/core/devices/local-catalog';
import { createDeviceRegistry } from '../src/core/devices/registry';
import { productionProfiles } from '../src/core/profiles';
import { createBlockPackCatalog } from '../src/core/program/block-packs';
import { capabilityKeys } from '../src/core/capabilities/io';

// Where YB-3 and YB-4 end (YB plan §21 YB-3, YB-4, §6.2 R4, the frozen exclusions). Whatever is not the onboard parts
// of YB-3 (display, buttons, light, sound), the RGB display of N17 B1, the sensors of N17 B2 (temperature, accelerometer,
// gestures: Advanced only), the header pins and the potentiometer of YB-4 must not have appeared: the Advanced hardware of
// YB-7 (servo, the drawing blocks), and the rows the contract excludes or defers (PWM, random, elapsed time, events). These tests are meant to be updated deliberately by the phase that opens a
// construct, together with its contract row, never as a side effect of another change.

const registry = createDeviceRegistry(localDeviceDefinitions);
const packs = createBlockPackCatalog(registry);
const profiles = ['ybc-basic', 'ybc-advanced'].map((id) => productionProfiles.get(id));
/**
 * The onboard blocks of YB-3: the display, the buttons, the light sensor and the sound (contract C-06…C-09, C-12, C-13, C-15, C-50,
 * C-51), and the RGB display N17 B1 opened with its contract rows (C-05, C-10, C-42, C-43; the colour block is C-10's).
 */
const onboardBlockTypes = [
  'ybc_button_pressed',
  'ybc_button_presses',
  'ybc_colour',
  'ybc_display_clear',
  'ybc_display_clear_pixel',
  'ybc_display_scroll_number',
  'ybc_display_scroll_text',
  'ybc_display_set_all',
  'ybc_display_set_pixel',
  'ybc_display_show_icon',
  'ybc_display_show_image',
  'ybc_light_level',
  'ybc_sound_note',
  'ybc_sound_rest',
  // N17 B2: the sensors of the Advanced board (C-16, C-17, C-18).
  'ybc_temperature',
  'ybc_accel',
  'ybc_gesture_is',
];

describe('the blocks a Yolo:Bit-compatible project has', () => {
  it('are the two hats, the YB-2 language, the onboard blocks of YB-3 and N17 B1 and the three pin blocks: nothing else of this family is registered', () => {
    const ybc = packs.list().filter((pack) => pack.family === 'ybc');
    const types = ybc.flatMap((pack) => pack.blockTypes).filter((type) => type.startsWith('ybc_') || type.startsWith('stem_'));
    expect([...new Set(types)].sort()).toEqual(
      [
        'stem_forever',
        'stem_on_start',
        // YB-2
        'ybc_arith',
        'ybc_count_up',
        'ybc_int_divide',
        'ybc_wait_ms',
        'ybc_while',
        // YB-3
        ...onboardBlockTypes,
        // YB-4
        'ybc_pin_analog',
        'ybc_pin_read',
        'ybc_pin_write',
      ].sort(),
    );
    // The registered definitions say the same: nothing hides in a pack with a block that is not listed.
    expect(packs.definitions().map((d) => d.type).filter((type) => type.startsWith('ybc_')).sort()).toEqual(
      ['ybc_arith', 'ybc_count_up', 'ybc_int_divide', ...onboardBlockTypes, 'ybc_pin_analog', 'ybc_pin_read', 'ybc_pin_write', 'ybc_wait_ms', 'ybc_while'].sort(),
    );
  });

  it('have no block for PWM, servo, pulse, events, random or elapsed time, and none for the display, the buttons, light, sound or the sensors but the onboard ones', () => {
    const everything = packs.list().flatMap((pack) => pack.blockTypes).filter((type) => !onboardBlockTypes.includes(type)).join(' ');
    expect(everything).not.toMatch(/pwm|servo|pulse|temperature|display|image|scroll|button|light|sound|music|note|tone|event|random|timer|running|elapsed|shake|accel|gesture/i);
  });
});

describe('the contract rows a profile shows', () => {
  const exposed = [
    'C-01', 'C-02', 'C-04', 'C-05', 'C-06', 'C-07', 'C-08', 'C-09', 'C-10', 'C-12', 'C-13', 'C-15', 'C-23', 'C-24', 'C-25', 'C-29', 'C-30', 'C-31',
    'C-32', 'C-33', 'C-34', 'C-35', 'C-36', 'C-37', 'C-38', 'C-39', 'C-42', 'C-43', 'C-50', 'C-51', 'C-56',
  ];

  it('are the language of YB-2, the onboard hardware of YB-3 with the RGB display of N17 B1, and the pins of YB-4, in both profiles; Advanced adds the sensors of N17 B2', () => {
    const [basic, advanced] = profiles;
    expect([...(basic?.constructs ?? [])].sort()).toEqual([...exposed].sort());
    expect([...(advanced?.constructs ?? [])].sort()).toEqual([...exposed, 'C-16', 'C-17', 'C-18'].sort());
  });

  it.each([
    ['YB-7: text variables, functions, servo', ['C-57', 'C-58', 'C-59', 'C-27']],
    ['excluded: PWM / analog write, pulse in, random, elapsed time', ['C-26', 'C-28', 'C-40', 'C-19']],
    ['deferred: events', ['C-14']],
  ])('keep out %s', (_, ids) => {
    for (const profile of profiles) {
      for (const id of ids) {
        expect(profile?.constructs, `${profile?.id}/${id}`).not.toContain(id);
      }
    }
    for (const id of ids) {
      expect(generatedConstructs as readonly string[], id).not.toContain(id);
    }
  });

  it('keep the eligibility the contract gave them: nothing was upgraded to make a pin work', () => {
    const eligibility = (id: string) => yolobitContract.constructs.find((row) => row.id === id)?.eligibility;
    expect(['C-23', 'C-24', 'C-25'].map(eligibility)).toEqual(['RESTRICTED', 'RESTRICTED', 'RESTRICTED']);
    expect(['C-26', 'C-28', 'C-40', 'C-19'].map(eligibility)).toEqual(['EXCLUDED', 'EXCLUDED', 'EXCLUDED', 'EXCLUDED']);
    expect(eligibility('C-14')).toBe('DEFERRED');
    expect(yolobitContract.analog.nativeMax).toBe(4095);
  });
});

describe('the devices and capabilities', () => {
  it('give the ybc board digital and analog pins and the onboard parts of YB-3 as data only, and no PWM, servo or pulse', () => {
    const definition = registry.get('ybc-board');
    const pinCapabilities = new Set(definition.board?.pins.flatMap((pin) => pin.capabilities ?? []));
    expect([...pinCapabilities].sort()).toEqual(['analogIn', 'digital']);
    expect(definition.board?.reservedPins).toEqual([]);
    expect(capabilityKeys).toContain('pwm');
    // The interface exists (YB-CP) and the board does not have it: a type is not an exposure.
    expect(pinCapabilities.has('pwm')).toBe(false);
  });

  it('add one device for YB-4 and no other: the potentiometer, of the ybc family', () => {
    expect(registry.list().map((definition) => definition.id)).toEqual(['board', 'led', 'resistor', 'push-button', 'ybc-board', 'potentiometer']);
    expect(registry.get('potentiometer').family).toBe('ybc');
  });
});

describe('the Python of the pins', () => {
  const sources = pinCases.map(({ blocks }) => {
    const generated = generateYbcMicroPython(compileBlocks(blocks));
    if (!generated.ok) {
      throw new Error(JSON.stringify(generated.diagnostics));
    }
    return generated.source;
  });

  it('registers no event handler (the preamble only sets them to None), and uses no random, elapsed time or PWM', () => {
    for (const source of sources) {
      const registrations = source.split('\n').filter((line) => /on_pressed/.test(line));
      expect(registrations).toEqual(['button_a.on_pressed = None', 'button_b.on_pressed = None', 'button_a.on_pressed_ab = button_b.on_pressed_ab = -1']);
      expect(source).not.toMatch(/random|running_time|ticks_|timer|write_analog|pwm|servo|pulse_in|set_pull|display\.|music\.|accelerometer|light_level|temperature\(/);
    }
  });
});
