import { describe, expect, it } from 'vitest';
import type { ProgramClock } from '../capabilities/services';
import { createModuleIO, createVirtualUno, productionKits, referenceKitRef, unoR3Board, type Kit, type PinState, type VirtualUno } from '../hardware';
import { buzzerHzOf, createModuleModels, hbridgeCommand, ledLit, servoAngleOf } from './robot-modules';

// N18 R3.6: the module models read the virtual UNO's pins and say what the world's actuators do (robot plan §3, tick step 2). Each
// mapping is the inverse of its driver's pin writes (hardware/drivers): the tests drive the real drivers through the module binding
// and read the pins back.

const kit = productionKits.get(referenceKitRef) as Kit;

function bench(): { uno: VirtualUno; modules: ReturnType<typeof createModuleIO>; pins(): PinState[] } {
  let ms = 0;
  const clock: ProgramClock = { now: () => ms, charge: (us) => void (ms += us / 1000) };
  const uno = createVirtualUno(unoR3Board, clock);
  const modules = createModuleIO(kit, uno);
  return { uno, modules, pins: () => uno.pins() };
}

const pin = (id: string, state: Partial<PinState>): PinState => ({ pin: id, mode: 'OUTPUT', level: 0, duty: 0, toneHz: null, servoDeg: null, ...state });
const high = (id: string) => pin(id, { level: 1, duty: 255 });
const low = (id: string) => pin(id, { level: 0, duty: 0 });

describe('hbridgeCommand (hbridge-en-in1-in2, contract U-20)', () => {
  it('inverts motor.set: the EN duty, and the direction from IN1/IN2', () => {
    const { modules, pins } = bench();
    const command = () => {
      const [en, in1, in2] = ['D5', 'D7', 'D8'].map((id) => pins().find((state) => state.pin === id)!);
      return hbridgeCommand(en!, in1!, in2!);
    };
    modules.call('motorLeft', 'motor.set', [50]);
    expect(command()).toEqual({ duty: 128, dir: 1, brake: false });
    modules.call('motorLeft', 'motor.set', [-30]);
    expect(command()).toEqual({ duty: 77, dir: -1, brake: false });
    modules.call('motorLeft', 'motor.set', [100]);
    expect(command()).toEqual({ duty: 255, dir: 1, brake: false });
    modules.call('motorLeft', 'motor.set', [-1]);
    expect(command()).toEqual({ duty: 3, dir: -1, brake: false });
    // 0: both IN LOW and EN LOW, the motor's terminals open: it coasts.
    modules.call('motorLeft', 'motor.set', [0]);
    expect(command()).toEqual({ duty: 0, dir: 0, brake: false });
  });

  it('coasts while EN is LOW or not driven, whatever IN1/IN2 say', () => {
    expect(hbridgeCommand(low('D5'), high('D7'), low('D8'))).toEqual({ duty: 0, dir: 0, brake: false });
    expect(hbridgeCommand(low('D5'), high('D7'), high('D8'))).toEqual({ duty: 0, dir: 0, brake: false });
    // An input (the motor's setup never ran): no drive at all.
    expect(hbridgeCommand(pin('D5', { mode: 'INPUT' }), pin('D7', { mode: 'INPUT' }), pin('D8', { mode: 'INPUT' }))).toEqual({ duty: 0, dir: 0, brake: false });
  });

  it('brakes only with EN on and IN1 = IN2 (the shorted motor), and keeps the duty the bridge gives', () => {
    expect(hbridgeCommand(high('D5'), high('D7'), high('D8'))).toEqual({ duty: 255, dir: 0, brake: true });
    expect(hbridgeCommand(high('D5'), low('D7'), low('D8'))).toEqual({ duty: 255, dir: 0, brake: true });
    expect(hbridgeCommand(pin('D5', { duty: 128 }), low('D7'), low('D8'))).toEqual({ duty: 128, dir: 0, brake: true });
    expect(hbridgeCommand(pin('D5', { duty: 128 }), low('D7'), high('D8'))).toEqual({ duty: 128, dir: -1, brake: false });
  });
});

describe('the other module models', () => {
  it('servo: the angle written to the pin (servo-lib attaches at 90°, U-23), null before it is attached', () => {
    const { modules, pins, uno } = bench();
    const servo = () => servoAngleOf(pins().find((state) => state.pin === 'D9')!);
    expect(servo()).toBe(90);
    modules.call('servo1', 'servo.set', [45]);
    expect(servo()).toBe(45);
    modules.call('servo1', 'servo.set', [200]);
    expect(servo()).toBe(180);
    expect(servoAngleOf(createVirtualUno(uno.board, { now: () => 0, charge() {} }).pins().find((state) => state.pin === 'D9')!)).toBeNull();
  });

  it('LED: lit while its pin drives HIGH (led-digital, U-24)', () => {
    const { modules, pins } = bench();
    const led = () => ledLit(pins().find((state) => state.pin === 'D13')!);
    expect(led()).toBe(false);
    modules.call('led1', 'led.set', [1]);
    expect(led()).toBe(true);
    modules.call('led1', 'led.set', [0]);
    expect(led()).toBe(false);
    // An input with its pull-up reads HIGH, but drives no LED.
    expect(ledLit(pin('D13', { mode: 'INPUT_PULLUP', level: 1, duty: 0 }))).toBe(false);
  });

  it('buzzer: the frequency playing on its pin, or null (buzzer-tone, U-25, U-26)', () => {
    const { modules, pins } = bench();
    const buzzer = () => buzzerHzOf(pins().find((state) => state.pin === 'D10')!);
    expect(buzzer()).toBeNull();
    modules.call('buzzer', 'buzzer.tone', [440, 200]);
    expect(buzzer()).toBe(440);
    modules.call('buzzer', 'buzzer.stop', []);
    expect(buzzer()).toBeNull();
  });
});

describe('createModuleModels (ref-uno-rover@0)', () => {
  it('maps the kit’s pins to actuator targets: both motors always, a servo once attached; the LEDs and the buzzer by role', () => {
    let ms = 0;
    const uno = createVirtualUno(unoR3Board, { now: () => ms, charge: (us) => void (ms += us / 1000) });
    const models = createModuleModels(kit, unoR3Board);
    expect(models.targets(uno.pins())).toEqual({
      motors: { motorLeft: { duty: 0, dir: 0, brake: false }, motorRight: { duty: 0, dir: 0, brake: false } },
      servos: {},
    });
    expect(models.leds(uno.pins())).toEqual({ led1: false });
    expect(models.buzzerHz(uno.pins())).toBeNull();

    const modules = createModuleIO(kit, uno);
    modules.call('drive', 'drive.move', [2, 60]);
    modules.call('servo1', 'servo.set', [30]);
    modules.call('led1', 'led.set', [1]);
    modules.call('buzzer', 'buzzer.tone', [880, 1000]);
    // spinLeft: left −s, right +s.
    expect(models.targets(uno.pins())).toEqual({
      motors: { motorLeft: { duty: 153, dir: -1, brake: false }, motorRight: { duty: 153, dir: 1, brake: false } },
      servos: { servo1: 30 },
    });
    expect(models.leds(uno.pins())).toEqual({ led1: true });
    expect(models.buzzerHz(uno.pins())).toBe(880);
    // The tone runs out by itself after its 1000 ms of program time.
    ms += 1000;
    expect(models.buzzerHz(uno.pins())).toBeNull();
  });
});
