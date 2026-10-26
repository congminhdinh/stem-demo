import { describe, expect, it } from 'vitest';
import { exposureViolations, isExposable, profileConstructViolations } from '../compat/contract-validation';
import { unoContract } from '../compat/uno-contract';
import { localDeviceDefinitions } from '../devices/local-catalog';
import { createDeviceRegistry } from '../devices/registry';
import { productionKits } from '../hardware/catalog';
import { COLOR_CHANNELS, COLOR_NAMES, drivers, SERVO_START_DEG } from '../hardware/drivers';
import { productionProfiles } from '../profiles';
import { buildToolbox, createBlockPackCatalog } from '../program/block-packs';
import { unoLanguageBlockTypes } from '../program/__fixtures__/uno-language';
import { unoBlockTypesOf, unoConstructs, unoLangConstructs, unoModuleConstructOf, unoModuleConstructs, unoPackIds, type UnoPackId } from './uno';
import { SPEED_RANGE } from './uno.drive';
import { unoCountUpType, unoIntDivideType } from './uno.lang';
import { HZ_RANGE, MS_RANGE } from './uno.output';
import { PWM_RANGE } from './uno.pins';
import { ULTRASONIC_CM, UNO_ADC_MAX } from './uno.sensors';
import { ANGLE_RANGE } from './uno.servo';
import { COLOR_RAW_RANGE } from './uno.color';
import { clawPositions, GRIPPER_ANGLE_RANGE, liftPositions } from './uno.gripper';

// The uno constructs against the UNO contract (N18 R2.2, docs/uno-compatibility-contract.md §10, §11; the contract is test data):
// every block a uno profile shows is a row that passes the exposure gate and is meant for that profile, the packs own exactly
// their rows' blocks, and the ranges the blocks clamp to are the contract's.

const registry = createDeviceRegistry(localDeviceDefinitions);
const packs = createBlockPackCatalog(registry);
const basic = productionProfiles.get('uno-basic');
const advanced = productionProfiles.get('uno-advanced');
const row = (id: string) => {
  const found = unoContract.constructs.find((construct) => construct.id === id);
  if (!found) {
    throw new Error(`No contract row ${id}`);
  }
  return found;
};
/** The packs only Advanced shows. */
const advancedPacks: readonly UnoPackId[] = ['uno.sensors.advanced', 'uno.output.advanced', 'uno.pins', 'uno.color.advanced'];
const typesIn = (contents: readonly unknown[]): string[] =>
  contents.flatMap((item) => {
    const entry = item as { kind?: string; type?: string; contents?: readonly unknown[] };
    return entry.kind === 'block' && typeof entry.type === 'string' ? [entry.type] : typesIn(entry.contents ?? []);
  });

describe('every uno construct is a row of the UNO contract that passes the exposure gate (EG)', () => {
  it.each(unoConstructs.map((construct) => [construct.contractId, construct] as const))('%s', (id, construct) => {
    const found = row(id);
    expect(exposureViolations(found, unoContract)).toEqual([]);
    expect(isExposable(found, unoContract)).toBe(true);
    expect(['ELIGIBLE', 'RESTRICTED']).toContain(found.eligibility);
    // A pack of Basic shows a row of both profiles; a pack only Advanced shows, a row of Advanced only.
    expect(found.profiles).toEqual(advancedPacks.includes(construct.pack) ? ['uno-advanced'] : ['uno-basic', 'uno-advanced']);
  });

  it('has each row once, and every row the contract opens', () => {
    const ids = unoConstructs.map((construct) => construct.contractId);
    expect(new Set(ids).size).toBe(ids.length);
    const open = unoContract.constructs.filter((construct) => construct.eligibility === 'ELIGIBLE' || construct.eligibility === 'RESTRICTED').map((construct) => construct.id);
    expect([...ids].sort()).toEqual([...open].sort());
  });

  it('has no row the contract excludes or defers: no float, text variable, function, event, serial read, random, I²C, micros', () => {
    for (const id of ['U-40', 'U-41', 'U-42', 'U-43', 'U-44', 'U-45', 'U-46', 'U-47', 'U-48', 'U-49', 'U-50']) {
      expect(unoConstructs.some((construct) => construct.contractId === id), id).toBe(false);
      expect(row(id).profiles, id).toEqual([]);
    }
  });

  it('compiles each module row to its own op, the one the kit’s driver runs for that row', () => {
    const byRow = new Map(Object.values(drivers).flatMap((driver) => Object.entries(driver.ops).map(([op, definition]) => [definition.row, op] as const)));
    for (const construct of unoModuleConstructs) {
      if (byRow.has(construct.contractId)) {
        expect(construct.op, construct.contractId).toBe(byRow.get(construct.contractId));
      }
    }
    expect(unoModuleConstructs.map((construct) => `${construct.contractId} ${construct.op}`)).toEqual([
      'U-21 drive.move', 'U-22 drive.stop', 'U-20 motor.set', 'U-27 ultrasonic.cm', 'U-28 line.dark', 'U-30 button.pressed', 'U-23 servo.set',
      'U-24 led.set', 'U-25 buzzer.tone', 'U-29 line.raw', 'U-26 buzzer.stop', 'U-31 digital.write', 'U-32 pwm.write', 'U-33 digital.read',
      'U-34 analogIn.read', 'U-19 time.millis', 'U-35 gripper.claw', 'U-36 gripper.lift', 'U-37 ir.detect', 'U-38 color.is', 'U-39 color.raw',
    ]);
  });
});

describe('profile exposure (N18 R2.2)', () => {
  it('lets each profile show exactly the blocks of the rows it lists, and every row it lists passes the gate', () => {
    for (const profile of [basic, advanced]) {
      const shown = packs.typesOf(profile?.blockPacks ?? []);
      const listed = new Set(profile?.constructs ?? []);
      const fromRows = unoConstructs.filter((construct) => listed.has(construct.contractId)).flatMap((construct) => construct.blockTypes);
      expect([...shown].sort(), profile?.id).toEqual([...fromRows].sort());
      expect(unoConstructs.filter((construct) => listed.has(construct.contractId)).length, profile?.id).toBe(listed.size);
      expect(profileConstructViolations(profile?.id ?? '', profile?.constructs ?? [], unoContract), profile?.id).toEqual([]);
    }
  });

  it('keeps Advanced a superset of Basic, adding only the raw line value, buzzer stop, millis and the raw pins', () => {
    const basicTypes = packs.typesOf(basic?.blockPacks ?? []);
    const advancedTypes = packs.typesOf(advanced?.blockPacks ?? []);
    expect([...basicTypes].filter((type) => !advancedTypes.has(type))).toEqual([]);
    expect([...advancedTypes].filter((type) => !basicTypes.has(type)).sort()).toEqual(
      ['uno_line_raw', 'uno_buzzer_stop', 'uno_digital_write', 'uno_pwm_write', 'uno_digital_read', 'uno_analog_read', 'uno_millis', 'uno_color_raw'].sort(),
    );
  });

  it('shows the brief’s Basic blocks: drive, stop, motor, ultrasonic, line, servo, LED, buzzer tone, button; N19: the claw, the lift, IR and colour', () => {
    const robot = [...packs.typesOf(basic?.blockPacks ?? [])].filter((type) => unoModuleConstructOf(type) !== undefined).sort();
    expect(robot).toEqual(
      [
        'uno_drive_move', 'uno_drive_stop', 'uno_motor_set', 'uno_ultrasonic_cm', 'uno_line_dark', 'uno_servo_set', 'uno_led_set', 'uno_buzzer_tone', 'uno_button_pressed',
        'uno_gripper_claw', 'uno_gripper_claw_angle', 'uno_gripper_lift', 'uno_gripper_lift_angle', 'uno_ir_detect', 'uno_color_is',
      ].sort(),
    );
  });

  it('has no random number, no running time and no Yolo:Bit hardware in either profile (U-45; U-19 is the board’s millis)', () => {
    for (const profile of [basic, advanced]) {
      const shown = packs.typesOf(profile?.blockPacks ?? []);
      for (const type of ['ybc_random_int', 'ybc_running_time', 'ybc_display_show_image', 'ybc_button_pressed', 'ybc_pin_write', 'ybc_servo_write']) {
        expect(shown.has(type), `${profile?.id}/${type}`).toBe(false);
      }
    }
  });

  it('shows in each toolbox only blocks of its packs, in the categories the robot lab names', () => {
    for (const profile of [basic, advanced]) {
      const toolbox = buildToolbox(profile?.blockPacks ?? [], packs);
      const shown = packs.typesOf(profile?.blockPacks ?? []);
      expect(typesIn(toolbox.contents).filter((type) => !shown.has(type)), profile?.id).toEqual([]);
      expect(toolbox.contents.map((category) => category.name), profile?.id).toEqual(
        profile === basic
          ? ['Program', 'Motors', 'Sensors', 'Servo', 'Gripper', 'Light & Sound', 'Logic', 'Loops', 'Time', 'Math', 'Text', 'Variables']
          : ['Program', 'Motors', 'Sensors', 'Servo', 'Gripper', 'Light & Sound', 'Logic', 'Loops', 'Time', 'Math', 'Text', 'Variables', 'Pins'],
      );
    }
  });
});

describe('the uno packs', () => {
  it('own exactly the block types of their constructs, register exactly their module blocks, and are of the uno family', () => {
    for (const id of unoPackIds) {
      const pack = packs.get(id);
      expect(pack?.family, id).toBe('uno');
      expect([...(pack?.blockTypes ?? [])].sort(), id).toEqual(unoBlockTypesOf(id).sort());
      const robotBlocks = (pack?.blocks ?? []).map((definition) => definition.type).filter((type) => type.startsWith('uno_'));
      expect(robotBlocks.sort(), id).toEqual(unoBlockTypesOf(id).filter((type) => type.startsWith('uno_')).sort());
    }
  });

  it('give each module block one construct, and the language the blocks R2.3 compiled the UNO language with', () => {
    for (const construct of unoModuleConstructs) {
      // N19 A4 (plan §4.3): the claw and the arm have two blocks of their one op, the two positions and any angle.
      expect(construct.blockTypes, construct.contractId).toHaveLength(['U-35', 'U-36'].includes(construct.contractId) ? 2 : 1);
      for (const type of construct.blockTypes) {
        expect(unoModuleConstructOf(type), `${construct.contractId} ${type}`).toBe(construct);
      }
    }
    const language = new Set(unoLangConstructs.flatMap((construct) => construct.blockTypes));
    // The dialect's division and count up are the UNO's own blocks here (fix round 1): their UNO meaning is not the dialect's.
    const replaced: Readonly<Record<string, string>> = { ybc_int_divide: unoIntDivideType, ybc_count_up: unoCountUpType };
    expect([...unoLanguageBlockTypes].map((type) => replaced[type] ?? type).filter((type) => !language.has(type))).toEqual([]);
    for (const profile of [basic, advanced]) {
      const shown = packs.typesOf(profile?.blockPacks ?? []);
      expect(Object.keys(replaced).filter((type) => shown.has(type)), profile?.id).toEqual([]);
      expect(Object.values(replaced).filter((type) => !shown.has(type)), profile?.id).toEqual([]);
    }
  });

  it('give the UNO’s count up no step and its division the C++ meaning (contract UNO U-14, U-06)', () => {
    const definitions = new Map(packs.definitions().map((definition) => [definition.type, definition]));
    const countUp = JSON.stringify(definitions.get(unoCountUpType));
    expect(countUp).not.toContain('STEP');
    expect(definitions.get(unoCountUpType)?.tooltip).toBe('Counts up by 1 from the first number to the second.');
    expect(definitions.get(unoIntDivideType)?.tooltip).toMatch(/toward zero \(-7 \/ 2 is -3\)/);
    expect(row('U-14').cpp?.form).toContain('_c += 1L');
    expect(row('U-06').cpp?.form).toBe('div32(<a>, <b>)');
  });
});

describe('the ranges and answers of the robot’s blocks are the contract’s (domain sync)', () => {
  const constants = unoContract.constants;

  it('clamps a speed to ±MOTOR_SPEED_MAX, an angle to 0..SERVO_ANGLE_MAX, a tone to its Hz and ms, a PWM value to 0..PWM_MAX', () => {
    expect([SPEED_RANGE.min, SPEED_RANGE.max]).toEqual([-constants.MOTOR_SPEED_MAX, constants.MOTOR_SPEED_MAX]);
    expect([ANGLE_RANGE.min, ANGLE_RANGE.max]).toEqual([0, constants.SERVO_ANGLE_MAX]);
    expect([HZ_RANGE.min, HZ_RANGE.max]).toEqual([constants.TONE_MIN_HZ, constants.TONE_MAX_HZ]);
    expect([MS_RANGE.min, MS_RANGE.max]).toEqual([constants.TONE_MIN_MS, constants.TONE_MAX_MS]);
    expect([PWM_RANGE.min, PWM_RANGE.max]).toEqual([0, constants.PWM_MAX]);
    expect(SERVO_START_DEG).toBe(constants.SERVO_START_ANGLE);
  });

  it('checks what the board answers against the contract: ultrasonic 2..400 cm, ADC 0..adcMax', () => {
    expect(ULTRASONIC_CM).toEqual([constants.ULTRASONIC_MIN_CM, constants.ULTRASONIC_MAX_CM]);
    expect(constants.ULTRASONIC_NO_ECHO_CM).toBe(constants.ULTRASONIC_MAX_CM);
    expect(UNO_ADC_MAX).toBe(unoContract.board.adcMax);
  });

  it('N19 A5: clamps the claw and the arm to 0..90 as the contract’s gripperSet does, writes open 0, close 80 (the kit’s jaws meet), up 90, down 0, and reads a colour index 0..6 and a raw count 0..21504 as the contract’s helper', () => {
    const gripperSet = unoContract.helpers['gripper-servo2']?.text ?? '';
    expect(gripperSet).toContain(`if (angle < ${GRIPPER_ANGLE_RANGE.min}L) angle = ${GRIPPER_ANGLE_RANGE.min}L;`);
    expect(gripperSet).toContain(`if (angle > ${GRIPPER_ANGLE_RANGE.max}L) angle = ${GRIPPER_ANGLE_RANGE.max}L;`);
    const gripper = productionKits.get({ id: 'ref-uno-gripper', version: '0' })?.modules.find((module) => module.role === 'gripper');
    expect([clawPositions.OPEN, clawPositions.CLOSE, liftPositions.UP, liftPositions.DOWN]).toEqual([0, gripper?.spec.jawsMeetDeg, GRIPPER_ANGLE_RANGE.max, 0]);
    expect(row('U-35').restrictions[0]).toContain(`writes ${clawPositions.OPEN} (open) or ${clawPositions.CLOSE} (closed`);
    expect(row('U-36').restrictions[0]).toContain(`writes ${liftPositions.UP} (up) or ${liftPositions.DOWN} (down)`);
    // The colour helper: ATIME 0xEB gives (256 − ATIME) × 1024 counts at most (DS-02); its classes are COLOR_NAMES, unknown the last.
    const colour = unoContract.helpers['tcs34725-wire']?.text ?? '';
    const atime = Number.parseInt(/colorWrite\(0x01, 0x([0-9A-F]{2})\);/.exec(colour)?.[1] ?? '', 16);
    expect(COLOR_RAW_RANGE).toEqual([0, Math.min(65535, (256 - atime) * 1024)]);
    expect(COLOR_RAW_RANGE[1]).toBe(21504);
    expect(colour).toContain(`return ${COLOR_NAMES.length - 1};`);
    expect(COLOR_NAMES.at(-1)).toBe('unknown');
    expect(row('U-38').restrictions[0]).toContain(COLOR_NAMES.map((name, index) => `${index} ${name}`).join(', '));
    expect(row('U-39').restrictions[0]).toContain(`${COLOR_CHANNELS.map((channel, index) => `${index} ${channel}`).join(', ')}; 0..${COLOR_RAW_RANGE[1]}`);
  });

  it('reports with the codes and severities the contract names (§13)', () => {
    const severity = (id: string) => unoContract.diagnostics.find((diagnostic) => diagnostic.id === id)?.severity;
    expect(['capability-unavailable', 'pin-unavailable', 'timer-claimed', 'value-clamped', 'not-pwm'].map(severity)).toEqual(['error', 'error', 'error', 'warning', 'warning']);
  });
});
