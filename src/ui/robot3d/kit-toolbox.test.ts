import { describe, expect, it } from 'vitest';
import { localDeviceDefinitions } from '../../core/devices/local-catalog';
import { createDeviceRegistry } from '../../core/devices/registry';
import { productionKits, unoR3Board, type Kit } from '../../core/hardware';
import { productionProfiles } from '../../core/profiles';
import { buildToolbox, createBlockPackCatalog, kitBlockPacks, toolboxOfPacks, type Toolbox } from '../../core/program/block-packs';
import { scenarioCatalog } from '../../samples/robot-scenarios';
import { robotTemplateKeys, robotTemplateKitRef } from '../../samples/robot-templates';
import { robotTemplateToolboxRobot } from '../../samples/robot-toolbox-robot';
import { localizeToolbox } from '../i18n/blocks';
import { restrictToolbox } from './toolbox';

// N19 A4 (D-G11): a robot lab's toolbox is its kit's (kitBlockPacks). The rover's, in its sandbox and in every N18 scenario, is the
// toolbox of N18's packs exactly; the gripper car's has the claw, the arm, the IR and the colour blocks and none of the servo or buzzer.

const packs = createBlockPackCatalog(createDeviceRegistry(localDeviceDefinitions));
const kitOf = (id: string) => productionKits.get({ id, version: '0' }) as Kit;
const rover = { kit: kitOf('ref-uno-rover'), board: unoR3Board };
const gripper = { kit: kitOf('ref-uno-gripper'), board: unoR3Board };
const profile = (id: 'uno-basic' | 'uno-advanced') => productionProfiles.get(id) as { blockPacks: readonly string[] };

/** The packs the two profiles listed in N18 (before N19): their toolbox is the rover's. */
const n18Basic = ['uno.structure', 'uno.drive', 'uno.sensors', 'uno.servo', 'uno.output', 'uno.logic', 'uno.loops', 'uno.math', 'uno.text', 'uno.variables'];
const n18Packs = { 'uno-basic': n18Basic, 'uno-advanced': [...n18Basic, 'uno.sensors.advanced', 'uno.output.advanced', 'uno.pins'] } as const;

const kitToolbox = (id: 'uno-basic' | 'uno-advanced', robot: typeof rover | undefined) => toolboxOfPacks(kitBlockPacks(profile(id), robot, packs));
/** Each category's name and the types of its blocks, in order. */
const outline = (toolbox: Toolbox) => toolbox.contents.map((category) => [category.name ?? category.custom, (category.contents ?? []).map((entry) => (entry as { type?: string }).type)]);

describe('the toolbox of a robot lab is its kit’s (N19 A4, D-G11)', () => {
  it('rover sandbox toolbox unchanged', () => {
    // App's path: the robot of the template (robotTemplateToolboxRobot), whose toolbox kitBlockPacks gives.
    const sandbox = robotTemplateToolboxRobot('rb-sandbox');
    for (const id of ['uno-basic', 'uno-advanced'] as const) {
      const n18 = buildToolbox(n18Packs[id], packs);
      for (const locale of ['en', 'vi'] as const) {
        expect(JSON.stringify(localizeToolbox(kitToolbox(id, sandbox), locale)), `${id} ${locale}`).toBe(JSON.stringify(localizeToolbox(n18, locale)));
      }
    }
  });

  it('gives each robot template its kit and board, and throws on a kit the build does not have (review M3: no silent full toolbox)', () => {
    for (const key of robotTemplateKeys) {
      const robot = robotTemplateToolboxRobot(key);
      expect([robot.kit.id, robot.kit.version, robot.board], key).toEqual([robotTemplateKitRef(key).id, '0', unoR3Board]);
    }
    expect(robotTemplateKeys.filter((key) => robotTemplateToolboxRobot(key).kit === rover.kit)).toHaveLength(7);
    const empty = { get: () => undefined, boardOf: () => undefined, refs: () => [] };
    expect(() => robotTemplateToolboxRobot('rb-sandbox', empty)).toThrow('The robot template "rb-sandbox" names kit ref-uno-rover@0, which this build does not have');
  });

  it('every N18 scenario toolbox unchanged', () => {
    const roverKeys = robotTemplateKeys.filter((key) => robotTemplateKitRef(key).id === 'ref-uno-rover');
    expect(roverKeys).toEqual(['rb-drive-to-zone', 'rb-square-route', 'rb-stop-at-wall', 'rb-line-follow', 'rb-servo-gate', 'rb-mini-mission', 'rb-sandbox']);
    for (const key of roverKeys) {
      const scenario = scenarioCatalog.get(key);
      const id = scenario?.profile as 'uno-basic' | 'uno-advanced';
      for (const locale of ['en', 'vi'] as const) {
        const now = restrictToolbox(localizeToolbox(kitToolbox(id, robotTemplateToolboxRobot(key)), locale), scenario?.toolbox);
        const before = restrictToolbox(localizeToolbox(buildToolbox(n18Packs[id], packs), locale), scenario?.toolbox);
        expect(JSON.stringify(now), `${key} ${locale}`).toBe(JSON.stringify(before));
      }
    }
  });

  it('gripper blocks appear only for the gripper kit', () => {
    expect(outline(kitToolbox('uno-basic', gripper))).toEqual([
      ['Program', ['stem_on_start', 'stem_forever']],
      ['Motors', ['uno_drive_move', 'uno_drive_move', 'uno_drive_stop', 'uno_motor_set', 'uno_motor_set']],
      ['Sensors', ['uno_ultrasonic_cm', 'uno_line_dark', 'uno_button_pressed', 'uno_ir_detect', 'uno_color_is']],
      ['Gripper', ['uno_gripper_claw', 'uno_gripper_claw', 'uno_gripper_claw_angle', 'uno_gripper_lift', 'uno_gripper_lift', 'uno_gripper_lift_angle']],
      ['Light & Sound', ['uno_led_set', 'uno_led_set']],
      ['Logic', ['controls_if', 'controls_if', 'logic_compare', 'logic_operation', 'logic_operation', 'logic_negate', 'logic_boolean', 'logic_boolean']],
      ['Loops', ['controls_repeat_ext', 'ybc_while', 'uno_count_up']],
      ['Time', ['ybc_wait_ms']],
      ['Math', ['math_number', 'ybc_arith', 'ybc_arith', 'ybc_arith', 'uno_int_divide', 'math_modulo']],
      ['Text', ['text', 'text_join', 'text_print']],
      ['Variables', []],
    ]);
    // Advanced adds the raw line value and the raw colour to Sensors, then millis and the raw pins (no buzzer stop: no buzzer).
    const advanced = outline(kitToolbox('uno-advanced', gripper));
    expect(advanced.find(([name]) => name === 'Sensors')).toEqual(['Sensors', ['uno_ultrasonic_cm', 'uno_line_dark', 'uno_button_pressed', 'uno_ir_detect', 'uno_color_is', 'uno_line_raw', 'uno_color_raw']]);
    expect(advanced.find(([name]) => name === 'Light & Sound')).toEqual(['Light & Sound', ['uno_led_set', 'uno_led_set']]);
    expect(advanced.map(([name]) => name)).toEqual(['Program', 'Motors', 'Sensors', 'Gripper', 'Light & Sound', 'Logic', 'Loops', 'Time', 'Math', 'Text', 'Variables', 'Pins']);
    // The rover's has none of them.
    const roverTypes = JSON.stringify(kitToolbox('uno-advanced', rover));
    for (const type of ['uno_gripper_claw', 'uno_gripper_lift', 'uno_ir_detect', 'uno_color_is', 'uno_color_raw', '"Gripper"']) {
      expect(roverTypes, type).not.toContain(type);
    }
    // Vietnamese: the category and the blocks' text.
    const vi = localizeToolbox(kitToolbox('uno-basic', gripper), 'vi');
    expect(vi.contents.map((category) => category.name)).toContain('Tay gắp');
  });

  it('is the profile’s toolbox as it is without a robot (the editor, a lab of another family)', () => {
    for (const id of ['uno-basic', 'uno-advanced'] as const) {
      expect(kitBlockPacks(profile(id), undefined, packs).map((pack) => pack.id)).toEqual(profile(id).blockPacks);
      expect(kitToolbox(id, undefined)).toEqual(buildToolbox(profile(id).blockPacks, packs));
    }
  });
});
