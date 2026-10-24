import { describe, expect, expectTypeOf, it } from 'vitest';
import type { ModuleIO } from '../capabilities/io';
import type { ProgramClock } from '../capabilities/services';
import { createModuleIO } from './binding';
import { productionKits, referenceKitRef, unoR3Board as board } from './catalog';
import { DRIVE_ROLE, driveDirections } from './drivers';
import type { Kit } from './kit';
import { createVirtualUno, type PinState } from './virtual-uno';

// N18 R1.4 (robot plan §4.3, §4.4): the `modules` capability, role → port → driver → pins of the virtual UNO.

const rover = productionKits.get(referenceKitRef) as Kit;
const direction = (name: (typeof driveDirections)[number]) => driveDirections.indexOf(name);

function robot(uses?: Parameters<typeof createModuleIO>[2]) {
  let us = 0;
  const clock: ProgramClock = { now: () => us / 1000, charge: (by) => (us += by) && undefined };
  const uno = createVirtualUno(board, clock);
  const changed: string[] = [];
  uno.onChange((pin) => changed.push(pin.pin));
  const modules = createModuleIO(rover, uno, uses);
  const state = (pin: string) => uno.pins().find((candidate) => candidate.pin === pin) as PinState;
  const levels = (...pins: string[]) => pins.map((pin) => state(pin).level);
  return { uno, modules, state, levels, changed, elapsedUs: () => us };
}

describe('createModuleIO', () => {
  it('is a ModuleIO', () => {
    expectTypeOf(createModuleIO).returns.toExtend<ModuleIO>();
  });

  it('runs setup() in kit port order: motors, ultrasonic, line, LED, button, servo (the buzzer has none)', () => {
    const { state, changed, elapsedUs } = robot();
    // Pins already INPUT (ECHO, the line sensors) do not change.
    expect(changed).toEqual(['D5', 'D7', 'D8', 'D6', 'D4', 'D2', 'D12', 'D13', 'D3', 'D9']);
    expect(state('D9').servoDeg).toBe(90);
    expect(state('D3').mode).toBe('INPUT_PULLUP');
    expect(state('D10').mode).toBe('INPUT');
    // 6 + 2 + 3 + 1 pinMode, 1 INPUT_PULLUP, Servo.write(90).
    expect(elapsedUs()).toBe(12 * 4.375 + 4.75 + 49.5);
  });

  it('sets up only what the program uses', () => {
    const { state, changed } = robot([{ role: 'led1', op: 'led.set' }, { role: 'lineLeft', op: 'line.raw' }]);
    expect(changed).toEqual(['D13']);
    expect(state('D9').servoDeg).toBeNull();
    const drive = robot([{ role: DRIVE_ROLE, op: 'drive.stop' }]);
    expect(drive.changed).toEqual(['D5', 'D7', 'D8', 'D6', 'D4', 'D2']);
  });

  it('refuses a use the kit does not have, and a kit for another board', () => {
    expect(() => robot([{ role: 'servo1', op: 'motor.set' }])).toThrow(/no motor\.set on servo1/);
    const uno = createVirtualUno({ ...board, id: 'nano' }, { now: () => 0, charge: () => {} });
    expect(() => createModuleIO(rover, uno)).toThrow(/is for uno-r3, not nano/);
  });
});

describe('module calls', () => {
  it('motor.set(motorLeft, 50) → D5 duty 128, D7 HIGH, D8 LOW', () => {
    const { modules, state, levels } = robot();
    modules.call('motorLeft', 'motor.set', [50]);
    expect([state('D5').duty, ...levels('D7', 'D8')]).toEqual([128, 1, 0]);
  });

  it('motor.set(-100) → D7 LOW, D8 HIGH, duty 255', () => {
    const { modules, state, levels } = robot();
    modules.call('motorLeft', 'motor.set', [-100]);
    expect([...levels('D7', 'D8'), state('D5').duty]).toEqual([0, 1, 255]);
  });

  it('clamps out of range with value-clamped once per role per run (contract §0.5)', () => {
    const { uno, modules, state } = robot();
    modules.call('motorLeft', 'motor.set', [150]);
    modules.call('motorLeft', 'motor.set', [-150]);
    modules.call('servo1', 'servo.set', [600]);
    modules.call('buzzer', 'buzzer.tone', [10, 0]);
    expect(state('D5').duty).toBe(255);
    expect(state('D9').servoDeg).toBe(180);
    expect(uno.diagnostics().map(({ severity, code, role }) => `${severity} ${code} ${String(role)}`)).toEqual([
      'warning value-clamped motorLeft',
      'warning value-clamped servo1',
      'warning value-clamped buzzer',
    ]);
    expect(uno.diagnostics()[0]?.message).toBe('motor.set on motorLeft: speed 150 is outside -100..100, so 100 is used.');
  });

  it('drives forward 60 and spins left 40 as the contract traced it (EMU-13), and stops with every motor pin LOW', () => {
    const { modules, state, levels } = robot();
    modules.call(DRIVE_ROLE, 'drive.move', [direction('forward'), 60]);
    expect([state('D5').duty, state('D6').duty, ...levels('D7', 'D8', 'D4', 'D2')]).toEqual([153, 153, 1, 0, 1, 0]);
    modules.call(DRIVE_ROLE, 'drive.move', [direction('spinLeft'), 40]);
    expect([state('D5').duty, state('D6').duty, ...levels('D7', 'D8', 'D4', 'D2')]).toEqual([102, 102, 0, 1, 1, 0]);
    modules.call(DRIVE_ROLE, 'drive.move', [direction('spinRight'), 40]);
    expect(levels('D7', 'D8', 'D4', 'D2')).toEqual([1, 0, 0, 1]);
    modules.call(DRIVE_ROLE, 'drive.move', [direction('backward'), 40]);
    expect(levels('D7', 'D8', 'D4', 'D2')).toEqual([0, 1, 0, 1]);
    modules.call(DRIVE_ROLE, 'drive.stop', []);
    expect([state('D5').duty, state('D6').duty, ...levels('D7', 'D8', 'D4', 'D2')]).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it('negates the drive speed with an int32 wrap, then lets each motor clamp (neg32, contract U-21)', () => {
    const { uno, modules, levels } = robot();
    modules.call(DRIVE_ROLE, 'drive.move', [direction('backward'), -2_147_483_648]);
    // neg32(INT32_MIN) is INT32_MIN: both motors full speed backward, each warned once.
    expect(levels('D7', 'D8', 'D4', 'D2')).toEqual([0, 1, 0, 1]);
    expect(uno.diagnostics().map((diagnostic) => diagnostic.role)).toEqual(['motorLeft', 'motorRight']);
  });

  it('turns the LED on and off, and plays and stops the buzzer', () => {
    const { modules, state } = robot();
    modules.call('led1', 'led.set', [1]);
    expect(state('D13').level).toBe(1);
    modules.call('led1', 'led.set', [0]);
    expect(state('D13').level).toBe(0);
    modules.call('buzzer', 'buzzer.tone', [880, 30]);
    expect(state('D10').toneHz).toBe(880);
    modules.call('buzzer', 'buzzer.stop', []);
    expect(state('D10').toneHz).toBeNull();
  });
});

describe('module reads', () => {
  it('reads the ultrasonic distance, the line, the raw line and the button from the pins the world drives', () => {
    const { uno, modules } = robot();
    uno.attachPulseSource('D11', () => ({ waitUs: 450, widthUs: 50 * 58 }));
    uno.attachDigitalSource('A1', () => 1);
    uno.attachAnalogSource('A1', () => 900);
    uno.attachDigitalSource('D3', () => 0);
    expect(modules.read('ultrasonic', 'ultrasonic.cm')).toBe(50);
    expect(modules.read('lineCenter', 'line.dark')).toBe(true);
    expect(modules.read('lineCenter', 'line.raw')).toBe(900);
    expect(modules.read('lineLeft', 'line.dark')).toBe(false);
    expect(modules.read('button1', 'button.pressed')).toBe(true);
  });

  it('refuses a role the kit lacks, an op its driver lacks, and a call used as a read', () => {
    const { modules } = robot();
    expect(() => modules.call('motorFront', 'motor.set', [1])).toThrow(/has no motorFront/);
    expect(() => modules.read('led1', 'line.dark')).toThrow(/led1 \(led-digital\) has no op line\.dark/);
    expect(() => modules.read('led1', 'led.set')).toThrow(/led\.set is a call, not a read/);
    expect(() => modules.call(DRIVE_ROLE, 'drive.move', [7, 10])).toThrow(/no direction 7/);
  });

  it('refuses the drive on a kit without both motors', () => {
    let us = 0;
    const uno = createVirtualUno(board, { now: () => us / 1000, charge: (by) => (us += by) && undefined });
    const oneMotor: Kit = { ...rover, ports: rover.ports.slice(0, 1), modules: rover.modules.slice(0, 1) };
    const modules = createModuleIO(oneMotor, uno);
    expect(() => modules.call(DRIVE_ROLE, 'drive.stop', [])).toThrow(/has no drive\.stop: the drive needs motorLeft and motorRight/);
    expect(() => modules.call(DRIVE_ROLE, 'drive.turn', [])).toThrow(/has no drive\.turn/);
  });
});
