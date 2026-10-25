import { describe, expect, it } from 'vitest';
import { createModuleIO } from '../../core/hardware/binding';
import { productionKits, referenceKitRef, unoR3Board } from '../../core/hardware/catalog';
import { robotRoles, type Kit } from '../../core/hardware/kit';
import { createVirtualUno } from '../../core/hardware/virtual-uno';
import type { RobotSnapshot } from '../../core/world/snapshot';
import { scenarioCatalog } from '../../samples/robot-scenarios';
import { translate, type Locale } from '../i18n/messages';
import type { Text } from '../i18n/text';
import { hubMap, hubValues, idleHubValues, type PinReading } from './pin-map';
import { hubRows, moduleValueText, padLabel, pinValueText, rowText } from './pin-text';
import { idleSnapshot } from './scene-math';

// N18 R4.5: the words of the "Cổng & chân" tab, in both languages. The plan's example, motor.set(motorLeft, 50), reads
// "motor trái 50 % → M1 → D5 PWM 128, D7 HIGH, D8 LOW".

const kit = productionKits.get(referenceKitRef) as Kit;
const board = unoR3Board;
const map = hubMap(kit, board);
const scenario = scenarioCatalog.get('rb-drive-to-zone')!;
const textIn = (locale: Locale): Text => (key, params) => translate(locale, key, params);
const vi = textIn('vi');
const en = textIn('en');

/** The world after the kit's setup() and the calls given, with the sensors a test adds. */
function worldAfter(calls: (modules: ReturnType<typeof createModuleIO>) => void, changes: Partial<RobotSnapshot> = {}): RobotSnapshot {
  let us = 0;
  const uno = createVirtualUno(board, { now: () => us / 1000, charge: (by) => (us += by) && undefined });
  const modules = createModuleIO(kit, uno);
  calls(modules);
  return { ...idleSnapshot(scenario, kit), t: 1, status: 'running', pins: uno.pins(), ...changes };
}

describe('pinValueText (N18 R4.5)', () => {
  const cases: [PinReading, string, string][] = [
    [{ kind: 'low' }, 'LOW', 'LOW'],
    [{ kind: 'high' }, 'HIGH', 'HIGH'],
    [{ kind: 'pwm', duty: 128 }, 'PWM 128', 'PWM 128'],
    [{ kind: 'tone', hz: 440 }, 'âm 440 Hz', 'tone 440 Hz'],
    [{ kind: 'servo', deg: 90 }, 'servo 90°', 'servo 90°'],
  ];
  it.each(cases)('says %j as “%s” in Vietnamese and “%s” in English', (reading, inVi, inEn) => {
    expect(pinValueText(vi, 'vi', reading)).toBe(inVi);
    expect(pinValueText(en, 'en', reading)).toBe(inEn);
  });
});

describe('moduleValueText', () => {
  it('says the value of each kind of part in the learner’s language, with a decimal comma in Vietnamese', () => {
    expect(moduleValueText(vi, 'vi', { kind: 'dc-motor', percent: 50, direction: 'forward' })).toBe('50 %');
    expect(moduleValueText(vi, 'vi', { kind: 'dc-motor', percent: -30, direction: 'backward' })).toBe('-30 %');
    expect(moduleValueText(vi, 'vi', { kind: 'servo', deg: 90 })).toBe('90°');
    expect(moduleValueText(vi, 'vi', { kind: 'ultrasonic', cm: 23.4, echo: true })).toBe('23,4 cm');
    expect(moduleValueText(en, 'en', { kind: 'ultrasonic', cm: 23.4, echo: true })).toBe('23.4 cm');
    expect(moduleValueText(vi, 'vi', { kind: 'ultrasonic', cm: 400, echo: false })).toBe('400 cm');
    expect(moduleValueText(vi, 'vi', { kind: 'line-sensor', dark: true })).toBe('tối');
    expect(moduleValueText(en, 'en', { kind: 'line-sensor', dark: false })).toBe('light');
    expect(moduleValueText(vi, 'vi', { kind: 'led', on: true })).toBe('bật');
    expect(moduleValueText(en, 'en', { kind: 'led', on: false })).toBe('off');
    expect(moduleValueText(vi, 'vi', { kind: 'buzzer', hz: 440 })).toBe('440 Hz');
    expect(moduleValueText(vi, 'vi', { kind: 'buzzer', hz: null })).toBe('im');
    expect(moduleValueText(vi, 'vi', { kind: 'button', pressed: true })).toBe('đang nhấn');
    expect(moduleValueText(en, 'en', { kind: 'button', pressed: false })).toBe('released');
  });

  it('has no value text for a part the snapshot says nothing about', () => {
    expect(moduleValueText(vi, 'vi', undefined)).toBeNull();
  });
});

describe('hubRows: role → port → pins → value (N18 R4.5)', () => {
  it('motor.set(motorLeft, 50) reads motor trái 50 % → M1 → D5 PWM 128, D7 HIGH, D8 LOW', () => {
    const values = hubValues(map, worldAfter((modules) => modules.call('motorLeft', 'motor.set', [50])));
    const [left, right] = hubRows(vi, 'vi', map, values);
    expect(rowText(left!)).toBe('Motor trái 50 % → M1 → D5 PWM 128, D7 HIGH, D8 LOW');
    expect(rowText(right!)).toBe('Motor phải 0 % → M2 → D6 LOW, D4 LOW, D2 LOW');
    expect(rowText(hubRows(en, 'en', map, values)[0]!)).toBe('Left motor 50 % → M1 → D5 PWM 128, D7 HIGH, D8 LOW');
  });

  it('gives each row its part, port, and each pin its signal, value and kind', () => {
    const values = hubValues(map, worldAfter((modules) => modules.call('motorLeft', 'motor.set', [50])));
    expect(hubRows(vi, 'vi', map, values)[0]).toEqual({
      role: 'motorLeft',
      name: 'Motor trái',
      port: 'M1',
      value: '50 %',
      pins: [
        { pin: 'D5', signal: 'EN', value: 'PWM 128', kind: 'pwm', input: false },
        { pin: 'D7', signal: 'IN1', value: 'HIGH', kind: 'high', input: false },
        { pin: 'D8', signal: 'IN2', value: 'LOW', kind: 'low', input: false },
      ],
    });
  });

  it('lists the kit in kit order, with each part’s name in both languages', () => {
    const rows = hubRows(vi, 'vi', map, idleHubValues);
    expect(rows.map((row) => [row.role, row.name, row.port])).toEqual([
      ['motorLeft', 'Motor trái', 'M1'],
      ['motorRight', 'Motor phải', 'M2'],
      ['ultrasonic', 'Siêu âm', 'US1'],
      ['lineLeft', 'Line trái', 'LN1'],
      ['lineCenter', 'Line giữa', 'LN2'],
      ['lineRight', 'Line phải', 'LN3'],
      ['servo1', 'Servo', 'SV1'],
      ['led1', 'Đèn LED', 'LED1'],
      ['buzzer', 'Còi', 'BZ1'],
      ['button1', 'Nút bấm', 'BTN1'],
    ]);
    expect(hubRows(en, 'en', map, idleHubValues).map((row) => row.name)).toEqual(['Left motor', 'Right motor', 'Ultrasonic', 'Line left', 'Line middle', 'Line right', 'Servo', 'LED', 'Buzzer', 'Button']);
  });

  it('shows the static mapping with no values before a run', () => {
    const rows = hubRows(vi, 'vi', map, idleHubValues);
    expect(rows.every((row) => row.value === null && row.pins.every((pin) => pin.value === null && pin.kind === null))).toBe(true);
    expect(rows.map(rowText)).toEqual([
      'Motor trái → M1 → D5, D7, D8',
      'Motor phải → M2 → D6, D4, D2',
      'Siêu âm → US1 → D12, D11',
      'Line trái → LN1 → A0',
      'Line giữa → LN2 → A1',
      'Line phải → LN3 → A2',
      'Servo → SV1 → D9',
      'Đèn LED → LED1 → D13',
      'Còi → BZ1 → D10',
      'Nút bấm → BTN1 → D3',
    ]);
  });

  it('reads the other parts of a run: sensors, servo, LED, buzzer and button', () => {
    const base = idleSnapshot(scenario, kit);
    const world = worldAfter(() => {}, {
      sensors: [
        { role: 'ultrasonic', kind: 'ultrasonic', cm: 23.4, hitId: 'wall' },
        { role: 'lineLeft', kind: 'line-sensor', reflectance: 0.05, dark: true, spotCm: [1, 1] },
        { role: 'lineCenter', kind: 'line-sensor', reflectance: 0.9, dark: false, spotCm: [1, 1] },
        { role: 'lineRight', kind: 'line-sensor', reflectance: 0.9, dark: false, spotCm: [1, 1] },
      ],
      robot: { ...base.robot, servoDeg: { servo1: 90 } },
      leds: { led1: true },
    });
    const rows = hubRows(vi, 'vi', map, hubValues(map, world)).map(rowText);
    expect(rows.slice(2)).toEqual([
      'Siêu âm 23,4 cm → US1 → D12 LOW, D11 LOW',
      'Line trái tối → LN1 → A0 LOW',
      'Line giữa sáng → LN2 → A1 LOW',
      'Line phải sáng → LN3 → A2 LOW',
      'Servo 90° → SV1 → D9 servo 90°',
      'Đèn LED bật → LED1 → D13 LOW',
      'Còi im → BZ1 → D10 LOW',
      'Nút bấm nhả → BTN1 → D3 HIGH',
    ]);
  });
});

describe('padLabel: the name beside a pin on the board (N18 R4.5 fix round 1)', () => {
  const labels = (t: Text) => map.board.flatMap((pin) => (map.owners.has(pin.id) ? [`${pin.id}: ${((label) => (label.signal === null ? label.part : `${label.part} ${label.signal}`))(padLabel(t, map.owners.get(pin.id)!))}`] : []));

  it('names the signal on each pin of a part that has several, and only the part on a part with one', () => {
    expect(labels(vi)).toEqual([
      'D2: Motor phải IN2',
      'D3: Nút bấm',
      'D4: Motor phải IN1',
      'D5: Motor trái EN',
      'D6: Motor phải EN',
      'D7: Motor trái IN1',
      'D8: Motor trái IN2',
      'D9: Servo',
      'D10: Còi',
      'D11: Siêu âm ECHO',
      'D12: Siêu âm TRIG',
      'D13: Đèn LED',
      'A0: Line trái',
      'A1: Line giữa',
      'A2: Line phải',
    ]);
  });

  it('says it in English too', () => {
    expect(labels(en).filter((label) => /motor|Ultrasonic/i.test(label))).toEqual([
      'D2: Right motor IN2',
      'D4: Right motor IN1',
      'D5: Left motor EN',
      'D6: Right motor EN',
      'D7: Left motor IN1',
      'D8: Left motor IN2',
      'D11: Ultrasonic ECHO',
      'D12: Ultrasonic TRIG',
    ]);
  });
});

describe('the words of the tab', () => {
  it('has a name for every role of the robot, in both languages', () => {
    for (const role of robotRoles) {
      for (const locale of ['vi', 'en'] as const) {
        const key = `robot.pins.role.${role}` as const;
        expect(translate(locale, key).trim(), `${locale} ${key}`).not.toBe('');
        expect(translate(locale, key), `${locale} ${key} is not the key itself`).not.toBe(key);
      }
    }
  });
});
