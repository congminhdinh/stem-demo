import { describe, expect, it } from 'vitest';
import { productionKits, unoR3Board } from '../../core/hardware/catalog';
import type { Kit } from '../../core/hardware/kit';
import { translate, type Locale } from '../i18n/messages';
import type { Text } from '../i18n/text';
import { hubMap, hubValues, type ModuleView } from './pin-map';
import { CLAW_CLOSED_FROM_DEG, clawStateText, colorNameText, colorRawText, hubRows, irStateText, moduleValueText, padLabel, rowText } from './pin-text';

// N19 E2: the words of the "Cổng & chân" tab for the gripper car, exact in Vietnamese: the claw's angle and whether it is open or closed, the
// arm's angle, the IR sensor's pin level and whether it sees an object (có vật / không), the colour sensor's raw R G B C and its colour.

const textIn = (locale: Locale): Text => (key, params) => translate(locale, key, params);
const vi = textIn('vi');
const en = textIn('en');
const gripperKit = productionKits.get({ id: 'ref-uno-gripper', version: '0' }) as Kit;
const map = hubMap(gripperKit, unoR3Board);

describe('the claw open or closed', () => {
  it('is open below 6° (nothing attaches there, plan §4.6) and closed from it: closed on a cube at 27°, closed all the way at 80°', () => {
    expect(CLAW_CLOSED_FROM_DEG).toBe(6);
    expect([0, 5, 5.9].map((deg) => clawStateText(vi, deg))).toEqual(['mở', 'mở', 'mở']);
    expect([6, 27, 80, 90].map((deg) => clawStateText(vi, deg))).toEqual(['đóng', 'đóng', 'đóng', 'đóng']);
    expect([clawStateText(en, 0), clawStateText(en, 27)]).toEqual(['open', 'closed']);
  });
});

describe('moduleValueText of the gripper car’s parts', () => {
  const view = (value: ModuleView) => ({ vi: moduleValueText(vi, 'vi', value), en: moduleValueText(en, 'en', value) });

  it('says the gripper as claw, its state, and arm: kẹp 0° mở · tay 90°', () => {
    expect(view({ kind: 'gripper', clawDeg: 0, liftDeg: 90 })).toEqual({ vi: 'kẹp 0° mở · tay 90°', en: 'claw 0° open · arm 90°' });
    expect(view({ kind: 'gripper', clawDeg: 27, liftDeg: 45 })).toEqual({ vi: 'kẹp 27° đóng · tay 45°', en: 'claw 27° closed · arm 45°' });
    expect(view({ kind: 'gripper', clawDeg: null, liftDeg: null })).toEqual({ vi: null, en: null });
  });

  it('says the IR sensor as its pin level and whether it sees an object: LOW · có vật, HIGH · không', () => {
    expect(view({ kind: 'ir-obstacle', level: 'low', detected: true })).toEqual({ vi: 'LOW · có vật', en: 'LOW · object' });
    expect(view({ kind: 'ir-obstacle', level: 'high', detected: false })).toEqual({ vi: 'HIGH · không', en: 'HIGH · none' });
    expect([irStateText(vi, true), irStateText(vi, false)]).toEqual(['có vật', 'không']);
  });

  it('says the colour sensor as its raw R G B C and its colour, and nothing without a reading', () => {
    expect(view({ kind: 'color-sensor', rgbc: { r: 8047, g: 1676, b: 1382, c: 9596 }, color: 'red' })).toEqual({ vi: 'R 8047 G 1676 B 1382 C 9596 · đỏ', en: 'R 8047 G 1676 B 1382 C 9596 · red' });
    expect(view({ kind: 'color-sensor', rgbc: { r: 0, g: 0, b: 0, c: 0 }, color: 'unknown' })).toEqual({ vi: 'R 0 G 0 B 0 C 0 · không rõ', en: 'R 0 G 0 B 0 C 0 · unclear' });
    expect(view({ kind: 'color-sensor', rgbc: null, color: null })).toEqual({ vi: null, en: null });
    expect(colorRawText(vi, { r: 12, g: 34, b: 56, c: 78 })).toBe('R 12 G 34 B 56 C 78');
  });

  it('names every colour of COLOR_RULES in both languages', () => {
    expect((['red', 'green', 'blue', 'yellow', 'white', 'black', 'unknown'] as const).map((name) => colorNameText(vi, name))).toEqual(['đỏ', 'xanh lá', 'xanh dương', 'vàng', 'trắng', 'đen', 'không rõ']);
    expect((['red', 'green', 'blue', 'yellow', 'white', 'black', 'unknown'] as const).map((name) => colorNameText(en, name))).toEqual(['red', 'green', 'blue', 'yellow', 'white', 'black', 'unclear']);
  });
});

describe('the table of the gripper car (N19 E2)', () => {
  const idle = hubValues(map, null);

  it('lists the three parts after the button with their ports and pins, before a run: Tay gắp → GR1 → D9, D10; A3; A4 SDA, A5 SCL', () => {
    const rows = hubRows(vi, 'vi', map, idle);
    expect(rows.slice(-3).map(rowText)).toEqual(['Tay gắp → GR1 → D9, D10', 'Hồng ngoại ở càng → IR1 → A3', 'Cảm biến màu → CS1 → A4, A5']);
    expect(rows.slice(-3).map((row) => row.pins.map((pin) => `${pin.pin} ${pin.signal}`))).toEqual([['D9 CLAW', 'D10 LIFT'], ['A3 PIN'], ['A4 SDA', 'A5 SCL']]);
  });

  it('says the live values of each as one sentence', () => {
    const pins = unoR3Board.pins.map((pin) => ({
      pin: pin.id,
      mode: pin.id === 'A3' || pin.id === 'A4' || pin.id === 'A5' ? ('INPUT_PULLUP' as const) : ('OUTPUT' as const),
      level: pin.id === 'A3' ? (0 as const) : pin.id === 'A4' || pin.id === 'A5' ? (1 as const) : (0 as const),
      duty: 0,
      toneHz: null,
      servoDeg: pin.id === 'D9' ? 80 : pin.id === 'D10' ? 15 : null,
    }));
    const world = {
      t: 1,
      objects: [],
      pins,
      leds: {},
      activeBlockId: null,
      status: 'running',
      outOfArena: false,
      score: { points: 0, maxScore: null, goals: [] },
      robot: { xCm: 0, yCm: 0, zCm: 0, yawDeg: 0, rotation: { x: 0, y: 0, z: 0, w: 1 }, wheelRad: [0, 0], servoDeg: {}, gripper: { clawDeg: 26.97, liftDeg: 15, heldId: 'cube' } },
      sensors: [
        { role: 'ultrasonic', kind: 'ultrasonic', cm: 400, hitId: null },
        ...['lineLeft', 'lineCenter', 'lineRight'].map((role) => ({ role, kind: 'line-sensor', reflectance: 0.9, dark: false, spotCm: [1, 1] })),
        { role: 'irClaw', kind: 'ir-obstacle', detected: true, hitId: 'cube' },
        { role: 'color1', kind: 'color-sensor', hitId: 'cube', distanceCm: 1, rgbc: { c: 9596, r: 8047, g: 1676, b: 1382 } },
      ],
    } as unknown as Parameters<typeof hubValues>[1];
    const rows = hubRows(vi, 'vi', map, hubValues(map, world)).slice(-3);
    expect(rows.map(rowText)).toEqual([
      'Tay gắp kẹp 27° đóng · tay 15° → GR1 → D9 servo 80°, D10 servo 15°',
      'Hồng ngoại ở càng LOW · có vật → IR1 → A3 LOW',
      'Cảm biến màu R 8047 G 1676 B 1382 C 9596 · đỏ → CS1 → A4 HIGH, A5 HIGH',
    ]);
  });

  it('names the gripper’s pins on the board by their signal: Tay gắp CLAW and LIFT, the sensor’s SDA and SCL, the IR with none', () => {
    const label = (pin: string) => padLabel(vi, map.owners.get(pin)!);
    expect([label('D9'), label('D10'), label('A3'), label('A4'), label('A5')]).toEqual([
      { part: 'Tay gắp', signal: 'CLAW' },
      { part: 'Tay gắp', signal: 'LIFT' },
      { part: 'Hồng ngoại ở càng', signal: null },
      { part: 'Cảm biến màu', signal: 'SDA' },
      { part: 'Cảm biến màu', signal: 'SCL' },
    ]);
  });
});
