import { describe, expect, expectTypeOf, it } from 'vitest';
import type { HardwareDiagnosticCode } from '../capabilities/diagnostics';
import { kitBoardTarget } from './board-target';
import { productionKits, referenceKitRef, unoR3Board as board } from './catalog';
import type { Kit, KitPort } from './kit';
import { checkKit, rawPinCheck, type HardwareDiagnostic, type KitUsage } from './pin-rules';

// N18 R1.2 (robot plan §4.2, contract §5.2, §5.3, §9): the pin rules of a kit and of the raw pins of a program.

const rover = productionKits.get(referenceKitRef) as Kit;
const usages: KitUsage[] = [false, true].flatMap((servo) => [false, true].flatMap((tone) => [false, true].map((serial) => ({ servo, tone, serial }))));
const all: KitUsage = { servo: true, tone: true, serial: true };
const none: KitUsage = { servo: false, tone: false, serial: false };

/** The reference kit with one port's pins changed. */
function rewired(portId: string, pins: Record<string, string>): Kit {
  return { ...rover, ports: rover.ports.map((port) => (port.id === portId ? { ...port, pins: { ...port.pins, ...pins } } : port)) };
}

/** A kit of the given ports, one module each (the role is the vocabulary role of the port's kind). */
function kitOf(ports: { port: KitPort; role: Kit['modules'][number]['role'] }[]): Kit {
  return {
    id: 'test-kit',
    version: '0',
    board: 'uno-r3',
    ports: ports.map(({ port }) => port),
    modules: ports.map(({ port, role }) => ({
      role,
      kind: rover.modules.find((module) => module.role === role)?.kind ?? 'led',
      port: port.id,
      mount: { posCm: [0, 0, 0], yawDeg: 0 },
      spec: {},
    })),
  };
}
const motor = (id: string, en: string, in1: string, in2: string): KitPort => ({ id, driver: 'hbridge-en-in1-in2', pins: { EN: en, IN1: in1, IN2: in2 } });
const servo = (pin: string): KitPort => ({ id: 'SV1', driver: 'servo-lib', pins: { PIN: pin } });
const buzzer = (pin: string): KitPort => ({ id: 'BZ1', driver: 'buzzer-tone', pins: { PIN: pin } });

describe('checkKit', () => {
  it('ref-uno-rover has no diagnostics', () => {
    for (const usage of usages) {
      expect(checkKit(rover, board, usage), JSON.stringify(usage)).toEqual([]);
    }
  });

  it('two ports on one pin → pin-conflict', () => {
    expect(checkKit(rewired('M2', { EN: 'D5' }), board, none)).toEqual([
      { severity: 'error', code: 'pin-conflict', pin: 'D5', ports: ['M1', 'M2'], message: 'Pin D5 is wired to more than one port: M1 (EN), M2 (EN).' },
    ]);
  });

  it('finds a conflict inside one port too, once per pin, in board order', () => {
    const diagnostics = checkKit(rewired('M1', { IN1: 'D8' }), board, none);
    expect(diagnostics.map(({ code, pin, ports }) => ({ code, pin, ports }))).toEqual([{ code: 'pin-conflict', pin: 'D8', ports: ['M1'] }]);
  });

  it('pwm on D10 with servo is refused with timer-claimed', () => {
    const kit = kitOf([{ port: motor('M1', 'D10', 'D7', 'D8'), role: 'motorLeft' }, { port: servo('D9'), role: 'servo1' }]);
    expect(checkKit(kit, board, { ...none, servo: true })).toEqual([
      {
        severity: 'error',
        code: 'timer-claimed',
        pin: 'D10',
        ports: ['M1'],
        message: 'Port M1 needs PWM on D10, but the servo holds timer T1 there: the pin would stay LOW (contract U-48).',
      },
    ]);
    // Without a servo in the program, the Servo library never takes Timer1 (contract §2.3: setup lines only for rows used).
    expect(checkKit(kit, board, none)).toEqual([]);
  });

  it('refuses PWM on D3 or D11 while the program plays a tone (Timer2)', () => {
    const kit = kitOf([{ port: motor('M1', 'D11', 'D7', 'D8'), role: 'motorLeft' }, { port: motor('M2', 'D3', 'D4', 'D2'), role: 'motorRight' }, { port: buzzer('D12'), role: 'buzzer' }]);
    expect(checkKit(kit, board, { ...none, tone: true }).map(({ code, pin, ports }) => ({ code, pin, ports }))).toEqual([
      { code: 'timer-claimed', pin: 'D11', ports: ['M1'] },
      { code: 'timer-claimed', pin: 'D3', ports: ['M2'] },
    ]);
    expect(checkKit(kit, board, { ...none, servo: true })).toEqual([]);
  });

  it('D0 used while serial → pin-reserved', () => {
    const kit = rewired('LED1', { PIN: 'D0' });
    expect(checkKit(kit, board, { ...none, serial: true })).toEqual([
      { severity: 'error', code: 'pin-reserved', pin: 'D0', ports: ['LED1'], message: 'Port LED1 uses D0, but the program prints: Serial holds D0 and D1.' },
    ]);
    expect(checkKit(kit, board, none)).toEqual([]);
  });

  it('reports only hardware codes', () => {
    expectTypeOf<HardwareDiagnostic['code']>().toEqualTypeOf<HardwareDiagnosticCode>();
  });
});

describe('rawPinCheck: the pins an Advanced program may name (contract §9, U-31…U-34)', () => {
  const target = kitBoardTarget(rover, board);
  const verdict = (op: Parameters<typeof rawPinCheck>[1], pin: string, usage: KitUsage = all) => {
    const diagnostic = rawPinCheck(target, op, pin, usage);
    return diagnostic ? `${diagnostic.severity} ${diagnostic.code}` : 'ok';
  };

  it('pwm.write on ref-uno-rover@0: every PWM pin is the kit’s (pin-unavailable); A3..A5 work without PWM (not-pwm)', () => {
    expect(['D3', 'D5', 'D6', 'D9', 'D10', 'D11'].map((pin) => verdict('pwm.write', pin))).toEqual(Array(6).fill('error pin-unavailable'));
    expect(['A3', 'A4', 'A5'].map((pin) => verdict('pwm.write', pin))).toEqual(Array(3).fill('warning not-pwm'));
  });

  it('digital.write: a free pin only, and D0/D1 only while the program does not print', () => {
    expect(verdict('digital.write', 'A3')).toBe('ok');
    expect(verdict('digital.write', 'D13')).toBe('error pin-unavailable');
    expect(verdict('digital.write', 'D0', all)).toBe('error pin-unavailable');
    expect(verdict('digital.write', 'D0', none)).toBe('ok');
    expect(verdict('digital.write', 'D20')).toBe('error pin-unavailable');
  });

  it('digital.read: only a pin wired to an input module; analogIn.read: only an analog pin of an analog module', () => {
    expect(['D3', 'D11', 'A0', 'A1', 'A2'].map((pin) => verdict('digital.read', pin))).toEqual(Array(5).fill('ok'));
    expect(['D13', 'D5', 'A4'].map((pin) => verdict('digital.read', pin))).toEqual(Array(3).fill('error pin-unavailable'));
    expect(['A0', 'A1', 'A2'].map((pin) => verdict('analogIn.read', pin))).toEqual(Array(3).fill('ok'));
    expect(['A3', 'D3'].map((pin) => verdict('analogIn.read', pin))).toEqual(Array(2).fill('error pin-unavailable'));
  });

  it('pwm.write on a free PWM pin whose timer the program’s servo or tone holds is timer-claimed', () => {
    const servoOnly = kitBoardTarget(kitOf([{ port: servo('D9'), role: 'servo1' }]), board);
    expect(rawPinCheck(servoOnly, 'pwm.write', 'D10', { ...none, servo: true })).toEqual({
      severity: 'error',
      code: 'timer-claimed',
      pin: 'D10',
      message: 'PWM on D10 is not possible: the servo holds timer T1 there, so the pin would stay LOW (contract U-48).',
    });
    expect(rawPinCheck(servoOnly, 'pwm.write', 'D10', none)).toBeNull();
    expect(rawPinCheck(servoOnly, 'pwm.write', 'D3', { ...none, servo: true })).toBeNull();
  });
});
