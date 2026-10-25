import { describe, expect, it } from 'vitest';
import { robotRoles } from '../../hardware/kit';
import { assignCppNames, isReservedCppName, sanitizeCppName } from './names';
import { toolchainNames } from './toolchain-names';

// N18 C1: C++ names for Blockly variables, as yolobit/names.ts does for Python: ASCII and legal, kept away from everything the sketch
// and the pinned toolchain already mean, and unique, in the order of `variables`, so the same program always gets the same names.

const names = (...list: string[]) => {
  const assigned = assignCppNames(list.map((name, index) => ({ id: `v${String(index)}`, name })));
  if (!assigned.ok) {
    throw new Error(assigned.message);
  }
  return [...assigned.names.values()];
};

describe('sanitizeCppName', () => {
  it('drops accents, turns anything else into one _, and starts with a letter', () => {
    expect(sanitizeCppName('số lượng')).toBe('so_luong');
    expect(sanitizeCppName('Đếm')).toBe('Dem');
    expect(sanitizeCppName('tốc độ (cm/s)')).toBe('toc_do_cm_s_');
    expect(sanitizeCppName('9lives')).toBe('v_9lives');
    expect(sanitizeCppName('_tmp')).toBe('v_tmp');
    expect(sanitizeCppName('a__b')).toBe('a_b');
    expect(sanitizeCppName('')).toBe('v_');
    expect(sanitizeCppName('😀')).toBe('v_');
  });
});

describe('assignCppNames', () => {
  it('keeps a plain name as it is', () => {
    expect(names('x', 'count', 'speed', 'time', 'value')).toEqual(['x', 'count', 'speed', 'time', 'value']);
  });

  it('moves a C++ keyword, an Arduino name, a helper, a role and a pin macro of the sketch to a numbered name', () => {
    expect(names('int', 'and', 'delay', 'Serial', 'HIGH', 'add32', 'motorSet', 'servo1', 'setup', 'loop', 'MOTOR_LEFT_EN', 'LINE_CENTER_PIN')).toEqual([
      'int_2', 'and_2', 'delay_2', 'Serial_2', 'HIGH_2', 'add32_2', 'motorSet_2', 'servo1_2', 'setup_2', 'loop_2', 'MOTOR_LEFT_EN_2', 'LINE_CENTER_PIN_2',
    ]);
  });

  it('moves a macro, a declaration and a link symbol of the pinned toolchain, and every binary.h constant', () => {
    expect(names('sinf', 'stdin', 'PORTB', 'B101', 'B11111111', 'timer0_millis', 'Servo', 'String', 'max')).toEqual([
      'sinf_2', 'stdin_2', 'PORTB_2', 'B101_2', 'B11111111_2', 'timer0_millis_2', 'Servo_2', 'String_2', 'max_2',
    ]);
    expect(names('B2', 'B111111111')).toEqual(['B2', 'B111111111']);
  });

  it('makes names unique in the order given, skipping a numbered name that is taken', () => {
    expect(names('số', 'so', 'so_2', 'so')).toEqual(['so', 'so_2', 'so_2_2', 'so_3']);
    expect(names('x_', 'x_')).toEqual(['x_', 'x_2']);
  });

  it('refuses a variable id used twice', () => {
    expect(assignCppNames([{ id: 'a', name: 'x' }, { id: 'a', name: 'y' }])).toEqual({ ok: false, message: 'The variable id "a" is used twice.', variableId: 'a' });
  });
});

describe('the reserved names', () => {
  it('has every C++ keyword and alternative token, and nothing a learner name never is', () => {
    for (const keyword of ['class', 'namespace', 'template', 'nullptr', 'constexpr', 'and', 'or', 'not', 'xor', 'bitand', 'compl', 'main']) {
      expect(isReservedCppName(keyword), keyword).toBe(true);
    }
    expect(isReservedCppName('x')).toBe(false);
  });

  it('has the sequencing temporaries of contract §3.5 (`_s1`, `_s2`, …), which a learner name can never become anyway', () => {
    expect(['_s1', '_s2', '_s10', '_s123'].map(isReservedCppName)).toEqual([true, true, true, true]);
    expect(sanitizeCppName('_s1')).toBe('v_s1');
    expect(names('_s1', 's1')).toEqual(['v_s1', 's1']);
  });

  it('has the sketch’s own names: setup, loop, the helpers, every robot role and every pin macro', () => {
    for (const name of ['setup', 'loop', 'add32', 'sub32', 'mul32', 'neg32', 'div32', 'mod32', 'motorSet', 'servoSet', 'buzzerTone', 'ultrasonicCm', 'pwmWrite', ...robotRoles]) {
      expect(isReservedCppName(name), name).toBe(true);
    }
    for (const name of ['MOTOR_LEFT_IN2', 'ULTRASONIC_TRIG', 'ULTRASONIC_ECHO', 'BUZZER_PIN', 'BUTTON1_PIN']) {
      expect(isReservedCppName(name), name).toBe(true);
    }
  });

  it('is a sorted list of distinct identifiers that never start with _ (the generator’s own names do)', () => {
    const list = [...toolchainNames()];
    expect(list.length).toBe(1634);
    expect(list).toEqual([...list].sort());
    expect(list.every((name) => /^[A-Za-z]\w*$/.test(name))).toBe(true);
    expect(list.some((name) => /^B[01]{1,8}$/.test(name))).toBe(false);
    expect(list).toEqual(expect.arrayContaining(['Serial', 'pinMode', 'millis', 'sinf', 'stdin', 'A0', 'LED_BUILTIN', 'timer0_millis', 'Servo', 'HardwareSerial']));
  });
});
