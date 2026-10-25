import { describe, expect, it } from 'vitest';
import { productionKits, unoR3Board } from '../../core/hardware/catalog';
import type { Kit } from '../../core/hardware/kit';
import type { PinState } from '../../core/hardware/virtual-uno';
import type { RobotSnapshot, SensorReadout } from '../../core/world/snapshot';
import { scenarioCatalog } from '../../samples/robot-scenarios';
import { buttonPressed, lineSeesDark, robotModel, toneHzOf } from './robot-model';
import { idleSnapshot } from './scene-math';

// N18 R4.2: the robot the 3D view draws is built from the kit, part by part, at the kit's mounts (cm in the robot frame, drawn in m):
// the chassis box, a wheel on each drive motor, the caster, each sensor, servo, LED, buzzer and button. What the parts show comes from
// the snapshot: a line sensor's `dark`, the buzzer's tone and the button's level on their board pins.

const kit = productionKits.get({ id: 'ref-uno-rover', version: '0' }) as Kit;
const model = robotModel(kit, unoR3Board);

describe('the robot of the 3D view (N18 R4.2)', () => {
  it('has the chassis of the kit: 15 × 12 × 5 cm, 1.5 cm above the floor', () => {
    expect(model.body).toEqual({ lengthM: 0.15, widthM: 0.12, heightM: 0.05, bottomM: 0.015 });
  });

  it('puts a wheel at each drive motor’s mount, the left one on +y (three’s −Z), with the motor’s wheel', () => {
    expect(model.wheels).toEqual([
      { role: 'motorLeft', position: [-0.02, 0.033, -0.075], radiusM: 0.033, widthM: 2.6 / 100, outward: -1 },
      { role: 'motorRight', position: [-0.02, 0.033, 0.075], radiusM: 0.033, widthM: 2.6 / 100, outward: 1 },
    ]);
    expect(model.caster).toEqual({ position: [0.055, 0.0075, 0], radiusM: 0.0075 });
  });

  it('places the sensors at their mounts, with their index among the snapshot’s sensors (kit order)', () => {
    expect(model.ultrasonics).toEqual([{ role: 'ultrasonic', position: [0.075, 0.04, 0], yawRad: 0 }]);
    expect(model.lineSensors).toEqual([
      { role: 'lineLeft', position: [0.07, 0.01, -0.015], sensorIndex: 1 },
      { role: 'lineCenter', position: [0.07, 0.01, 0], sensorIndex: 2 },
      { role: 'lineRight', position: [0.07, 0.01, 0.015], sensorIndex: 3 },
    ]);
  });

  it('gives the servo its mount, its yaw and its arm, and the LED, buzzer and button their mounts and board pins', () => {
    expect(model.servos).toEqual([{ role: 'servo1', position: [0.015, 0.07, 0], mountYawDeg: -90, arm: { lengthM: 0.055, widthM: 0.008, heightM: 0.015 } }]);
    expect(model.leds).toEqual([{ role: 'led1', position: [-0.05, 0.065, 0.03] }]);
    expect(model.buzzers).toEqual([{ role: 'buzzer', position: [-0.05, 0.065, -0.03], pinIndex: 10 }]);
    expect(model.buttons).toEqual([{ role: 'button1', position: [-0.065, 0.065, 0], pinIndex: 3 }]);
  });
});

describe('what the robot’s parts show (N18 R4.2)', () => {
  const idle = idleSnapshot(scenarioCatalog.get('rb-line-follow')!, kit);
  const pin = (id: string, state: Partial<PinState>): PinState => ({ pin: id, mode: 'INPUT', level: 1, duty: 0, toneHz: null, servoDeg: null, ...state });
  const pins = unoR3Board.pins.map((spec) => pin(spec.id, {}));
  const line = (dark: boolean): SensorReadout => ({ role: 'lineCenter', kind: 'line-sensor', reflectance: dark ? 0 : 1, dark, spotCm: [0, 0] });
  const world = (changes: Partial<RobotSnapshot>): RobotSnapshot => ({ ...idle, ...changes });

  it('a line sensor shows dark when its readout says so, and nothing before a run', () => {
    expect(lineSeesDark(world({ sensors: [{ role: 'ultrasonic', kind: 'ultrasonic', cm: 40, hitId: null }, line(false), line(true)] }), 2)).toBe(true);
    expect(lineSeesDark(world({ sensors: [{ role: 'ultrasonic', kind: 'ultrasonic', cm: 40, hitId: null }, line(false), line(true)] }), 1)).toBe(false);
    expect(lineSeesDark(idle, 2)).toBe(false);
  });

  it('the buzzer plays the tone on its pin, and the button is down while its pin reads LOW', () => {
    const playing = world({ pins: pins.map((state, i) => (i === 10 ? { ...state, mode: 'OUTPUT', toneHz: 440 } : i === 3 ? { ...state, level: 0 } : state)) });
    expect(toneHzOf(playing, 10)).toBe(440);
    expect(buttonPressed(playing, 3)).toBe(true);
    expect(toneHzOf(world({ pins }), 10)).toBeNull();
    expect(buttonPressed(world({ pins }), 3)).toBe(false);
    expect(toneHzOf(idle, 10)).toBeNull();
    expect(buttonPressed(idle, 3)).toBe(false);
  });
});
