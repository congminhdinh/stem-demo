import { describe, expect, it } from 'vitest';
import type { ProgramClock } from '../../capabilities/services';
import { productionKits, referenceKitRef, unoR3Board as board } from '../catalog';
import type { Kit, KitPort } from '../kit';
import { createVirtualUno, type PinState } from '../virtual-uno';
import { drivers, echoToCm, motorDuty, runSetup } from './index';

// N18 R1.4: each driver's TS `sim` against the semantics of its contract row (docs/uno-compatibility-contract.md §6), on the
// virtual UNO's pins, with the ports of ref-uno-rover@0.

const rover = productionKits.get(referenceKitRef) as Kit;
const portOf = (id: string) => rover.ports.find((port) => port.id === id) as KitPort;

function bench() {
  let us = 0;
  const clock: ProgramClock = { now: () => us / 1000, charge: (by) => (us += by) && undefined };
  const uno = createVirtualUno(board, clock);
  const state = (pin: string) => uno.pins().find((candidate) => candidate.pin === pin) as PinState;
  const run = (portId: string, op: string, args: number[] = []) => {
    const port = portOf(portId);
    const driverOp = drivers[port.driver].ops[op];
    if (!driverOp) {
      throw new Error(`no ${op}`);
    }
    return driverOp.sim(uno.io, port, args);
  };
  const setup = (portId: string, op: string) => runSetup(uno.io, portOf(portId), drivers[portOf(portId).driver].ops[op]?.setup ?? []);
  const charged = (work: () => unknown) => {
    const before = us;
    work();
    return us - before;
  };
  return { uno, clock, state, run, setup, charged };
}

describe('hbridge-en-in1-in2 (U-20)', () => {
  it('motor.set(motorLeft, 50) → D5 duty 128, D7 HIGH, D8 LOW', () => {
    const { state, run, setup } = bench();
    setup('M1', 'motor.set');
    run('M1', 'motor.set', [50]);
    expect([state('D5').duty, state('D7').level, state('D8').level]).toEqual([128, 1, 0]);
  });

  it('motor.set(-100) → D7 LOW, D8 HIGH, duty 255', () => {
    const { state, run, setup } = bench();
    setup('M1', 'motor.set');
    run('M1', 'motor.set', [-100]);
    expect([state('D7').level, state('D8').level, state('D5').duty]).toEqual([0, 1, 255]);
  });

  it('gives every speed −100..100 the duty round(|s| × 255 / 100) and the direction of its sign', () => {
    const { state, run, setup } = bench();
    setup('M1', 'motor.set');
    for (let speed = -100; speed <= 100; speed += 1) {
      run('M1', 'motor.set', [speed]);
      const duty = Math.round((Math.abs(speed) * 255) / 100);
      expect(motorDuty(speed), String(speed)).toBe(duty);
      expect(state('D5').duty, String(speed)).toBe(duty);
      expect([state('D7').level, state('D8').level], String(speed)).toEqual(speed > 0 ? [1, 0] : speed < 0 ? [0, 1] : [0, 0]);
    }
  });

  it('has the traced duties 50 → 128, 30 → 77, 1 → 3, 60 → 153, 40 → 102 (EMU-02, EMU-13); 0 puts EN and both IN LOW', () => {
    expect([50, 30, 1, 60, 40].map(motorDuty)).toEqual([128, 77, 3, 153, 102]);
    const { state, run, setup } = bench();
    setup('M2', 'motor.set');
    run('M2', 'motor.set', [-30]);
    run('M2', 'motor.set', [0]);
    expect([state('D6'), state('D4'), state('D2')].map((pin) => [pin.mode, pin.level, pin.duty])).toEqual([['OUTPUT', 0, 0], ['OUTPUT', 0, 0], ['OUTPUT', 0, 0]]);
  });

  it('clamps beyond ±100 as the helper does: 150 is full speed (EMU-13)', () => {
    const { state, run, setup } = bench();
    setup('M1', 'motor.set');
    run('M1', 'motor.set', [150]);
    expect([state('D5').duty, state('D7').level]).toEqual([255, 1]);
    run('M1', 'motor.set', [-2_147_483_648]);
    expect([state('D5').duty, state('D8').level]).toEqual([255, 1]);
  });

  it('charges two digitalWrite, the helper’s own arithmetic (motorSetOverhead, contract 0.1.5) and one analogWrite, the setup three pinMode', () => {
    const { run, setup, charged } = bench();
    expect(charged(() => setup('M1', 'motor.set'))).toBe(3 * 4.375);
    // 58.875 µs: what motorSet(50) measured on avr8js (EMU-17).
    expect(charged(() => run('M1', 'motor.set', [50]))).toBe(2 * 4.5625 + 42.0625 + 7.6875);
    expect(charged(() => run('M1', 'motor.set', [100]))).toBe(2 * 4.5625 + 42.0625 + 11.875);
  });
});

describe('hcsr04-pulsein (U-27)', () => {
  it('converts the echo’s µs to whole cm at 58 µs per cm, clamped to 2..400 (EMU-03)', () => {
    expect([1160, 1155, 580, 2900, 116, 58, 1, 23_200, 23_034, 23_260, 30_000].map(echoToCm)).toEqual([20, 19, 10, 50, 2, 2, 2, 400, 397, 400, 400]);
  });

  it('ultrasonic 400 when pulse source times out', () => {
    const { uno, run } = bench();
    expect(run('US1', 'ultrasonic.cm')).toBe(400);
    uno.attachPulseSource('D11', () => 0);
    expect(run('US1', 'ultrasonic.cm')).toBe(400);
    uno.attachPulseSource('D11', () => ({ waitUs: 450, widthUs: 30_500 }));
    expect(run('US1', 'ultrasonic.cm')).toBe(400);
  });

  it('triggers HIGH then LOW on TRIG and reads a HIGH pulse on ECHO with the 30000 µs timeout', () => {
    const { uno, run, setup } = bench();
    setup('US1', 'ultrasonic.cm');
    const trig: number[] = [];
    uno.onChange((pin) => {
      if (pin.pin === 'D12') {
        trig.push(pin.level);
      }
    });
    const asked: unknown[] = [];
    uno.attachPulseSource('D11', (level, timeoutUs) => {
      asked.push({ level, timeoutUs, trigLow: uno.pins().find((pin) => pin.pin === 'D12')?.level === 0 });
      return { waitUs: 450, widthUs: 1160 };
    });
    expect(run('US1', 'ultrasonic.cm')).toBe(20);
    expect(trig).toEqual([1, 0]);
    expect(asked).toEqual([{ level: 1, timeoutUs: 30_000, trigLow: true }]);
  });

  it('charges the contract’s whole-helper time: 1675.5625 µs for 450 µs + 1160 µs (EMU-13); 20777.6875 µs without echo', () => {
    const { uno, run, charged } = bench();
    uno.attachPulseSource('D11', () => ({ waitUs: 450, widthUs: 1160 }));
    expect(charged(() => run('US1', 'ultrasonic.cm'))).toBe(1675.5625);
    uno.attachPulseSource('D11', () => 0);
    // 3 digitalWrite + 2 + 10 µs of trigger + pulseIn's 20 752 µs; the board's 20 812 µs has the Servo's interrupts in it.
    expect(charged(() => run('US1', 'ultrasonic.cm'))).toBe(3 * 4.5625 + 12 + 20_752);
  });
});

describe('line-digital (U-28, U-29)', () => {
  const activeLowKit = (activeLow: boolean): KitPort => ({ ...portOf('LN1'), params: { activeLow } });

  it('line.dark honours activeLow', () => {
    const { uno } = bench();
    let level: 0 | 1 = 0;
    uno.attachDigitalSource('A0', () => level);
    const dark = (activeLow: boolean) => drivers['line-digital'].ops['line.dark']?.sim(uno.io, activeLowKit(activeLow), []);
    expect([dark(true), dark(false)]).toEqual([true, false]);
    level = 1;
    expect([dark(true), dark(false)]).toEqual([false, true]);
  });

  it('dark is HIGH when the kit gives no activeLow (the driver’s default)', () => {
    const { uno } = bench();
    uno.attachDigitalSource('A0', () => 1);
    const noParams: KitPort = { id: 'LN1', driver: 'line-digital', pins: { PIN: 'A0' } };
    expect(drivers['line-digital'].ops['line.dark']?.sim(uno.io, noParams, [])).toBe(true);
  });

  it('line.raw is analogRead of the same pin, 0..1023', () => {
    const { uno, run } = bench();
    uno.attachAnalogSource('A2', () => 700.4);
    expect(run('LN3', 'line.raw')).toBe(700);
  });

  it('line-analog reads raw only: the contract has no dark row for it', () => {
    expect(Object.keys(drivers['line-analog'].ops)).toEqual(['line.raw']);
  });
});

describe('button-pullup (U-30)', () => {
  it('is released when the pin reads HIGH thanks to the pull-up, pressed when it reads LOW', () => {
    const { uno, state, run, setup } = bench();
    setup('BTN1', 'button.pressed');
    expect(state('D3')).toMatchObject({ mode: 'INPUT_PULLUP', level: 1 });
    expect(run('BTN1', 'button.pressed')).toBe(false);
    let pressed = true;
    uno.attachDigitalSource('D3', () => (pressed ? 0 : 1));
    expect(run('BTN1', 'button.pressed')).toBe(true);
    pressed = false;
    expect(run('BTN1', 'button.pressed')).toBe(false);
  });
});

describe('buzzer-tone (U-25, U-26)', () => {
  it('plays hz for ms in the background, then stops by itself', () => {
    const { clock, state, run } = bench();
    run('BZ1', 'buzzer.tone', [440, 100]);
    expect(state('D10')).toMatchObject({ mode: 'OUTPUT', toneHz: 440 });
    clock.charge(99_000);
    expect(state('D10').toneHz).toBe(440);
    clock.charge(2000);
    expect(state('D10').toneHz).toBeNull();
  });

  it('clamps hz to 31..4000 and ms to 1..60000 (EMU-13: 10 → 31, 9000 → 4000, 0 ms → 1 ms)', () => {
    const { clock, state, run } = bench();
    run('BZ1', 'buzzer.tone', [10, 40]);
    expect(state('D10').toneHz).toBe(31);
    run('BZ1', 'buzzer.tone', [9000, 20]);
    expect(state('D10').toneHz).toBe(4000);
    run('BZ1', 'buzzer.tone', [1000, 0]);
    expect(state('D10').toneHz).toBe(1000);
    clock.charge(1001);
    expect(state('D10').toneHz).toBeNull();
  });

  it('buzzer.stop is noTone: silent and LOW at once', () => {
    const { state, run } = bench();
    run('BZ1', 'buzzer.tone', [1000, 1000]);
    run('BZ1', 'buzzer.stop');
    expect(state('D10')).toMatchObject({ toneHz: null, level: 0 });
  });
});

describe('servo-lib (U-23) and led-digital (U-24)', () => {
  it('starts the servo at 90° in setup, sets 0..180 and clamps beyond (EMU-13: 600 → 180, −5 → 0)', () => {
    const { state, run, setup } = bench();
    setup('SV1', 'servo.set');
    expect(state('D9')).toMatchObject({ mode: 'OUTPUT', servoDeg: 90 });
    run('SV1', 'servo.set', [45]);
    expect(state('D9').servoDeg).toBe(45);
    run('SV1', 'servo.set', [600]);
    expect(state('D9').servoDeg).toBe(180);
    run('SV1', 'servo.set', [-5]);
    expect(state('D9').servoDeg).toBe(0);
  });

  it('starts the LED off as an OUTPUT, HIGH when on and LOW when off', () => {
    const { state, run, setup } = bench();
    setup('LED1', 'led.set');
    expect(state('D13')).toMatchObject({ mode: 'OUTPUT', level: 0 });
    run('LED1', 'led.set', [1]);
    expect(state('D13').level).toBe(1);
    run('LED1', 'led.set', [0]);
    expect(state('D13').level).toBe(0);
  });
});
