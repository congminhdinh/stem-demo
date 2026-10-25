import { describe, expect, it } from 'vitest';
import { createModuleIO } from '../../core/hardware/binding';
import { productionKits, referenceKitRef, unoR3Board } from '../../core/hardware/catalog';
import { motorDuty } from '../../core/hardware/drivers';
import type { Kit } from '../../core/hardware/kit';
import { createVirtualUno, type PinState } from '../../core/hardware/virtual-uno';
import type { RobotSnapshot, SensorReadout } from '../../core/world/snapshot';
import { scenarioCatalog } from '../../samples/robot-scenarios';
import { hubCards, hubMap, hubValues, idleHubValues, pinReading, type HubValues } from './pin-map';
import { buttonPressed, lineSeesDark, robotModel, toneHzOf } from './robot-model';
import { idleSnapshot } from './scene-math';

// N18 R4.5: what the "Cổng & chân" tab shows, worked out here without React: the kit's role → port → pins, and what the snapshot of a run
// says about each of them (pin levels and PWM duty, motor percent, sensor readings). The plan's example: motor.set(motorLeft, 50) puts
// 128 on D5 and HIGH, LOW on D7 and D8.

const kit = productionKits.get(referenceKitRef) as Kit;
const board = unoR3Board;
const scenario = scenarioCatalog.get('rb-drive-to-zone')!;
const map = hubMap(kit, board);

/** A virtual UNO set up as the whole kit's program would, to call the kit's real drivers on. */
function robot() {
  let us = 0;
  const uno = createVirtualUno(board, { now: () => us / 1000, charge: (by) => (us += by) && undefined });
  const modules = createModuleIO(kit, uno);
  return { uno, modules };
}

/** The world of a run at some moment: the pins of `uno`, and the rest of the snapshot as given. */
function worldOf(pins: readonly PinState[], changes: Partial<RobotSnapshot> = {}): RobotSnapshot {
  return { ...idleSnapshot(scenario, kit), t: 1, status: 'running', pins, ...changes };
}

const ultrasonic = (cm: number, hitId: string | null): SensorReadout => ({ role: 'ultrasonic', kind: 'ultrasonic', cm, hitId });
const line = (role: string, dark: boolean): SensorReadout => ({ role, kind: 'line-sensor', reflectance: dark ? 0.05 : 0.9, dark, spotCm: [10, 10] });
/** The kit's sensors in kit order (the snapshot's `sensors`): the ultrasonic, then the three line sensors. */
const sensors = (...readouts: SensorReadout[]) => readouts;

describe('hubMap: the kit’s role → port → pins (N18 R4.5)', () => {
  it('lists the kit’s modules in kit order, each with its port, its driver and the board pins of the port under the driver’s names', () => {
    expect(map.modules.map((module) => [module.role, module.port, module.pins.map((pin) => `${pin.name}=${pin.pin}`)])).toEqual([
      ['motorLeft', 'M1', ['EN=D5', 'IN1=D7', 'IN2=D8']],
      ['motorRight', 'M2', ['EN=D6', 'IN1=D4', 'IN2=D2']],
      ['ultrasonic', 'US1', ['TRIG=D12', 'ECHO=D11']],
      ['lineLeft', 'LN1', ['PIN=A0']],
      ['lineCenter', 'LN2', ['PIN=A1']],
      ['lineRight', 'LN3', ['PIN=A2']],
      ['servo1', 'SV1', ['PIN=D9']],
      ['led1', 'LED1', ['PIN=D13']],
      ['buzzer', 'BZ1', ['PIN=D10']],
      ['button1', 'BTN1', ['PIN=D3']],
    ]);
    expect(map.modules.map((module) => [module.role, module.kind, module.driver])).toEqual([
      ['motorLeft', 'dc-motor', 'hbridge-en-in1-in2'],
      ['motorRight', 'dc-motor', 'hbridge-en-in1-in2'],
      ['ultrasonic', 'ultrasonic', 'hcsr04-pulsein'],
      ['lineLeft', 'line-sensor', 'line-digital'],
      ['lineCenter', 'line-sensor', 'line-digital'],
      ['lineRight', 'line-sensor', 'line-digital'],
      ['servo1', 'servo', 'servo-lib'],
      ['led1', 'led', 'led-digital'],
      ['buzzer', 'buzzer', 'buzzer-tone'],
      ['button1', 'button', 'button-pullup'],
    ]);
  });

  it('says for each pin of a port whether the driver drives it or reads it', () => {
    const dirs = (role: string) => map.modules.find((module) => module.role === role)?.pins.map((pin) => `${pin.name}:${pin.dir}`);
    expect(dirs('motorLeft')).toEqual(['EN:out', 'IN1:out', 'IN2:out']);
    expect(dirs('ultrasonic')).toEqual(['TRIG:out', 'ECHO:in']);
    expect(dirs('lineCenter')).toEqual(['PIN:in']);
    expect(dirs('button1')).toEqual(['PIN:in']);
  });

  it('lists the board’s pins in board order: D0 to D13, then A0 to A5, with PWM and analog marked', () => {
    expect(map.board.map((pin) => pin.id)).toEqual(board.pins.map((pin) => pin.id));
    expect(map.board.filter((pin) => pin.pwm).map((pin) => pin.id)).toEqual(['D3', 'D5', 'D6', 'D9', 'D10', 'D11']);
    expect(map.board.filter((pin) => pin.analog).map((pin) => pin.id)).toEqual(['A0', 'A1', 'A2', 'A3', 'A4', 'A5']);
    expect(map.board.map((pin) => pin.index)).toEqual(board.pins.map((_, index) => index));
    expect(map.pwmMax).toBe(255);
  });

  it('knows the part, port and signal behind each pin the kit uses, and no other', () => {
    expect(map.owners.get('D5')).toEqual({ role: 'motorLeft', port: 'M1', signal: 'EN' });
    expect(map.owners.get('D11')).toEqual({ role: 'ultrasonic', port: 'US1', signal: 'ECHO' });
    expect(map.owners.get('A2')).toEqual({ role: 'lineRight', port: 'LN3', signal: 'PIN' });
    expect(map.owners.get('D0')).toBeUndefined();
    expect(map.owners.get('A5')).toBeUndefined();
    expect([...map.owners.keys()].sort()).toEqual(['A0', 'A1', 'A2', 'D10', 'D11', 'D12', 'D13', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8', 'D9']);
  });

  it('indexes the sensors and pins as the 3D view does (robot-model.ts), so both read the same place of the snapshot', () => {
    const model = robotModel(kit, board);
    for (const sensor of model.lineSensors) {
      expect(map.modules.find((module) => module.role === sensor.role)?.sensorIndex).toBe(sensor.sensorIndex);
    }
    for (const part of [...model.buzzers, ...model.buttons]) {
      expect(map.modules.find((module) => module.role === part.role)?.pins[0]?.index).toBe(part.pinIndex);
    }
    expect(map.modules.find((module) => module.role === 'ultrasonic')?.sensorIndex).toBe(0);
    expect(map.modules.find((module) => module.role === 'motorLeft')?.sensorIndex).toBe(-1);
  });
});

describe('pinReading: what one pin says', () => {
  const state = (changes: Partial<PinState>): PinState => ({ pin: 'D5', mode: 'OUTPUT', level: 0, duty: 0, toneHz: null, servoDeg: null, ...changes });

  it('is HIGH or LOW for a level, PWM n for a duty between, and the tone or the servo angle a pin carries', () => {
    expect(pinReading(state({ level: 1, duty: 255 }), 255)).toEqual({ reading: { kind: 'high' }, input: false });
    expect(pinReading(state({}), 255)).toEqual({ reading: { kind: 'low' }, input: false });
    expect(pinReading(state({ level: 1, duty: 128 }), 255)).toEqual({ reading: { kind: 'pwm', duty: 128 }, input: false });
    expect(pinReading(state({ level: 0, duty: 1 }), 255)).toEqual({ reading: { kind: 'pwm', duty: 1 }, input: false });
    expect(pinReading(state({ pin: 'D10', toneHz: 440 }), 255)).toEqual({ reading: { kind: 'tone', hz: 440 }, input: false });
    expect(pinReading(state({ pin: 'D9', servoDeg: 90 }), 255)).toEqual({ reading: { kind: 'servo', deg: 90 }, input: false });
  });

  it('marks an input, which has a level and never a duty', () => {
    expect(pinReading(state({ pin: 'D3', mode: 'INPUT_PULLUP', level: 1 }), 255)).toEqual({ reading: { kind: 'high' }, input: true });
    expect(pinReading(state({ pin: 'A0', mode: 'INPUT', level: 0 }), 255)).toEqual({ reading: { kind: 'low' }, input: true });
  });
});

describe('hubValues: what the snapshot says (N18 R4.5)', () => {
  it('has no values before a run, or when nothing is held: the static mapping', () => {
    expect(hubValues(map, null)).toEqual(idleHubValues);
    expect(idleHubValues).toEqual({ live: false, pins: {}, modules: {} });
  });

  it('a world with no pins yet (the world alone) has nothing to say about them either', () => {
    expect(hubValues(map, idleSnapshot(scenario, kit)).live).toBe(false);
  });

  it('motor.set(motorLeft, 50) → D5 duty 128, D7 HIGH, D8 LOW: the left motor runs forward at 50 %', () => {
    const { uno, modules } = robot();
    modules.call('motorLeft', 'motor.set', [50]);
    const values = hubValues(map, worldOf(uno.pins()));
    expect(values.live).toBe(true);
    expect(values.pins.D5).toEqual({ reading: { kind: 'pwm', duty: 128 }, input: false });
    expect(values.pins.D7).toEqual({ reading: { kind: 'high' }, input: false });
    expect(values.pins.D8).toEqual({ reading: { kind: 'low' }, input: false });
    expect(values.modules.motorLeft).toEqual({ kind: 'dc-motor', percent: 50, direction: 'forward' });
    expect(values.modules.motorRight).toEqual({ kind: 'dc-motor', percent: 0, direction: 'stopped' });
  });

  it('motor.set(motorRight, -100) → full duty on D6 (HIGH), D4 LOW, D2 HIGH: backward at 100 %', () => {
    const { uno, modules } = robot();
    modules.call('motorRight', 'motor.set', [-100]);
    const values = hubValues(map, worldOf(uno.pins()));
    expect([values.pins.D6?.reading, values.pins.D4?.reading, values.pins.D2?.reading]).toEqual([{ kind: 'high' }, { kind: 'low' }, { kind: 'high' }]);
    expect(values.modules.motorRight).toEqual({ kind: 'dc-motor', percent: -100, direction: 'backward' });
  });

  it('reads back every speed the driver can be given, −100 to 100, as the same percent', () => {
    for (let speed = -100; speed <= 100; speed++) {
      const { uno, modules } = robot();
      modules.call('motorLeft', 'motor.set', [speed]);
      const view = hubValues(map, worldOf(uno.pins())).modules.motorLeft;
      expect(view, `speed ${speed} (duty ${motorDuty(speed)})`).toEqual({
        kind: 'dc-motor',
        percent: speed,
        direction: speed > 0 ? 'forward' : speed < 0 ? 'backward' : 'stopped',
      });
    }
  });

  it('a motor whose two direction pins agree is not turning, whatever the duty', () => {
    const { uno } = robot();
    const pins = uno.pins().map((pin) => (pin.pin === 'D5' ? { ...pin, level: 1 as const, duty: 200 } : pin.pin === 'D7' || pin.pin === 'D8' ? { ...pin, level: 1 as const } : pin));
    expect(hubValues(map, worldOf(pins)).modules.motorLeft).toEqual({ kind: 'dc-motor', percent: 0, direction: 'stopped' });
  });

  it('reads the ultrasonic distance and whether an echo came, and each line sensor’s eye', () => {
    const { uno } = robot();
    const world = worldOf(uno.pins(), { sensors: sensors(ultrasonic(23.4, 'wall'), line('lineLeft', true), line('lineCenter', false), line('lineRight', true)) });
    const { modules } = hubValues(map, world);
    expect(modules.ultrasonic).toEqual({ kind: 'ultrasonic', cm: 23.4, echo: true });
    expect(modules.lineLeft).toEqual({ kind: 'line-sensor', dark: true });
    expect(modules.lineCenter).toEqual({ kind: 'line-sensor', dark: false });
    expect(modules.lineRight).toEqual({ kind: 'line-sensor', dark: true });
    expect(hubValues(map, worldOf(uno.pins(), { sensors: sensors(ultrasonic(400, null), line('lineLeft', false), line('lineCenter', false), line('lineRight', false)) })).modules.ultrasonic).toEqual({
      kind: 'ultrasonic',
      cm: 400,
      echo: false,
    });
  });

  it('agrees with the 3D view on what each sensor, the buzzer and the button show', () => {
    const { uno } = robot();
    const pins = uno.pins().map((pin) => (pin.pin === 'D10' ? { ...pin, toneHz: 440 } : pin.pin === 'D3' ? { ...pin, level: 0 as const } : pin));
    const world = worldOf(pins, { sensors: sensors(ultrasonic(50, 'wall'), line('lineLeft', false), line('lineCenter', true), line('lineRight', false)) });
    const { modules } = hubValues(map, world);
    const model = robotModel(kit, board);
    for (const sensor of model.lineSensors) {
      expect(modules[sensor.role]).toEqual({ kind: 'line-sensor', dark: lineSeesDark(world, sensor.sensorIndex) });
    }
    expect(modules.buzzer).toEqual({ kind: 'buzzer', hz: toneHzOf(world, model.buzzers[0]!.pinIndex) });
    expect(modules.buzzer).toEqual({ kind: 'buzzer', hz: 440 });
    expect(modules.button1).toEqual({ kind: 'button', pressed: buttonPressed(world, model.buttons[0]!.pinIndex) });
    expect(modules.button1).toEqual({ kind: 'button', pressed: true });
  });

  it('reads the servo arm, rounded to a degree, the LED, a silent buzzer and a button that is let go', () => {
    const { uno } = robot();
    const base = idleSnapshot(scenario, kit);
    const world = worldOf(uno.pins(), { robot: { ...base.robot, servoDeg: { servo1: 44.6 } }, leds: { led1: true } });
    const { modules, pins } = hubValues(map, world);
    expect(modules.servo1).toEqual({ kind: 'servo', deg: 45 });
    expect(modules.led1).toEqual({ kind: 'led', on: true });
    expect(modules.buzzer).toEqual({ kind: 'buzzer', hz: null });
    expect(modules.button1).toEqual({ kind: 'button', pressed: false });
    // setup() has attached the servo: the pin carries its command.
    expect(pins.D9).toEqual({ reading: { kind: 'servo', deg: 90 }, input: false });
    expect(pins.D3).toEqual({ reading: { kind: 'high' }, input: true });
    // A servo at 0 is 0, never −0.
    const folded = worldOf(uno.pins(), { robot: { ...base.robot, servoDeg: { servo1: -1.2e-6 } } });
    expect(Object.is((hubValues(map, folded).modules.servo1 as { deg: number }).deg, 0)).toBe(true);
  });

  it('is plain JSON, so a view can tell whether anything changed by comparing text', () => {
    const { uno, modules } = robot();
    modules.call('motorLeft', 'motor.set', [50]);
    const values: HubValues = hubValues(map, worldOf(uno.pins(), { sensors: sensors(ultrasonic(23.4, 'wall'), line('lineLeft', true), line('lineCenter', false), line('lineRight', true)) }));
    expect(JSON.parse(JSON.stringify(values))).toEqual(values);
  });
});

describe('hubCards: the cards of the panel, in kit order', () => {
  it('is one card for each part, and one for all the line sensors, where the first of them stands', () => {
    expect(hubCards(map).map((card) => [card.id, card.kind, card.modules.map((module) => module.role)])).toEqual([
      ['motorLeft', 'dc-motor', ['motorLeft']],
      ['motorRight', 'dc-motor', ['motorRight']],
      ['ultrasonic', 'ultrasonic', ['ultrasonic']],
      ['line', 'line-sensor', ['lineLeft', 'lineCenter', 'lineRight']],
      ['servo1', 'servo', ['servo1']],
      ['led1', 'led', ['led1']],
      ['buzzer', 'buzzer', ['buzzer']],
      ['button1', 'button', ['button1']],
    ]);
  });

  it('has no card for a kind the kit lacks', () => {
    const noLine = { ...map, modules: map.modules.filter((module) => module.kind !== 'line-sensor') };
    expect(hubCards(noLine).map((card) => card.id)).toEqual(['motorLeft', 'motorRight', 'ultrasonic', 'servo1', 'led1', 'buzzer', 'button1']);
  });
});
